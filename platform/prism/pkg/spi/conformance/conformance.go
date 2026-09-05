package conformance

import (
	"context"
	"fmt"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// Factory creates an isolated backend and its cleanup function for a test.
type Factory func(t *testing.T) (spi.Backend, func())

// Options controls conformance execution for a driver.
type Options struct {
	KnownDeviations      map[string]string
	WriteVisibilityDelay time.Duration
	SkipSignals          []spi.Signal
}

// Run executes every L1 storage driver conformance group.
func Run(t *testing.T, f Factory, opts Options) {
	t.Helper()
	validateOptions(t, opts)
	t.Run("general", func(t *testing.T) { RunGeneral(t, f, opts) })
	t.Run("metrics", func(t *testing.T) { RunMetrics(t, f, opts) })
	t.Run("logs", func(t *testing.T) { RunLogs(t, f, opts) })
	t.Run("traces", func(t *testing.T) { RunTraces(t, f, opts) })
}

// RunGeneral executes the C-GEN conformance tests.
func RunGeneral(t *testing.T, f Factory, opts Options) {
	t.Helper()
	validateOptions(t, opts)

	t.Run("C-GEN-01 migrate is idempotent", func(t *testing.T) {
		backend := openBackend(t, f)
		if err := backend.Migrate(context.Background()); err != nil {
			t.Fatalf("first Migrate() error = %v", err)
		}
		if err := backend.Migrate(context.Background()); err != nil {
			t.Fatalf("second Migrate() error = %v", err)
		}
	})

	t.Run("C-GEN-02 ping succeeds", func(t *testing.T) {
		backend := openBackend(t, f)
		if err := backend.Ping(context.Background()); err != nil {
			t.Fatalf("Ping() error = %v", err)
		}
	})

	t.Run("C-GEN-03 operations fail after close", func(t *testing.T) {
		backend := openBackend(t, f)
		metrics, logs, traces := backend.Metrics(), backend.Logs(), backend.Traces()
		if err := backend.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
		calls := closedOperationCalls(backend, metrics, logs, traces)
		for name, call := range calls {
			t.Run(name, func(t *testing.T) {
				if got := spi.Classify(call(context.Background())); got != spi.ErrUnavailable {
					t.Fatalf("error class = %v, want unavailable", got)
				}
			})
		}
	})

	t.Run("C-GEN-04 signal declarations match stores", func(t *testing.T) {
		backend := openBackend(t, f)
		caps := backend.Capabilities()
		checks := []struct {
			signal spi.Signal
			store  any
		}{
			{signal: spi.SignalMetrics, store: backend.Metrics()},
			{signal: spi.SignalLogs, store: backend.Logs()},
			{signal: spi.SignalTraces, store: backend.Traces()},
		}
		for _, check := range checks {
			skipped := slices.Contains(opts.SkipSignals, check.signal)
			if skipped && (caps.Has(check.signal) || !isNil(check.store)) {
				t.Errorf("skipped signal %q is declared or has a store", check.signal)
			}
			if !skipped && (!caps.Has(check.signal) || isNil(check.store)) {
				t.Errorf("signal %q must be declared with a non-nil store or listed in SkipSignals", check.signal)
			}
		}
	})

	t.Run("C-GEN-05 declared optional capabilities exist", func(t *testing.T) {
		backend := openBackend(t, f)
		checkOptionalCapabilities(t, backend, true)
	})

	t.Run("C-GEN-06 undeclared optional capabilities are absent", func(t *testing.T) {
		backend := openBackend(t, f)
		checkOptionalCapabilities(t, backend, false)
	})

	t.Run("C-GEN-07 canceled operations return and do not leak", func(t *testing.T) {
		backend := openBackend(t, f)
		baseline := runtime.NumGoroutine()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		for name, call := range canceledOperationCalls(backend) {
			t.Run(name, func(t *testing.T) {
				result := make(chan error, 1)
				go func() { result <- call(ctx) }()
				select {
				case err := <-result:
					if spi.Classify(err) != spi.ErrTimeout {
						t.Fatalf("error class = %v, want timeout", spi.Classify(err))
					}
				case <-time.After(time.Second):
					t.Fatal("operation did not return within one second")
				}
			})
		}
		deadline := time.Now().Add(time.Second)
		for runtime.NumGoroutine() > baseline+2 && time.Now().Before(deadline) {
			runtime.Gosched()
			time.Sleep(10 * time.Millisecond)
		}
		if got := runtime.NumGoroutine(); got > baseline+2 {
			t.Errorf("goroutine count grew from %d to %d after cancellation", baseline, got)
		}
	})

	t.Run("C-GEN-08 errors are classified", func(t *testing.T) {
		backend := openBackend(t, f)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if got := spi.Classify(backend.Ping(ctx)); got != spi.ErrTimeout {
			t.Fatalf("canceled Ping() class = %v, want timeout", got)
		}
		if err := backend.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
		if got := spi.Classify(backend.Ping(context.Background())); got != spi.ErrUnavailable {
			t.Fatalf("closed Ping() class = %v, want unavailable", got)
		}
	})

	t.Run("C-GEN-09 concurrent mixed access", func(t *testing.T) {
		backend := openBackend(t, f)
		runConcurrentAccess(t, backend, opts)
	})
}

func validateOptions(t *testing.T, opts Options) {
	t.Helper()
	allowed := map[string]struct{}{"C-MET-08": {}, "C-LOG-08": {}, "C-TRC-05": {}}
	for id, reason := range opts.KnownDeviations {
		if _, ok := allowed[id]; !ok {
			t.Fatalf("KnownDeviations contains unsupported test ID %q", id)
		}
		if strings.TrimSpace(reason) == "" {
			t.Fatalf("KnownDeviations[%q] must include a reason", id)
		}
	}
	for _, signal := range opts.SkipSignals {
		if signal != spi.SignalMetrics && signal != spi.SignalLogs && signal != spi.SignalTraces {
			t.Fatalf("SkipSignals contains unknown signal %q", signal)
		}
	}
}

func openBackend(t *testing.T, factory Factory) spi.Backend {
	t.Helper()
	if factory == nil {
		t.Fatal("conformance Factory must not be nil")
	}
	backend, cleanup := factory(t)
	if isNil(backend) {
		t.Fatal("conformance Factory returned a nil backend")
	}
	if cleanup != nil {
		t.Cleanup(cleanup)
	}
	if err := backend.Capabilities().Validate(); err != nil {
		t.Fatalf("Capabilities.Validate() error = %v", err)
	}
	return backend
}

func requireSignal(t *testing.T, backend spi.Backend, opts Options, signal spi.Signal) {
	t.Helper()
	if slices.Contains(opts.SkipSignals, signal) {
		if backend.Capabilities().Has(signal) {
			t.Fatalf("signal %q is both declared and skipped", signal)
		}
		t.Skipf("driver does not implement %s", signal)
	}
	if !backend.Capabilities().Has(signal) {
		t.Fatalf("signal %q is not declared and is missing from SkipSignals", signal)
	}
}

func skipDeviation(t *testing.T, opts Options, id string) {
	t.Helper()
	if reason, ok := opts.KnownDeviations[id]; ok {
		t.Skipf("known deviation %s: %s", id, reason)
	}
}

func waitForVisibility(opts Options) {
	if opts.WriteVisibilityDelay > 0 {
		time.Sleep(opts.WriteVisibilityDelay)
	}
}

func isNil(value any) bool {
	if value == nil {
		return true
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return reflected.IsNil()
	default:
		return false
	}
}

func closedOperationCalls(
	backend spi.Backend,
	metrics spi.MetricStore,
	logs spi.LogStore,
	traces spi.TraceStore,
) map[string]func(context.Context) error {
	fixtures := NewFixtures()
	metricBatch := fixtures.Metrics(1, 1, 1, time.Millisecond)
	metricQuery := fixtureSeriesQuery(0, 2)
	metricLabelQuery := spi.LabelQuery{
		Tenant: fixtureTenant, Matchers: metricQuery.Matchers, Start: 0, End: 2, Limit: 10,
	}
	logBatch := fixtures.Logs(1, 1, 1, time.Nanosecond)
	logQuery := fixtureLogQuery(0, 2, spi.Forward)
	logQuery.Limit = 10
	logLabelQuery := spi.LabelQuery{
		Tenant: fixtureTenant, Matchers: logQuery.Selectors, Start: 0, End: 2, Limit: 10,
	}
	traceBatch := fixtures.Trace(1, 1, 1)
	traceQuery := spi.TraceQuery{
		Tenant: fixtureTenant, Service: "service-0", Start: 0, End: int64(time.Second), Limit: 10,
	}
	timeRange := spi.TimeRange{Start: 0, End: int64(time.Second)}
	calls := map[string]func(context.Context) error{
		"Migrate": backend.Migrate,
		"Ping":    backend.Ping,
	}
	if !isNil(metrics) {
		calls["metrics.Write"] = func(ctx context.Context) error { return metrics.Write(ctx, metricBatch) }
		calls["metrics.Select"] = func(ctx context.Context) error {
			_, err := metrics.Select(ctx, metricQuery)
			return err
		}
		calls["metrics.LabelNames"] = func(ctx context.Context) error {
			_, err := metrics.LabelNames(ctx, metricLabelQuery)
			return err
		}
		calls["metrics.LabelValues"] = func(ctx context.Context) error {
			_, err := metrics.LabelValues(ctx, "group", metricLabelQuery)
			return err
		}
		if native, ok := metrics.(spi.NativeMetricQuerier); ok {
			calls["metrics.QueryInstant"] = func(ctx context.Context) error {
				_, err := native.QueryInstant(ctx, fixtureTenant, "up", utm.MilliToTime(0), time.Second)
				return err
			}
			calls["metrics.QueryRange"] = func(ctx context.Context) error {
				_, err := native.QueryRange(ctx, fixtureTenant, "up", utm.MilliToTime(0), utm.MilliToTime(1_000), time.Second, time.Second)
				return err
			}
		}
		if exemplars, ok := metrics.(spi.ExemplarQuerier); ok {
			calls["metrics.QueryExemplars"] = func(ctx context.Context) error {
				_, err := exemplars.QueryExemplars(ctx, fixtureTenant, [][]spi.Matcher{metricQuery.Matchers}, spi.TimeRange{Start: 0, End: 2})
				return err
			}
		}
		if deleter, ok := metrics.(spi.SeriesDeleter); ok {
			calls["metrics.DeleteSeries"] = func(ctx context.Context) error {
				return deleter.DeleteSeries(ctx, fixtureTenant, metricQuery.Matchers, spi.TimeRange{Start: 0, End: 2})
			}
		}
		if metadata, ok := metrics.(spi.MetadataStore); ok {
			calls["metrics.UpsertMetadata"] = func(ctx context.Context) error {
				return metadata.UpsertMetadata(ctx, fixtureTenant, []utm.MetricMetadata{{Metric: "fixture_metric", Type: utm.TypeGauge}})
			}
			calls["metrics.Metadata"] = func(ctx context.Context) error {
				_, err := metadata.Metadata(ctx, fixtureTenant, "fixture_metric", 1)
				return err
			}
		}
	}
	if !isNil(logs) {
		calls["logs.Write"] = func(ctx context.Context) error { return logs.Write(ctx, logBatch) }
		calls["logs.Search"] = func(ctx context.Context) error {
			_, err := logs.Search(ctx, logQuery)
			return err
		}
		calls["logs.LabelNames"] = func(ctx context.Context) error {
			_, err := logs.LabelNames(ctx, logLabelQuery)
			return err
		}
		calls["logs.LabelValues"] = func(ctx context.Context) error {
			_, err := logs.LabelValues(ctx, "job", logLabelQuery)
			return err
		}
		if native, ok := logs.(spi.NativeLogQuerier); ok {
			calls["logs.SearchNative"] = func(ctx context.Context) error {
				_, err := native.SearchNative(ctx, logQuery)
				return err
			}
		}
		if tailer, ok := logs.(spi.LogTailer); ok {
			calls["logs.Tail"] = func(ctx context.Context) error {
				_, err := tailer.Tail(ctx, logQuery)
				return err
			}
		}
		if statser, ok := logs.(spi.LogStatser); ok {
			calls["logs.Stats"] = func(ctx context.Context) error {
				_, err := statser.Stats(ctx, logQuery)
				return err
			}
		}
	}
	if !isNil(traces) {
		calls["traces.Write"] = func(ctx context.Context) error { return traces.Write(ctx, traceBatch) }
		calls["traces.GetTrace"] = func(ctx context.Context) error {
			_, err := traces.GetTrace(ctx, fixtureTenant, traceBatch[0].TraceID)
			return err
		}
		calls["traces.FindTraceIDs"] = func(ctx context.Context) error {
			_, err := traces.FindTraceIDs(ctx, traceQuery)
			return err
		}
		calls["traces.Services"] = func(ctx context.Context) error {
			_, err := traces.Services(ctx, fixtureTenant, timeRange)
			return err
		}
		calls["traces.Operations"] = func(ctx context.Context) error {
			_, err := traces.Operations(ctx, fixtureTenant, "service-0", "", timeRange)
			return err
		}
		if dependencies, ok := traces.(spi.DependencyQuerier); ok {
			calls["traces.Dependencies"] = func(ctx context.Context) error {
				_, err := dependencies.Dependencies(ctx, fixtureTenant, timeRange)
				return err
			}
		}
		if aggregator, ok := traces.(spi.SpanAggregator); ok {
			calls["traces.ServiceRED"] = func(ctx context.Context) error {
				_, err := aggregator.ServiceRED(ctx, spi.REDQuery{
					Tenant: fixtureTenant, Services: []string{"service-0"}, Start: 0, End: int64(time.Minute), Step: time.Minute,
				})
				return err
			}
		}
	}
	return calls
}

func canceledOperationCalls(backend spi.Backend) map[string]func(context.Context) error {
	return closedOperationCalls(backend, backend.Metrics(), backend.Logs(), backend.Traces())
}

func checkOptionalCapabilities(t *testing.T, backend spi.Backend, declared bool) {
	t.Helper()
	caps := backend.Capabilities()
	checks := []struct {
		name       string
		capability bool
		present    bool
	}{
		{name: "NativeMetricQuerier", capability: caps.Metrics.NativePromQL, present: implements[spi.NativeMetricQuerier](backend.Metrics())},
		{name: "ExemplarQuerier", capability: caps.Metrics.Exemplars, present: implements[spi.ExemplarQuerier](backend.Metrics())},
		{name: "SeriesDeleter", capability: caps.Metrics.DeleteSeries, present: implements[spi.SeriesDeleter](backend.Metrics())},
		{name: "MetadataStore", capability: caps.Metrics.Metadata, present: implements[spi.MetadataStore](backend.Metrics())},
		{name: "NativeLogQuerier", capability: caps.Logs.NativeLogQuery, present: implements[spi.NativeLogQuerier](backend.Logs())},
		{name: "LogTailer", capability: caps.Logs.LiveTail, present: implements[spi.LogTailer](backend.Logs())},
		{name: "LogStatser", capability: caps.Logs.Stats, present: implements[spi.LogStatser](backend.Logs())},
		{name: "DependencyQuerier", capability: caps.Traces.Dependencies, present: implements[spi.DependencyQuerier](backend.Traces())},
		{name: "SpanAggregator", capability: caps.Traces.RED, present: implements[spi.SpanAggregator](backend.Traces())},
	}
	for _, check := range checks {
		if declared && check.capability && !check.present {
			t.Errorf("%s capability is true but interface is not implemented", check.name)
		}
		if !declared && !check.capability && check.present {
			t.Errorf("%s capability is false but interface is implemented", check.name)
		}
	}
}

func implements[T any](value any) bool {
	_, ok := value.(T)
	return ok
}

func runConcurrentAccess(t *testing.T, backend spi.Backend, opts Options) {
	t.Helper()
	fixtures := NewFixtures()
	errorsCh := make(chan error, 600)
	var waitGroup sync.WaitGroup
	for worker := range 100 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			switch worker % 3 {
			case 0:
				if backend.Metrics() == nil {
					return
				}
				points := fixtures.Metrics(1, 1, int64(worker), time.Millisecond)
				points[0].Labels = append(points[0].Labels, labelsForWorker(worker)...)
				if err := backend.Metrics().Write(context.Background(), points); err != nil {
					errorsCh <- err
				}
				set, err := backend.Metrics().Select(context.Background(), fixtureSeriesQuery(0, 1_000))
				switch {
				case err != nil:
					errorsCh <- err
				case set == nil:
					errorsCh <- fmt.Errorf("concurrent metrics Select returned nil SeriesSet")
				default:
					for set.Next() {
						iterator := set.At().Samples()
						for iterator.Next() {
							_, _ = iterator.At()
						}
						if err := iterator.Err(); err != nil {
							errorsCh <- err
						}
					}
					if err := set.Err(); err != nil {
						errorsCh <- err
					}
					if err := set.Close(); err != nil {
						errorsCh <- err
					}
				}
			case 1:
				if backend.Logs() == nil {
					return
				}
				if err := backend.Logs().Write(context.Background(), fixtures.Logs(1, 1, int64(worker), time.Nanosecond)); err != nil {
					errorsCh <- err
				}
				iterator, err := backend.Logs().Search(context.Background(), fixtureLogQuery(0, 1_000, spi.Forward))
				switch {
				case err != nil:
					errorsCh <- err
				case iterator == nil:
					errorsCh <- fmt.Errorf("concurrent log Search returned nil LogIterator")
				default:
					for iterator.Next() {
						_ = iterator.At()
					}
					if err := iterator.Err(); err != nil {
						errorsCh <- err
					}
					if err := iterator.Close(); err != nil {
						errorsCh <- err
					}
				}
			case 2:
				if backend.Traces() == nil {
					return
				}
				spans := fixtures.Trace(1, 1, int64(worker))
				spans[0].TraceID = fmt.Sprintf("%032x", worker+1)
				spans[0].SpanID = fmt.Sprintf("%016x", worker+1)
				if err := backend.Traces().Write(context.Background(), spans); err != nil {
					errorsCh <- err
				}
				iterator, err := backend.Traces().GetTrace(context.Background(), fixtureTenant, spans[0].TraceID)
				switch {
				case err != nil:
					errorsCh <- err
				case iterator == nil:
					errorsCh <- fmt.Errorf("concurrent trace GetTrace returned nil SpanIterator")
				default:
					for iterator.Next() {
						_ = iterator.At()
					}
					if err := iterator.Err(); err != nil {
						errorsCh <- err
					}
					if err := iterator.Close(); err != nil {
						errorsCh <- err
					}
				}
			}
		}()
	}
	waitGroup.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Errorf("concurrent operation error = %v", err)
	}
	waitForVisibility(opts)
}

func labelsForWorker(worker int) utm.Labels {
	return utm.Labels{{Name: "worker", Value: fmt.Sprint(worker)}}
}
