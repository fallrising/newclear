//go:build integration

package clickhouse_test

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

const nativeOrigin = int64(1_757_030_400) * int64(time.Second)

func TestClickHouseNativeLogQuery(t *testing.T) {
	f := newFixture(t)
	backend := f.migrated(map[string]string{"async_insert": "0", "retention_logs_days": "1000"})
	native, ok := backend.Logs().(spi.NativeLogQuerier)
	if !ok {
		t.Fatal("NativeLogQuerier is not exposed")
	}
	t.Run("AC-43", func(t *testing.T) {
		const tenant = "ac43"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "in", nativeOrigin, "host", "h1"),
			nativeRecord(tenant, "out", nativeOrigin+int64(time.Second), "host", "h1"),
		})
		query := nativeQuery(t, tenant, nativeOrigin-int64(time.Second), nativeOrigin+2*int64(time.Second), "host", "h1")
		query.Filters = []spi.LineFilter{{Op: spi.LineContains, Value: "in"}}
		got := searchBodies(t, f, backend, query)
		if !slices.Equal(got, []string{"in", "out"}) {
			t.Fatalf("Search() bodies = %v", got)
		}
	})
	t.Run("AC-46", func(t *testing.T) {
		const tenant = "ac46"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "out", nativeOrigin-int64(time.Second), "host", "h1"),
			nativeRecord(tenant, "in", nativeOrigin, "host", "h1"),
			nativeRecord(tenant, "out", nativeOrigin+int64(time.Second), "host", "h1"),
		})
		result := mustNative(t, f, native, nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1"))
		if bodies := nativeBodies(result); !slices.Equal(bodies, []string{"in"}) || len(result.Streams) != 1 || result.Streams[0].Labels.Get("host") != "h1" {
			t.Fatalf("result = %#v", result)
		}
	})
	t.Run("AC-47", func(t *testing.T) {
		const tenant = "ac47"
		start := nativeOrigin - int64(time.Second)
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "out", start, "host", "h1"),
			nativeRecord(tenant, "in", nativeOrigin, "host", "h1"),
			nativeRecord(tenant, "out", nativeOrigin+int64(time.Second), "host", "h1"),
		})
		contains := nativeQuery(t, tenant, start, nativeOrigin+2*int64(time.Second), "host", "h1")
		contains.Filters = []spi.LineFilter{{Op: spi.LineContains, Value: "in"}}
		if bodies := nativeBodies(mustNative(t, f, native, contains)); !slices.Equal(bodies, []string{"in"}) {
			t.Fatalf("contains bodies = %v", bodies)
		}
		excludes := contains
		excludes.Filters = []spi.LineFilter{{Op: spi.LineNotContains, Value: "in"}}
		if bodies := nativeBodies(mustNative(t, f, native, excludes)); !slices.Equal(bodies, []string{"out", "out"}) {
			t.Fatalf("not-contains bodies = %v", bodies)
		}
	})
	t.Run("AC-48", func(t *testing.T) {
		const tenant = "ac48"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "hello token", nativeOrigin, "host", "h1"),
			nativeRecord(tenant, "hello-token", nativeOrigin+int64(time.Millisecond), "host", "h1"),
		})
		query := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1")
		query.Filters = []spi.LineFilter{{Op: spi.LineMatch, Value: "hello token", LiteralHint: "hello token"}}
		if bodies := nativeBodies(mustNative(t, f, native, query)); !slices.Equal(bodies, []string{"hello token"}) {
			t.Fatalf("match bodies = %v", bodies)
		}
		writeNativeLogs(t, f, backend, []utm.LogRecord{nativeRecord(tenant, "hello", nativeOrigin+2*int64(time.Millisecond), "host", "h1")})
		query.Filters = []spi.LineFilter{{Op: spi.LineMatch, Value: "^hello$", LiteralHint: "hello"}}
		if bodies := nativeBodies(mustNative(t, f, native, query)); !slices.Equal(bodies, []string{"hello"}) {
			t.Fatalf("anchored match bodies = %v", bodies)
		}
		query.Filters = []spi.LineFilter{{Op: spi.LineNotMatch, Value: "^hello$", LiteralHint: "hello"}}
		if bodies := nativeBodies(mustNative(t, f, native, query)); !slices.Equal(bodies, []string{"hello token", "hello-token"}) {
			t.Fatalf("negative match bodies = %v", bodies)
		}
	})
	t.Run("AC-49", func(t *testing.T) {
		const tenant = "ac49"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, `{"status":"500"}`, nativeOrigin, "host", "h1"),
			nativeRecord(tenant, `{"status":"200"}`, nativeOrigin+int64(time.Millisecond), "host", "h1"),
		})
		query := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1")
		query.Stages = []spi.ParseStage{{Kind: spi.ParseJSON}}
		query.Fields = []spi.FieldFilter{{Field: "status", Op: spi.CmpEq, Value: "500"}}
		if bodies := nativeBodies(mustNative(t, f, native, query)); !slices.Equal(bodies, []string{`{"status":"500"}`}) {
			t.Fatalf("json bodies = %v", bodies)
		}
	})
	t.Run("AC-50", func(t *testing.T) {
		const tenant = "ac50"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "a", nativeOrigin, "host", "h1"),
			nativeRecord(tenant, "b", nativeOrigin, "host", "h1"),
		})
		query := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1")
		query.Limit = 1
		if bodies := nativeBodies(mustNative(t, f, native, query)); !slices.Equal(bodies, []string{"a"}) {
			t.Fatalf("limit bodies = %v", bodies)
		}
	})
	t.Run("AC-51", func(t *testing.T) {
		const tenant = "ac51"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "a", nativeOrigin, "host", "h1"),
			nativeRecord(tenant, "b", nativeOrigin, "host", "h1"),
		})
		forward := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1")
		if bodies := nativeBodies(mustNative(t, f, native, forward)); !slices.Equal(bodies, []string{"a", "b"}) {
			t.Fatalf("forward bodies = %v", bodies)
		}
		backward := forward
		backward.Direction = spi.Backward
		if bodies := nativeBodies(mustNative(t, f, native, backward)); !slices.Equal(bodies, []string{"a", "b"}) {
			t.Fatalf("backward bodies = %v", bodies)
		}
	})
	t.Run("AC-52", func(t *testing.T) {
		const tenant = "ac52"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "in", nativeOrigin, "host", "h1"),
			nativeRecord(tenant, "out", nativeOrigin-int64(time.Second), "host", "h1"),
		})
		for _, fn := range []string{"count_over_time", "rate", "bytes_over_time"} {
			query := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1")
			query.Agg = &spi.LogAggregation{RangeFunc: fn, Window: time.Second, Step: time.Second}
			result := mustNative(t, f, native, query)
			want := 1.0
			if fn == "bytes_over_time" {
				want = 2
			}
			assertMatrix(t, result, 1_757_030_400_000, want)
		}
	})
	t.Run("AC-52 empty window emits zero", func(t *testing.T) {
		const tenant = "ac52-empty"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "late", nativeOrigin+int64(500*time.Millisecond), "host", "h1"),
		})
		for _, fn := range []string{"count_over_time", "rate", "bytes_over_time"} {
			query := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1")
			query.Agg = &spi.LogAggregation{RangeFunc: fn, Window: time.Second, Step: time.Second}
			assertMatrix(t, mustNative(t, f, native, query), 1_757_030_400_000, 0)
		}
	})
	t.Run("AC-52 rows before start are not counted", func(t *testing.T) {
		const tenant = "ac52-before"
		writeNativeLogs(t, f, backend, []utm.LogRecord{
			nativeRecord(tenant, "early", nativeOrigin-int64(500*time.Millisecond), "host", "h1"),
			nativeRecord(tenant, "in", nativeOrigin, "host", "h1"),
		})
		for _, fn := range []string{"count_over_time", "rate", "bytes_over_time"} {
			query := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1")
			query.Agg = &spi.LogAggregation{RangeFunc: fn, Window: time.Second, Step: time.Second}
			want := 1.0
			if fn == "bytes_over_time" {
				want = 2
			}
			assertMatrix(t, mustNative(t, f, native, query), 1_757_030_400_000, want)
		}
	})
	t.Run("AC-58", func(t *testing.T) {
		const tenant = "ac58"
		writeNativeLogs(t, f, backend, []utm.LogRecord{nativeRecord(tenant, "in", nativeOrigin, "host", "h1")})
		for _, fn := range []string{"count_over_time", "rate", "bytes_over_time"} {
			query := nativeQuery(t, tenant, nativeOrigin, nativeOrigin+2*int64(time.Second), "host", "h1")
			query.Agg = &spi.LogAggregation{RangeFunc: fn, Window: 2 * time.Second, Step: time.Second}
			result := mustNative(t, f, native, query)
			want := 1.0
			if fn == "rate" {
				want = 0.5
			}
			if fn == "bytes_over_time" {
				want = 2
			}
			if len(result.Matrix) != 1 || len(result.Matrix[0].Samples) != 2 {
				t.Fatalf("%s matrix = %#v", fn, result.Matrix)
			}
			if result.Matrix[0].Samples[0].Value != want || result.Matrix[0].Samples[1].Value != want || result.Matrix[0].Samples[1].TS != 1_757_030_401_000 {
				t.Fatalf("%s samples = %#v", fn, result.Matrix[0].Samples)
			}
		}
	})
	t.Run("AC-60", func(t *testing.T) {
		const tenant = "ac60"
		column := nativeRecord(tenant, "column", nativeOrigin, "host", "h1")
		column.Resource.Service = "api"
		labeled := nativeRecord(tenant, "label", nativeOrigin+int64(time.Millisecond), "service", "api")
		labeled.Resource.Service = "other"
		writeNativeLogs(t, f, backend, []utm.LogRecord{column, labeled})
		if bodies := nativeBodies(mustNative(t, f, native, nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "service", "api"))); !slices.Equal(bodies, []string{"label"}) {
			t.Fatalf("selector bodies = %v", bodies)
		}
	})
}

func TestClickHouseNativeLogQuery_AC54_ServerLimit(t *testing.T) {
	f := newFixture(t)
	backend := f.migrated(map[string]string{"async_insert": "0", "retention_logs_days": "1000"})
	const tenant = "ac54"
	writeNativeLogs(t, f, backend, []utm.LogRecord{
		nativeRecord(tenant, "one", nativeOrigin, "host", "h1"),
		nativeRecord(tenant, "two", nativeOrigin+int64(time.Millisecond), "host", "h1"),
	})
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}
	bounded := f.backend(map[string]string{"async_insert": "0", "max_result_rows": "1"})
	native, ok := bounded.Logs().(spi.NativeLogQuerier)
	if !ok {
		t.Fatal("NativeLogQuerier is not exposed")
	}
	_, err := native.SearchNative(f.ctx, nativeQuery(t, tenant, nativeOrigin, nativeOrigin+int64(time.Second), "host", "h1"))
	if spi.Classify(err) != spi.ErrTooLarge || !strings.Contains(err.Error(), "storage operation failed") {
		t.Fatalf("SearchNative() error = %v", err)
	}
}

func nativeRecord(tenant, body string, ts int64, pairs ...string) utm.LogRecord {
	return utm.LogRecord{
		Resource:   &utm.Resource{Tenant: tenant},
		TS:         ts,
		ObservedTS: ts,
		Body:       body,
		Labels:     labels.FromStrings(pairs...),
	}
}

func nativeQuery(t *testing.T, tenant string, start, end int64, name, value string) spi.LogQuery {
	t.Helper()
	matcher, err := spi.NewMatcher(spi.MatchEqual, name, value)
	if err != nil {
		t.Fatal(err)
	}
	return spi.LogQuery{Tenant: tenant, Start: start, End: end, Direction: spi.Forward, Selectors: []spi.Matcher{matcher}}
}

func writeNativeLogs(t *testing.T, f *fixture, backend spi.Backend, records []utm.LogRecord) {
	t.Helper()
	if err := backend.Logs().Write(f.ctx, records); err != nil {
		t.Fatal(err)
	}
}

func mustNative(t *testing.T, f *fixture, native spi.NativeLogQuerier, query spi.LogQuery) spi.LogResult {
	t.Helper()
	result, err := native.SearchNative(f.ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func nativeBodies(result spi.LogResult) []string {
	var bodies []string
	for _, stream := range result.Streams {
		for _, entry := range stream.Entries {
			bodies = append(bodies, entry.Body)
		}
	}
	return bodies
}

func searchBodies(t *testing.T, f *fixture, backend spi.Backend, query spi.LogQuery) []string {
	t.Helper()
	iterator, err := backend.Logs().Search(f.ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := iterator.Close(); err != nil {
			t.Error(err)
		}
	}()
	var bodies []string
	for iterator.Next() {
		bodies = append(bodies, iterator.At().Body)
	}
	if err := iterator.Err(); err != nil {
		t.Fatal(err)
	}
	return bodies
}

func assertMatrix(t *testing.T, result spi.LogResult, ts int64, value float64) {
	t.Helper()
	if len(result.Streams) != 0 || len(result.Matrix) != 1 || result.Matrix[0].Labels.Get("host") != "h1" || len(result.Matrix[0].Samples) != 1 {
		t.Fatalf("matrix = %#v streams = %#v", result.Matrix, result.Streams)
	}
	sample := result.Matrix[0].Samples[0]
	if sample.TS != ts || sample.Value != value {
		t.Fatalf("sample = %#v, want ts %d value %v", sample, ts, value)
	}
}
