package memory

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

const (
	traceOne = "00000000000000000000000000000001"
	traceTwo = "00000000000000000000000000000002"
)

func TestTraceStoreWriteGetAndClone(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })

	spans := traceFixture()
	if err := backend.traces.Write(context.Background(), spans); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	spans[0].Name = "mutated"
	spans[0].Resource.Service = "mutated"
	spans[0].Resource.Attrs["region"] = "mutated"
	spans[0].Attrs["env"] = "mutated"
	spans[0].Events[0].Attrs["event"] = "mutated"
	spans[0].Links[0].Attrs["link"] = "mutated"

	got := getTrace(t, backend.traces, "tenant-a", traceOne)
	if len(got) != 2 || got[0].Name != "frontend" || got[1].Name != "database" {
		t.Fatalf("GetTrace() = %#v", got)
	}
	root := got[0]
	if root.Resource.Service != "frontend" || root.Resource.Attrs["region"] != "eu" ||
		root.Attrs["env"] != "prod" || root.Events[0].Attrs["event"] != "ready" ||
		root.Links[0].Attrs["link"] != "follows" {
		t.Fatalf("GetTrace() did not preserve nested data: %#v", root)
	}
	got[0].Attrs["env"] = "caller-mutated"
	if again := getTrace(t, backend.traces, "tenant-a", traceOne); again[0].Attrs["env"] != "prod" {
		t.Fatal("GetTrace() returned shared span attributes")
	}
	if missing := getTrace(t, backend.traces, "tenant-a", "000000000000000000000000000000ff"); len(missing) != 0 {
		t.Fatalf("missing trace returned %d spans", len(missing))
	}
	if leaked := getTrace(t, backend.traces, "tenant-b", traceOne); len(leaked) != 0 {
		t.Fatalf("tenant-b GetTrace() leaked %d spans", len(leaked))
	}
}

func TestTraceStoreFindTraceIDs(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	if err := backend.traces.Write(context.Background(), traceFixture()); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	query := spi.TraceQuery{Tenant: "tenant-a", Service: "frontend", Start: 0, End: 1_000, Limit: 10}
	got, err := backend.traces.FindTraceIDs(context.Background(), query)
	if err != nil {
		t.Fatalf("FindTraceIDs() error = %v", err)
	}
	want := []spi.TraceIDWithTime{
		{TraceID: traceTwo, StartNano: 300, EndNano: 500},
		{TraceID: traceOne, StartNano: 100, EndNano: 200},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("FindTraceIDs() = %v, want %v", got, want)
	}

	query.Limit = 1
	limited, err := backend.traces.FindTraceIDs(context.Background(), query)
	if err != nil || !reflect.DeepEqual(limited, want[:1]) {
		t.Fatalf("limited FindTraceIDs() = %v, %v", limited, err)
	}
	query.Limit = 10
	query.MinDuration = 150 * time.Nanosecond
	durationFiltered, err := backend.traces.FindTraceIDs(context.Background(), query)
	if err != nil || !reflect.DeepEqual(durationFiltered, want[:1]) {
		t.Fatalf("duration FindTraceIDs() = %v, %v", durationFiltered, err)
	}
	query.MinDuration = 0
	query.Operation = ""
	query.Tags = map[string]string{"env": "prod"}
	tagged, err := backend.traces.FindTraceIDs(context.Background(), query)
	if err != nil || len(tagged) != 2 {
		t.Fatalf("tagged FindTraceIDs() = %v, %v", tagged, err)
	}
	query.SpanKind = utm.KindClient.String()
	if got, err := backend.traces.FindTraceIDs(context.Background(), query); err != nil || len(got) != 0 {
		t.Fatalf("kind FindTraceIDs() = %v, %v", got, err)
	}

	backendQuery := spi.TraceQuery{Tenant: "tenant-a", Service: "backend", Operation: "database", Start: 0, End: 1_000, Limit: 10}
	backendResult, err := backend.traces.FindTraceIDs(context.Background(), backendQuery)
	if err != nil || len(backendResult) != 1 || backendResult[0] != (spi.TraceIDWithTime{TraceID: traceOne, StartNano: 120, EndNano: 150}) {
		t.Fatalf("backend FindTraceIDs() = %v, %v", backendResult, err)
	}
	query.Tenant = "tenant-c"
	query.Operation = ""
	query.Tags = nil
	query.SpanKind = ""
	if got, err := backend.traces.FindTraceIDs(context.Background(), query); err != nil || len(got) != 0 {
		t.Fatalf("tenant-c FindTraceIDs() = %v, %v", got, err)
	}
}

func TestTraceStoreServicesOperationsAndLateSpans(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	if err := backend.traces.Write(context.Background(), traceFixture()); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	rangeAll := spi.TimeRange{Start: 0, End: 1_000}
	services, err := backend.traces.Services(context.Background(), "tenant-a", rangeAll)
	if err != nil {
		t.Fatalf("Services() error = %v", err)
	}
	if want := []string{"backend", "frontend"}; !reflect.DeepEqual(services, want) {
		t.Fatalf("Services() = %v, want %v", services, want)
	}
	if services, err := backend.traces.Services(context.Background(), "tenant-a", spi.TimeRange{Start: 200, End: 300}); err != nil || len(services) != 0 {
		t.Fatalf("half-open Services() = %v, %v", services, err)
	}

	operations, err := backend.traces.Operations(context.Background(), "tenant-a", "frontend", "", rangeAll)
	if err != nil {
		t.Fatalf("Operations() error = %v", err)
	}
	wantOperations := []spi.Operation{{Name: "frontend", SpanKind: "server"}, {Name: "worker", SpanKind: "producer"}}
	if !reflect.DeepEqual(operations, wantOperations) {
		t.Fatalf("Operations() = %v, want %v", operations, wantOperations)
	}
	serverOperations, err := backend.traces.Operations(context.Background(), "tenant-a", "frontend", "server", rangeAll)
	if err != nil || !reflect.DeepEqual(serverOperations, wantOperations[:1]) {
		t.Fatalf("server Operations() = %v, %v", serverOperations, err)
	}

	late := utm.Span{
		Resource: &utm.Resource{Tenant: "tenant-a", Service: "cache"},
		TraceID:  traceOne, SpanID: "00000000000000ff", ParentSpanID: "0000000000000001",
		Name: "cache", Kind: utm.KindClient, StartNano: 180, EndNano: 190,
	}
	if err := backend.traces.Write(context.Background(), []utm.Span{late}); err != nil {
		t.Fatalf("late Write() error = %v", err)
	}
	if got := getTrace(t, backend.traces, "tenant-a", traceOne); len(got) != 3 || got[2].Name != "cache" {
		t.Fatalf("trace after late span = %#v", got)
	}
}

func TestTraceStoreWriteIsAtomicAndDeduplicates(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	valid := utm.Span{Resource: &utm.Resource{Tenant: "tenant"}, TraceID: traceOne, SpanID: "0000000000000001", Name: "first"}
	if got := spi.Classify(backend.traces.Write(context.Background(), []utm.Span{valid, {Resource: nil}})); got != spi.ErrBadRequest {
		t.Fatalf("invalid Write() class = %v, want bad_request", got)
	}
	if got := getTrace(t, backend.traces, "tenant", traceOne); len(got) != 0 {
		t.Fatalf("failed atomic Write() stored %d spans", len(got))
	}
	if got := spi.Classify(backend.traces.Write(context.Background(), nil)); got != spi.ErrBadRequest {
		t.Fatalf("Write(nil) class = %v, want bad_request", got)
	}

	if err := backend.traces.Write(context.Background(), []utm.Span{valid}); err != nil {
		t.Fatalf("first Write() error = %v", err)
	}
	valid.Name = "replacement"
	if err := backend.traces.Write(context.Background(), []utm.Span{valid}); err != nil {
		t.Fatalf("replacement Write() error = %v", err)
	}
	got := getTrace(t, backend.traces, "tenant", traceOne)
	if len(got) != 1 || got[0].Name != "replacement" {
		t.Fatalf("deduplicated trace = %#v", got)
	}
}

func TestTraceDurationUsesZeroLengthRoot(t *testing.T) {
	t.Parallel()

	var aggregate traceAggregate
	aggregate.add(utm.Span{StartNano: 10, EndNano: 10}, false)
	aggregate.add(utm.Span{ParentSpanID: "parent", StartNano: 10, EndNano: 100}, false)
	if got := aggregate.duration(); got != 0 {
		t.Fatalf("duration() = %d, want zero-length root duration", got)
	}
}

func traceFixture() []utm.Span {
	return []utm.Span{
		{
			Resource:  &utm.Resource{Tenant: "tenant-a", Service: "frontend", Attrs: map[string]string{"region": "eu"}},
			TraceID:   traceOne,
			SpanID:    "0000000000000001",
			Name:      "frontend",
			Kind:      utm.KindServer,
			StartNano: 100,
			EndNano:   200,
			Attrs:     map[string]string{"env": "prod"},
			Events:    []utm.SpanEvent{{TS: 110, Name: "start", Attrs: map[string]string{"event": "ready"}}},
			Links:     []utm.SpanLink{{TraceID: traceTwo, SpanID: "0000000000000003", Attrs: map[string]string{"link": "follows"}}},
		},
		{
			Resource:     &utm.Resource{Tenant: "tenant-a", Service: "backend"},
			TraceID:      traceOne,
			SpanID:       "0000000000000002",
			ParentSpanID: "0000000000000001",
			Name:         "database",
			Kind:         utm.KindClient,
			StartNano:    120,
			EndNano:      150,
			Attrs:        map[string]string{"db": "orders"},
		},
		{
			Resource:  &utm.Resource{Tenant: "tenant-a", Service: "frontend"},
			TraceID:   traceTwo,
			SpanID:    "0000000000000003",
			Name:      "worker",
			Kind:      utm.KindProducer,
			StartNano: 300,
			EndNano:   500,
			Attrs:     map[string]string{"env": "prod"},
		},
		{
			Resource:  &utm.Resource{Tenant: "tenant-b", Service: "frontend"},
			TraceID:   "00000000000000000000000000000003",
			SpanID:    "0000000000000004",
			Name:      "secret",
			Kind:      utm.KindServer,
			StartNano: 400,
			EndNano:   450,
		},
	}
}

func getTrace(t *testing.T, store spi.TraceStore, tenant, traceID string) []utm.Span {
	t.Helper()
	iterator, err := store.GetTrace(context.Background(), tenant, traceID)
	if err != nil {
		t.Fatalf("GetTrace() error = %v", err)
	}
	if iterator == nil {
		t.Fatal("GetTrace() returned a nil iterator")
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
