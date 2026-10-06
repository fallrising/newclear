package clickhouse

import (
	"context"
	"errors"
	"sync"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// readLease owns an admission token and native rows until EOF, error, Close,
// cancellation, or backend shutdown. Its mutex serializes Next and Close.
type readLease struct {
	b          *backend
	op         string
	ctx        context.Context
	cancel     context.CancelFunc
	stop       func() bool
	cancelStop func() bool
	cancelDone chan struct{}
	rows       chdriver.Rows
	budget     queryBudget
	mu         sync.Mutex
	done       bool
	admitted   bool
	err        error
}

func (b *backend) queryRows(ctx context.Context, op, sql string, args ...any) (*readLease, error) {
	if err := ctx.Err(); err != nil {
		return nil, classifiedError(op, err)
	}
	timeout := b.opts.timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	opCtx, cancel := context.WithTimeout(ctx, timeout)
	stop := context.AfterFunc(b.closing, cancel) //nolint:contextcheck // backend lifetime is independent of caller
	l := &readLease{b: b, op: op, ctx: opCtx, cancel: cancel, stop: stop,
		budget: queryBudget{maxRows: b.opts.maxRowsRead, maxBytes: b.opts.maxResultBytes}}
	if l.budget.maxRows <= 0 {
		l.budget.maxRows = 5_000_000
	}
	if b.opts.maxResultRows > 0 {
		l.budget.maxRows = min(l.budget.maxRows, b.opts.maxResultRows)
	}
	if l.budget.maxBytes <= 0 {
		l.budget.maxBytes = 64 << 20
	}
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		stop()
		cancel()
		return nil, closedError(op)
	}
	b.wg.Add(1)
	b.mu.Unlock()
	select {
	case b.sem <- struct{}{}:
		l.admitted = true
	case <-opCtx.Done():
		l.finish(classifiedError(op, opCtx.Err()))
		return nil, l.err
	case <-b.closing.Done():
		l.finish(closedError(op))
		return nil, l.err
	}
	if err := opCtx.Err(); err != nil {
		l.finish(classifiedError(op, err))
		return nil, l.err
	}
	rows, err := b.conn.Query(opCtx, sql, args...)
	if err != nil {
		l.finish(l.classify(err))
		return nil, l.err
	}
	l.rows = rows
	l.mu.Lock()
	l.cancelDone = make(chan struct{})
	b.wg.Add(1) // callback completion is included in backend drain
	l.cancelStop = context.AfterFunc(opCtx, func() {
		defer b.wg.Done()
		defer close(l.cancelDone)
		_ = l.closeNoWait()
	})
	b.mu.Lock()
	if b.closed || l.done {
		b.mu.Unlock()
		l.finish(closedError(op))
		l.mu.Unlock()
		return nil, l.err
	}
	b.leases[l] = struct{}{}
	b.mu.Unlock()
	l.mu.Unlock()
	return l, nil
}

func (l *readLease) classify(err error) error {
	if err == nil {
		return nil
	}
	if l.b.closing.Err() != nil {
		return closedError(l.op)
	}
	if cause := l.ctx.Err(); cause != nil {
		return classifiedError(l.op, cause)
	}
	return classifiedError(l.op, err)
}

// finish is called with l.mu held, or before the lease is published.
func (l *readLease) finish(err error) {
	if l.done {
		return
	}
	l.done = true
	if l.rows != nil {
		err = errors.Join(err, l.classify(l.rows.Close()))
	}
	l.err = err
	if l.cancelStop != nil && l.cancelStop() {
		close(l.cancelDone)
		l.b.wg.Done()
	}
	l.stop()
	l.cancel()
	l.b.mu.Lock()
	delete(l.b.leases, l)
	l.b.mu.Unlock()
	// Only an admitted lease owns a semaphore token. Pre-admission failures
	// are handled by the caller's select path before constructing this release.
	if l.admitted {
		<-l.b.sem
	}
	l.b.wg.Done()
}

func (l *readLease) Next(scan func(chdriver.Rows) (int, error)) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.done {
		return false
	}
	if err := l.ctx.Err(); err != nil {
		l.finish(l.classify(err))
		return false
	}
	if !l.rows.Next() {
		l.finish(l.classify(l.rows.Err()))
		return false
	}
	size, err := scan(l.rows)
	if err == nil {
		err = l.budget.add(size)
	}
	if err == nil && l.ctx.Err() != nil {
		err = l.classify(l.ctx.Err())
	}
	if err != nil {
		l.finish(l.classify(err))
		return false
	}
	return true
}

func (l *readLease) Err() error { l.mu.Lock(); defer l.mu.Unlock(); return l.err }

func (l *readLease) Close() error {
	err := l.closeNoWait()
	if l.cancelDone != nil {
		<-l.cancelDone
	}
	return err
}

func (l *readLease) closeNoWait() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	var reason error
	if l.b.closing.Err() != nil {
		reason = closedError(l.op)
	} else if err := l.ctx.Err(); err != nil {
		reason = classifiedError(l.op, err)
	}
	l.finish(reason)
	return l.err
}

func tooLarge(op string) error {
	return spi.Wrap(spi.ErrTooLarge, driverName, op, errors.New("query result exceeds limit"))
}
