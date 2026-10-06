//go:build integration

package clickhouse_test

import (
	"context"
	"errors"
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func TestClickHouseQueryNegativeZeroAtEpoch(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_metrics_days": "36500"})
	const bits uint64 = 1 << 63
	seriesLabels := labels.FromStrings(utm.LabelName, "fuzz_float", utm.LabelTenant, "official-corpus")
	point := utm.MetricPoint{Name: "fuzz_float", Labels: seriesLabels, TS: 0, Value: math.Float64frombits(bits)}
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{point}); err != nil {
		t.Fatal(err)
	}
	var storedBits uint64
	if err := f.reader.QueryRow(f.ctx, "SELECT value_bits FROM metric_samples WHERE tenant='official-corpus'").Scan(&storedBits); err != nil {
		t.Fatal(err)
	}
	if storedBits != bits {
		t.Fatalf("persisted float bits=%016x want=%016x", storedBits, bits)
	}
	matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "fuzz_float")
	if err != nil {
		t.Fatal(err)
	}
	set, err := b.Metrics().Select(f.ctx, spi.SeriesQuery{Tenant: "official-corpus", Matchers: []spi.Matcher{matcher}, Start: 0, End: 0})
	if err != nil {
		t.Fatal(err)
	}
	if !set.Next() {
		t.Fatalf("missing epoch series: %v", set.Err())
	}
	iter := set.At().Samples()
	if !iter.Next() {
		t.Fatalf("missing epoch sample: %v", iter.Err())
	}
	ts, value := iter.At()
	if ts != 0 || math.Float64bits(value) != bits {
		t.Fatalf("SPI epoch float ts=%d bits=%016x want ts=0 bits=%016x", ts, math.Float64bits(value), bits)
	}
	if iter.Next() || iter.Err() != nil || set.Next() || set.Err() != nil {
		t.Fatalf("extra sample or iterator failure: sample=%v series=%v", iter.Err(), set.Err())
	}
	if err := set.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestClickHouseQueryTenantAndCatalogWindows(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_metrics_days": "36500"})
	matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "window_metric")
	if err != nil {
		t.Fatal(err)
	}
	for _, tenant := range []string{"tenant-a", "tenant-b"} {
		seriesLabels := labels.FromStrings(utm.LabelName, "window_metric", utm.LabelTenant, tenant, "tag", tenant)
		if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{
			{Name: "window_metric", Labels: seriesLabels, TS: 1_000, Value: 1},
			{Name: "window_metric", Labels: seriesLabels, TS: 3_000, Value: 3},
		}); err != nil {
			t.Fatal(err)
		}
	}
	query := spi.SeriesQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: 2_000, End: 2_000}
	set, err := b.Metrics().Select(f.ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	if set.Next() || set.Err() != nil {
		t.Fatal("hole in metadata window returned a sample or iterator error")
	}
	if err := set.Close(); err != nil {
		t.Fatal(err)
	}
	query.Start, query.End = 1_000, 3_000
	set, err = b.Metrics().Select(f.ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	var samples int
	for set.Next() {
		series := set.At()
		if series.Labels().Get(utm.LabelTenant) != "tenant-a" {
			t.Fatal("cross-tenant metric selected")
		}
		iterator := series.Samples()
		for iterator.Next() {
			samples++
		}
		if err := iterator.Err(); err != nil {
			t.Fatal(err)
		}
	}
	if err := errors.Join(set.Err(), set.Close()); err != nil {
		t.Fatal(err)
	}
	if samples != 2 {
		t.Fatalf("selected %d samples, want 2", samples)
	}
	values, err := b.Metrics().LabelValues(f.ctx, "tag", spi.LabelQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: 2_000, End: 2_000})
	if err != nil || len(values) != 0 {
		t.Fatalf("catalog window hole values=%v err=%v", values, err)
	}
	values, err = b.Metrics().LabelValues(f.ctx, "tag", spi.LabelQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: 1_000, End: 3_000})
	if err != nil || len(values) != 1 || values[0] != "tenant-a" {
		t.Fatalf("tenant-scoped catalog values=%v err=%v", values, err)
	}
}

func TestClickHouseQueryFullLabelsAcrossMonth(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_metrics_days": "3650"})
	base := utm.TimeToMilli(time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC))
	labelSets := []labels.Labels{
		labels.FromStrings(utm.LabelName, "month_metric", utm.LabelTenant, "tenant-a", "a", "x\x00y", "b", "z"),
		labels.FromStrings(utm.LabelName, "month_metric", utm.LabelTenant, "tenant-a", "a", "x", "b", "\x01z"),
		labels.FromStrings(utm.LabelName, "month_metric", utm.LabelTenant, "tenant-a", "a", "x\ny", "b", "z"),
	}
	for _, ls := range labelSets {
		if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{
			{Name: "month_metric", Labels: ls, TS: base, Value: 1},
			{Name: "month_metric", Labels: ls, TS: base + 2_000, Value: 2},
		}); err != nil {
			t.Fatal(err)
		}
	}
	matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "month_metric")
	if err != nil {
		t.Fatal(err)
	}
	set, err := b.Metrics().Select(f.ctx, spi.SeriesQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: base, End: base + 2_000})
	if err != nil {
		t.Fatal(err)
	}
	var got []labels.Labels
	for set.Next() {
		series := set.At()
		got = append(got, series.Labels())
		iter := series.Samples()
		var timestamps []int64
		for iter.Next() {
			ts, _ := iter.At()
			timestamps = append(timestamps, ts)
		}
		if err := iter.Err(); err != nil || !reflect.DeepEqual(timestamps, []int64{base, base + 2_000}) {
			t.Fatalf("cross-month samples=%v err=%v", timestamps, err)
		}
	}
	if err := errors.Join(set.Err(), set.Close()); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(labelSets) {
		t.Fatalf("cross-month series=%d want=%d", len(got), len(labelSets))
	}
	for i := 1; i < len(got); i++ {
		if labels.Compare(got[i-1], got[i]) >= 0 {
			t.Fatalf("full-label order violated: %v", got)
		}
	}
}

func TestClickHouseQueryMissingLabelRegex(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_metrics_days": "36500"})
	for _, pair := range []struct{ name, value string }{{"", ""}, {"probe", ""}, {"probe", "line\nsecond"}, {"probe", "alpha"}} {
		fields := []string{utm.LabelName, "regex_metric", utm.LabelTenant, "tenant-a"}
		if pair.name != "" {
			fields = append(fields, pair.name, pair.value)
		}
		if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{{Name: "regex_metric", Labels: labels.FromStrings(fields...), TS: 1_000, Value: 1}}); err != nil {
			t.Fatal(err)
		}
	}
	metric, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "regex_metric")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		kind  spi.MatchType
		value string
		want  int
	}{
		{spi.MatchEqual, "", 2},
		{spi.MatchNotEqual, "", 2},
		{spi.MatchRegexp, "", 2},
		{spi.MatchNotRegexp, "", 2},
		{spi.MatchRegexp, "line\\nsecond", 1},
	} {
		m, err := spi.NewMatcher(test.kind, "probe", test.value)
		if err != nil {
			t.Fatal(err)
		}
		set, err := b.Metrics().Select(f.ctx, spi.SeriesQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{metric, m}, Start: 0, End: 2_000})
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		for set.Next() {
			count++
		}
		if err := errors.Join(set.Err(), set.Close()); err != nil {
			t.Fatal(err)
		}
		if count != test.want {
			t.Fatalf("matcher %v %q returned %d series, want %d", test.kind, test.value, count, test.want)
		}
	}
}

func TestClickHouseQueryCanceledBeforeRead(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0"})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "canceled_metric")
	if err != nil {
		t.Fatal(err)
	}
	set, err := b.Metrics().Select(ctx, spi.SeriesQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: 0, End: 1})
	if err == nil {
		if set != nil {
			_ = set.Close()
		}
		t.Fatal("canceled query accepted")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled query lost context identity: %v", err)
	}
}

func TestClickHouseQueryLogStableTiesAfterReopen(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_logs_days": "36500"})
	resource := &utm.Resource{Tenant: "tenant-a", Service: "log-test"}
	var records []utm.LogRecord
	for _, body := range []string{"first", "second", "third"} {
		records = append(records, utm.LogRecord{Resource: resource, TS: 1_000, ObservedTS: 1_000, Body: body, Labels: labels.FromStrings("job", "stable")})
	}
	records = append(records, utm.LogRecord{Resource: resource, TS: 1_001, ObservedTS: 1_001, Body: "at end", Labels: labels.FromStrings("job", "stable")})
	if err := b.Logs().Write(f.ctx, records); err != nil {
		t.Fatal(err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	b = f.backend(map[string]string{"async_insert": "0", "retention_logs_days": "36500"})
	matcher, err := spi.NewMatcher(spi.MatchEqual, "job", "stable")
	if err != nil {
		t.Fatal(err)
	}
	query := spi.LogQuery{Tenant: "tenant-a", Selectors: []spi.Matcher{matcher}, Start: 1_000, End: 1_001, Direction: spi.Forward}
	for _, test := range []struct {
		direction spi.Direction
		want      []string
	}{
		{spi.Forward, []string{"first", "second", "third"}},
		{spi.Backward, []string{"first", "second", "third"}},
	} {
		query.Direction = test.direction
		iter, err := b.Logs().Search(f.ctx, query)
		if err != nil {
			t.Fatal(err)
		}
		var bodies []string
		for iter.Next() {
			bodies = append(bodies, iter.At().Body)
		}
		if err := errors.Join(iter.Err(), iter.Close()); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(bodies, test.want) {
			t.Fatalf("direction=%v bodies=%v want=%v", test.direction, bodies, test.want)
		}
	}
	query.Direction = spi.Forward
	query.Limit = 1
	query.Stages = []spi.ParseStage{{Kind: spi.ParseLogfmt}}
	iter, err := b.Logs().Search(f.ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	var count int
	for iter.Next() {
		count++
	}
	if err := errors.Join(iter.Err(), iter.Close()); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("unsupported logfmt stage pretruncated superset to %d rows", count)
	}
}

func TestClickHouseQueryTraceRootZeroAndLastSpan(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_traces_days": "36500"})
	const traceID = "0123456789abcdef0123456789abcdef"
	root := utm.Span{Resource: &utm.Resource{Tenant: "tenant-a", Service: "root"}, TraceID: traceID, SpanID: "0123456789abcdef", Name: "root", Kind: utm.KindServer, StartNano: 1_000, EndNano: 1_000}
	child := utm.Span{Resource: &utm.Resource{Tenant: "tenant-a", Service: "child"}, TraceID: traceID, SpanID: "fedcba9876543210", ParentSpanID: root.SpanID, Name: "work", Kind: utm.KindClient, StartNano: 1_100, EndNano: 2_100, TraceState: "vendor=1"}
	last := utm.Span{Resource: &utm.Resource{Tenant: "tenant-a", Service: "child"}, TraceID: traceID, SpanID: "1111111111111111", ParentSpanID: root.SpanID, Name: "last", Kind: utm.KindClient, StartNano: 3_000, EndNano: 3_100}
	if err := b.Traces().Write(f.ctx, []utm.Span{root, child, last}); err != nil {
		t.Fatal(err)
	}
	query := spi.TraceQuery{Tenant: "tenant-a", Service: "child", Start: 1_000, End: 2_000, Limit: 10}
	IDs, err := b.Traces().FindTraceIDs(f.ctx, query)
	if err != nil || len(IDs) != 1 || IDs[0].TraceID != traceID || IDs[0].StartNano != child.StartNano || IDs[0].EndNano != child.EndNano {
		t.Fatalf("matching span trace candidates=%v err=%v", IDs, err)
	}
	query.MinDuration = time.Nanosecond
	IDs, err = b.Traces().FindTraceIDs(f.ctx, query)
	if err != nil || len(IDs) != 0 {
		t.Fatalf("zero-duration root did not control trace duration: %v %v", IDs, err)
	}
	iter, err := b.Traces().GetTrace(f.ctx, "tenant-a", traceID)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for iter.Next() {
		names = append(names, iter.At().Name)
	}
	if err := errors.Join(iter.Err(), iter.Close()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(names, []string{"root", "work", "last"}) {
		t.Fatalf("full trace omitted latest span: %v", names)
	}
	services, err := b.Traces().Services(f.ctx, "tenant-a", spi.TimeRange{Start: 2_200, End: 2_900})
	if err != nil || len(services) != 0 {
		t.Fatalf("service catalog returned time-window hole: %v %v", services, err)
	}
}

func TestClickHouseQueryTraceEmptyServiceAndLimitsMatchMemory(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_traces_days": "36500"})
	memory, err := spi.Open(f.ctx, "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := memory.Close(); err != nil {
			t.Errorf("close memory reference: %v", err)
		}
	})
	var spans []utm.Span
	for i, item := range []struct {
		tenant, service string
		start           int64
	}{
		{"tenant-a", "", 1_000},
		{"tenant-a", "", 2_000},
		{"tenant-a", "", 2_000},
		{"tenant-a", "", 3_000},
		{"tenant-a", "svc", 4_000},
		{"tenant-a", "svc", 3_500},
		{"tenant-b", "", 5_000},
	} {
		spans = append(spans, utm.Span{
			Resource: &utm.Resource{Tenant: item.tenant, Service: item.service},
			TraceID:  fmt.Sprintf("%032x", i+1), SpanID: fmt.Sprintf("%016x", i+1),
			Name: "root", Kind: utm.KindServer, StartNano: item.start, EndNano: item.start + 10,
		})
	}
	for _, store := range []spi.TraceStore{memory.Traces(), b.Traces()} {
		if err := store.Write(f.ctx, spans); err != nil {
			t.Fatal("write trace comparison fixture:", err)
		}
	}
	traceIDs := func(indexes ...int) []string {
		ids := make([]string, len(indexes))
		for i, index := range indexes {
			ids[i] = spans[index].TraceID
		}
		return ids
	}
	for _, test := range []struct {
		name, tenant, service string
		limit                 int
		want                  []string
	}{
		{"zero-empty", "tenant-a", "", 0, traceIDs(3, 1, 2, 0)},
		{"negative-empty", "tenant-a", "", -2, traceIDs(3, 1, 2, 0)},
		{"positive-empty", "tenant-a", "", 2, traceIDs(3, 1)},
		{"zero-nonempty", "tenant-a", "svc", 0, traceIDs(4, 5)},
		{"positive-nonempty", "tenant-a", "svc", 1, traceIDs(4)},
		{"tenant-isolation", "tenant-b", "", 0, traceIDs(6)},
	} {
		t.Run(test.name, func(t *testing.T) {
			query := spi.TraceQuery{Tenant: test.tenant, Service: test.service, Start: 0, End: 6_000, Limit: test.limit}
			want, err := memory.Traces().FindTraceIDs(f.ctx, query)
			if err != nil {
				t.Fatal("memory reference:", err)
			}
			got, err := b.Traces().FindTraceIDs(f.ctx, query)
			if err != nil {
				t.Fatal("ClickHouse trace query:", err)
			}
			var actualIDs []string
			for _, item := range got {
				actualIDs = append(actualIDs, item.TraceID)
			}
			if !reflect.DeepEqual(want, got) || !reflect.DeepEqual(actualIDs, test.want) {
				t.Fatalf("query=%+v memory=%v ClickHouse=%v ordered IDs=%v want IDs=%v", query, want, got, actualIDs, test.want)
			}
		})
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	bounded := f.backend(map[string]string{"async_insert": "0", "max_result_rows": "1"})
	_, err = bounded.Traces().FindTraceIDs(f.ctx, spi.TraceQuery{
		Tenant: "tenant-a", Service: "", Start: 0, End: 6_000, Limit: 0,
	})
	if spi.Classify(err) != spi.ErrTooLarge {
		t.Fatalf("unbounded requested trace result silently truncated or misclassified: %v", err)
	}
}

func TestClickHouseQueryResultBounds(t *testing.T) {
	for _, test := range []struct {
		option string
		value  string
	}{
		{"max_rows_to_read", "1"},
		{"max_result_rows", "1"},
		{"max_result_bytes", "16"},
	} {
		t.Run(test.option, func(t *testing.T) {
			f := newFixture(t)
			b := f.migrated(map[string]string{"async_insert": "0", "retention_metrics_days": "36500"})
			var points []utm.MetricPoint
			for i := range 3 {
				ls := labels.FromStrings(utm.LabelName, "bound_metric", utm.LabelTenant, "tenant-a", "job", fmt.Sprintf("bounds-%d", i))
				points = append(points, utm.MetricPoint{Name: "bound_metric", Labels: ls, TS: int64(1_000 + i), Value: float64(i)})
			}
			if err := b.Metrics().Write(f.ctx, points); err != nil {
				t.Fatal(err)
			}
			if err := b.Close(); err != nil {
				t.Fatal(err)
			}
			b = f.backend(map[string]string{"async_insert": "0", test.option: test.value})
			matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "bound_metric")
			if err != nil {
				t.Fatal(err)
			}
			set, err := b.Metrics().Select(f.ctx, spi.SeriesQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: 0, End: 4_000})
			if err == nil {
				for set.Next() {
					iter := set.At().Samples()
					for iter.Next() {
					}
					err = errors.Join(err, iter.Err())
				}
				err = errors.Join(err, set.Err(), set.Close())
			}
			if spi.Classify(err) != spi.ErrTooLarge {
				t.Fatalf("%s did not fail with ErrTooLarge: %v", test.option, err)
			}
		})
	}
}

func TestClickHouseQueryMemoryCapCallerContext(t *testing.T) {
	const configured = 10_000_000
	for _, override := range []int{0, 20_000_000} {
		t.Run(fmt.Sprintf("caller_%d", override), func(t *testing.T) {
			f := newFixture(t)
			b := f.migrated(map[string]string{
				"async_insert": "0", "retention_metrics_days": "36500",
				"max_memory_usage": fmt.Sprint(configured),
			})
			seriesLabels := labels.FromStrings(utm.LabelName, "memory_cap_metric", utm.LabelTenant, "tenant-a")
			if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{{
				Name: "memory_cap_metric", Labels: seriesLabels, TS: 1_000, Value: 1,
			}}); err != nil {
				t.Fatal(err)
			}
			matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "memory_cap_metric")
			if err != nil {
				t.Fatal(err)
			}
			ctx := clickhouse.Context(f.ctx, clickhouse.WithSettings(clickhouse.Settings{"max_memory_usage": override}))
			set, err := b.Metrics().Select(ctx, spi.SeriesQuery{
				Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: 1_000, End: 1_000,
			})
			if err != nil {
				t.Fatal(err)
			}
			if !set.Next() {
				t.Fatalf("missing query row: %v", set.Err())
			}
			iter := set.At().Samples()
			if !iter.Next() {
				t.Fatalf("missing query sample: %v", iter.Err())
			}
			if err := errors.Join(iter.Err(), set.Err(), set.Close()); err != nil {
				t.Fatal(err)
			}
			var effective string
			var lastErr error
			deadline := time.Now().Add(8 * time.Second)
			for time.Now().Before(deadline) {
				if err := f.admin.Exec(f.ctx, "SYSTEM FLUSH LOGS"); err != nil {
					t.Fatal("flush server query log:", err)
				}
				lastErr = f.admin.QueryRow(f.ctx, "SELECT Settings['max_memory_usage'] FROM system.query_log WHERE current_database=? AND type='QueryFinish' AND query LIKE '%FROM metric_samples AS s INNER JOIN meta AS m%' ORDER BY event_time_microseconds DESC LIMIT 1", f.db).Scan(&effective)
				if lastErr == nil {
					break
				}
				time.Sleep(100 * time.Millisecond)
			}
			if lastErr != nil {
				t.Fatal("query server setting missing:", lastErr)
			}
			if effective != fmt.Sprint(configured) {
				t.Fatalf("caller setting %d changed effective max_memory_usage to %q, want %d", override, effective, configured)
			}
		})
	}
}

func TestClickHouseQueryAbandonedIteratorReleasesBackend(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "retention_metrics_days": "36500"})
	ls := labels.FromStrings(utm.LabelName, "lifetime_metric", utm.LabelTenant, "tenant-a")
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{{Name: "lifetime_metric", Labels: ls, TS: 1_000, Value: 1}}); err != nil {
		t.Fatal(err)
	}
	matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "lifetime_metric")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	set, err := b.Metrics().Select(ctx, spi.SeriesQuery{Tenant: "tenant-a", Matchers: []spi.Matcher{matcher}, Start: 0, End: 2_000})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	// Leave the streaming series partially consumed, then cancel and close.
	_ = set.Next()
	cancel()
	if err := set.Close(); err != nil && !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err := set.Close(); err != nil && !errors.Is(err, context.Canceled) {
		t.Fatal("iterator Close was not idempotent:", err)
	}
	done := make(chan error, 1)
	go func() { done <- b.Close() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("backend.Close blocked on an abandoned iterator")
	}
}
