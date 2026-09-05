// Package deltaconv implements the bounded, stateful OTLP
// delta-to-cumulative conversion exception to otherwise pure normalization.
package deltaconv

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultTTL           = 5 * time.Minute
	defaultSweepInterval = 30 * time.Second
	defaultMaxSeries     = 100_000
)

// Status reports how a delta point affected converter state.
type Status uint8

const (
	// Baseline means the point established a baseline and was not emitted.
	Baseline Status = iota
	// Converted means the point was added to an existing cumulative value.
	Converted
	// Capacity means a new series was refused at the configured state cap.
	Capacity
)

// Options configures the bounded delta-to-cumulative state machine.
type Options struct {
	TTL           time.Duration
	SweepInterval time.Duration
	MaxSeries     int
	Now           func() time.Time
}

func (o Options) withDefaults() Options {
	if o.TTL <= 0 {
		o.TTL = defaultTTL
	}
	if o.SweepInterval <= 0 {
		o.SweepInterval = defaultSweepInterval
	}
	if o.MaxSeries <= 0 {
		o.MaxSeries = defaultMaxSeries
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return o
}

type state struct {
	mu         sync.Mutex
	cumulative float64
	updated    time.Time
}

// Converter converts scalar delta points to cumulative points. The first
// point of a series establishes a baseline and is intentionally not emitted.
type Converter struct {
	states   sync.Map
	createMu sync.Mutex
	count    atomic.Int64
	option   Options
	close    func()
	done     chan struct{}
}

// New starts a context-bound cleanup loop. Close must be called.
func New(parent context.Context, options Options) *Converter {
	options = options.withDefaults()
	ctx, cancel := context.WithCancel(parent)
	converter := &Converter{
		option: options,
		done:   make(chan struct{}),
	}
	converter.close = sync.OnceFunc(func() {
		cancel()
		<-converter.done
	})
	go converter.run(ctx)
	return converter
}

// Close stops the cleanup loop. It is safe to call more than once.
func (c *Converter) Close() {
	if c != nil {
		c.close()
	}
}

// Convert adds delta to a series. A Baseline or Capacity result must be
// dropped by the caller.
func (c *Converter) Convert(key string, delta float64) (float64, Status) {
	now := c.option.Now()
	for {
		if existing, found := c.states.Load(key); found {
			entry := existing.(*state)
			entry.mu.Lock()
			current, stillStored := c.states.Load(key)
			if !stillStored || current != existing {
				entry.mu.Unlock()
				continue
			}
			if now.Sub(entry.updated) > c.option.TTL {
				entry.cumulative = delta
				entry.updated = now
				entry.mu.Unlock()
				return 0, Baseline
			}
			entry.cumulative += delta
			entry.updated = now
			value := entry.cumulative
			entry.mu.Unlock()
			return value, Converted
		}

		c.createMu.Lock()
		if _, found := c.states.Load(key); found {
			c.createMu.Unlock()
			continue
		}
		if c.count.Load() >= int64(c.option.MaxSeries) {
			c.createMu.Unlock()
			return 0, Capacity
		}
		c.states.Store(key, &state{cumulative: delta, updated: now})
		c.count.Add(1)
		c.createMu.Unlock()
		return 0, Baseline
	}
}

// Len returns the current number of tracked series.
func (c *Converter) Len() int { return int(c.count.Load()) }

// Sweep removes state that has been idle longer than the configured TTL and
// returns the number of removed series.
func (c *Converter) Sweep() int {
	now := c.option.Now()
	removed := 0
	c.states.Range(func(key, value any) bool {
		entry := value.(*state)
		entry.mu.Lock()
		expired := now.Sub(entry.updated) > c.option.TTL
		if expired && c.states.CompareAndDelete(key, value) {
			c.count.Add(-1)
			removed++
		}
		entry.mu.Unlock()
		return true
	})
	return removed
}

func (c *Converter) run(ctx context.Context) {
	defer close(c.done)
	ticker := time.NewTicker(c.option.SweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.Sweep()
		}
	}
}
