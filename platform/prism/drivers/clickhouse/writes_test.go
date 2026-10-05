package clickhouse

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type writeTestHost struct{ conn *writeTestConn }

func (h *writeTestHost) run(ctx context.Context, _ string, fn func(context.Context) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return fn(ctx)
}
func (h *writeTestHost) connection() connection { return h.conn }
func (h *writeTestHost) retentionDays(signal spi.Signal) int {
	switch signal {
	case spi.SignalMetrics:
		return 30
	case spi.SignalLogs:
		return 14
	case spi.SignalTraces:
		return 90
	default:
		return 0
	}
}

type retentionWriteTestHost struct {
	*writeTestHost
	days map[spi.Signal]int
}

func (h *retentionWriteTestHost) retentionDays(signal spi.Signal) int {
	if days, ok := h.days[signal]; ok {
		return days
	}
	return h.writeTestHost.retentionDays(signal)
}

func ttlSourceBoundary(days int) time.Time {
	return time.Unix(1<<32, 0).UTC().AddDate(0, 0, -days)
}

type writeTestConn struct {
	queries  []string
	rows     map[string][][]any
	failSend string
	closeErr error
	closed   int
}

func (c *writeTestConn) PrepareBatch(_ context.Context, query string, _ ...chdriver.PrepareBatchOption) (chdriver.Batch, error) {
	c.queries = append(c.queries, query)
	return &writeTestBatch{conn: c, query: query}, nil
}
func (c *writeTestConn) Exec(context.Context, string, ...any) error { panic("unexpected Exec") }
func (c *writeTestConn) Query(context.Context, string, ...any) (chdriver.Rows, error) {
	panic("unexpected Query")
}
func (c *writeTestConn) Ping(context.Context) error { return nil }
func (c *writeTestConn) Close() error               { return nil }

type writeTestBatch struct {
	chdriver.Batch
	conn  *writeTestConn
	query string
	rows  [][]any
}

func (b *writeTestBatch) Append(values ...any) error {
	b.rows = append(b.rows, append([]any(nil), values...))
	return nil
}
func (b *writeTestBatch) Send() error {
	if strings.Contains(b.query, b.conn.failSend) && b.conn.failSend != "" {
		return errors.New("send failed")
	}
	if b.conn.rows == nil {
		b.conn.rows = make(map[string][][]any)
	}
	b.conn.rows[b.query] = append(b.conn.rows[b.query], b.rows...)
	return nil
}
func (b *writeTestBatch) Close() error { b.conn.closed++; return b.conn.closeErr }

func writeTestRows(c *writeTestConn, table string) [][]any {
	for query, rows := range c.rows {
		if strings.HasPrefix(query, "INSERT INTO "+table+" ") {
			return rows
		}
	}
	return nil
}

func requireClass(t *testing.T, err error, want spi.ErrClass) {
	t.Helper()
	if got := spi.Classify(err); got != want {
		t.Fatalf("class = %s, want %s; err=%v", got, want, err)
	}
}

func TestEmptyWritersRejectBeforePrepare(t *testing.T) {
	conn := &writeTestConn{}
	host := &writeTestHost{conn}
	requireClass(t, newMetricStore(host).Write(t.Context(), nil), spi.ErrBadRequest)
	requireClass(t, newLogStore(host).Write(t.Context(), nil), spi.ErrBadRequest)
	requireClass(t, newTraceStore(host).Write(t.Context(), []utm.Span{}), spi.ErrBadRequest)
	if len(conn.queries) != 0 {
		t.Fatal("empty input reached I/O")
	}
}

func TestZeroIDsRejectedBeforePrepare(t *testing.T) {
	const (
		traceID     = "00000000000000000000000000000001"
		spanID      = "0000000000000001"
		zeroTraceID = "00000000000000000000000000000000"
		zeroSpanID  = "0000000000000000"
	)
	validSpan := func() utm.Span {
		return utm.Span{Resource: &utm.Resource{Tenant: "a"}, TraceID: traceID, SpanID: spanID, StartNano: 1, EndNano: 2}
	}
	validLog := func() utm.LogRecord {
		return utm.LogRecord{Resource: &utm.Resource{Tenant: "a"}, TS: 1, ObservedTS: 1}
	}
	tests := []struct {
		name  string
		write func(*writeTestHost) error
	}{
		{"trace ID", func(host *writeTestHost) error {
			span := validSpan()
			span.TraceID = zeroTraceID
			return newTraceStore(host).Write(t.Context(), []utm.Span{span})
		}},
		{"span ID", func(host *writeTestHost) error {
			span := validSpan()
			span.SpanID = zeroSpanID
			return newTraceStore(host).Write(t.Context(), []utm.Span{span})
		}},
		{"parent span ID", func(host *writeTestHost) error {
			span := validSpan()
			span.ParentSpanID = zeroSpanID
			return newTraceStore(host).Write(t.Context(), []utm.Span{span})
		}},
		{"link trace ID", func(host *writeTestHost) error {
			span := validSpan()
			span.Links = []utm.SpanLink{{TraceID: zeroTraceID, SpanID: spanID}}
			return newTraceStore(host).Write(t.Context(), []utm.Span{span})
		}},
		{"link span ID", func(host *writeTestHost) error {
			span := validSpan()
			span.Links = []utm.SpanLink{{TraceID: traceID, SpanID: zeroSpanID}}
			return newTraceStore(host).Write(t.Context(), []utm.Span{span})
		}},
		{"log trace ID", func(host *writeTestHost) error {
			record := validLog()
			record.TraceID = zeroTraceID
			return newLogStore(host).Write(t.Context(), []utm.LogRecord{record})
		}},
		{"log span ID", func(host *writeTestHost) error {
			record := validLog()
			record.SpanID = zeroSpanID
			return newLogStore(host).Write(t.Context(), []utm.LogRecord{record})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			conn := &writeTestConn{}
			requireClass(t, test.write(&writeTestHost{conn}), spi.ErrBadRequest)
			if len(conn.queries) != 0 {
				t.Fatalf("invalid ID prepared %d batches", len(conn.queries))
			}
		})
	}
}

func TestOptionalAndNonzeroIDsAccepted(t *testing.T) {
	const (
		traceID = "00000000000000000000000000000001"
		spanID  = "0000000000000001"
	)
	for _, test := range []struct {
		name  string
		write func(*writeTestHost) error
	}{
		{"empty log IDs", func(host *writeTestHost) error {
			return newLogStore(host).Write(t.Context(), []utm.LogRecord{{Resource: &utm.Resource{Tenant: "a"}, TS: 1, ObservedTS: 1}})
		}},
		{"nonzero log IDs", func(host *writeTestHost) error {
			return newLogStore(host).Write(t.Context(), []utm.LogRecord{{Resource: &utm.Resource{Tenant: "a"}, TS: 1, ObservedTS: 1, TraceID: traceID, SpanID: spanID}})
		}},
		{"empty parent and nonzero link IDs", func(host *writeTestHost) error {
			return newTraceStore(host).Write(t.Context(), []utm.Span{{Resource: &utm.Resource{Tenant: "a"}, TraceID: traceID, SpanID: spanID, StartNano: 1, EndNano: 2, Links: []utm.SpanLink{{TraceID: traceID, SpanID: spanID}}}})
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			conn := &writeTestConn{}
			if err := test.write(&writeTestHost{conn}); err != nil {
				t.Fatal(err)
			}
			if len(conn.queries) == 0 {
				t.Fatal("valid IDs did not reach I/O")
			}
		})
	}
}
