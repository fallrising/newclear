package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestConfigCheck(t *testing.T) {
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	exitCode := run(context.Background(), []string{"--config", path, "--config-check"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("run() = %d, want 0; stderr = %s", exitCode, stderr.String())
	}
	if stdout.String() != "prismd: configuration valid\n" {
		t.Fatalf("stdout = %q", stdout.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want empty", stderr.String())
	}
}

func TestVersionAndHealthcheckBeforeConfiguration(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run(t.Context(), []string{"version"}, &stdout, &stderr); code != 0 || !strings.Contains(stdout.String(), "dev") || !strings.Contains(stdout.String(), "unknown") {
		t.Fatalf("version code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "ok\n") }))
	defer server.Close()
	stdout.Reset()
	stderr.Reset()
	if code := run(t.Context(), []string{"healthcheck", "--url", server.URL}, &stdout, &stderr); code != 0 {
		t.Fatalf("healthcheck code=%d stderr=%q", code, stderr.String())
	}
	for _, endpoint := range []string{"ftp://example.test", "http://user:secret@example.test", "http://127.0.0.1:1"} {
		stderr.Reset()
		if code := run(t.Context(), []string{"healthcheck", "--url", endpoint, "--timeout", "50ms"}, &stdout, &stderr); code == 0 || strings.Contains(stderr.String(), "secret") {
			t.Fatalf("endpoint=%q code=%d stderr=%q", endpoint, code, stderr.String())
		}
	}
}

func TestHealthcheckRejectsUnhealthyAndOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oversized" {
			_, _ = io.WriteString(w, strings.Repeat("x", maxHealthBody+1))
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	for _, path := range []string{"/unhealthy", "/oversized"} {
		if err := healthcheck(t.Context(), server.URL+path, time.Second); err == nil {
			t.Fatalf("%s accepted", path)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := healthcheck(ctx, server.URL+"/oversized", time.Second); err == nil {
		t.Fatal("canceled healthcheck accepted")
	}
}

func TestHealthcheckDeadlineRedirectAndCredentialRedaction(t *testing.T) {
	redirected := make(chan struct{}, 1)
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected <- struct{}{} }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/slow":
			<-r.Context().Done()
		case "/redirect":
			http.Redirect(w, r, target.URL, http.StatusFound)
		}
	}))
	defer server.Close()
	if err := healthcheck(t.Context(), server.URL+"/slow", 25*time.Millisecond); err == nil || !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("slow healthcheck error=%v", err)
	}
	if err := healthcheck(t.Context(), server.URL+"/redirect", time.Second); err == nil || !strings.Contains(err.Error(), "302") {
		t.Fatalf("redirect healthcheck error=%v", err)
	}
	select {
	case <-redirected:
		t.Fatal("healthcheck followed redirect")
	default:
	}
	const credential = "query-secret-never-log" //nolint:gosec // Public regression marker, never an actual credential.
	var stdout, stderr bytes.Buffer
	if code := run(t.Context(), []string{"healthcheck", "--url", server.URL + "/redirect?token=" + credential}, &stdout, &stderr); code == 0 || strings.Contains(stderr.String(), credential) {
		t.Fatalf("credential leak code=%d stderr=%q", code, stderr.String())
	}
}

func TestClickHouseConfigCheckWithoutConnection(t *testing.T) {
	t.Setenv("PRISM_STORAGE_DRIVER", "clickhouse")
	t.Setenv("PRISM_STORAGE_DSN", "clickhouse://prism:disposable-pass@127.0.0.1:1/prism")
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := run(t.Context(), []string{"--config", path, "--config-check"}, &stdout, &stderr); code != 0 {
		t.Fatalf("config-check code = %d, stderr = %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "configuration valid") || strings.Contains(stderr.String(), "disposable-pass") {
		t.Fatalf("config-check output = %q; stderr = %q", stdout.String(), stderr.String())
	}
	if !slices.Contains(spi.Drivers(), "clickhouse") || !slices.Contains(spi.Drivers(), "memory") {
		t.Fatalf("registered drivers = %v", spi.Drivers())
	}
}

func TestConfigCheckRejectsInvalidConfiguration(t *testing.T) {
	var stdout, stderr bytes.Buffer
	exitCode := run(context.Background(), []string{"--config", filepath.Join(t.TempDir(), "missing.yaml"), "--config-check"}, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("run() = %d, want 1", exitCode)
	}
	if !strings.Contains(stderr.String(), "configuration invalid") {
		t.Fatalf("stderr = %q, want configuration error", stderr.String())
	}
}

func TestModeFlagRejectsUnknownMode(t *testing.T) {
	var stdout, stderr bytes.Buffer
	exitCode := run(context.Background(), []string{"--mode", "invalid"}, &stdout, &stderr)
	if exitCode != 2 {
		t.Fatalf("run() = %d, want 2", exitCode)
	}
	if !strings.Contains(stderr.String(), "unknown server mode") {
		t.Fatalf("stderr = %q, want mode validation error", stderr.String())
	}
}

func TestConfigCheckEmitsStartupWarnings(t *testing.T) {
	t.Setenv("PRISM_SERVER_HTTP_LISTEN", "0.0.0.0:9090")
	t.Setenv("PRISM_AUTH_ALLOW_ANONYMOUS_READ", "false")
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	exitCode := run(context.Background(), []string{"--config", path, "--config-check"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("run() = %d, stderr = %q", exitCode, stderr.String())
	}
	if !strings.Contains(stderr.String(), `"level":"warn"`) ||
		!strings.Contains(stderr.String(), `"code":"public-listener-without-transport-security"`) {
		t.Fatalf("stderr = %q, want startup security warning", stderr.String())
	}
}

func TestRuntimeStopsOnCancellation(t *testing.T) {
	address := availableAddress(t)
	t.Setenv("PRISM_SERVER_HTTP_LISTEN", address)
	t.Setenv("PRISM_SERVER_MODE", "ingest")
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan int, 1)
	finished := false
	var stdout, stderr bytes.Buffer
	go runForTest(ctx, []string{"--config", path, "--mode", "query"}, &stdout, &stderr, result)
	t.Cleanup(func() {
		if finished {
			return
		}
		cancel()
		select {
		case <-result:
		case <-time.After(time.Second):
		}
	})

	waitForEndpoint(t, "http://"+address+"/-/healthy", "ok\n")
	waitForEndpoint(t, "http://"+address+"/metrics", "go_goroutines")
	cancel()
	select {
	case exitCode := <-result:
		finished = true
		if exitCode != 0 {
			t.Fatalf("run() = %d, stderr = %s", exitCode, stderr.String())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("run() did not stop after cancellation")
	}
	if !strings.Contains(stderr.String(), `"msg":"HTTP server starting"`) ||
		!strings.Contains(stderr.String(), `"msg":"HTTP server stopped"`) ||
		!strings.Contains(stderr.String(), `"mode":"query"`) {
		t.Fatalf("lifecycle logs missing: %s", stderr.String())
	}
}

func TestConfigCheckHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var stdout, stderr bytes.Buffer
	exitCode := run(ctx, []string{"--config", "unused.yaml", "--config-check"}, &stdout, &stderr)
	if exitCode != 1 || !strings.Contains(stderr.String(), context.Canceled.Error()) {
		t.Fatalf("run() = %d, stderr = %q; want canceled error", exitCode, stderr.String())
	}
}

func runForTest(ctx context.Context, arguments []string, stdout, stderr io.Writer, result chan<- int) {
	result <- run(ctx, arguments, stdout, stderr)
}

func availableAddress(t *testing.T) string {
	t.Helper()
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return address
}

func waitForEndpoint(t *testing.T, endpoint, wantBody string) {
	t.Helper()
	client := &http.Client{Timeout: 100 * time.Millisecond}
	t.Cleanup(client.CloseIdleConnections)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for {
		request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, endpoint, nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := client.Do(request)
		if err == nil {
			body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
			closeErr := response.Body.Close()
			if response.StatusCode == http.StatusOK && readErr == nil && closeErr == nil && strings.Contains(string(body), wantBody) {
				return
			}
		}
		select {
		case <-ticker.C:
		case <-timeout.C:
			t.Fatalf("endpoint %s did not become ready", endpoint)
		}
	}
}

func TestConfigCheckModeOverrideSkipsIngestCredential(t *testing.T) {
	t.Setenv("PRISM_AUTH_INGEST_API_KEY_FILE", "")
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if exit := run(context.Background(), []string{"--config", path, "--mode", "query", "--config-check"}, &stdout, &stderr); exit != 0 {
		t.Fatalf("query mode requires ingest key: %s", stderr.String())
	}
	stdout.Reset()
	stderr.Reset()
	if exit := run(context.Background(), []string{"--config", path, "--mode", "ingest", "--config-check"}, &stdout, &stderr); exit != 1 || !strings.Contains(stderr.String(), "ingest_api_key_file") {
		t.Fatalf("ingest accepted missing key: %s", stderr.String())
	}
}
