//go:build integration

package e2e_test

import (
	"context"
	"errors"
	"net"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/compat/otlp"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.uber.org/goleak"
	"google.golang.org/grpc"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

// This gate requires a real external generator. It deliberately fails, rather
// than skips, when explicitly selected without the documented prerequisite.
func TestTelemetrygenThreeSignals(t *testing.T) {
	generator := os.Getenv("OTLP_TELEMETRYGEN_BINARY")
	if generator == "" {
		t.Fatal("set OTLP_TELEMETRYGEN_BINARY to telemetrygen v0.116.0; see test/e2e/README.md")
	}
	for _, transport := range []string{"grpc", "http"} {
		t.Run(transport, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			backend, err := spi.Open(ctx, "memory", spi.Config{})
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := backend.Close(); err != nil {
					t.Error(err)
				}
			}()
			options := ingest.DefaultOptions()
			options.MaxTenants = 1
			options.Metrics.FlushInterval = time.Hour
			options.Logs.FlushInterval = time.Hour
			options.Traces.FlushInterval = time.Hour
			pipeline, err := ingest.New(ctx, backend, options)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := pipeline.Close(ctx); err != nil {
					t.Error(err)
				}
			}()
			// Public, test-only credential; never use this value for a deployed service.
			const key = "prism-telemetrygen-public-test-key-00000000"
			receiver, err := otlp.New(pipeline, otlp.Options{Tenant: "generator", APIKey: secret.String(key), MaxRequestBytes: 16 << 20, MaxRecvMsgSize: 4 << 20, MaxConcurrentRequests: 4})
			if err != nil {
				t.Fatal(err)
			}
			var endpoint string
			if transport == "http" {
				server := httptest.NewServer(receiver.HTTPHandler())
				defer server.Close()
				endpoint = strings.TrimPrefix(server.URL, "http://")
			} else {
				listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				server := receiver.NewGRPCServer()
				exited := make(chan error, 1)
				go func() { exited <- server.Serve(listener) }()
				defer func() {
					server.Stop()
					if err := <-exited; err != nil && !errors.Is(err, grpc.ErrServerStopped) {
						t.Error(err)
					}
				}()
				endpoint = listener.Addr().String()
			}
			for _, signal := range []string{"metrics", "logs", "traces"} {
				args := []string{signal, "--otlp-endpoint", endpoint, "--otlp-insecure", "--workers", "1", "--" + signal, "1", "--otlp-header", `authorization="Bearer ` + key + `"`}
				if transport == "http" {
					args = append(args, "--otlp-http")
				}
				if signal == "traces" {
					args = append(args, "--service", "prism-acceptance", "--child-spans", "1")
				}
				command := exec.CommandContext(ctx, generator, args...) //nolint:gosec // Explicit administrator-selected integration-test executable, no shell.
				output, err := command.CombinedOutput()
				if err != nil {
					t.Fatalf("telemetrygen %s/%s failed: %v\n%s", transport, signal, err, output)
				}
				t.Logf("telemetrygen %s/%s exited successfully", transport, signal)
			}
			// All records are still buffered (one-hour timers); Close must flush them.
			if err := pipeline.Close(ctx); err != nil {
				t.Fatal(err)
			}
			assertStoredTelemetry(t, ctx, backend, "generator", true)
			assertStoredTelemetry(t, ctx, backend, "other", false)
		})
	}
}

func assertStoredTelemetry(t *testing.T, ctx context.Context, backend spi.Backend, tenant string, want bool) {
	t.Helper()
	start, end := time.Now().Add(-time.Minute), time.Now().Add(time.Minute)
	series, err := backend.Metrics().Select(ctx, spi.SeriesQuery{Tenant: tenant, Start: utm.TimeToMilli(start), End: utm.TimeToMilli(end)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := series.Close(); err != nil {
			t.Error(err)
		}
	}()
	metrics := 0
	for series.Next() {
		row := series.At()
		if row.Labels().Get(utm.LabelName) != "gen" || row.Labels().Get(utm.LabelTenant) != tenant {
			t.Fatalf("unexpected metric labels: %v", row.Labels())
		}
		samples := row.Samples()
		for samples.Next() {
			_, value := samples.At()
			if value != 0 {
				t.Fatalf("metric value = %v, want first generated value 0", value)
			}
			metrics++
		}
		if err := samples.Err(); err != nil {
			t.Fatal(err)
		}
	}
	if err := series.Err(); err != nil {
		t.Fatal(err)
	}
	logs, err := backend.Logs().Search(ctx, spi.LogQuery{Tenant: tenant, Start: utm.TimeToNano(start), End: utm.TimeToNano(end), Limit: 10, Direction: spi.Forward})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := logs.Close(); err != nil {
			t.Error(err)
		}
	}()
	logCount := 0
	for logs.Next() {
		row := logs.At()
		if row.Resource == nil || row.Resource.Tenant != tenant || row.Body == "" {
			t.Fatalf("invalid stored log: %#v", row)
		}
		logCount++
	}
	if err := logs.Err(); err != nil {
		t.Fatal(err)
	}
	traces, err := backend.Traces().FindTraceIDs(ctx, spi.TraceQuery{Tenant: tenant, Service: "prism-acceptance", Start: utm.TimeToNano(start), End: utm.TimeToNano(end), Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	spanCount := 0
	for _, trace := range traces {
		spans, err := backend.Traces().GetTrace(ctx, tenant, trace.TraceID)
		if err != nil {
			t.Fatal(err)
		}
		for spans.Next() {
			row := spans.At()
			if row.Resource == nil || row.Resource.Tenant != tenant || row.Resource.Service != "prism-acceptance" || row.SpanID == "" {
				t.Errorf("invalid stored span: %#v", row)
			}
			spanCount++
		}
		scanErr := spans.Err()
		closeErr := spans.Close()
		if err := errors.Join(scanErr, closeErr); err != nil {
			t.Fatal(err)
		}
	}
	if want {
		if metrics != 1 || logCount != 1 || len(traces) != 1 || spanCount != 2 {
			t.Fatalf("stored metrics=%d logs=%d traces=%d spans=%d, want 1/1/1/2", metrics, logCount, len(traces), spanCount)
		}
	} else if metrics != 0 || logCount != 0 || len(traces) != 0 {
		t.Fatal("telemetry leaked across tenants")
	}
	t.Logf("tenant=%s persisted metrics=%d logs=%d traces=%d spans=%d", tenant, metrics, logCount, len(traces), spanCount)
}
