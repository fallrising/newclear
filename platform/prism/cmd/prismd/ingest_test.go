package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/limits"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/golang/snappy"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/prometheus/prompb"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"go.uber.org/goleak"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

func TestMain(tests *testing.M) { goleak.VerifyTestMain(tests) }

func runtimeConfig(t *testing.T) *config.Config {
	t.Helper()
	cfg, err := config.LoadWithEnvironment(context.Background(), filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"), nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Server.HTTPListen = availableAddress(t)
	cfg.Server.GRPCListen = availableAddress(t)
	return cfg
}

func TestPipelineOptionsPreservesConfiguration(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Ingest.QueueDepth = 7
	cfg.Ingest.Batch.Metrics = config.BatchSignalConfig{MaxItems: 123, MaxBytes: 456789, FlushInterval: config.Duration(13 * time.Second)}
	cfg.Ingest.Batch.Logs = config.BatchSignalConfig{MaxItems: 234, MaxBytes: 567890, FlushInterval: config.Duration(14 * time.Second)}
	cfg.Ingest.Batch.Traces = config.BatchSignalConfig{MaxItems: 345, MaxBytes: 678901, FlushInterval: config.Duration(15 * time.Second)}
	cfg.Ingest.ClockSkewPolicy = "drop"
	cfg.Ingest.MaxPast = config.Duration(17 * time.Minute)
	cfg.Ingest.MaxFuture = config.Duration(19 * time.Minute)
	cfg.Limits.MaxActiveSeriesPerTenant = 321
	cfg.Limits.MaxLogLineBytes = 6543
	cfg.Limits.CardinalityAlarmThreshold = 789
	cfg.Limits.AutoDropHighCardinality = true
	options := pipelineOptions(cfg)
	if options.MaxTenants != 1 || options.MaxInputBytes != int(cfg.Ingest.MaxRequestBytes) {
		t.Fatal("identity or input capacity was not mapped")
	}
	for _, pair := range []struct {
		source config.BatchSignalConfig
		target ingest.BatchOptions
	}{{cfg.Ingest.Batch.Metrics, options.Metrics}, {cfg.Ingest.Batch.Logs, options.Logs}, {cfg.Ingest.Batch.Traces, options.Traces}} {
		if pair.target.MaxItems != pair.source.MaxItems || pair.target.MaxBytes != int(pair.source.MaxBytes) || pair.target.FlushInterval != pair.source.FlushInterval.Std() || pair.target.QueueDepth != 7 || pair.target.Workers != 2 {
			t.Fatalf("batch config lost: %+v", pair)
		}
	}
	if string(options.Normalize.ClockSkewPolicy) != "drop" || options.Normalize.MaxPast != 17*time.Minute || options.Normalize.MaxFuture != 19*time.Minute {
		t.Fatal("normalization config lost")
	}
	settings, err := limits.Resolve(options.Limits.Global, limits.Overrides{})
	if err != nil {
		t.Fatal(err)
	}
	if settings.MaxActiveSeriesPerTenant != 321 || settings.MaxLogLineBytes != 6543 || settings.CardinalityAlarmThreshold != 789 || !settings.AutoDropHighCardinality {
		t.Fatal("limits config lost")
	}
	// Pointer overrides own a snapshot rather than retaining mutable config.
	cfg.Limits.MaxActiveSeriesPerTenant = 999
	again, err := limits.Resolve(options.Limits.Global, limits.Overrides{})
	if err != nil || !reflect.DeepEqual(settings, again) {
		t.Fatal("runtime options alias config")
	}
}

func TestIngestRuntimeFlushesAcceptedQueueOnParentCancel(t *testing.T) {
	for _, mode := range []string{"all-in-one", "ingest"} {
		t.Run(mode, func(t *testing.T) {
			cfg := runtimeConfig(t)
			cfg.Server.Mode = mode
			cfg.Ingest.Batch.Logs.FlushInterval = config.Duration(time.Hour)
			cfg.Ingest.Batch.Metrics.FlushInterval = config.Duration(time.Hour)
			backend, err := spi.Open(context.Background(), "memory", spi.Config{})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = backend.Close() }()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			result := make(chan error, 1)
			go func() {
				result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
			}()
			waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
			postRuntimeLog(t, cfg, "http")
			postRuntimeLoki(t, cfg, &http.Client{Timeout: time.Second}, "http", http.StatusNoContent)
			postRuntimeWrite(t, cfg, &http.Client{Timeout: time.Second}, "http", http.StatusNoContent)
			connection, err := grpc.NewClient(cfg.Server.GRPCListen, grpc.WithTransportCredentials(insecure.NewCredentials()))
			if err != nil {
				t.Fatal(err)
			}
			logs := plog.NewLogs()
			resource := logs.ResourceLogs().AppendEmpty()
			resource.Resource().Attributes().PutStr("service.name", "runtime")
			resource.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("grpc")
			requestCtx, stop := context.WithTimeout(metadata.AppendToOutgoingContext(context.Background(), "authorization", "Bearer "+string(cfg.Auth.IngestAPIKey)), time.Second)
			_, err = plogotlp.NewGRPCClient(connection).Export(requestCtx, plogotlp.NewExportRequestFromLogs(logs))
			stop()
			_ = connection.Close()
			if err != nil {
				t.Fatal(err)
			}
			if got := runtimeMetricValues(t, backend, "default"); len(got) != 0 {
				t.Fatalf("unflushed metric bucket already written: %v", got)
			}
			if got := runtimeLogBodies(t, backend); len(got) != 0 {
				t.Fatalf("unflushed bucket already written: %v", got)
			}
			cancel()
			select {
			case err := <-result:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("runtime shutdown hung")
			}
			if got := runtimeMetricValues(t, backend, "default"); !reflect.DeepEqual(got, []float64{42}) {
				t.Fatalf("accepted remote_write discarded on parent cancel: %v", got)
			}
			if got := runtimeMetricValues(t, backend, "other"); len(got) != 0 {
				t.Fatalf("remote_write crossed tenant boundary: %v", got)
			}
			if got := runtimeLogBodies(t, backend); !reflect.DeepEqual(got, []string{"http", "loki", "grpc"}) {
				t.Fatalf("accepted data discarded on parent cancel: %v", got)
			}
		})
	}
}

func TestIngestRuntimeDeadlineCancelsSPIWrite(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "ingest"
	cfg.Server.ShutdownTimeout = config.Duration(30 * time.Millisecond)
	cfg.Ingest.Batch.Logs.MaxItems = 1
	backend, err := spi.Open(context.Background(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	store := &blockingLogs{LogStore: backend.Logs(), started: make(chan struct{}), stopped: make(chan struct{})}
	wrapped := logBackend{Backend: backend, store: store}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), wrapped)
	}()
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	postRuntimeLog(t, cfg, "stalled")
	select {
	case <-store.started:
	case <-time.After(time.Second):
		t.Fatal("SPI write did not start")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("shutdown error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("stalled SPI write hung shutdown")
	}
	select {
	case <-store.stopped:
	case <-time.After(time.Second):
		t.Fatal("SPI write context was not cancelled")
	}
}

type logBackend struct {
	spi.Backend
	store spi.LogStore
}

func (b logBackend) Logs() spi.LogStore { return b.store }

type blockingLogs struct {
	spi.LogStore
	started, stopped chan struct{}
}

func (s *blockingLogs) Write(ctx context.Context, _ []utm.LogRecord) error {
	close(s.started)
	<-ctx.Done()
	close(s.stopped)
	return spi.Wrap(spi.ErrTimeout, "", "logs.Write", ctx.Err())
}

func postRuntimeLog(t *testing.T, cfg *config.Config, body string) {
	t.Helper()
	logs := plog.NewLogs()
	resource := logs.ResourceLogs().AppendEmpty()
	resource.Resource().Attributes().PutStr("service.name", "runtime")
	resource.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr(body)
	content, err := plogotlp.NewExportRequestFromLogs(logs).MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+cfg.Server.HTTPListen+"/v1/logs", bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+string(cfg.Auth.IngestAPIKey))
	client := &http.Client{Timeout: time.Second}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || strings.Contains(string(data), "rejected") {
		t.Fatalf("export status=%d body=%s", response.StatusCode, data)
	}
}
func runtimeLogBodies(t *testing.T, backend spi.Backend) []string {
	t.Helper()
	matcher, err := spi.NewMatcher(spi.MatchEqual, "service", "runtime")
	if err != nil {
		t.Fatal(err)
	}
	iterator, err := backend.Logs().Search(context.Background(), spi.LogQuery{Tenant: "default", Selectors: []spi.Matcher{matcher}, Start: 0, End: math.MaxInt64, Direction: spi.Forward, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = iterator.Close() }()
	var bodies []string
	for iterator.Next() {
		bodies = append(bodies, iterator.At().Body)
	}
	if err := iterator.Err(); err != nil {
		t.Fatal(err)
	}
	return bodies
}

func TestIngestRuntimeUsesTLSOnBothTransports(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "ingest"
	certificate, key, pool := runtimeCertificate(t)
	cfg.Server.TLSCertFile = certificate
	cfg.Server.TLSKeyFile = key
	backend, err := spi.Open(context.Background(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
	}()
	client := &http.Client{Timeout: time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	defer client.CloseIdleConnections()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	for {
		request, requestErr := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://"+cfg.Server.HTTPListen+"/-/healthy", nil)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		response, requestErr := client.Do(request)
		if requestErr == nil {
			_, _ = io.Copy(io.Discard, response.Body)
			_ = response.Body.Close()
			if response.StatusCode == 200 {
				break
			}
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("HTTPS never ready")
		}
	}
	postRuntimeWrite(t, cfg, client, "https", http.StatusNoContent)
	postRuntimeLoki(t, cfg, client, "https", http.StatusNoContent)
	connection, err := grpc.NewClient(cfg.Server.GRPCListen, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12})))
	if err != nil {
		t.Fatal(err)
	}
	requestCtx, stop := context.WithTimeout(metadata.AppendToOutgoingContext(context.Background(), "authorization", "Bearer "+string(cfg.Auth.IngestAPIKey)), time.Second)
	_, err = plogotlp.NewGRPCClient(connection).Export(requestCtx, plogotlp.NewExportRequest())
	stop()
	_ = connection.Close()
	if err != nil {
		t.Fatalf("authenticated TLS gRPC export failed: %v", err)
	}
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("TLS runtime hung shutdown")
	}
}

func runtimeCertificate(t *testing.T) (string, string, *x509.CertPool) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), NotAfter: time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC), IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, public, private)
	if err != nil {
		t.Fatal(err)
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	key := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER})
	directory := t.TempDir()
	certPath := filepath.Join(directory, "cert.pem")
	keyPath := filepath.Join(directory, "key.pem")
	if err := os.WriteFile(certPath, certificate, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, key, 0o600); err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(certificate) {
		t.Fatal("invalid test certificate")
	}
	return certPath, keyPath, pool
}

func TestRunServiceClosesBackendAfterWriteCancellation(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "ingest"
	cfg.Server.ShutdownTimeout = config.Duration(20 * time.Millisecond)
	cfg.Ingest.Batch.Logs.MaxItems = 1
	backend, err := spi.Open(context.Background(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	store := &blockingLogs{LogStore: backend.Logs(), started: make(chan struct{}), stopped: make(chan struct{})}
	wrapped := &closeOrderBackend{Backend: backend, store: store, stopped: store.stopped}
	name := fmt.Sprintf("runtime-close-order-%d", driverSequence.Add(1))
	spi.Register(name, fixedBackendDriver{name: name, backend: wrapped})
	cfg.Storage.Driver = name
	cfg.Storage.DSN = "test"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- runService(ctx, cfg, slog.New(slog.DiscardHandler)) }()
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	postRuntimeLog(t, cfg, "stalled")
	select {
	case <-store.started:
	case <-time.After(time.Second):
		t.Fatal("write not started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown hung")
	}
	if !wrapped.closed.Load() || wrapped.closedEarly.Load() {
		t.Fatal("backend closed before pipeline write termination")
	}
}

var driverSequence atomic.Uint64

type fixedBackendDriver struct {
	name    string
	backend spi.Backend
}

func (d fixedBackendDriver) Name() string { return d.name }
func (d fixedBackendDriver) Open(context.Context, spi.Config) (spi.Backend, error) {
	return d.backend, nil
}

type closeOrderBackend struct {
	logBackend
	stopped             <-chan struct{}
	closed, closedEarly atomic.Bool
}

func (b *closeOrderBackend) Close() error {
	select {
	case <-b.stopped:
	default:
		b.closedEarly.Store(true)
	}
	b.closed.Store(true)
	return b.Backend.Close()
}

func runtimeWriteRequest(t *testing.T, cfg *config.Config, scheme string) *http.Request {
	t.Helper()
	write := prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "runtime_remote_write"}, {Name: "job", Value: "runtime"}},
		Samples: []prompb.Sample{{Value: 42, Timestamp: utm.TimeToMilli(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC))}},
	}}}
	wire, err := write.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	t.Cleanup(cancel)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, scheme+"://"+cfg.Server.HTTPListen+"/prom/api/v1/write", bytes.NewReader(snappy.Encode(nil, wire)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+string(cfg.Auth.IngestAPIKey))
	request.Header.Set("Content-Type", "application/x-protobuf")
	request.Header.Set("Content-Encoding", "snappy")
	request.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")
	return request
}

func postRuntimeWrite(t *testing.T, cfg *config.Config, client *http.Client, scheme string, wantStatus int) {
	t.Helper()
	t.Cleanup(client.CloseIdleConnections)
	response, err := client.Do(runtimeWriteRequest(t, cfg, scheme))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != wantStatus || (wantStatus == http.StatusNoContent && len(body) != 0) {
		t.Fatalf("remote_write status=%d body=%q want=%d", response.StatusCode, body, wantStatus)
	}
}

func runtimeMetricValues(t *testing.T, backend spi.Backend, tenant string) []float64 {
	t.Helper()
	matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "runtime_remote_write")
	if err != nil {
		t.Fatal(err)
	}
	series, err := backend.Metrics().Select(context.Background(), spi.SeriesQuery{Tenant: tenant, Matchers: []spi.Matcher{matcher}, Start: 0, End: math.MaxInt64})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = series.Close() }()
	var values []float64
	for series.Next() {
		if series.At().Labels().Get(utm.LabelTenant) != tenant {
			t.Fatal("stored metric lost authenticated tenant")
		}
		samples := series.At().Samples()
		for samples.Next() {
			_, value := samples.At()
			values = append(values, value)
		}
		if err := samples.Err(); err != nil {
			t.Fatal(err)
		}
	}
	if err := series.Err(); err != nil {
		t.Fatal(err)
	}
	return values
}

func TestRemoteWriteRuntimePreservesAuthenticationAndNormalization(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "ingest"
	cfg.Ingest.ClockSkewPolicy = "drop"
	backend, err := spi.Open(context.Background(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
	}()
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	client := &http.Client{Timeout: time.Second}
	defer client.CloseIdleConnections()
	for _, test := range []struct {
		name   string
		mutate func(*http.Request)
		status int
	}{
		{"wrong method", func(r *http.Request) { r.Method = http.MethodGet }, http.StatusMethodNotAllowed},
		{"missing bearer", func(r *http.Request) { r.Header.Del("Authorization") }, http.StatusUnauthorized},
		{"duplicate bearer", func(r *http.Request) { r.Header.Add("Authorization", r.Header.Get("Authorization")) }, http.StatusUnauthorized},
		{"other tenant", func(r *http.Request) { r.Header.Set("X-Prism-Tenant", "other") }, http.StatusBadRequest},
		{"configured clock skew drop", func(*http.Request) {}, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := runtimeWriteRequest(t, cfg, "http")
			test.mutate(request)
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			_, _ = io.Copy(io.Discard, response.Body)
			if response.StatusCode != test.status {
				t.Fatalf("remote_write status=%d want=%d", response.StatusCode, test.status)
			}
		})
	}
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("runtime shutdown hung")
	}
	if got := runtimeMetricValues(t, backend, "default"); len(got) != 0 {
		t.Fatalf("rejected remote_write persisted: %v", got)
	}
}

func TestIngestPushRuntimeIsAbsentInOtherRoles(t *testing.T) {
	for _, mode := range []string{"query", "ruler", "console"} {
		t.Run(mode, func(t *testing.T) {
			cfg := runtimeConfig(t)
			cfg.Server.Mode = mode
			cfg.Auth.IngestAPIKeyFile = ""
			backend, err := spi.Open(context.Background(), "memory", spi.Config{})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = backend.Close() }()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			result := make(chan error, 1)
			go func() {
				result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
			}()
			waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
			postRuntimeWrite(t, cfg, &http.Client{Timeout: time.Second}, "http", http.StatusNotFound)
			postRuntimeLoki(t, cfg, &http.Client{Timeout: time.Second}, "http", http.StatusNotFound)
			cancel()
			select {
			case err := <-result:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("runtime shutdown hung")
			}
		})
	}
}

func TestRemoteWriteSlowBodyDoesNotBlockOTLPAndCancelsAtShutdown(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "ingest"
	cfg.Server.ShutdownTimeout = config.Duration(30 * time.Millisecond)
	backend, err := spi.Open(context.Background(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	runtimeDone := make(chan struct{})
	defer func() {
		cancel()
		select {
		case <-runtimeDone:
		case <-time.After(time.Second):
			t.Error("runtime cleanup did not complete")
		}
	}()
	go func() {
		defer close(runtimeDone)
		result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
	}()
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	dialCtx, stopDial := context.WithTimeout(context.Background(), time.Second)
	defer stopDial()
	var dialer net.Dialer
	connection, err := dialer.DialContext(dialCtx, "tcp", cfg.Server.HTTPListen)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	_, err = fmt.Fprintf(connection, "POST /prom/api/v1/write HTTP/1.1\r\nHost: %s\r\nContent-Type: application/x-protobuf\r\nContent-Encoding: snappy\r\nX-Prometheus-Remote-Write-Version: 0.1.0\r\nAuthorization: Bearer %s\r\nContent-Length: 4096\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n", cfg.Server.HTTPListen, string(cfg.Auth.IngestAPIKey))
	if err != nil {
		t.Fatal(err)
	}
	// The server sends 100 Continue only when the receiver reads the body,
	// after acquiring its slot. Sending headers alone does not prove admission.
	readDeadline, _ := dialCtx.Deadline()
	if err := connection.SetReadDeadline(readDeadline); err != nil {
		t.Fatal(err)
	}
	continued, err := http.ReadResponse(bufio.NewReader(connection), nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = continued.Body.Close()
	if continued.StatusCode != http.StatusContinue {
		t.Fatalf("slow remote_write admission status=%d want=100", continued.StatusCode)
	}
	// This fixture owns one request and intentionally keeps its body incomplete.
	// Connection: close also avoids net/http's unread keep-alive body drain and
	// deferred TCP reset-avoidance cleanup after forced cancellation.
	if _, err := connection.Write([]byte{0}); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: time.Second}
	defer client.CloseIdleConnections()
	response, err := client.Do(runtimeWriteRequest(t, cfg, "http"))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("remote_write gate status=%d want=429", response.StatusCode)
	}
	if response.Header.Get("Retry-After") == "" {
		t.Fatal("remote_write gate omitted retry delay")
	}
	// The remote_write slot is independent of OTLP's gate and both routes share
	// the same listener. Shutdown must cancel this stalled HTTP body before drain.
	postRuntimeLog(t, cfg, "while-remote-write-stalled")
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("shutdown error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("slow remote_write body hung shutdown")
	}
}

// The string timestamp uses UTM conversion, including in runtime wire fixtures.
func runtimeLokiRequest(t *testing.T, cfg *config.Config, scheme string) *http.Request {
	t.Helper()
	body := fmt.Sprintf(`{"streams":[{"stream":{"service":"runtime"},"values":[["%d","loki"]]}]}`, utm.TimeToNano(time.Now()))
	request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, scheme+"://"+cfg.Server.HTTPListen+"/loki/api/v1/push", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+string(cfg.Auth.IngestAPIKey))
	return request
}

func postRuntimeLoki(t *testing.T, cfg *config.Config, client *http.Client, scheme string, wantStatus int) {
	t.Helper()
	t.Cleanup(client.CloseIdleConnections)
	response, err := client.Do(runtimeLokiRequest(t, cfg, scheme))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != wantStatus || (wantStatus == http.StatusNoContent && len(body) != 0) {
		t.Fatalf("loki push status=%d body=%q want=%d", response.StatusCode, body, wantStatus)
	}
}

func TestLokiRuntimePreservesAuthenticationAndNormalization(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "ingest"
	cfg.Ingest.ClockSkewPolicy = "drop"
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
	}()
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	client := &http.Client{Timeout: time.Second}
	defer client.CloseIdleConnections()
	for _, test := range []struct {
		name   string
		mutate func(*http.Request)
		status int
	}{
		{"wrong method", func(r *http.Request) { r.Method = http.MethodGet }, http.StatusMethodNotAllowed},
		{"missing bearer", func(r *http.Request) { r.Header.Del("Authorization") }, http.StatusUnauthorized},
		{"wrong bearer", func(r *http.Request) { r.Header.Set("Authorization", "Bearer wrong-credential") }, http.StatusUnauthorized},
		{"duplicate bearer", func(r *http.Request) { r.Header.Add("Authorization", r.Header.Get("Authorization")) }, http.StatusUnauthorized},
		{"other tenant", func(r *http.Request) { r.Header.Set("X-Scope-OrgID", "other") }, http.StatusBadRequest},
		{"duplicate tenant", func(r *http.Request) {
			r.Header.Add("X-Prism-Tenant", "default")
			r.Header.Add("X-Prism-Tenant", "default")
		}, http.StatusBadRequest},
		{"exact route only", func(r *http.Request) { r.URL.Path += "/extra" }, http.StatusNotFound},
		{"query route absent", func(r *http.Request) { r.Method = http.MethodGet; r.URL.Path = "/loki/api/v1/query" }, http.StatusNotFound},
		{"configured clock skew drop", func(r *http.Request) {
			body := fmt.Sprintf(`{"streams":[{"stream":{"service":"runtime"},"values":[["%d","old"]]}]}`, utm.TimeToNano(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)))
			r.Body = io.NopCloser(strings.NewReader(body))
			r.ContentLength = int64(len(body))
		}, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := runtimeLokiRequest(t, cfg, "http")
			test.mutate(request)
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			_, _ = io.Copy(io.Discard, response.Body)
			if response.StatusCode == http.StatusMethodNotAllowed && response.Header.Get("Allow") != http.MethodPost {
				t.Fatalf("Loki wrong-method Allow=%q", response.Header.Get("Allow"))
			}
			if response.StatusCode != test.status {
				t.Fatalf("loki push status=%d want=%d", response.StatusCode, test.status)
			}
		})
	}
	cancel()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("runtime shutdown hung")
	}
	if got := runtimeLogBodies(t, backend); len(got) != 0 {
		t.Fatalf("rejected loki push persisted: %v", got)
	}
}

func TestLokiSlowBodyDoesNotBlockOtherProtocolsAndCancelsAtShutdown(t *testing.T) {
	for _, clientCancel := range []bool{false, true} {
		t.Run(fmt.Sprintf("client_cancel_%t", clientCancel), func(t *testing.T) {
			cfg := runtimeConfig(t)
			cfg.Server.Mode = "ingest"
			cfg.Server.ShutdownTimeout = config.Duration(30 * time.Millisecond)
			backend, err := spi.Open(t.Context(), "memory", spi.Config{})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = backend.Close() }()
			ctx, cancel := context.WithCancel(t.Context())
			result := make(chan error, 1)
			runtimeDone := make(chan struct{})
			defer func() {
				cancel()
				select {
				case <-runtimeDone:
				case <-time.After(time.Second):
					t.Error("runtime cleanup did not complete")
				}
			}()
			go func() {
				defer close(runtimeDone)
				result <- runConfiguredMode(ctx, cfg, slog.New(slog.DiscardHandler), prometheus.NewRegistry(), backend)
			}()
			waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
			dialCtx, stopDial := context.WithTimeout(t.Context(), time.Second)
			defer stopDial()
			var dialer net.Dialer
			connection, err := dialer.DialContext(dialCtx, "tcp", cfg.Server.HTTPListen)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = connection.Close() }()
			_, err = fmt.Fprintf(connection, "POST /loki/api/v1/push HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\nAuthorization: Bearer %s\r\nContent-Length: 4096\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n", cfg.Server.HTTPListen, string(cfg.Auth.IngestAPIKey))
			if err != nil {
				t.Fatal(err)
			}
			// The server sends 100 Continue only when the receiver reads the body,
			// after acquiring its slot. Sending headers alone does not prove admission.
			readDeadline, _ := dialCtx.Deadline()
			if err := connection.SetReadDeadline(readDeadline); err != nil {
				t.Fatal(err)
			}
			continued, err := http.ReadResponse(bufio.NewReader(connection), nil)
			if err != nil {
				t.Fatal(err)
			}
			_ = continued.Body.Close()
			if continued.StatusCode != http.StatusContinue {
				t.Fatalf("slow loki push admission status=%d want=100", continued.StatusCode)
			}
			// This fixture owns one request and intentionally keeps its body incomplete.
			// Connection: close also avoids net/http's unread keep-alive body drain and
			// deferred TCP reset-avoidance cleanup after forced cancellation.
			if _, err := connection.Write([]byte("{")); err != nil {
				t.Fatal(err)
			}
			client := &http.Client{Timeout: time.Second}
			defer client.CloseIdleConnections()
			response, err := client.Do(runtimeLokiRequest(t, cfg, "http"))
			if err != nil {
				t.Fatal(err)
			}
			_, _ = io.Copy(io.Discard, response.Body)
			_ = response.Body.Close()
			if response.StatusCode != http.StatusTooManyRequests {
				t.Fatalf("loki push gate status=%d want=429", response.StatusCode)
			}
			if response.Header.Get("Retry-After") == "" {
				t.Fatal("loki push gate omitted retry delay")
			}
			// The loki push slot is independent of OTLP's gate and both routes share
			// the same listener. Shutdown must cancel this stalled HTTP body before drain.
			postRuntimeLog(t, cfg, "while-loki-push-stalled")
			postRuntimeWrite(t, cfg, client, "http", http.StatusNoContent)
			if clientCancel {
				if err := connection.Close(); err != nil {
					t.Fatal(err)
				}
				// The disconnected handler must join its body cancellation callback and
				// release its slot before another request can be admitted.
				deadline := time.NewTimer(time.Second)
				defer deadline.Stop()
				ticker := time.NewTicker(time.Millisecond)
				defer ticker.Stop()
				for {
					response, err := client.Do(runtimeLokiRequest(t, cfg, "http"))
					if err != nil {
						t.Fatal(err)
					}
					_, _ = io.Copy(io.Discard, response.Body)
					_ = response.Body.Close()
					if response.StatusCode == http.StatusNoContent {
						break
					}
					if response.StatusCode != http.StatusTooManyRequests {
						t.Fatalf("Loki after client cancel status=%d", response.StatusCode)
					}
					select {
					case <-ticker.C:
					case <-deadline.C:
						t.Fatal("disconnected Loki request retained its slot")
					}
				}
			}
			cancel()
			select {
			case err := <-result:
				if (clientCancel && err != nil) || (!clientCancel && !errors.Is(err, context.DeadlineExceeded)) {
					t.Fatalf("shutdown error=%v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("slow loki push body hung shutdown")
			}
		})
	}
}

func TestLokiRuntimeClosesBackendAfterWriteCancellation(t *testing.T) {
	cfg := runtimeConfig(t)
	cfg.Server.Mode = "ingest"
	cfg.Server.ShutdownTimeout = config.Duration(20 * time.Millisecond)
	cfg.Ingest.Batch.Logs.MaxItems = 1
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	store := &blockingLogs{LogStore: backend.Logs(), started: make(chan struct{}), stopped: make(chan struct{})}
	wrapped := &closeOrderBackend{Backend: backend, store: store, stopped: store.stopped}
	name := fmt.Sprintf("runtime-loki-close-order-%d", driverSequence.Add(1))
	spi.Register(name, fixedBackendDriver{name: name, backend: wrapped})
	cfg.Storage.Driver = name
	cfg.Storage.DSN = "test"
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- runService(ctx, cfg, slog.New(slog.DiscardHandler)) }()
	waitForEndpoint(t, "http://"+cfg.Server.HTTPListen+"/-/healthy", "ok\n")
	postRuntimeLoki(t, cfg, &http.Client{Timeout: time.Second}, "http", http.StatusNoContent)
	select {
	case <-store.started:
	case <-time.After(time.Second):
		t.Fatal("write not started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown hung")
	}
	if !wrapped.closed.Load() || wrapped.closedEarly.Load() {
		t.Fatal("backend closed before pipeline write termination")
	}
}
