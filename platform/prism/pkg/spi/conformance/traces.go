package conformance

import (
	"cmp"
	"context"
	"fmt"
	"math"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// RunTraces executes the C-TRC conformance tests.
func RunTraces(t *testing.T, f Factory, opts Options) {
	t.Helper()
	validateOptions(t, opts)

	t.Run("C-TRC-01 full trace round trip", func(t *testing.T) {
		_, store := openTraceStore(t, f, opts)
		spans := NewFixtures().Trace(1, 3, 1_000)
		spans[0].TraceState = "vendor=value"
		spans[0].StatusCode = utm.StatusError
		spans[0].StatusMsg = "fixture error"
		spans[0].Resource.Attrs = map[string]string{"resource.key": "resource.value"}
		spans[0].Events = []utm.SpanEvent{{TS: 1_050, Name: "event", Attrs: map[string]string{"event.key": "event.value"}}}
		spans[0].Links = []utm.SpanLink{{
			TraceID: "11111111111111111111111111111111", SpanID: "2222222222222222", Attrs: map[string]string{"link.key": "link.value"},
		}}
		writeSpans(t, store, spans, opts)
		got := getTrace(t, store, fixtureTenant, spans[0].TraceID)
		assertSpansEqual(t, got, spans)
	})

	t.Run("C-TRC-02 trace filters are correct", func(t *testing.T) {
		_, store := openTraceStore(t, f, opts)
		spans := []utm.Span{
			newSpan(1, 1, "target", "operation-a", utm.KindServer, 5*time.Second, "prod"),
			newSpan(2, 2, "target", "operation-b", utm.KindClient, 500*time.Millisecond, "dev"),
			newSpan(3, 3, "other", "operation-a", utm.KindServer, 5*time.Second, "prod"),
		}
		writeSpans(t, store, spans, opts)
		tests := []struct {
			name string
			edit func(*spi.TraceQuery)
			want []string
		}{
			{name: "service", want: []string{spans[0].TraceID, spans[1].TraceID}},
			{name: "operation", edit: func(q *spi.TraceQuery) { q.Operation = "operation-a" }, want: []string{spans[0].TraceID}},
			{name: "span kind", edit: func(q *spi.TraceQuery) { q.SpanKind = utm.KindClient.String() }, want: []string{spans[1].TraceID}},
			{name: "tag", edit: func(q *spi.TraceQuery) { q.Tags = map[string]string{"environment": "prod"} }, want: []string{spans[0].TraceID}},
			{
				name: "duration",
				edit: func(q *spi.TraceQuery) { q.MinDuration, q.MaxDuration = 4*time.Second, 6*time.Second },
				want: []string{spans[0].TraceID},
			},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				query := spi.TraceQuery{Tenant: fixtureTenant, Service: "target", Start: 0, End: int64(10 * time.Second), Limit: 10}
				if test.edit != nil {
					test.edit(&query)
				}
				got, err := store.FindTraceIDs(context.Background(), query)
				if err != nil {
					t.Fatalf("FindTraceIDs() error = %v", err)
				}
				assertTraceIDs(t, got, test.want)
			})
		}
	})

	t.Run("C-TRC-03 limit counts traces", func(t *testing.T) {
		_, store := openTraceStore(t, f, opts)
		var spans []utm.Span
		for trace := range 3 {
			traceSpans := NewFixtures().Trace(1, 4, int64(trace+1)*int64(time.Second))
			for index := range traceSpans {
				traceSpans[index].TraceID = fmt.Sprintf("%032x", trace+1)
				traceSpans[index].SpanID = fmt.Sprintf("%016x", (trace+1)*100+index)
				if index == 0 {
					traceSpans[index].ParentSpanID = ""
				} else {
					traceSpans[index].ParentSpanID = traceSpans[index-1].SpanID
				}
			}
			spans = append(spans, traceSpans...)
		}
		writeSpans(t, store, spans, opts)
		got, err := store.FindTraceIDs(context.Background(), spi.TraceQuery{
			Tenant: fixtureTenant, Service: "service-0", Start: 0, End: int64(10 * time.Second), Limit: 2,
		})
		if err != nil {
			t.Fatalf("FindTraceIDs() error = %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("FindTraceIDs() returned %d traces for 12 spans with limit 2", len(got))
		}
		seen := make(map[string]struct{}, len(got))
		for i, result := range got {
			if _, duplicate := seen[result.TraceID]; duplicate {
				t.Fatalf("FindTraceIDs() returned duplicate trace ID %q", result.TraceID)
			}
			seen[result.TraceID] = struct{}{}
			if i > 0 && got[i-1].StartNano <= result.StartNano {
				t.Fatalf("FindTraceIDs() results are not in descending StartNano order: %#v", got)
			}
		}
	})

	t.Run("C-TRC-04 cross service trace assembly", func(t *testing.T) {
		_, store := openTraceStore(t, f, opts)
		spans := NewFixtures().Trace(3, 3, 1_000)
		extra := spans[len(spans)-1]
		extra.SpanID = fmt.Sprintf("%016x", 10_000)
		extra.ParentSpanID = spans[len(spans)-1].SpanID
		extra.Name = "operation-3"
		extra.StartNano += int64(time.Millisecond)
		extra.EndNano = extra.StartNano + int64(time.Millisecond)
		extra.Attrs = map[string]string{"service.index": "2", "span.index": "3"}
		spans = append(spans, extra)
		writeSpans(t, store, spans, opts)
		got := getTrace(t, store, fixtureTenant, spans[0].TraceID)
		if len(got) != 10 {
			t.Fatalf("GetTrace() returned %d spans, want 10", len(got))
		}
		assertSpansEqual(t, got, spans)
		wantByID := make(map[string]utm.Span, len(spans))
		for _, span := range spans {
			wantByID[span.SpanID] = span
		}
		services := make(map[string]struct{})
		for _, span := range got {
			if span.Resource == nil {
				t.Fatalf("span %q has nil Resource", span.SpanID)
			}
			services[span.Resource.Service] = struct{}{}
			want, ok := wantByID[span.SpanID]
			if !ok {
				t.Fatalf("GetTrace() returned unknown span ID %q", span.SpanID)
			}
			if span.ParentSpanID != want.ParentSpanID {
				t.Fatalf("span %q ParentSpanID = %q, want %q", span.SpanID, span.ParentSpanID, want.ParentSpanID)
			}
		}
		if len(services) != 3 {
			t.Fatalf("GetTrace() returned spans from %d services, want 3", len(services))
		}
	})

	t.Run("C-TRC-05 late span joins existing trace", func(t *testing.T) {
		skipDeviation(t, opts, "C-TRC-05")
		_, store := openTraceStore(t, f, opts)
		spans := NewFixtures().Trace(1, 1, 1_000)
		writeSpans(t, store, spans, opts)
		late := spans[0]
		late.SpanID = "eeeeeeeeeeeeeeee"
		late.ParentSpanID = spans[0].SpanID
		late.Name = "late-operation"
		late.StartNano += int64(10 * time.Minute)
		late.EndNano = late.StartNano + int64(time.Millisecond)
		writeSpans(t, store, []utm.Span{late}, opts)
		got := getTrace(t, store, fixtureTenant, spans[0].TraceID)
		foundLate := false
		for _, span := range got {
			foundLate = foundLate || span.SpanID == late.SpanID
		}
		if len(got) != 2 || !foundLate {
			t.Fatalf("GetTrace() after late write = %#v", got)
		}
	})

	t.Run("C-TRC-06 service and operation ranges", func(t *testing.T) {
		_, store := openTraceStore(t, f, opts)
		spans := []utm.Span{
			newSpan(1, 10, "old", "outside", utm.KindInternal, time.Nanosecond, "test"),
			newSpan(2, 20, "api", "inside-b", utm.KindServer, time.Nanosecond, "test"),
			newSpan(5, 22, "api", "inside-a", utm.KindServer, time.Nanosecond, "test"),
			newSpan(6, 24, "api", "inside-a", utm.KindServer, time.Nanosecond, "test"),
			newSpan(3, 25, "db", "query", utm.KindClient, time.Nanosecond, "test"),
			newSpan(4, 30, "api", "boundary", utm.KindServer, time.Nanosecond, "test"),
		}
		writeSpans(t, store, spans, opts)
		rangeQuery := spi.TimeRange{Start: 20, End: 30}
		services, err := store.Services(context.Background(), fixtureTenant, rangeQuery)
		if err != nil {
			t.Fatalf("Services() error = %v", err)
		}
		if want := []string{"api", "db"}; !slices.Equal(services, want) {
			t.Fatalf("Services() = %v, want %v", services, want)
		}
		operations, err := store.Operations(context.Background(), fixtureTenant, "api", "", rangeQuery)
		if err != nil {
			t.Fatalf("Operations() error = %v", err)
		}
		if want := []spi.Operation{{Name: "inside-a", SpanKind: "server"}, {Name: "inside-b", SpanKind: "server"}}; !reflect.DeepEqual(operations, want) {
			t.Fatalf("Operations() = %v, want %v", operations, want)
		}
	})

	t.Run("C-TRC-07 RED matches scanned spans", func(t *testing.T) {
		backend, store := openTraceStore(t, f, opts)
		if !backend.Capabilities().Traces.RED {
			t.Skip("driver does not declare RED")
		}
		aggregator, ok := store.(spi.SpanAggregator)
		if !ok {
			t.Fatal("RED is true but SpanAggregator is missing")
		}
		spans := make([]utm.Span, 4)
		for i := range spans {
			spans[i] = newSpan(int64(i+1), int64(i+1)*int64(time.Second), "red-service", "request", utm.KindServer, time.Second, "test")
			if i%2 == 1 {
				spans[i].StatusCode = utm.StatusError
			}
		}
		writeSpans(t, store, spans, opts)
		points, err := aggregator.ServiceRED(context.Background(), spi.REDQuery{
			Tenant: fixtureTenant, Services: []string{"red-service"}, Operation: "request",
			Start: 0, End: int64(time.Minute), Step: time.Minute, Quantiles: []float64{0.5},
		})
		if err != nil {
			t.Fatalf("ServiceRED() error = %v", err)
		}
		var requests, failures, sumNano uint64
		for _, point := range points {
			if point.Service != "red-service" || point.Operation != "request" {
				t.Fatalf("ServiceRED() returned unexpected point %#v", point)
			}
			requests += point.Requests
			failures += point.Errors
			sumNano += point.SumNano
			if median, ok := point.Latency[0.5]; !ok || math.Abs(median-float64(time.Second)) > float64(time.Second)/100 {
				t.Fatalf("ServiceRED() median = %v, want %v ±1%%", median, time.Second)
			}
		}
		if requests != 4 || failures != 2 || sumNano != uint64(4*time.Second) {
			t.Fatalf("ServiceRED() totals = requests:%d errors:%d sum:%d", requests, failures, sumNano)
		}
	})

	t.Run("C-TRC-08 dependencies match topology", func(t *testing.T) {
		backend, store := openTraceStore(t, f, opts)
		if !backend.Capabilities().Traces.Dependencies {
			t.Skip("driver does not declare Dependencies")
		}
		querier, ok := store.(spi.DependencyQuerier)
		if !ok {
			t.Fatal("Dependencies is true but DependencyQuerier is missing")
		}
		spans := []utm.Span{
			newSpan(1, 1, "frontend", "request", utm.KindServer, time.Millisecond, "test"),
			newSpan(1, 2, "api", "request", utm.KindServer, time.Millisecond, "test"),
			newSpan(1, 3, "db", "query", utm.KindClient, time.Millisecond, "test"),
		}
		spans[1].ParentSpanID = spans[0].SpanID
		spans[2].ParentSpanID = spans[1].SpanID
		spans[2].StatusCode = utm.StatusError
		writeSpans(t, store, spans, opts)
		got, err := querier.Dependencies(context.Background(), fixtureTenant, spi.TimeRange{Start: 0, End: int64(time.Second)})
		if err != nil {
			t.Fatalf("Dependencies() error = %v", err)
		}
		slices.SortFunc(got, compareDependencies)
		want := []spi.Dependency{
			{Parent: "api", Child: "db", CallCount: 1, ErrCount: 1},
			{Parent: "frontend", Child: "api", CallCount: 1},
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("Dependencies() = %#v, want %#v", got, want)
		}
	})
}

func openTraceStore(t *testing.T, factory Factory, opts Options) (spi.Backend, spi.TraceStore) {
	t.Helper()
	backend := openBackend(t, factory)
	requireSignal(t, backend, opts, spi.SignalTraces)
	store := backend.Traces()
	if store == nil {
		t.Fatal("traces signal declared with nil TraceStore")
	}
	return backend, store
}

func writeSpans(t *testing.T, store spi.TraceStore, spans []utm.Span, opts Options) {
	t.Helper()
	if err := store.Write(context.Background(), spans); err != nil {
		t.Fatalf("TraceStore.Write() error = %v", err)
	}
	waitForVisibility(opts)
}

func getTrace(t *testing.T, store spi.TraceStore, tenant, traceID string) []utm.Span {
	t.Helper()
	iterator, err := store.GetTrace(context.Background(), tenant, traceID)
	if err != nil {
		t.Fatalf("GetTrace() error = %v", err)
	}
	if iterator == nil {
		t.Fatal("GetTrace() returned a nil SpanIterator")
	}
	defer func() {
		if err := iterator.Close(); err != nil {
			t.Errorf("SpanIterator.Close() error = %v", err)
		}
	}()
	var spans []utm.Span
	for iterator.Next() {
		spans = append(spans, iterator.At())
	}
	if err := iterator.Err(); err != nil {
		t.Fatalf("SpanIterator.Err() = %v", err)
	}
	return spans
}

func newSpan(trace, start int64, service, operation string, kind utm.SpanKind, duration time.Duration, environment string) utm.Span {
	return utm.Span{
		Resource:   &utm.Resource{Tenant: fixtureTenant, Service: service},
		TraceID:    fmt.Sprintf("%032x", trace),
		SpanID:     fmt.Sprintf("%016x", start),
		Name:       operation,
		Kind:       kind,
		StartNano:  start,
		EndNano:    start + int64(duration),
		StatusCode: utm.StatusOK,
		Attrs:      map[string]string{"environment": environment},
	}
}

func assertTraceIDs(t *testing.T, results []spi.TraceIDWithTime, want []string) {
	t.Helper()
	got := make([]string, len(results))
	for i, result := range results {
		got[i] = result.TraceID
	}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("FindTraceIDs() IDs = %v, want %v", got, want)
	}
}

func assertSpansEqual(t *testing.T, got, want []utm.Span) {
	t.Helper()
	got = slices.Clone(got)
	want = slices.Clone(want)
	slices.SortFunc(got, compareSpans)
	slices.SortFunc(want, compareSpans)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GetTrace() = %#v, want %#v", got, want)
	}
}

func compareSpans(a, b utm.Span) int {
	if order := cmp.Compare(a.TraceID, b.TraceID); order != 0 {
		return order
	}
	return cmp.Compare(a.SpanID, b.SpanID)
}

func compareDependencies(a, b spi.Dependency) int {
	if order := cmp.Compare(a.Parent, b.Parent); order != 0 {
		return order
	}
	return cmp.Compare(a.Child, b.Child)
}
