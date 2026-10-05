package clickhouse

import (
	"strconv"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func TestTraceLocalJoinAndPendingIsolation(t *testing.T) {
	conn := &writeTestConn{}
	store := newTraceStore(&writeTestHost{conn})
	trace := "00000000000000000000000000000001"
	parentID := "0000000000000001"
	parent := utm.Span{Resource: &utm.Resource{Tenant: "a", Service: "up", ServiceInstance: "i", Attrs: map[string]string{"rack": "r"}}, TraceID: trace, SpanID: parentID, Name: "parent", StartNano: 1_000_000_000, EndNano: 1_000_000_100, TraceState: "vendor=x"}
	child := utm.Span{Resource: &utm.Resource{Tenant: "a", Service: "down"}, TraceID: trace, SpanID: "0000000000000002", ParentSpanID: parentID, StartNano: 1_000_000_000, EndNano: 1_000_000_010, StatusCode: utm.StatusError, Links: []utm.SpanLink{{TraceID: trace, SpanID: parentID, Attrs: map[string]string{"k": "v"}}}}
	other := child
	other.Resource = &utm.Resource{Tenant: "b", Service: "down"}
	other.SpanID = "0000000000000003"
	if err := store.Write(t.Context(), []utm.Span{parent, child, other}); err != nil {
		t.Fatal(err)
	}
	if len(writeTestRows(conn, "spans")) != 3 || len(writeTestRows(conn, "service_deps_1h")) != 1 || len(writeTestRows(conn, "pending_links")) != 1 {
		t.Fatalf("unexpected row counts: %#v", conn.rows)
	}
	rows := writeTestRows(conn, "spans")
	if rows[0][15] != "vendor=x" || rows[0][16] != "i" || rows[1][25].([]map[string]string)[0]["k"] != "v" {
		t.Fatalf("lost trace fields: %#v", rows)
	}
}

func TestTraceRejectsNestedInvalidBeforeIO(t *testing.T) {
	conn := &writeTestConn{}
	store := newTraceStore(&writeTestHost{conn})
	span := utm.Span{Resource: &utm.Resource{Tenant: "a"}, TraceID: "00000000000000000000000000000001", SpanID: "0000000000000001", StartNano: 1_000_000_000, EndNano: 1_000_000_001}
	bad := span
	bad.Events = []utm.SpanEvent{{TS: -1}}
	requireClass(t, store.Write(t.Context(), []utm.Span{span, bad}), spi.ErrBadRequest)
	if len(conn.queries) != 0 {
		t.Fatal("prepared before full validation")
	}
}

func TestTraceTTLSourceBoundary(t *testing.T) {
	for _, days := range []int{90, 36500} {
		t.Run(strconv.Itoa(days), func(t *testing.T) {
			conn := &writeTestConn{}
			host := &retentionWriteTestHost{writeTestHost: &writeTestHost{conn}, days: map[spi.Signal]int{spi.SignalTraces: days}}
			store := newTraceStore(host)
			boundary := ttlSourceBoundary(days)
			valid := utm.Span{Resource: &utm.Resource{Tenant: "a"}, TraceID: "00000000000000000000000000000001", SpanID: "0000000000000001", StartNano: 1, EndNano: 2}
			unsafe := valid
			unsafe.SpanID = "0000000000000002"
			unsafe.StartNano = utm.TimeToNano(boundary)
			unsafe.EndNano = unsafe.StartNano + 1
			requireClass(t, store.Write(t.Context(), []utm.Span{valid, unsafe}), spi.ErrBadRequest)
			if len(conn.queries) != 0 {
				t.Fatalf("TTL-unsafe trace prepared %d batches", len(conn.queries))
			}
			safe := valid
			safe.StartNano = utm.TimeToNano(boundary.Add(-time.Nanosecond))
			high := utm.TimeToNano(time.Unix(1<<32, 0).UTC().Add(-time.Nanosecond))
			safe.EndNano = high
			safe.Events = []utm.SpanEvent{{TS: high, Name: "last event"}}
			if err := store.Write(t.Context(), []utm.Span{safe}); err != nil {
				t.Fatal(err)
			}
			if got := len(writeTestRows(conn, "spans")); got != 1 {
				t.Fatalf("safe span rows=%d", got)
			}
		})
	}
}
