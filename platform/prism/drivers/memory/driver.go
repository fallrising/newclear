// Package memory provides Prism's in-memory reference storage driver.
package memory

import (
	"context"
	"errors"
	"sync"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

const driverName = "memory"

var errBackendClosed = errors.New("memory backend is closed")

type driver struct{}

func init() {
	spi.Register(driverName, driver{})
}

func (driver) Name() string { return driverName }

func (driver) Open(ctx context.Context, _ spi.Config) (spi.Backend, error) {
	if err := contextError(ctx, "Open"); err != nil {
		return nil, err
	}
	return newBackend(), nil
}

type backend struct {
	state   *state
	metrics *metricStore
	logs    *logStore
	traces  *traceStore
}

func newBackend() *backend {
	state := &state{
		metrics: make(map[string]*metricSeries),
		spans:   make(map[spanKey]storedSpan),
	}
	return &backend{
		state:   state,
		metrics: &metricStore{state: state},
		logs:    &logStore{state: state},
		traces:  &traceStore{state: state},
	}
}

func (*backend) Capabilities() spi.Capabilities {
	return spi.Capabilities{
		Driver:           driverName,
		Version:          "1",
		Signals:          []spi.Signal{spi.SignalMetrics, spi.SignalLogs, spi.SignalTraces},
		MultiTenant:      false,
		OutOfOrderWindow: -1,
	}
}

func (b *backend) Metrics() spi.MetricStore { return b.metrics }

func (b *backend) Logs() spi.LogStore { return b.logs }

func (b *backend) Traces() spi.TraceStore { return b.traces }

func (b *backend) Migrate(ctx context.Context) error {
	return b.state.checkAvailable(ctx, "Migrate")
}

func (b *backend) Ping(ctx context.Context) error {
	return b.state.checkAvailable(ctx, "Ping")
}

func (b *backend) Close() error {
	b.state.mu.Lock()
	defer b.state.mu.Unlock()
	if b.state.closed {
		return nil
	}
	b.state.closed = true
	clear(b.state.metrics)
	b.state.logs = nil
	clear(b.state.spans)
	return nil
}

type state struct {
	mu sync.RWMutex

	closed bool

	metrics map[string]*metricSeries
	logs    []storedLog
	spans   map[spanKey]storedSpan
	nextSeq uint64
}

func (s *state) checkAvailable(ctx context.Context, op string) error {
	if err := contextError(ctx, op); err != nil {
		return err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return closedError(op)
	}
	return nil
}

func contextError(ctx context.Context, op string) error {
	if err := ctx.Err(); err != nil {
		return spi.Wrap(spi.ErrTimeout, driverName, op, err)
	}
	return nil
}

func closedError(op string) error {
	return spi.Wrap(spi.ErrUnavailable, driverName, op, errBackendClosed)
}

func badRequestError(op, message string) error {
	return spi.Wrap(spi.ErrBadRequest, driverName, op, errors.New(message))
}
