package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
