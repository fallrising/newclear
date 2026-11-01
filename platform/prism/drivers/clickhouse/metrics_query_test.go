package clickhouse

import (
	"context"
	"math"
	"reflect"
	"testing"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

type metricQueryRows struct {
	chdriver.Rows
	data   [][]any
	index  int
	closed int
}

func (r *metricQueryRows) Next() bool {
	if r.index >= len(r.data) {
		return false
	}
	r.index++
	return true
}
func (r *metricQueryRows) Scan(dest ...any) error {
	for i, value := range r.data[r.index-1] {
		reflect.ValueOf(dest[i]).Elem().Set(reflect.ValueOf(value))
	}
	return nil
}
func (r *metricQueryRows) Close() error { r.closed++; return nil }
func (*metricQueryRows) Err() error     { return nil }

type metricQueryConn struct {
	connection
	rows *metricQueryRows
}

func (c *metricQueryConn) Query(context.Context, string, ...any) (chdriver.Rows, error) {
	return c.rows, nil
}
func (*metricQueryConn) Close() error { return nil }

func TestMetricStreamingSeriesIdentityAndBorrowedSeriesSnapshot(t *testing.T) {
	first := map[string]string{"__name__": "cpu", "__tenant__": "tenant", "job": "a"}
	second := map[string]string{"__name__": "cpu", "__tenant__": "tenant", "job": "b"}
	fp1, fp2 := utm.Fingerprint(labels.FromMap(first)), utm.Fingerprint(labels.FromMap(second))
	rows := &metricQueryRows{data: [][]any{
		{fp1, "cpu", utm.MilliToTime(1), uint64(1 << 63), first, uint64(1), "cpu"},
		{fp1, "cpu", utm.MilliToTime(2), uint64(0x7ff0000000000001), first, uint64(1), "cpu"},
		{fp2, "cpu", utm.MilliToTime(3), math.Float64bits(3), second, uint64(1), "cpu"},
	}}
	b := newBackend(&metricQueryConn{rows: rows}, options{maxOpen: 1, timeout: time.Second})
	defer func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	}()
	match, _ := spi.NewMatcher(spi.MatchEqual, "__name__", "cpu")
	set, err := b.Metrics().Select(t.Context(), spi.SeriesQuery{Tenant: "tenant", Matchers: []spi.Matcher{match}, Start: 0, End: 4})
	if err != nil {
		t.Fatal(err)
	}
	if !set.Next() {
		t.Fatalf("first series missing: %v", set.Err())
	}
	held := set.At()
	it := held.Samples()
	if !it.Next() {
		t.Fatal("first sample missing")
	}
	_, v := it.At()
	if math.Float64bits(v) != 1<<63 {
		t.Fatalf("negative-zero bits=%x", math.Float64bits(v))
	}
	if !it.Next() {
		t.Fatal("second sample missing")
	}
	_, v = it.At()
	if math.Float64bits(v) != 0x7ff0000000000001 {
		t.Fatalf("NaN bits=%x", math.Float64bits(v))
	}
	if !set.Next() {
		t.Fatalf("second series missing: %v", set.Err())
	}
	if held.Labels().Get("job") != "a" || set.At().Labels().Get("job") != "b" {
		t.Fatal("held Series changed after Next")
	}
	if set.Next() || set.Err() != nil {
		t.Fatalf("EOF error=%v", set.Err())
	}
	if err := set.Close(); err != nil {
		t.Fatal(err)
	}
	if rows.closed != 1 {
		t.Fatalf("native rows closed %d times", rows.closed)
	}
}

func TestMetricStreamingFailsClosedOnMetadataConflict(t *testing.T) {
	values := map[string]string{"__name__": "cpu", "__tenant__": "tenant"}
	fp := utm.Fingerprint(labels.FromMap(values))
	for _, tc := range []struct {
		name         string
		identities   uint64
		sampleMetric string
	}{{"metadata", 2, "cpu"}, {"sample metric", 1, "other"}} {
		t.Run(tc.name, func(t *testing.T) {
			rows := &metricQueryRows{data: [][]any{{fp, "cpu", utm.MilliToTime(1), math.Float64bits(1), values, tc.identities, tc.sampleMetric}}}
			b := newBackend(&metricQueryConn{rows: rows}, options{maxOpen: 1, timeout: time.Second})
			defer func() {
				if err := b.Close(); err != nil {
					t.Error(err)
				}
			}()
			set, err := b.Metrics().Select(t.Context(), spi.SeriesQuery{Tenant: "tenant", Start: 0, End: 2})
			if err != nil {
				t.Fatal(err)
			}
			if set.Next() || spi.Classify(set.Err()) != spi.ErrInternal {
				t.Fatalf("corrupt identity not rejected: %v", set.Err())
			}
			_ = set.Close()
		})
	}
}

func TestStoredTimeRangeIntersection(t *testing.T) {
	if _, _, ok := metricRange(-100, -1); ok {
		t.Fatal("negative metric range intersects storage")
	}
	start, end, ok := metricRange(-100, 100)
	if !ok || start != 0 || end != 100 {
		t.Fatalf("metric range=%d,%d,%v", start, end, ok)
	}
	if _, _, ok := nanoRange(-100, -1); ok {
		t.Fatal("negative log range intersects storage")
	}
	start, end, ok = nanoRange(-100, 100)
	if !ok || start != 0 || end != 100 {
		t.Fatalf("nano range=%d,%d,%v", start, end, ok)
	}
	const upper = maxTimestampSeconds * 1_000_000_000
	start, end, ok = nanoRange(upper-1, math.MaxInt64)
	if !ok || start != upper-1 || end != upper {
		t.Fatalf("upper nano range=%d,%d,%v", start, end, ok)
	}
	if _, _, ok := nanoRange(upper, math.MaxInt64); ok {
		t.Fatal("range above stored nano maximum intersects")
	}
}
