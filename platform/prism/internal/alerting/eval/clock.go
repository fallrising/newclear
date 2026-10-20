package eval

import (
	"context"
	"sync"
	"time"
)

// Clock is the evaluation schedule. Tests use ManualClock.
type Clock interface {
	Now() time.Time
	WaitUntil(ctx context.Context, until time.Time) error
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

func (systemClock) WaitUntil(ctx context.Context, until time.Time) error {
	delay := time.Until(until)
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

type waiter struct {
	until time.Time
	ch    chan struct{}
}

// ManualClock is a test clock. WaitUntil unblocks when Advance reaches the deadline.
type ManualClock struct {
	mu      sync.Mutex
	now     time.Time
	waiters []waiter
}

// NewManualClock starts a clock that does not move until Advance.
func NewManualClock(now time.Time) *ManualClock {
	return &ManualClock{now: now.UTC()}
}

// Now returns the clock's current time.
func (c *ManualClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// Advance moves the clock forward and wakes waiters whose deadline has passed.
func (c *ManualClock) Advance(d time.Duration) {
	if d < 0 {
		return
	}
	c.mu.Lock()
	c.now = c.now.Add(d)
	now := c.now
	remain := c.waiters[:0]
	var wake []chan struct{}
	for _, w := range c.waiters {
		if !now.Before(w.until) {
			wake = append(wake, w.ch)
			continue
		}
		remain = append(remain, w)
	}
	c.waiters = remain
	c.mu.Unlock()
	for _, ch := range wake {
		close(ch)
	}
}

// WaitUntil blocks until Now is at or after until, or ctx is canceled.
func (c *ManualClock) WaitUntil(ctx context.Context, until time.Time) error {
	c.mu.Lock()
	if !c.now.Before(until) {
		c.mu.Unlock()
		return nil
	}
	ch := make(chan struct{})
	c.waiters = append(c.waiters, waiter{until: until, ch: ch})
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-ch:
		return nil
	}
}
