//go:build integration

package e2e_test

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
)

type composeFixture struct {
	httpURL, grpcAddress, grafanaURL, dsn, key, adminPassword string
	telemetrygen, prometheus, vector                          string
}

func composeEnvironment(t *testing.T) composeFixture {
	t.Helper()
	get := func(name string) string {
		value := os.Getenv(name)
		if value == "" {
			t.Fatalf("%s is required for Phase 1 Compose E2E", name)
		}
		return value
	}
	return composeFixture{
		httpURL: get("PRISM_E2E_HTTP_URL"), grpcAddress: get("PRISM_E2E_GRPC_ADDRESS"),
		grafanaURL: get("PRISM_E2E_GRAFANA_URL"), dsn: get("PRISM_E2E_CLICKHOUSE_DSN"),
		key: get("PRISM_E2E_API_KEY"), adminPassword: get("PRISM_E2E_GRAFANA_PASSWORD"),
		telemetrygen: get("OTLP_TELEMETRYGEN_BINARY"), prometheus: get("PROMETHEUS_BINARY"),
		vector: get("VECTOR_BINARY"),
	}
}

func composeRequest(t *testing.T, ctx context.Context, method, endpoint, token, password string, data []byte) (int, []byte) {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if password != "" {
		request.SetBasicAuth("admin", password)
	}
	if data != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, body
}

func composeWait(t *testing.T, ctx context.Context, label string, check func() bool) {
	t.Helper()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		if check() {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("%s not visible before deadline", label)
		case <-ticker.C:
		}
	}
}

func composeCount(t *testing.T, ctx context.Context, database clickhouse.Conn, signal string) uint64 {
	t.Helper()
	queries := map[string]string{
		"metrics": "SELECT count() FROM metric_samples WHERE tenant='default' AND metric='gen' AND value=0",
		"logs":    "SELECT count() FROM logs WHERE tenant='default' AND body!=''",
		"traces":  "SELECT count() FROM spans WHERE tenant='default' AND service='prism-compose-acceptance' AND length(trace_id)=32 AND length(span_id)=16",
	}
	var count uint64
	if err := database.QueryRow(ctx, queries[signal]).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func composeGrafanaValues(t *testing.T, body []byte) int {
	t.Helper()
	var payload struct {
		Results map[string]struct {
			Frames []struct {
				Data struct {
					Values [][]any `json:"values"`
				} `json:"data"`
			} `json:"frames"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	values := 0
	for _, result := range payload.Results {
		for _, frame := range result.Frames {
			if len(frame.Data.Values) >= 2 {
				values += len(frame.Data.Values[1])
			}
		}
	}
	return values
}

func composeGrafanaPluginPolicy(settingsBody, pluginsBody []byte) error {
	var settings struct {
		Plugins struct {
			PreinstallDisabled string `json:"preinstall_disabled"`
		} `json:"plugins"`
	}
	if err := json.Unmarshal(settingsBody, &settings); err != nil {
		return errors.New("Grafana admin settings invalid JSON")
	}
	if settings.Plugins.PreinstallDisabled != "true" {
		return errors.New("Grafana plugins.preinstall_disabled is not true")
	}
	var plugins []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(pluginsBody, &plugins); err != nil || plugins == nil {
		return errors.New("Grafana plugin inventory invalid JSON array")
	}
	for _, plugin := range plugins {
		switch plugin.ID {
		case "grafana-lokiexplore-app", "grafana-pyroscope-app", "grafana-exploretraces-app", "grafana-metricsdrilldown-app":
			return fmt.Errorf("Grafana suggested app installed: %s", plugin.ID)
		}
	}
	return nil
}

func TestComposeGrafanaPluginPolicy(t *testing.T) {
	validSettings := []byte(`{"plugins":{"preinstall_disabled":"true"}}`)
	validPlugins := []byte(`[{"id":"prometheus"}]`)
	for _, tt := range []struct {
		name     string
		settings []byte
		plugins  []byte
		wantErr  bool
	}{
		{name: "disabled and no suggested apps", settings: validSettings, plugins: validPlugins},
		{name: "disabled false", settings: []byte(`{"plugins":{"preinstall_disabled":"false"}}`), plugins: validPlugins, wantErr: true},
		{name: "missing setting", settings: []byte(`{"plugins":{}}`), plugins: validPlugins, wantErr: true},
		{name: "malformed settings", settings: []byte(`{`), plugins: validPlugins, wantErr: true},
		{name: "malformed inventory", settings: validSettings, plugins: []byte(`{`), wantErr: true},
		{name: "null inventory", settings: validSettings, plugins: []byte(`null`), wantErr: true},
		{name: "Loki Explore", settings: validSettings, plugins: []byte(`[{"id":"grafana-lokiexplore-app"}]`), wantErr: true},
		{name: "Pyroscope", settings: validSettings, plugins: []byte(`[{"id":"grafana-pyroscope-app"}]`), wantErr: true},
		{name: "Explore Traces", settings: validSettings, plugins: []byte(`[{"id":"grafana-exploretraces-app"}]`), wantErr: true},
		{name: "Metrics Drilldown", settings: validSettings, plugins: []byte(`[{"id":"grafana-metricsdrilldown-app"}]`), wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := composeGrafanaPluginPolicy(tt.settings, tt.plugins)
			if (err != nil) != tt.wantErr {
				t.Fatalf("plugin policy error=%v, wantErr=%t", err, tt.wantErr)
			}
		})
	}
}

func composePromQueryVisible(ctx context.Context, f composeFixture) bool {
	now := time.Now().Unix()
	endpoint := fmt.Sprintf("%s/prom/api/v1/query_range?query=prism_compose_fixture&start=%d&end=%d&step=15s", f.httpURL, now-600, now)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false
	}
	request.Header.Set("Authorization", "Bearer "+f.key)
	client := &http.Client{Timeout: time.Second}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<16))
	return err == nil && response.StatusCode == http.StatusOK && bytes.Contains(body, []byte(`"42.5"`))
}

func TestPhase1Compose(t *testing.T) {
	f := composeEnvironment(t)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	parsed, err := url.Parse(f.dsn)
	if err != nil || parsed.Scheme != "clickhouse" || parsed.Hostname() != "127.0.0.1" {
		t.Fatal("native ClickHouse fixture must be loopback")
	}
	options, err := clickhouse.ParseDSN(f.dsn)
	if err != nil {
		t.Fatal("invalid native ClickHouse fixture")
	}
	database, err := clickhouse.Open(options)
	if err != nil {
		t.Fatal("open native ClickHouse fixture")
	}
	defer func() {
		if err := database.Close(); err != nil {
			t.Error(err)
		}
	}()
	if err := database.Ping(ctx); err != nil {
		t.Fatal("native ClickHouse ping failed")
	}
	for _, path := range []string{"/-/healthy", "/-/ready"} {
		status, body := composeRequest(t, ctx, http.MethodGet, f.httpURL+path, "", "", nil)
		if status != http.StatusOK || string(body) != "ok\n" {
			t.Fatalf("%s status=%d body=%q", path, status, body)
		}
	}
	for _, path := range []string{"/prom/api/v1/query?query=vector(1)", "/v1/metrics"} {
		method := http.MethodGet
		if path == "/v1/metrics" {
			method = http.MethodPost
		}
		status, _ := composeRequest(t, ctx, method, f.httpURL+path, "", "", nil)
		if status != http.StatusUnauthorized {
			t.Fatalf("anonymous %s status=%d", path, status)
		}
	}
	status, _ := composeRequest(t, ctx, http.MethodGet, f.httpURL+"/prom/api/v1/query?query="+url.QueryEscape(`{__tenant__="other"}`), f.key, "", nil)
	if status < 400 {
		t.Fatalf("reserved tenant matcher accepted: %d", status)
	}
	for _, transport := range []string{"http", "grpc"} {
		for _, signal := range []string{"metrics", "logs", "traces"} {
			before := composeCount(t, ctx, database, signal)
			endpoint := f.grpcAddress
			if transport == "http" {
				endpoint = strings.TrimPrefix(f.httpURL, "http://")
			}
			arguments := []string{signal, "--otlp-endpoint", endpoint, "--otlp-insecure", "--workers", "1", "--" + signal, "1", "--otlp-header", `authorization="Bearer ` + f.key + `"`}
			if transport == "http" {
				arguments = append(arguments, "--otlp-http")
			}
			if signal == "traces" {
				arguments = append(arguments, "--service", "prism-compose-acceptance", "--child-spans", "1")
			}
			command := exec.CommandContext(ctx, f.telemetrygen, arguments...) //nolint:gosec // Pinned administrator-selected local test binary.
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("telemetrygen %s/%s: %v: %s", transport, signal, err, strings.ReplaceAll(string(output), f.key, "[REDACTED]"))
			}
			minimum := before + 1
			if signal == "traces" {
				minimum++
			}
			composeWait(t, ctx, transport+"/"+signal, func() bool { return composeCount(t, ctx, database, signal) >= minimum })
			t.Logf("telemetrygen %s/%s persisted %d exact-signal native rows", transport, signal, minimum-before)
		}
	}
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = io.WriteString(w, "# TYPE prism_compose_fixture gauge\nprism_compose_fixture 42.5\n")
	}))
	defer exporter.Close()
	directory := t.TempDir()
	keyFile := filepath.Join(directory, "prometheus-credential")
	if err := os.WriteFile(keyFile, []byte(f.key), 0o600); err != nil {
		t.Fatal(err)
	}
	configuration := fmt.Sprintf("global:\n  scrape_interval: 100ms\n  scrape_timeout: 100ms\nscrape_configs:\n  - job_name: fixture\n    static_configs:\n      - targets: [%q]\nremote_write:\n  - url: %q\n    authorization:\n      credentials_file: %q\n    queue_config:\n      min_shards: 1\n      max_shards: 1\n      capacity: 100\n      max_samples_per_send: 10\n      batch_send_deadline: 100ms\n", strings.TrimPrefix(exporter.URL, "http://"), f.httpURL+"/prom/api/v1/write", keyFile)
	configFile := filepath.Join(directory, "prometheus.yml")
	if err := os.WriteFile(configFile, []byte(configuration), 0o600); err != nil {
		t.Fatal(err)
	}
	prom := exec.CommandContext(ctx, f.prometheus, "--config.file="+configFile, "--storage.tsdb.path="+filepath.Join(directory, "data"), "--web.listen-address=127.0.0.1:0", "--log.level=warn") //nolint:gosec // Pinned local test binary.
	promLog := new(boundedProcessLog)
	prom.Stdout, prom.Stderr = promLog, promLog
	if err := prom.Start(); err != nil {
		t.Fatal(err)
	}
	promDone := make(chan error, 1)
	go func() { promDone <- prom.Wait() }()
	defer func() {
		if err := prom.Process.Signal(syscall.SIGTERM); err != nil {
			t.Errorf("signal Prometheus for graceful shutdown: %v", err)
		}
		select {
		case err := <-promDone:
			if err != nil {
				t.Errorf("Prometheus exited nonzero after SIGTERM: %v; logs=%s", err, strings.ReplaceAll(promLog.String(), f.key, "[REDACTED]"))
			}
		case <-time.After(5 * time.Second):
			_ = prom.Process.Kill()
			err := <-promDone
			t.Errorf("Prometheus shutdown timeout (forced kill): %v; logs=%s", err, strings.ReplaceAll(promLog.String(), f.key, "[REDACTED]"))
		}
	}()
	composeWait(t, ctx, "real Prometheus remote_write query", func() bool { return composePromQueryVisible(ctx, f) })
	var persisted float64
	if err := database.QueryRow(ctx, "SELECT value FROM metric_samples WHERE tenant='default' AND metric='prism_compose_fixture' ORDER BY ts DESC LIMIT 1").Scan(&persisted); err != nil || persisted != 42.5 {
		t.Fatalf("real remote_write native value=%v err=%v", persisted, err)
	}
	vectorFile := filepath.Join(directory, "vector.toml")
	vectorConfig := fmt.Sprintf("data_dir = %q\n[sources.fixture]\ntype = \"stdin\"\ndecoding.codec = \"json\"\n[sinks.prism]\ntype = \"loki\"\ninputs = [\"fixture\"]\nendpoint = %q\ncompression = \"none\"\ntenant_id = \"default\"\nhealthcheck.enabled = false\nencoding.codec = \"text\"\nauth.strategy = \"bearer\"\nauth.token = %q\nbatch.max_events = 2\nbatch.timeout_secs = 0.1\nrequest.concurrency = 1\nrequest.retry_attempts = 2\nbuffer.type = \"memory\"\nbuffer.max_events = 10\n[sinks.prism.labels]\nservice = \"vector-compose\"\n[sinks.prism.structured_metadata]\ntrace_id = \"0102030405060708090a0b0c0d0e0f10\"\norigin = \"vector\"\n", directory, f.httpURL, f.key)
	if err := os.WriteFile(vectorFile, []byte(vectorConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	vector := exec.CommandContext(ctx, f.vector, "--config", vectorFile) //nolint:gosec // Pinned local test binary.
	vector.Stdin = strings.NewReader("{\"message\":\"vector-compose-first\"}\n{\"message\":\"vector-compose-second\"}\n")
	output, err := vector.CombinedOutput()
	if err != nil {
		t.Fatalf("Vector push: %v: %s", err, strings.ReplaceAll(string(output), f.key, "[REDACTED]"))
	}
	composeWait(t, ctx, "Vector exact body and trace ID", func() bool {
		var logs uint64
		if err := database.QueryRow(ctx, "SELECT count() FROM logs WHERE tenant='default' AND body IN ('vector-compose-first','vector-compose-second') AND trace_id='0102030405060708090a0b0c0d0e0f10' AND service='vector-compose'").Scan(&logs); err != nil {
			return false
		}
		return logs == 2
	})
	for path, want := range map[string]string{
		"/prom/api/v1/query_range?query=prism_compose_fixture&start=" + fmt.Sprint(time.Now().Add(-time.Minute).Unix()) + "&end=" + fmt.Sprint(time.Now().Unix()) + "&step=1s": `"42.5"`,
		"/prom/api/v1/label/__name__/values":                "prism_compose_fixture",
		"/prom/api/v1/series?match[]=prism_compose_fixture": "prism_compose_fixture",
	} {
		status, body := composeRequest(t, ctx, http.MethodGet, f.httpURL+path, f.key, "", nil)
		if status != http.StatusOK || !bytes.Contains(body, []byte(want)) || bytes.Contains(body, []byte("__tenant__")) {
			t.Fatalf("PromQL/catalog %s status=%d body=%s", path, status, body)
		}
	}
	verifyComposeGrafana(t, ctx, f)
}

func verifyComposeGrafana(t *testing.T, ctx context.Context, f composeFixture) {
	t.Helper()
	status, settingsBody := composeRequest(t, ctx, http.MethodGet, f.grafanaURL+"/api/admin/settings", "", f.adminPassword, nil)
	if status != http.StatusOK {
		t.Fatalf("Grafana admin settings status=%d", status)
	}
	status, pluginsBody := composeRequest(t, ctx, http.MethodGet, f.grafanaURL+"/api/plugins", "", f.adminPassword, nil)
	if status != http.StatusOK {
		t.Fatalf("Grafana plugin inventory status=%d", status)
	}
	if err := composeGrafanaPluginPolicy(settingsBody, pluginsBody); err != nil {
		t.Fatal(err)
	}
	t.Log("Grafana preinstall disabled; four suggested apps absent")
	status, body := composeRequest(t, ctx, http.MethodGet, f.grafanaURL+"/api/datasources", "", f.adminPassword, nil)
	if status != http.StatusOK {
		t.Fatalf("Grafana datasources status=%d", status)
	}
	for _, uid := range []string{"prism-metrics", "prism-logs", "prism-traces", "prism-alerts"} {
		if !bytes.Contains(body, []byte(`"uid":"`+uid+`"`)) {
			t.Fatalf("datasource %s absent", uid)
		}
	}
	status, body = composeRequest(t, ctx, http.MethodGet, f.grafanaURL+"/api/datasources/uid/prism-metrics/health", "", f.adminPassword, nil)
	if status != http.StatusOK || !bytes.Contains(bytes.ToLower(body), []byte("success")) {
		t.Fatalf("Grafana Prometheus health status=%d body=%s", status, body)
	}
	query := []byte(`{"queries":[{"refId":"A","datasource":{"uid":"prism-metrics"},"expr":"prism_compose_fixture","instant":true,"range":false}],"from":"now-1m","to":"now"}`)
	status, body = composeRequest(t, ctx, http.MethodPost, f.grafanaURL+"/api/ds/query", "", f.adminPassword, query)
	if status != http.StatusOK || !bytes.Contains(body, []byte("42.5")) || composeGrafanaValues(t, body) == 0 {
		t.Fatalf("Grafana datasource proxy/auth query status=%d body=%s", status, body)
	}
	status, body = composeRequest(t, ctx, http.MethodGet, f.grafanaURL+"/api/search?type=dash-db", "", f.adminPassword, nil)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"uid":"prism-self"`)) {
		t.Fatalf("Grafana dashboard missing: status=%d body=%s", status, body)
	}
	status, body = composeRequest(t, ctx, http.MethodGet, f.grafanaURL+"/api/dashboards/uid/prism-self", "", f.adminPassword, nil)
	if status != http.StatusOK {
		t.Fatalf("Grafana dashboard fetch status=%d body=%s", status, body)
	}
	var dashboard struct {
		Dashboard struct {
			Panels []struct {
				Title      string `json:"title"`
				Datasource struct {
					UID string `json:"uid"`
				} `json:"datasource"`
				Targets []struct {
					Expr string `json:"expr"`
				} `json:"targets"`
			} `json:"panels"`
		} `json:"dashboard"`
	}
	if err := json.Unmarshal(body, &dashboard); err != nil {
		t.Fatal(err)
	}
	panelExpr := ""
	for _, panel := range dashboard.Dashboard.Panels {
		if panel.Title == "Ingested metric series" && panel.Datasource.UID == "prism-metrics" && len(panel.Targets) == 1 {
			panelExpr = panel.Targets[0].Expr
		}
	}
	if panelExpr == "" {
		t.Fatal("provisioned metrics panel expression missing")
	}
	panelQuery, err := json.Marshal(map[string]any{"queries": []any{map[string]any{"refId": "A", "datasource": map[string]string{"uid": "prism-metrics"}, "expr": panelExpr, "instant": true, "range": false}}, "from": "now-1m", "to": "now"})
	if err != nil {
		t.Fatal(err)
	}
	status, body = composeRequest(t, ctx, http.MethodPost, f.grafanaURL+"/api/ds/query", "", f.adminPassword, panelQuery)
	if status != http.StatusOK || composeGrafanaValues(t, body) == 0 {
		t.Fatalf("provisioned metric panel query status=%d body=%s", status, body)
	}
	t.Logf("Grafana provisioned panel expression %q returned data", panelExpr)
}

func TestPhase1ComposeRestart(t *testing.T) {
	f := composeEnvironment(t)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	composeWait(t, ctx, "query-visible persisted metric after restart", func() bool { return composePromQueryVisible(ctx, f) })
	options, err := clickhouse.ParseDSN(f.dsn)
	if err != nil {
		t.Fatal("invalid native ClickHouse fixture")
	}
	database, err := clickhouse.Open(options)
	if err != nil {
		t.Fatal("open native ClickHouse fixture")
	}
	defer func() {
		if err := database.Close(); err != nil {
			t.Error(err)
		}
	}()
	var value float64
	if err := database.QueryRow(ctx, "SELECT value FROM metric_samples WHERE tenant='default' AND metric='prism_compose_fixture' ORDER BY ts DESC LIMIT 1").Scan(&value); err != nil || value != 42.5 {
		t.Fatalf("persisted metric after restart=%v err=%v", value, err)
	}
}
