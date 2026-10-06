package clickhouse

import (
	"context"
	"errors"
	"net"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/column"
	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

type fakeBoundedColumn struct {
	column.Interface
	name string
}

func (c fakeBoundedColumn) Name() string { return c.name }

type fakeBoundedBatch struct {
	chdriver.Batch
	columns []column.Interface
	closed  int
}

func (b *fakeBoundedBatch) Columns() []column.Interface { return b.columns }
func (b *fakeBoundedBatch) Close() error                { b.closed++; return nil }

type fakeBoundedConn struct {
	connection
	batch    *fakeBoundedBatch
	query    string
	ctx      context.Context
	opts     []chdriver.PrepareBatchOption
	prepares int
	execSQL  string
	querySQL string
}

func (c *fakeBoundedConn) PrepareBatch(ctx context.Context, query string, opts ...chdriver.PrepareBatchOption) (chdriver.Batch, error) {
	c.prepares++
	c.ctx, c.query, c.opts = ctx, query, opts
	return c.batch, nil
}
func (c *fakeBoundedConn) Exec(_ context.Context, sql string, _ ...any) error {
	c.execSQL = sql
	return nil
}
func (c *fakeBoundedConn) Query(_ context.Context, sql string, _ ...any) (chdriver.Rows, error) {
	c.querySQL = sql
	return &fakeMigrationRows{}, nil
}

func TestBoundedNativeBatchMatchesSixFixedWriterColumns(t *testing.T) {
	for _, tc := range []struct{ table, cols string }{
		{"logs", "ts,observed_ts,tenant,cluster,host,service,env,severity,severity_text,body,trace_id,span_id,labels,attrs,res_attrs,service_instance,service_version,namespace,write_seq"},
		{"spans", "ts,tenant,trace_id,span_id,parent_id,service,name,kind,duration_ns,status_code,status_msg,host,env,attrs,res_attrs,trace_state,service_instance,service_version,namespace,cluster,events.ts,events.name,events.attrs,links.trace_id,links.span_id,links.attrs"},
		{"metric_series", "fingerprint,tenant,metric,labels,first_seen,last_seen"},
		{"metric_samples", "ts,fingerprint,tenant,metric,value"},
		{"metric_samples", "ts,fingerprint,tenant,metric,value,value_bits"},
		{"service_deps_1h", "hour,tenant,parent,child,calls,errors"},
		{"pending_links", "ts,tenant,trace_id,parent_span_id,child_service,is_error"},
	} {
		t.Run(tc.table+"/"+tc.cols, func(t *testing.T) {
			names := strings.Split(tc.cols, ",")
			batch := &fakeBoundedBatch{}
			for _, name := range names {
				batch.columns = append(batch.columns, fakeBoundedColumn{name: name})
			}
			conn := &fakeBoundedConn{batch: batch}
			adapter := boundedNativeConnection{connection: conn, maxExec: 7}
			ctx := t.Context()
			query := "INSERT INTO " + tc.table + " (" + tc.cols + ")"
			opt := chdriver.WithReleaseConnection()
			got, err := adapter.PrepareBatch(ctx, query, opt)
			if err != nil || got != batch {
				t.Fatalf("PrepareBatch result=%v, err=%v", got, err)
			}
			wantSQL := "INSERT INTO " + tc.table + " SETTINGS max_execution_time = 7"
			if tc.table == "logs" {
				wantSQL += ", async_insert = 0"
			}
			if conn.query != wantSQL || conn.ctx != ctx || len(conn.opts) != 1 {
				t.Fatalf("native prepare changed query/context/options: query=%q options=%d", conn.query, len(conn.opts))
			}
			var nativeOpts chdriver.PrepareBatchOptions
			conn.opts[0](&nativeOpts)
			if !nativeOpts.ReleaseConnection {
				t.Fatal("native batch option not forwarded")
			}
			if batch.closed != 0 || !slices.Equal(names, nativeBatchColumnNames(got)) {
				t.Fatal("matching batch closed or column order changed")
			}
		})
	}
}

func TestBoundedNativeBatchFailsClosedOnSchemaDrift(t *testing.T) {
	query := "INSERT INTO metric_samples (ts,fingerprint,tenant,metric,value)"
	for _, names := range [][]string{
		{"ts", "fingerprint", "tenant", "metric"},
		{"fingerprint", "ts", "tenant", "metric", "value"},
	} {
		batch := &fakeBoundedBatch{}
		for _, name := range names {
			batch.columns = append(batch.columns, fakeBoundedColumn{name: name})
		}
		conn := &fakeBoundedConn{batch: batch}
		adapter := boundedNativeConnection{connection: conn, maxExec: 7}
		if _, err := adapter.PrepareBatch(t.Context(), query); !errors.Is(err, errWriteSchema) || batch.closed != 1 {
			t.Fatalf("schema drift err=%v, closes=%d", err, batch.closed)
		}
	}
	conn := &fakeBoundedConn{batch: &fakeBoundedBatch{}}
	adapter := boundedNativeConnection{connection: conn, maxExec: 7}
	if _, err := adapter.PrepareBatch(t.Context(), "INSERT INTO unknown (value)"); !errors.Is(err, errWriteSchema) || conn.prepares != 0 {
		t.Fatalf("unknown SQL reached native client: err=%v, prepares=%d", err, conn.prepares)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := adapter.PrepareBatch(ctx, "INSERT INTO metric_samples (ts,fingerprint,tenant,metric,value)"); !errors.Is(err, context.Canceled) || conn.prepares != 0 {
		t.Fatalf("canceled batch reached native client: err=%v, prepares=%d", err, conn.prepares)
	}
}

func TestBoundedNativeConnectionLeavesDDLAndQueriesUntouched(t *testing.T) {
	conn := &fakeBoundedConn{}
	adapter := boundedNativeConnection{connection: conn, maxExec: 7}
	if err := adapter.Exec(t.Context(), "CREATE TABLE probe (x UInt8) ENGINE = Memory"); err != nil {
		t.Fatal(err)
	}
	rows, err := adapter.Query(t.Context(), "SELECT x FROM probe LIMIT 1")
	if err != nil {
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if conn.execSQL != "CREATE TABLE probe (x UInt8) ENGINE = Memory" || conn.querySQL != "SELECT x FROM probe LIMIT 1" || conn.prepares != 0 {
		t.Fatalf("DDL/query changed by write adapter: exec=%q query=%q prepares=%d", conn.execSQL, conn.querySQL, conn.prepares)
	}
}

func nativeBatchColumnNames(batch chdriver.Batch) []string {
	names := make([]string, 0, len(batch.Columns()))
	for _, col := range batch.Columns() {
		names = append(names, col.Name())
	}
	return names
}

type unfiredDeadlineContext struct {
	context.Context
	deadline time.Time
}

func (c unfiredDeadlineContext) Deadline() (time.Time, bool) { return c.deadline, true }
func (unfiredDeadlineContext) Done() <-chan struct{}         { return nil }
func (unfiredDeadlineContext) Err() error                    { return nil }

func TestRunClassifiesElapsedDeadlineBeforeNativeSocketError(t *testing.T) {
	b := newBackend(&fakeLifecycleConn{}, options{maxOpen: 1, timeout: time.Minute})
	defer func() { _ = b.Close() }()
	ctx := unfiredDeadlineContext{Context: t.Context(), deadline: time.Now().Add(-time.Second)}
	err := b.run(ctx, "Query", func(context.Context) error {
		return &net.OpError{Op: "read", Err: errors.New("raw socket timeout")}
	})
	if spi.Classify(err) != spi.ErrTimeout || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("elapsed deadline class=%s, err=%v", spi.Classify(err), err)
	}
	if strings.Contains(err.Error(), "raw socket timeout") {
		t.Fatal("raw native error leaked")
	}
}

func TestRunKeepsNetworkFailureBeforeDeadlineUnavailable(t *testing.T) {
	b := newBackend(&fakeLifecycleConn{}, options{maxOpen: 1, timeout: time.Minute})
	defer func() { _ = b.Close() }()
	err := b.run(t.Context(), "Query", func(context.Context) error {
		return &net.OpError{Op: "read", Err: errors.New("raw socket failure")}
	})
	if spi.Classify(err) != spi.ErrUnavailable || errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("early network failure class=%s, err=%v", spi.Classify(err), err)
	}
}

type fakeLifecycleConn struct {
	connection
	mu     sync.Mutex
	closes int
}

func (f *fakeLifecycleConn) Close() error             { f.mu.Lock(); defer f.mu.Unlock(); f.closes++; return nil }
func (*fakeLifecycleConn) Ping(context.Context) error { return nil }

func TestBackendCloseCancelsAndDrains(t *testing.T) {
	conn := &fakeLifecycleConn{}
	b := newBackend(conn, options{maxOpen: 1, timeout: time.Second})
	started := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		finished <- b.run(context.Background(), "Write", func(ctx context.Context) error { close(started); <-ctx.Done(); return ctx.Err() })
	}()
	<-started
	closed := make(chan error, 1)
	go func() { closed <- b.Close() }()
	select {
	case err := <-finished:
		if spi.Classify(err) != spi.ErrTimeout {
			t.Fatalf("write class=%s", spi.Classify(err))
		}
	case <-time.After(time.Second):
		t.Fatal("write did not drain")
	}
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	conn.mu.Lock()
	closes := conn.closes
	conn.mu.Unlock()
	if closes != 1 {
		t.Fatalf("native closes=%d", closes)
	}
	if err := b.Ping(t.Context()); spi.Classify(err) != spi.ErrUnavailable || !errors.Is(err, errClosed) {
		t.Fatalf("post-close ping: %v", err)
	}
}

func TestAdmissionHonorsCallerDeadline(t *testing.T) {
	b := newBackend(&fakeLifecycleConn{}, options{maxOpen: 1, timeout: time.Second})
	defer func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	}()
	entered := make(chan struct{})
	release := make(chan struct{})
	releaseOnce := sync.OnceFunc(func() { close(release) })
	defer releaseOnce()
	done := make(chan error, 1)
	go func() {
		done <- b.run(context.Background(), "Hold", func(context.Context) error { close(entered); <-release; return nil })
	}()
	<-entered
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	err := b.run(ctx, "Wait", func(context.Context) error { t.Error("admitted past deadline"); return nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("admission error=%v", err)
	}
	releaseOnce()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestAdmissionHasBackendTimeoutWithoutCallerDeadline(t *testing.T) {
	b := newBackend(&fakeLifecycleConn{}, options{maxOpen: 1, timeout: 25 * time.Millisecond})
	defer func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	}()
	b.sem <- struct{}{}
	defer func() { <-b.sem }()
	err := b.run(context.Background(), "Wait", func(context.Context) error { t.Error("admitted after operation timeout"); return nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("backend admission timeout=%v", err)
	}
}
