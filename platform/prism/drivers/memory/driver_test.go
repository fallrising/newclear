package memory

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

var (
	_ spi.Driver      = driver{}
	_ spi.Backend     = (*backend)(nil)
	_ spi.MetricStore = (*metricStore)(nil)
	_ spi.LogStore    = (*logStore)(nil)
	_ spi.TraceStore  = (*traceStore)(nil)
)

func TestDriverRegistrationAndCapabilities(t *testing.T) {
	if !slices.Contains(spi.Drivers(), driverName) {
		t.Fatalf("registered drivers %v do not contain %q", spi.Drivers(), driverName)
	}

	opened, err := spi.Open(context.Background(), driverName, spi.Config{})
	if err != nil {
		t.Fatalf("spi.Open() error = %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })

	caps := opened.Capabilities()
	if err := caps.Validate(); err != nil {
		t.Fatalf("Capabilities.Validate() error = %v", err)
	}
	if caps.Driver != driverName || !caps.Has(spi.SignalMetrics) || !caps.Has(spi.SignalLogs) ||
		!caps.Has(spi.SignalTraces) || caps.OutOfOrderWindow >= 0 {
		t.Fatalf("Capabilities() = %#v", caps)
	}
	if opened.Metrics() == nil || opened.Logs() == nil || opened.Traces() == nil {
		t.Fatal("memory backend did not provide all three stores")
	}
	if _, ok := opened.Metrics().(spi.NativeMetricQuerier); ok {
		t.Fatal("memory metric store implements undeclared NativeMetricQuerier")
	}
	if _, ok := opened.Logs().(spi.NativeLogQuerier); ok {
		t.Fatal("memory log store implements undeclared NativeLogQuerier")
	}
	if _, ok := opened.Traces().(spi.SpanAggregator); ok {
		t.Fatal("memory trace store implements undeclared SpanAggregator")
	}
}

func TestBackendLifecycle(t *testing.T) {
	backend := newBackend()
	if err := backend.Migrate(context.Background()); err != nil {
		t.Fatalf("first Migrate() error = %v", err)
	}
	if err := backend.Migrate(context.Background()); err != nil {
		t.Fatalf("second Migrate() error = %v", err)
	}
	if err := backend.Ping(context.Background()); err != nil {
		t.Fatalf("Ping() error = %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}

	checks := []struct {
		name string
		call func() error
	}{
		{name: "Migrate", call: func() error { return backend.Migrate(context.Background()) }},
		{name: "Ping", call: func() error { return backend.Ping(context.Background()) }},
		{name: "metrics write", call: func() error { return backend.metrics.Write(context.Background(), nil) }},
		{name: "metrics select", call: func() error {
			_, err := backend.metrics.Select(context.Background(), spi.SeriesQuery{})
			return err
		}},
		{name: "metrics label names", call: func() error {
			_, err := backend.metrics.LabelNames(context.Background(), spi.LabelQuery{})
			return err
		}},
		{name: "metrics label values", call: func() error {
			_, err := backend.metrics.LabelValues(context.Background(), "job", spi.LabelQuery{})
			return err
		}},
		{name: "logs write", call: func() error { return backend.logs.Write(context.Background(), nil) }},
		{name: "logs search", call: func() error {
			_, err := backend.logs.Search(context.Background(), spi.LogQuery{})
			return err
		}},
		{name: "logs label names", call: func() error {
			_, err := backend.logs.LabelNames(context.Background(), spi.LabelQuery{})
			return err
		}},
		{name: "logs label values", call: func() error {
			_, err := backend.logs.LabelValues(context.Background(), "job", spi.LabelQuery{})
			return err
		}},
		{name: "traces write", call: func() error { return backend.traces.Write(context.Background(), nil) }},
		{name: "get trace", call: func() error {
			_, err := backend.traces.GetTrace(context.Background(), "tenant", "trace")
			return err
		}},
		{name: "find traces", call: func() error {
			_, err := backend.traces.FindTraceIDs(context.Background(), spi.TraceQuery{})
			return err
		}},
		{name: "services", call: func() error {
			_, err := backend.traces.Services(context.Background(), "tenant", spi.TimeRange{})
			return err
		}},
		{name: "operations", call: func() error {
			_, err := backend.traces.Operations(context.Background(), "tenant", "service", "", spi.TimeRange{})
			return err
		}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if got := spi.Classify(check.call()); got != spi.ErrUnavailable {
				t.Fatalf("error class = %v, want unavailable", got)
			}
		})
	}
}

func TestCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (driver{}).Open(ctx, spi.Config{}); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("driver.Open() class = %v, want timeout", spi.Classify(err))
	}

	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	checks := []struct {
		name string
		call func() error
	}{
		{name: "Migrate", call: func() error { return backend.Migrate(ctx) }},
		{name: "metrics", call: func() error {
			_, err := backend.metrics.Select(ctx, spi.SeriesQuery{})
			return err
		}},
		{name: "logs", call: func() error {
			_, err := backend.logs.Search(ctx, spi.LogQuery{})
			return err
		}},
		{name: "traces", call: func() error {
			_, err := backend.traces.GetTrace(ctx, "tenant", "trace")
			return err
		}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if got := spi.Classify(check.call()); got != spi.ErrTimeout {
				t.Fatalf("error class = %v, want timeout", got)
			}
		})
	}
}

func TestConcurrentAccess(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })

	const workers = 32
	errorsCh := make(chan error, workers*4)
	var waitGroup sync.WaitGroup
	for i := range workers {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			tenant := "tenant"
			metricLabels := labels.FromStrings(utm.LabelName, "requests_total", utm.LabelTenant, tenant, "worker", fmt.Sprint(i))
			if err := backend.metrics.Write(context.Background(), []utm.MetricPoint{{Labels: metricLabels, TS: int64(i), Value: float64(i)}}); err != nil {
				errorsCh <- err
			}
			if err := backend.logs.Write(context.Background(), []utm.LogRecord{{Resource: &utm.Resource{Tenant: tenant}, TS: int64(i), Body: "log"}}); err != nil {
				errorsCh <- err
			}
			if err := backend.traces.Write(context.Background(), []utm.Span{{Resource: &utm.Resource{Tenant: tenant}, TraceID: fmt.Sprintf("%032x", i+1), SpanID: fmt.Sprintf("%016x", i+1), StartNano: int64(i), EndNano: int64(i + 1)}}); err != nil {
				errorsCh <- err
			}
			if _, err := backend.metrics.LabelNames(context.Background(), spi.LabelQuery{Tenant: tenant, Start: 0, End: workers}); err != nil {
				errorsCh <- err
			}
		}()
	}
	waitGroup.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Errorf("concurrent operation error = %v", err)
	}
}
