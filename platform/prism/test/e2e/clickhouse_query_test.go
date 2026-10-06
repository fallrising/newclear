//go:build integration

package e2e_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/golang/snappy"
	"github.com/prometheus/prometheus/prompb"
)

func TestClickHouseDaemonCoreChain(t *testing.T) {
	daemon := os.Getenv("PRISMD_BINARY")
	fixtureDSN := os.Getenv("PRISM_CLICKHOUSE_TEST_DSN")
	if daemon == "" || fixtureDSN == "" {
		t.Fatal("PRISMD_BINARY and PRISM_CLICKHOUSE_TEST_DSN are required")
	}
	parsed, err := url.Parse(fixtureDSN)
	if err != nil || parsed.Scheme != "clickhouse" || parsed.Hostname() != "127.0.0.1" {
		t.Fatal("fixture must use native ClickHouse loopback")
	}
	options, err := clickhouse.ParseDSN(fixtureDSN)
	if err != nil {
		t.Fatal("invalid fixture DSN")
	}
	admin, err := clickhouse.Open(options)
	if err != nil {
		t.Fatal("cannot open fixture admin")
	}
	var random [12]byte
	if _, err := rand.Read(random[:]); err != nil {
		t.Fatal(err)
	}
	db := "prism_daemon_" + hex.EncodeToString(random[:])
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	if err := admin.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		t.Fatal("cannot create isolated daemon database")
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		if err := admin.Exec(cleanup, "DROP DATABASE IF EXISTS "+db+" SYNC"); err != nil {
			t.Errorf("drop isolated daemon database: %v", err)
		}
		if err := admin.Close(); err != nil {
			t.Errorf("close fixture admin: %v", err)
		}
	})
	parsed.Path = "/" + db
	module, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	const key = "public-clickhouse-daemon-test-credential"
	keyFile := filepath.Join(dir, "ingest-key")
	if err := os.WriteFile(keyFile, []byte(key), 0o600); err != nil {
		t.Fatal(err)
	}
	httpAddress, grpcAddress := querySmokeAddresses(t)
	endpoint := "http://" + httpAddress
	// The integration fixture variable is only for the test process. The daemon
	// receives a strict production config environment with no PRISM test keys.
	var env []string
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "PRISM_") {
			env = append(env, entry)
		}
	}
	env = append(env,
		"PRISM_STORAGE_DRIVER=clickhouse", "PRISM_STORAGE_DSN="+parsed.String(),
		"PRISM_STORAGE_OPTIONS_ASYNC_INSERT=0",
		"PRISM_SERVER_HTTP_LISTEN="+httpAddress, "PRISM_SERVER_GRPC_LISTEN="+grpcAddress,
		"PRISM_SERVER_SHUTDOWN_TIMEOUT=3s", "PRISM_SERVER_MODE=all-in-one",
		"PRISM_AUTH_INGEST_API_KEY_FILE="+keyFile, "PRISM_AUTH_ALLOW_ANONYMOUS_READ=false",
		"PRISM_TENANCY_DEFAULT_TENANT=daemon-chain", "PRISM_INGEST_BATCH_METRICS_FLUSH_INTERVAL=10ms",
		"PRISM_INGEST_BATCH_LOGS_FLUSH_INTERVAL=10ms",
	)
	args := []string{"--config", filepath.Join(module, "internal/config/testdata/prismd.yaml")}
	check := exec.CommandContext(ctx, daemon, append(args, "--config-check")...) //nolint:gosec // Pinned local test binary; no shell.
	check.Env = env
	output, err := check.CombinedOutput()
	if err != nil || !bytes.Contains(output, []byte("configuration valid")) || bytes.Contains(output, []byte("local-public-fixture")) {
		t.Fatalf("ClickHouse daemon config-check failed: %v", err)
	}
	logs := new(boundedProcessLog)
	command := exec.CommandContext(ctx, daemon, args...) //nolint:gosec // Pinned local test binary; no shell.
	command.Env, command.Stdout, command.Stderr = env, logs, logs
	command.WaitDelay = time.Second
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- command.Wait() }()
	joined := false
	defer func() {
		if !joined {
			_ = command.Process.Kill()
			<-exited
		}
	}()
	client := &http.Client{Timeout: 2 * time.Second}
	defer client.CloseIdleConnections()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		if code, _, err := daemonRequest(ctx, client, endpoint+"/-/healthy", http.MethodGet, nil, "", ""); err == nil && code == http.StatusOK {
			break
		}
		select {
		case err := <-exited:
			joined = true
			t.Fatalf("daemon exited before health: %v", err)
		case <-ctx.Done():
			t.Fatal("daemon health timeout")
		case <-ticker.C:
		}
	}
	if code, _, err := daemonRequest(ctx, client, endpoint+"/prom/api/v1/query?query=vector(1)", http.MethodGet, nil, "", ""); err != nil || code != http.StatusUnauthorized {
		t.Fatalf("anonymous query status=%d err=%v", code, err)
	}
	instant := time.Now().UTC().Truncate(time.Second)
	otlp := fmt.Sprintf(`{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"daemon_otlp_metric","gauge":{"dataPoints":[{"asDouble":41,"timeUnixNano":%q}]}}]}]}]}`, strconv.FormatInt(utm.TimeToNano(instant), 10))
	if code, _, err := daemonRequest(ctx, client, endpoint+"/v1/metrics", http.MethodPost, []byte(otlp), key, "application/json"); err != nil || code != http.StatusOK {
		t.Fatalf("OTLP ingress status=%d err=%v", code, err)
	}
	write := &prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{Labels: []prompb.Label{{Name: "__name__", Value: "daemon_remote_metric"}}, Samples: []prompb.Sample{{Timestamp: utm.TimeToMilli(instant), Value: 42}}}}}
	wire, err := write.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if code, _, err := daemonRequest(ctx, client, endpoint+"/prom/api/v1/write", http.MethodPost, snappy.Encode(nil, wire), key, "application/x-protobuf"); err != nil || code != http.StatusNoContent {
		t.Fatalf("remote_write ingress status=%d err=%v", code, err)
	}
	loki := fmt.Sprintf(`{"streams":[{"stream":{"service":"daemon"},"values":[[%q,"daemon log"]]}]}`, strconv.FormatInt(utm.TimeToNano(instant), 10))
	if code, _, err := daemonRequest(ctx, client, endpoint+"/loki/api/v1/push", http.MethodPost, []byte(loki), key, "application/json"); err != nil || code != http.StatusNoContent {
		t.Fatalf("Loki ingress status=%d err=%v", code, err)
	}
	for {
		path := "/prom/api/v1/query?query=daemon_remote_metric&time=" + url.QueryEscape(instant.Format(time.RFC3339))
		code, body, err := daemonRequest(ctx, client, endpoint+path, http.MethodGet, nil, key, "")
		if err == nil && code == http.StatusOK && bytes.Contains(body, []byte(`"42"`)) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("persistent PromQL query did not become visible: %v", ctx.Err())
		case <-ticker.C:
		}
	}
	for path, want := range map[string]string{
		"/prom/api/v1/query?query=daemon_otlp_metric&time=" + url.QueryEscape(instant.Format(time.RFC3339)):                                                                                                  `"41"`,
		"/prom/api/v1/query_range?query=daemon_remote_metric&start=" + url.QueryEscape(instant.Format(time.RFC3339)) + "&end=" + url.QueryEscape(instant.Add(time.Second).Format(time.RFC3339)) + "&step=1s": `"42"`,
		"/prom/api/v1/label/__name__/values":               "daemon_remote_metric",
		"/prom/api/v1/series?match[]=daemon_remote_metric": "daemon_remote_metric",
	} {
		code, body, err := daemonRequest(ctx, client, endpoint+path, http.MethodGet, nil, key, "")
		if err != nil || code != http.StatusOK || !bytes.Contains(body, []byte(want)) || bytes.Contains(body, []byte("__tenant__")) {
			t.Fatalf("ClickHouse query/catalog %s status=%d err=%v body=%s", path, code, err, body)
		}
	}
	readOptions := *options
	readOptions.Auth.Database = db
	reader, err := clickhouse.Open(&readOptions)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reader.Close() }()
	var metricRows, logRows uint64
	if err := reader.QueryRow(ctx, "SELECT count() FROM metric_samples WHERE tenant='daemon-chain'").Scan(&metricRows); err != nil {
		t.Fatal(err)
	}
	if err := reader.QueryRow(ctx, "SELECT count() FROM logs WHERE tenant='daemon-chain' AND body='daemon log'").Scan(&logRows); err != nil {
		t.Fatal(err)
	}
	if metricRows < 2 || logRows != 1 {
		t.Fatalf("persisted rows: metrics=%d logs=%d", metricRows, logRows)
	}
	if err := command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-exited:
		joined = true
		if err != nil {
			t.Fatalf("daemon SIGTERM error: %v", err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("daemon SIGTERM exceeded deadline")
	}
	if strings.Contains(logs.String(), "local-public-fixture") || strings.Contains(logs.String(), key) {
		t.Fatal("daemon leaked fixture credentials")
	}
}

func daemonRequest(ctx context.Context, client *http.Client, address, method string, body []byte, key, contentType string) (int, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, method, address, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	if key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if contentType == "application/x-protobuf" {
		request.Header.Set("Content-Encoding", "snappy")
		request.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, data, err
}
