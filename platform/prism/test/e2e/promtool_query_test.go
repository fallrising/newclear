//go:build integration

package e2e_test

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"io"
	"net"
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

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// This gate exercises the built daemon, OTLP admission, its shared memory
// backend, the actual upstream promtool client, and bounded process shutdown.
func TestPromtoolHTTPQuery(t *testing.T) {
	daemon, promtool := os.Getenv("PRISMD_BINARY"), os.Getenv("PROMTOOL_BINARY")
	if daemon == "" || promtool == "" {
		t.Fatal("set PRISMD_BINARY and PROMTOOL_BINARY (Prometheus 2.53.0); see test/e2e/README.md")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 35*time.Second)
	defer cancel()
	module, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	const key = "public-promtool-query-fixture-not-for-production"
	keyFile := filepath.Join(dir, "key")
	if err := os.WriteFile(keyFile, []byte(key), 0o600); err != nil {
		t.Fatal(err)
	}
	clientConfig := filepath.Join(dir, "client.yaml")
	if err := os.WriteFile(clientConfig, []byte(fmt.Sprintf("authorization:\n  credentials_file: %q\n", keyFile)), 0o600); err != nil {
		t.Fatal(err)
	}
	httpAddress, grpcAddress := querySmokeAddresses(t)
	endpoint := "http://" + httpAddress
	env := append(os.Environ(),
		"PRISM_SERVER_HTTP_LISTEN="+httpAddress, "PRISM_SERVER_GRPC_LISTEN="+grpcAddress,
		"PRISM_SERVER_SHUTDOWN_TIMEOUT=2s", "PRISM_AUTH_INGEST_API_KEY_FILE="+keyFile,
		"PRISM_AUTH_ALLOW_ANONYMOUS_READ=false", "PRISM_TENANCY_DEFAULT_TENANT=promtool",
		"PRISM_SERVER_MODE=all-in-one", "PRISM_INGEST_BATCH_METRICS_FLUSH_INTERVAL=10ms",
	)
	args := []string{"--config", filepath.Join(module, "internal/config/testdata/prismd.yaml")}
	check := exec.CommandContext(ctx, daemon, append(args, "--config-check")...) //nolint:gosec // Explicit local integration executable; no shell.
	check.Env = env
	if output, err := check.CombinedOutput(); err != nil || !strings.Contains(string(output), "configuration valid") {
		t.Fatalf("query daemon config-check failed: %v", err)
	}
	logs := new(boundedProcessLog)
	command := exec.CommandContext(ctx, daemon, args...) //nolint:gosec // Explicit local integration executable; no shell.
	command.Env = env
	command.Stdout, command.Stderr = logs, logs
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
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/-/healthy", nil)
		if err != nil {
			t.Fatal(err)
		}
		if response, err := client.Do(request); err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				break
			}
		}
		select {
		case err := <-exited:
			joined = true
			t.Fatalf("daemon exited during startup: %v", err)
		case <-ctx.Done():
			t.Fatal("daemon startup timeout")
		case <-ticker.C:
		}
	}
	request := func(method, path, body string, authenticated bool) (int, http.Header, []byte) {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, endpoint+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if authenticated {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		if method == http.MethodPost {
			req.Header.Set("Content-Type", "application/json")
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = response.Body.Close() }()
		data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), key) {
			t.Fatal("HTTP response exposed credential")
		}
		return response.StatusCode, response.Header, data
	}
	if code, headers, _ := request(http.MethodGet, "/prom/api/v1/query?query=vector(1)", "", false); code != http.StatusUnauthorized || headers.Get("X-Prism-Error-Class") == "" {
		t.Fatalf("anonymous query status=%d", code)
	}
	instant := time.Now().UTC().Truncate(time.Second)
	load := fmt.Sprintf(`{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"prism_query_fixture","gauge":{"dataPoints":[{"asDouble":42.5,"timeUnixNano":%q}]}}]}]}]}`, strconv.FormatInt(utm.TimeToNano(instant), 10))
	if code, _, _ := request(http.MethodPost, "/v1/metrics", load, true); code != http.StatusOK {
		t.Fatalf("OTLP load status=%d", code)
	}
	queryPath := "/prom/api/v1/query?query=prism_query_fixture&time=" + url.QueryEscape(instant.Format(time.RFC3339))
	for {
		code, _, data := request(http.MethodGet, queryPath, "", true)
		if code != http.StatusOK {
			t.Fatalf("query status=%d body=%s", code, data)
		}
		var response struct {
			Data struct {
				Result []struct {
					Value []any `json:"value"`
				} `json:"result"`
			} `json:"data"`
		}
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if len(response.Data.Result) == 1 && len(response.Data.Result[0].Value) == 2 && response.Data.Result[0].Value[1] == "42.5" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("admitted metric did not become queryable")
		case <-ticker.C:
		}
	}
	for _, queryArgs := range [][]string{
		{"query", "instant", "--time=" + instant.Format(time.RFC3339), endpoint + "/prom", "prism_query_fixture"},
		{"query", "range", "--start=" + instant.Format(time.RFC3339), "--end=" + instant.Add(2*time.Second).Format(time.RFC3339), "--step=1s", endpoint + "/prom", "prism_query_fixture"},
	} {
		arguments := append([]string{queryArgs[0], "--http.config.file=" + clientConfig}, queryArgs[1:]...)
		cmd := exec.CommandContext(ctx, promtool, arguments...) //nolint:gosec // Pinned explicit integration binary; no shell.
		cmd.WaitDelay = time.Second
		output := new(boundedProcessLog)
		cmd.Stdout, cmd.Stderr = output, output
		if err := cmd.Run(); err != nil || !strings.Contains(output.String(), "42.5") {
			t.Fatalf("real promtool %s failed: %v, output=%s", queryArgs[1], err, output.String())
		}
	}
	for path, required := range map[string]string{
		"/prom/api/v1/labels":                             "__name__",
		"/prom/api/v1/label/__name__/values":              "prism_query_fixture",
		"/prom/api/v1/series?match[]=prism_query_fixture": "prism_query_fixture",
		"/prom/api/v1/metadata":                           `"data":{}`,
		"/prom/api/v1/status/buildinfo":                   "2.53.0",
	} {
		code, _, data := request(http.MethodGet, path, "", true)
		if code != http.StatusOK || !strings.Contains(string(data), required) || strings.Contains(string(data), "__tenant__") {
			t.Fatalf("catalog/buildinfo %s: %d %s", path, code, data)
		}
	}
	badQuery := `label_replace(prism_query_fixture,"__tenant__","other","job",".*")`
	if code, headers, data := request(http.MethodGet, "/prom/api/v1/query?query="+url.QueryEscape(badQuery), "", true); code != http.StatusBadRequest || headers.Get("X-Prism-Error-Class") == "" || !strings.Contains(string(data), `"status":"error"`) {
		t.Fatalf("reserved output response: %d %s", code, data)
	}
	if code, _, data := request(http.MethodGet, "/metrics", "", false); code != http.StatusOK || !strings.Contains(string(data), "prism_query_requests_total") || !strings.Contains(string(data), `path="fallback"`) {
		t.Fatal("query self-telemetry missing")
	}
	if err := command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-exited:
		joined = true
		if err != nil {
			t.Fatalf("daemon SIGTERM: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("query daemon did not shut down within deadline")
	}
	if strings.Contains(logs.String(), key) {
		t.Fatal("daemon logged credential")
	}
	t.Log("real prismd + OTLP + promtool instant/range + catalog/auth/telemetry + SIGTERM passed")
}

func querySmokeAddresses(t *testing.T) (string, string) {
	t.Helper()
	var listeners []net.Listener
	defer func() {
		for _, listener := range listeners {
			_ = listener.Close()
		}
	}()
	for range 2 {
		listener, err := new(net.ListenConfig).Listen(t.Context(), "tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		listeners = append(listeners, listener)
	}
	return listeners[0].Addr().String(), listeners[1].Addr().String()
}
