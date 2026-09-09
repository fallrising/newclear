package memory

import (
	"context"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func TestLogStoreWriteSearchAndOrdering(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })

	records := []utm.LogRecord{
		{
			Resource: &utm.Resource{Tenant: "tenant-a", Service: "api", Attrs: map[string]string{"region": "eu"}},
			TS:       10,
			Body:     "first",
			TraceID:  "trace-one",
			Labels:   labels.FromStrings(utm.LabelSeverity, "info", "job", "api"),
			Attrs:    map[string]string{"request": "one"},
		},
		{Resource: &utm.Resource{Tenant: "tenant-a"}, TS: 10, Body: "second", Labels: labels.FromStrings("job", "api")},
		{Resource: &utm.Resource{Tenant: "tenant-a"}, TS: 20, Body: "newest", Labels: labels.FromStrings("job", "api")},
		{Resource: &utm.Resource{Tenant: "tenant-b"}, TS: 15, Body: "secret", Labels: labels.FromStrings("job", "api")},
	}
	if err := backend.logs.Write(context.Background(), records); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	records[0].Body = "mutated"
	records[0].Resource.Service = "mutated"
	records[0].Resource.Attrs["region"] = "mutated"
	records[0].Labels[0].Value = "mutated"
	records[0].Attrs["request"] = "mutated"

	jobAPI := mustMatcher(t, spi.MatchEqual, "job", "api")
	query := spi.LogQuery{
		Tenant:    "tenant-a",
		Selectors: []spi.Matcher{jobAPI},
		Start:     0,
		End:       21,
		Direction: spi.Backward,
		Limit:     1,
		Filters:   []spi.LineFilter{{Op: spi.LineContains, Value: "never-present"}},
	}
	backward := searchLogs(t, backend.logs, query)
	if got, want := logBodies(backward), []string{"newest", "first", "second"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("backward bodies = %v, want %v", got, want)
	}
	if backward[1].Resource.Service != "api" || backward[1].Resource.Attrs["region"] != "eu" ||
		backward[1].Attrs["request"] != "one" || backward[1].TraceID != "trace-one" {
		t.Fatalf("stored log was not preserved: %#v", backward[1])
	}
	if len(backward) != 3 {
		t.Fatal("Search() incorrectly pushed down unsupported filter or limit")
	}

	query.Direction = spi.Forward
	forward := searchLogs(t, backend.logs, query)
	if got, want := logBodies(forward), []string{"first", "second", "newest"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("forward bodies = %v, want %v", got, want)
	}

	query.End = 20
	if got, want := logBodies(searchLogs(t, backend.logs, query)), []string{"first", "second"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("half-open range bodies = %v, want %v", got, want)
	}
	query.Tenant = "tenant-b"
	query.End = 21
	if got, want := logBodies(searchLogs(t, backend.logs, query)), []string{"secret"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("tenant-b bodies = %v, want %v", got, want)
	}
	query.Tenant = "tenant-c"
	if got := searchLogs(t, backend.logs, query); len(got) != 0 {
		t.Fatalf("tenant-c Search() leaked %d records", len(got))
	}

	backward[1].Attrs["request"] = "caller-mutated"
	query.Tenant = "tenant-a"
	query.End = 21
	again := searchLogs(t, backend.logs, query)
	if again[0].Attrs["request"] != "one" {
		t.Fatalf("Search() returned shared Attrs: %#v", again[0].Attrs)
	}
}

func TestLogStoreLabelsAndPayloads(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	invalidUTF8 := string([]byte{0xff, 0xfe, 'x'})
	records := []utm.LogRecord{
		{Resource: &utm.Resource{Tenant: "tenant"}, TS: 10, Body: "正常", Labels: labels.FromStrings(utm.LabelSeverity, "info", "job", "api", "zone", "eu")},
		{Resource: &utm.Resource{Tenant: "tenant"}, TS: 20, Body: invalidUTF8, Labels: labels.FromStrings("job", "worker", "zone", "us")},
	}
	if err := backend.logs.Write(context.Background(), records); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	nameMatcher := mustMatcher(t, spi.MatchRegexp, "job", ".+")
	query := spi.LabelQuery{Tenant: "tenant", Matchers: []spi.Matcher{nameMatcher}, Start: 0, End: 21}
	names, err := backend.logs.LabelNames(context.Background(), query)
	if err != nil {
		t.Fatalf("LabelNames() error = %v", err)
	}
	if want := []string{"job", "zone"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("LabelNames() = %v, want %v", names, want)
	}
	values, err := backend.logs.LabelValues(context.Background(), "zone", query)
	if err != nil {
		t.Fatalf("LabelValues() error = %v", err)
	}
	if want := []string{"eu", "us"}; !reflect.DeepEqual(values, want) {
		t.Fatalf("LabelValues() = %v, want %v", values, want)
	}
	query.End = 20
	values, err = backend.logs.LabelValues(context.Background(), "zone", query)
	if err != nil || !reflect.DeepEqual(values, []string{"eu"}) {
		t.Fatalf("range LabelValues() = %v, %v", values, err)
	}
	query.End = 21
	query.Limit = 1
	values, err = backend.logs.LabelValues(context.Background(), "zone", query)
	if err != nil || !reflect.DeepEqual(values, []string{"eu"}) {
		t.Fatalf("limited LabelValues() = %v, %v", values, err)
	}
	if _, err := backend.logs.LabelValues(context.Background(), "", query); spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("empty LabelValues() class = %v, want bad_request", spi.Classify(err))
	}

	logs := searchLogs(t, backend.logs, spi.LogQuery{
		Tenant: "tenant", Selectors: []spi.Matcher{mustMatcher(t, spi.MatchEqual, "job", "worker")}, Start: 0, End: 21,
	})
	if len(logs) != 1 || logs[0].Body != invalidUTF8 {
		t.Fatalf("invalid UTF-8 payload result = %#v", logs)
	}
}

func TestLogStoreWriteIsAtomic(t *testing.T) {
	backend := newBackend()
	t.Cleanup(func() { _ = backend.Close() })
	batch := []utm.LogRecord{
		{Resource: &utm.Resource{Tenant: "tenant"}, TS: 1, Labels: labels.FromStrings("job", "api")},
		{Resource: nil, TS: 2, Labels: labels.FromStrings("job", "api")},
	}
	if got := spi.Classify(backend.logs.Write(context.Background(), batch)); got != spi.ErrBadRequest {
		t.Fatalf("Write() class = %v, want bad_request", got)
	}
	logs := searchLogs(t, backend.logs, spi.LogQuery{
		Tenant: "tenant", Selectors: []spi.Matcher{mustMatcher(t, spi.MatchEqual, "job", "api")}, Start: 0, End: 3,
	})
	if len(logs) != 0 {
		t.Fatalf("failed atomic Write() stored %d records", len(logs))
	}
	if got := spi.Classify(backend.logs.Write(context.Background(), nil)); got != spi.ErrBadRequest {
		t.Fatalf("Write(nil) class = %v, want bad_request", got)
	}
}

func searchLogs(t *testing.T, store spi.LogStore, query spi.LogQuery) []utm.LogRecord {
	t.Helper()
	iterator, err := store.Search(context.Background(), query)
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if iterator == nil {
		t.Fatal("Search() returned a nil iterator")
	}
	defer func() {
		if err := iterator.Close(); err != nil {
			t.Errorf("LogIterator.Close() error = %v", err)
		}
	}()

	var records []utm.LogRecord
	for iterator.Next() {
		records = append(records, iterator.At())
	}
	if err := iterator.Err(); err != nil {
		t.Fatalf("LogIterator.Err() = %v", err)
	}
	return records
}

func logBodies(records []utm.LogRecord) []string {
	bodies := make([]string, len(records))
	for i, record := range records {
		bodies[i] = record.Body
	}
	return bodies
}
