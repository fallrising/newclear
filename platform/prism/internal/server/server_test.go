package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

func TestMain(tests *testing.M) {
	os.Exit(runTestMain(tests))
}

func runTestMain(tests *testing.M) int {
	baseline := runtime.NumGoroutine()
	exitCode := tests.Run()
	if transport, ok := http.DefaultTransport.(*http.Transport); ok {
		transport.CloseIdleConnections()
	}
	if exitCode == 0 && !goroutineCountReturnsTo(baseline) {
		_, _ = fmt.Fprintf(os.Stderr, "goroutine leak: before=%d after=%d\n%s", baseline, runtime.NumGoroutine(), allGoroutineStacks())
		return 1
	}
	return exitCode
}

func TestNew_Validation(t *testing.T) {
	tests := []struct {
		name    string
		options Options
	}{
		{name: "missing address", options: Options{ShutdownTimeout: time.Second}},
		{name: "invalid timeout", options: Options{Address: "127.0.0.1:0"}},
		{name: "incomplete TLS", options: Options{Address: "127.0.0.1:0", ShutdownTimeout: time.Second, TLSCertFile: "cert.pem"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := New(test.options); err == nil {
				t.Fatal("New() error = nil")
			}
		})
	}
}

func TestBaseRoutes(t *testing.T) {
	registry := prometheus.NewRegistry()
	gauge := prometheus.NewGauge(prometheus.GaugeOpts{Name: "prism_test_runtime_value", Help: "Test-only runtime value."})
	gauge.Set(7)
	registry.MustRegister(gauge)
	server, err := New(Options{Address: "127.0.0.1:0", ShutdownTimeout: time.Second, Gatherer: registry})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantBody   string
	}{
		{name: "healthy", method: http.MethodGet, path: "/-/healthy", wantStatus: http.StatusOK, wantBody: "ok\n"},
		{name: "metrics", method: http.MethodGet, path: "/metrics", wantStatus: http.StatusOK, wantBody: "prism_test_runtime_value 7"},
		{name: "method rejected", method: http.MethodPost, path: "/-/healthy", wantStatus: http.StatusMethodNotAllowed},
		{name: "unknown route", method: http.MethodGet, path: "/missing", wantStatus: http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequestWithContext(context.Background(), test.method, test.path, nil)
			response := httptest.NewRecorder()
			server.httpServer.Handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if test.wantBody != "" && !strings.Contains(response.Body.String(), test.wantBody) {
				t.Fatalf("body = %q, want substring %q", response.Body.String(), test.wantBody)
			}
		})
	}
}

func TestRecoverPanics(t *testing.T) {
	const panicValue = "do-not-log-panic-value"
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := recoverPanics(logger, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(panicValue)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/panic", nil))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(logs.String(), "HTTP handler panic") || !strings.Contains(logs.String(), "stack=") {
		t.Fatalf("panic log does not contain fixed message and stack: %s", logs.String())
	}
	if strings.Contains(logs.String(), panicValue) {
		t.Fatalf("panic log leaked recovered value: %s", logs.String())
	}
}

func TestServe_StopsCleanly(t *testing.T) {
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Address: listener.Addr().String(), ShutdownTimeout: time.Second})
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go serveForTest(server, ctx, listener, result)

	waitForHealthy(t, "http://"+listener.Addr().String()+"/-/healthy")
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("Serve() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Serve() did not stop within one second")
	}
}

func TestServe_WaitsForActiveRequest(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		close(started)
		select {
		case <-release:
			response.WriteHeader(http.StatusNoContent)
		case <-request.Context().Done():
		}
	})
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{
		Address:         listener.Addr().String(),
		ShutdownTimeout: time.Second,
		Handler:         handler,
	})
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	serveResult := make(chan error, 1)
	go serveForTest(server, ctx, listener, serveResult)
	waitForHealthy(t, "http://"+listener.Addr().String()+"/-/healthy")

	requestResult := make(chan error, 1)
	go requestForTest("http://"+listener.Addr().String()+"/blocking", requestResult)
	select {
	case <-started:
	case <-time.After(time.Second):
		cancel()
		t.Fatal("request handler did not start")
	}
	cancel()
	select {
	case err := <-serveResult:
		t.Fatalf("Serve() returned before the active request completed: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case err := <-requestResult:
		if err != nil {
			t.Fatalf("request error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("active request did not complete")
	}
	select {
	case err := <-serveResult:
		if err != nil {
			t.Fatalf("Serve() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Serve() did not return after active request completed")
	}
}

func TestServe_ForcesCloseAtShutdownTimeout(t *testing.T) {
	started := make(chan struct{})
	handlerStopped := make(chan struct{})
	handler := http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
		close(handlerStopped)
	})
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{
		Address:         listener.Addr().String(),
		ShutdownTimeout: 20 * time.Millisecond,
		Handler:         handler,
	})
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	serveResult := make(chan error, 1)
	go serveForTest(server, ctx, listener, serveResult)
	waitForHealthy(t, "http://"+listener.Addr().String()+"/-/healthy")

	requestResult := make(chan error, 1)
	go requestExpectingClose("http://"+listener.Addr().String()+"/blocking", requestResult)
	select {
	case <-started:
	case <-time.After(time.Second):
		cancel()
		t.Fatal("request handler did not start")
	}
	cancel()
	select {
	case err := <-serveResult:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("Serve() error = %v, want deadline exceeded", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Serve() exceeded bounded shutdown time")
	}
	select {
	case <-handlerStopped:
	case <-time.After(time.Second):
		t.Fatal("forced shutdown did not cancel active handler")
	}
	select {
	case <-requestResult:
	case <-time.After(time.Second):
		t.Fatal("forced shutdown did not close active connection")
	}
}

func TestServe_RejectsNilListener(t *testing.T) {
	server, err := New(Options{Address: "127.0.0.1:0", ShutdownTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Serve(context.Background(), nil); err == nil {
		t.Fatal("Serve() error = nil")
	}
}

func serveForTest(server *Server, ctx context.Context, listener net.Listener, result chan<- error) {
	result <- server.Serve(ctx, listener)
}

func requestForTest(endpoint string, result chan<- error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, endpoint, nil)
	if err != nil {
		result <- err
		return
	}
	client := &http.Client{Timeout: 2 * time.Second}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		result <- err
		return
	}
	_, copyErr := io.Copy(io.Discard, response.Body)
	closeErr := response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		result <- fmt.Errorf("status = %d, want %d", response.StatusCode, http.StatusNoContent)
		return
	}
	result <- errors.Join(copyErr, closeErr)
}

func requestExpectingClose(endpoint string, result chan<- error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, endpoint, nil)
	if err != nil {
		result <- err
		return
	}
	client := &http.Client{Timeout: 2 * time.Second}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		result <- err
		return
	}
	_, copyErr := io.Copy(io.Discard, response.Body)
	closeErr := response.Body.Close()
	result <- errors.Join(copyErr, closeErr)
}

func waitForHealthy(t *testing.T, endpoint string) {
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
			_, copyErr := io.Copy(io.Discard, response.Body)
			closeErr := response.Body.Close()
			if response.StatusCode == http.StatusOK && copyErr == nil && closeErr == nil {
				return
			}
		}
		select {
		case <-ticker.C:
		case <-timeout.C:
			t.Fatalf("health endpoint %s did not become ready", endpoint)
		}
	}
}

func goroutineCountReturnsTo(want int) bool {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(time.Second)
	defer timeout.Stop()
	for {
		if runtime.NumGoroutine() <= want {
			return true
		}
		select {
		case <-ticker.C:
		case <-timeout.C:
			return false
		}
	}
}

func allGoroutineStacks() string {
	buffer := make([]byte, 1<<20)
	length := runtime.Stack(buffer, true)
	return string(buffer[:length])
}
