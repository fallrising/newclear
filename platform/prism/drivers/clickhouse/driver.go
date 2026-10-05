// Package clickhouse provides Prism's native ClickHouse write backend.
package clickhouse

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

type driver struct{}

func init()                 { spi.Register(driverName, driver{}) }
func (driver) Name() string { return driverName }

func (driver) Open(ctx context.Context, cfg spi.Config) (spi.Backend, error) {
	if err := ctx.Err(); err != nil {
		return nil, classifiedError("Open", err)
	}
	opts, err := parseOptions(ctx, cfg)
	if err != nil {
		return nil, err
	}
	conn, err := clickhouse.Open(opts.native)
	if err != nil {
		return nil, classifiedError("Open", err)
	}
	openCtx, cancel := context.WithTimeout(ctx, opts.timeout)
	defer cancel()
	if err := conn.Ping(openCtx); err != nil {
		_ = conn.Close()
		if openCtx.Err() != nil {
			return nil, classifiedError("Open", openCtx.Err())
		}
		return nil, classifiedError("Open", err)
	}
	if err := ctx.Err(); err != nil {
		_ = conn.Close()
		return nil, classifiedError("Open", err)
	}
	return newBackend(boundedNativeConnection{connection: conn, maxExec: opts.maxExec}, opts), nil
}

// Native PrepareBatch strips trailing settings when INSERT names columns. Every
// writer INSERT is fixed, so omit its column list and verify the server's block.
type boundedNativeConnection struct {
	connection
	maxExec int
}

func (c boundedNativeConnection) PrepareBatch(ctx context.Context, query string, opts ...chdriver.PrepareBatchOption) (chdriver.Batch, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c.maxExec <= 0 {
		return nil, errWriteSchema
	}
	var table string
	switch query {
	case "INSERT INTO logs (ts,observed_ts,tenant,cluster,host,service,env,severity,severity_text,body,trace_id,span_id,labels,attrs,res_attrs,service_instance,service_version,namespace)":
		table = "logs"
	case "INSERT INTO spans (ts,tenant,trace_id,span_id,parent_id,service,name,kind,duration_ns,status_code,status_msg,host,env,attrs,res_attrs,trace_state,service_instance,service_version,namespace,cluster,events.ts,events.name,events.attrs,links.trace_id,links.span_id,links.attrs)":
		table = "spans"
	case "INSERT INTO metric_series (fingerprint,tenant,metric,labels,first_seen,last_seen)":
		table = "metric_series"
	case "INSERT INTO metric_samples (ts,fingerprint,tenant,metric,value)":
		table = "metric_samples"
	case "INSERT INTO service_deps_1h (hour,tenant,parent,child,calls,errors)":
		table = "service_deps_1h"
	case "INSERT INTO pending_links (ts,tenant,trace_id,parent_span_id,child_service,is_error)":
		table = "pending_links"
	default:
		return nil, errWriteSchema
	}
	_, columns, _ := strings.Cut(query, " (")
	want := strings.Split(strings.TrimSuffix(columns, ")"), ",")
	batch, err := c.connection.PrepareBatch(ctx, fmt.Sprintf("INSERT INTO %s SETTINGS max_execution_time = %d", table, c.maxExec), opts...)
	if err != nil {
		return nil, err
	}
	actual := batch.Columns()
	if len(actual) != len(want) {
		_ = batch.Close()
		return nil, errWriteSchema
	}
	for i, column := range actual {
		if column == nil || column.Name() != want[i] {
			_ = batch.Close()
			return nil, errWriteSchema
		}
	}
	return batch, nil
}

type backend struct {
	conn       connection
	opts       options
	metrics    spi.MetricStore
	logs       spi.LogStore
	traces     spi.TraceStore
	mu         sync.Mutex
	closed     bool
	wg         sync.WaitGroup
	cancel     context.CancelFunc
	closing    context.Context
	sem        chan struct{}
	migrateSem chan struct{}
	closeOnce  sync.Once
	closeErr   error
}

func newBackend(conn connection, opts options) *backend {
	closing, cancel := context.WithCancel(context.Background())
	limit := opts.maxOpen
	if limit <= 0 {
		limit = 1
	}
	b := &backend{conn: conn, opts: opts, closing: closing, cancel: cancel, sem: make(chan struct{}, limit), migrateSem: make(chan struct{}, 1)}
	b.metrics = newMetricStore(b)
	b.logs = newLogStore(b)
	b.traces = newTraceStore(b)
	return b
}

func (b *backend) connection() connection { return b.conn }
func (b *backend) retentionDays(signal spi.Signal) int {
	switch signal {
	case spi.SignalMetrics:
		return b.opts.metricDays
	case spi.SignalLogs:
		return b.opts.logDays
	case spi.SignalTraces:
		return max(b.opts.traceDays, b.opts.redDays, 1)
	default:
		return 0
	}
}
func (b *backend) Metrics() spi.MetricStore { return b.metrics }
func (b *backend) Logs() spi.LogStore       { return b.logs }
func (b *backend) Traces() spi.TraceStore   { return b.traces }
func (b *backend) Capabilities() spi.Capabilities {
	return spi.Capabilities{Driver: driverName, Version: "1", Signals: []spi.Signal{spi.SignalMetrics, spi.SignalLogs, spi.SignalTraces}, OutOfOrderWindow: -1,
		Retention: spi.RetentionCaps{PerSignal: true, Enforced: false}}
}

func (b *backend) run(ctx context.Context, op string, fn func(context.Context) error) error {
	if err := ctx.Err(); err != nil {
		return classifiedError(op, err)
	}
	timeout := b.opts.timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	opCtx, cancel := context.WithTimeout(ctx, timeout)
	stop := context.AfterFunc(b.closing, cancel) //nolint:contextcheck // backend lifetime is independent of the caller
	defer func() { stop(); cancel() }()
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return closedError(op)
	}
	b.wg.Add(1)
	b.mu.Unlock()
	defer b.wg.Done()
	select {
	case b.sem <- struct{}{}:
		defer func() { <-b.sem }()
	case <-opCtx.Done():
		return classifiedError(op, opCtx.Err())
	case <-b.closing.Done():
		return closedError(op)
	}
	if err := opCtx.Err(); err != nil {
		return classifiedError(op, err)
	}
	err := fn(opCtx)
	if err == nil && b.closing.Err() != nil {
		return closedError(op)
	}
	if ctxErr := opCtx.Err(); ctxErr != nil {
		return classifiedError(op, ctxErr)
	}
	if deadline, ok := opCtx.Deadline(); ok && !time.Now().Before(deadline) {
		return classifiedError(op, context.DeadlineExceeded)
	}
	if err != nil {
		return classifiedError(op, err)
	}
	return nil
}

func (b *backend) Ping(ctx context.Context) error {
	return b.run(ctx, "Ping", func(ctx context.Context) error { return b.conn.Ping(ctx) })
}

func (b *backend) Close() error {
	b.closeOnce.Do(func() {
		b.mu.Lock()
		b.closed = true
		b.cancel()
		b.mu.Unlock()
		b.wg.Wait()
		b.closeErr = classifiedError("Close", b.conn.Close())
	})
	return b.closeErr
}
