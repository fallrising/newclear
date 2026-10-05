package clickhouse

import (
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func TestLogPreservesResourceAndRejectsConflictingTenant(t *testing.T) {
	conn := &writeTestConn{}
	store := newLogStore(&writeTestHost{conn})
	record := utm.LogRecord{Resource: &utm.Resource{Tenant: "a", Service: "svc", ServiceInstance: "inst", ServiceVersion: "v1", Namespace: "ns", Attrs: map[string]string{"zone": "z"}}, TS: 1_000_000_001, ObservedTS: 1_000_000_002, Severity: utm.SevWarn, Body: "hello", Labels: labels.FromStrings("__tenant__", "a"), Attrs: map[string]string{"x": "y"}}
	bad := record
	bad.Labels = labels.FromStrings("__tenant__", "b")
	requireClass(t, store.Write(t.Context(), []utm.LogRecord{record, bad}), spi.ErrBadRequest)
	if len(conn.queries) != 0 {
		t.Fatal("prepared before full validation")
	}
	if err := store.Write(t.Context(), []utm.LogRecord{record}); err != nil {
		t.Fatal(err)
	}
	rows := writeTestRows(conn, "logs")
	if len(rows) != 1 || len(rows[0]) != 18 || rows[0][8] != "" || rows[0][9] != "hello" || rows[0][14].(map[string]string)["zone"] != "z" || rows[0][15] != "inst" || rows[0][16] != "v1" || rows[0][17] != "ns" {
		t.Fatalf("unexpected log row: %v", rows)
	}
}

func TestLogRejectsDuplicateLabelsAndCloseFailure(t *testing.T) {
	conn := &writeTestConn{}
	store := newLogStore(&writeTestHost{conn})
	record := utm.LogRecord{Resource: &utm.Resource{Tenant: "a"}, TS: 1, ObservedTS: 1}
	record.Labels = labels.FromStrings("x", "1", "x", "2")
	requireClass(t, store.Write(t.Context(), []utm.LogRecord{record}), spi.ErrBadRequest)
	if len(conn.queries) != 0 {
		t.Fatal("duplicate labels reached I/O")
	}
	record.Labels = labels.FromStrings("x", "1")
	conn.closeErr = errors.New("close failed")
	if err := store.Write(t.Context(), []utm.LogRecord{record}); err == nil || !strings.Contains(err.Error(), "close failed") {
		t.Fatalf("close failure lost: %v", err)
	}
}

func TestLogByteAndTimestampBoundsBeforeIO(t *testing.T) {
	conn := &writeTestConn{}
	store := newLogStore(&writeTestHost{conn})
	record := utm.LogRecord{Resource: &utm.Resource{Tenant: "a"}, TS: 1, ObservedTS: 1, Body: strings.Repeat("x", maxBatchBytes)}
	requireClass(t, store.Write(t.Context(), []utm.LogRecord{record}), spi.ErrTooLarge)
	record.Body = "ok"
	record.ObservedTS = 4_294_967_296_000_000_000
	requireClass(t, store.Write(t.Context(), []utm.LogRecord{record}), spi.ErrBadRequest)
	if len(conn.queries) != 0 {
		t.Fatal("oversized or out-of-range record reached I/O")
	}
}

func TestLogTTLSourceBoundary(t *testing.T) {
	for _, days := range []int{14, 36500} {
		t.Run(strconv.Itoa(days), func(t *testing.T) {
			conn := &writeTestConn{}
			host := &retentionWriteTestHost{writeTestHost: &writeTestHost{conn}, days: map[spi.Signal]int{spi.SignalLogs: days}}
			store := newLogStore(host)
			boundary := ttlSourceBoundary(days)
			valid := utm.LogRecord{Resource: &utm.Resource{Tenant: "a"}, TS: 1, ObservedTS: 1}
			unsafe := valid
			unsafe.TS = utm.TimeToNano(boundary)
			requireClass(t, store.Write(t.Context(), []utm.LogRecord{valid, unsafe}), spi.ErrBadRequest)
			if len(conn.queries) != 0 {
				t.Fatalf("TTL-unsafe log prepared %d batches", len(conn.queries))
			}
			safe := valid
			safe.TS = utm.TimeToNano(boundary.Add(-time.Nanosecond))
			safe.ObservedTS = utm.TimeToNano(time.Unix(1<<32, 0).UTC().Add(-time.Nanosecond))
			if err := store.Write(t.Context(), []utm.LogRecord{safe}); err != nil {
				t.Fatal(err)
			}
			if got := len(writeTestRows(conn, "logs")); got != 1 {
				t.Fatalf("safe log rows=%d", got)
			}
		})
	}
}
