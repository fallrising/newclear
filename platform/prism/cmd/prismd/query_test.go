package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/client_golang/prometheus"
)

type blockingQueryStore struct {
	spi.MetricStore
	started, stopped    chan struct{}
	startOnce, stopOnce sync.Once
}

func (s *blockingQueryStore) Select(ctx context.Context, _ spi.SeriesQuery) (spi.SeriesSet, error) {
	s.startOnce.Do(func() { close(s.started) })
	<-ctx.Done()
	s.stopOnce.Do(func() { close(s.stopped) })
	return nil, ctx.Err()
}

type queryCloseOrderBackend struct {
	spi.Backend
	store               *blockingQueryStore
	closed, closedEarly atomic.Bool
}

type largeLabelValuesStore struct {
	spi.MetricStore
	values []string
}

func (s *largeLabelValuesStore) LabelValues(context.Context, string, spi.LabelQuery) ([]string, error) {
	return s.values, nil
}

type largeLabelValuesBackend struct {
	spi.Backend
	store *largeLabelValuesStore
}

func (b *largeLabelValuesBackend) Metrics() spi.MetricStore { return b.store }

type closeFlagBackend struct {
	spi.Backend
	closed atomic.Bool
}

func (b *closeFlagBackend) Close() error {
	b.closed.Store(true)
	return b.Backend.Close()
}

func TestQueryListenerStartupFailureClosesBackend(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "query"
	cfg.Auth.IngestAPIKeyFile = ""
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()
	cfg.Server.HTTPListen = listener.Addr().String()
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	wrapped := &closeFlagBackend{Backend: backend}
	name := fmt.Sprintf("runtime-query-startup-failure-%d", driverSequence.Add(1))
	spi.Register(name, fixedBackendDriver{name: name, backend: wrapped})
	cfg.Storage.Driver = name
	cfg.Storage.DSN = "test"
	if err := runService(t.Context(), cfg, slog.New(slog.DiscardHandler)); err == nil {
		t.Fatal("occupied query listener started")
	}
	if !wrapped.closed.Load() {
		t.Fatal("startup failure left backend open")
	}
}

func (b *queryCloseOrderBackend) Metrics() spi.MetricStore { return b.store }
func (b *queryCloseOrderBackend) Close() error {
	select {
	case <-b.store.stopped:
	default:
		b.closedEarly.Store(true)
	}
	b.closed.Store(true)
	return b.Backend.Close()
}

func TestQueryShutdownWaitsBeforeBackendClose(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "query"
	cfg.Auth.IngestAPIKeyFile = ""
	cfg.Server.ShutdownTimeout = config.Duration(50 * time.Millisecond)
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	store := &blockingQueryStore{MetricStore: backend.Metrics(), started: make(chan struct{}), stopped: make(chan struct{})}
	wrapped := &queryCloseOrderBackend{Backend: backend, store: store}
	name := fmt.Sprintf("runtime-query-close-order-%d", driverSequence.Add(1))
	spi.Register(name, fixedBackendDriver{name: name, backend: wrapped})
	cfg.Storage.Driver = name
	cfg.Storage.DSN = "test"
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- runService(ctx, cfg, slog.New(slog.DiscardHandler)) }()
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://"+cfg.Server.HTTPListen+"/prom/api/v1/query?query=up", nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: time.Second}
	t.Cleanup(client.CloseIdleConnections)
	requestDone := make(chan struct{})
	go func() {
		defer close(requestDone)
		response, err := client.Do(request)
		if err == nil {
			_ = response.Body.Close()
		}
	}()
	select {
	case <-store.started:
	case <-time.After(time.Second):
		t.Fatal("query did not enter backend")
	}
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("shutdown: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("query shutdown hung")
	}
	<-requestDone
	if !wrapped.closed.Load() || wrapped.closedEarly.Load() {
		t.Fatal("backend closed before active query terminated")
	}
}

func TestAuthenticatedQueryRuntimeUsesConfiguredReadKey(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "query"
	cfg.Auth.AllowAnonymousRead = false
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	result := make(chan error, 1)
	go func() {
		result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-result:
			if err != nil {
				t.Errorf("shutdown: %v", err)
			}
		case <-time.After(time.Second):
			t.Error("query runtime did not stop")
		}
		_ = backend.Close()
	})
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	for _, test := range []struct {
		name, authorization string
		status              int
	}{
		{"missing", "", http.StatusUnauthorized},
		{"invalid", "Bearer invalid", http.StatusUnauthorized},
		{"valid", "Bearer " + string(cfg.Auth.IngestAPIKey), http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://"+cfg.Server.HTTPListen+"/prom/api/v1/status/buildinfo", nil)
			if err != nil {
				t.Fatal(err)
			}
			if test.authorization != "" {
				request.Header.Set("Authorization", test.authorization)
			}
			response, err := (&http.Client{Timeout: time.Second}).Do(request)
			if err != nil {
				t.Fatal(err)
			}
			_ = response.Body.Close()
			if response.StatusCode != test.status {
				t.Fatalf("status=%d want=%d", response.StatusCode, test.status)
			}
		})
	}
}

func TestQueryShutdownClosesSlowResponseClient(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "query"
	cfg.Auth.IngestAPIKeyFile = ""
	cfg.Server.ShutdownTimeout = config.Duration(50 * time.Millisecond)
	cfg.Query.MaxConcurrent = 1
	cfg.Query.MaxConcurrentPerTenant = 1
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	values := make([]string, 13_000)
	for i := range values {
		values[i] = fmt.Sprintf("%05d-%s", i, strings.Repeat("a", 390))
	}
	if len(values)*len(values[0]) <= 4<<20 {
		t.Fatal("slow response fixture is too small to fill TCP buffers")
	}
	wrapped := &largeLabelValuesBackend{Backend: backend, store: &largeLabelValuesStore{MetricStore: backend.Metrics(), values: values}}
	ctx, cancel := context.WithCancel(t.Context())
	result := make(chan error, 1)
	go func() {
		result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), wrapped)
	}()
	finished := false
	t.Cleanup(func() {
		cancel()
		if !finished {
			select {
			case <-result:
			case <-time.After(2 * time.Second):
				t.Error("slow-response runtime did not stop")
			}
		}
		_ = backend.Close()
	})
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	dialer := &net.Dialer{Timeout: time.Second}
	connection, err := dialer.DialContext(t.Context(), "tcp", cfg.Server.HTTPListen)
	if err != nil {
		t.Fatal(err)
	}
	if tcp, ok := connection.(*net.TCPConn); ok {
		_ = tcp.SetReadBuffer(4096)
	}
	now := time.Now()
	_, err = fmt.Fprintf(connection, "GET /prom/api/v1/label/job/values?start=%d&end=%d HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", now.Add(-time.Hour).Unix(), now.Unix(), cfg.Server.HTTPListen)
	if err != nil {
		t.Fatal(err)
	}
	if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(connection), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close(); _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("large response status=%d", response.StatusCode)
	}
	var first [1]byte
	if _, err := response.Body.Read(first[:]); err != nil {
		t.Fatal(err)
	}
	probe, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://"+cfg.Server.HTTPListen+"/prom/api/v1/query?query=vector(1)", nil)
	if err != nil {
		t.Fatal(err)
	}
	busy, err := (&http.Client{Timeout: time.Second}).Do(probe)
	if err != nil {
		t.Fatal(err)
	}
	_ = busy.Body.Close()
	if busy.StatusCode != http.StatusServiceUnavailable || busy.Header.Get("Retry-After") != "1" {
		t.Fatalf("unread response did not retain query admission: status=%d retry=%q", busy.StatusCode, busy.Header.Get("Retry-After"))
	}
	// Leave the large body unread so the writer blocks once TCP buffers fill.
	cancel()
	select {
	case err := <-result:
		finished = true
		if err != nil && !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("shutdown: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("slow response client held query shutdown")
	}
}

func TestQueryRuntimeRoutesAndIngestSeparation(t *testing.T) {
	for _, mode := range []string{"query", "all-in-one", "ingest"} {
		t.Run(mode, func(t *testing.T) {
			cfg := runtimeConfig(t)
			cfg.Server.Mode = mode
			cfg.Ingest.Batch.Metrics.MaxItems = 1
			cfg.Ingest.MaxPast = config.Duration(10 * 365 * 24 * time.Hour)
			cfg.Query.MaxLookback = config.Duration(10 * 365 * 24 * time.Hour)
			if mode == "query" {
				cfg.Auth.IngestAPIKeyFile = ""
			}
			backend, err := spi.Open(t.Context(), "memory", spi.Config{})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(t.Context())
			result := make(chan error, 1)
			go func() {
				result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
			}()
			t.Cleanup(func() {
				cancel()
				select {
				case err := <-result:
					if err != nil {
						t.Errorf("shutdown: %v", err)
					}
				case <-time.After(2 * time.Second):
					t.Error("query runtime did not stop")
				}
				if err := backend.Close(); err != nil {
					t.Errorf("close backend: %v", err)
				}
			})
			waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
			client := &http.Client{Timeout: time.Second}
			t.Cleanup(client.CloseIdleConnections)
			if mode == "all-in-one" {
				postRuntimeWrite(t, cfg, client, "http", http.StatusNoContent)
				deadline := time.Now().Add(time.Second)
				for len(runtimeMetricValues(t, backend, cfg.Tenancy.DefaultTenant)) == 0 {
					if time.Now().After(deadline) {
						t.Fatal("remote write did not reach shared backend")
					}
					time.Sleep(time.Millisecond)
				}
			}
			request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://"+cfg.Server.HTTPListen+"/prom/api/v1/query?query=runtime_remote_write&time=1577836800", nil)
			if err != nil {
				t.Fatal(err)
			}
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			body, readErr := io.ReadAll(io.LimitReader(response.Body, 4096))
			_ = response.Body.Close()
			if readErr != nil {
				t.Fatal(readErr)
			}
			if mode == "ingest" {
				if response.StatusCode != http.StatusNotFound {
					t.Fatalf("ingest query status=%d body=%s", response.StatusCode, body)
				}
				return
			}
			if response.StatusCode != http.StatusOK || !strings.Contains(string(body), `"status":"success"`) {
				t.Fatalf("%s query status=%d body=%s", mode, response.StatusCode, body)
			}
			if mode == "all-in-one" && (!strings.Contains(string(body), "runtime_remote_write") || !strings.Contains(string(body), `"42"`)) {
				t.Fatalf("all-in-one query did not read ingested metric: %s", body)
			}
		})
	}
}
