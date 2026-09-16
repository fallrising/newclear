// Package testkit supplies deterministic clocks, random streams, transports,
// and event history for safety tests.
package testkit

import (
	"sync"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

type ManualClock struct {
	mu     sync.Mutex
	now    time.Time
	timers map[*manualTimer]struct{}
}

func NewManualClock(now time.Time) *ManualClock {
	return &ManualClock{now: now, timers: make(map[*manualTimer]struct{})}
}

func (clock *ManualClock) Now() time.Time {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	return clock.now
}

func (clock *ManualClock) NewTimer(duration time.Duration) adapters.Timer {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	timer := &manualTimer{
		clock:    clock,
		channel:  make(chan time.Time, 1),
		deadline: clock.now.Add(duration),
		active:   true,
	}
	clock.timers[timer] = struct{}{}
	return timer
}

func (clock *ManualClock) Advance(duration time.Duration) {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	clock.now = clock.now.Add(duration)
	for timer := range clock.timers {
		if !timer.active || timer.deadline.After(clock.now) {
			continue
		}
		timer.active = false
		select {
		case timer.channel <- clock.now:
		default:
		}
	}
}

type manualTimer struct {
	clock    *ManualClock
	channel  chan time.Time
	deadline time.Time
	active   bool
}

func (timer *manualTimer) C() <-chan time.Time {
	return timer.channel
}

func (timer *manualTimer) Stop() bool {
	timer.clock.mu.Lock()
	defer timer.clock.mu.Unlock()
	wasActive := timer.active
	timer.active = false
	return wasActive
}

func (timer *manualTimer) Reset(duration time.Duration) bool {
	timer.clock.mu.Lock()
	defer timer.clock.mu.Unlock()
	wasActive := timer.active
	select {
	case <-timer.channel:
	default:
	}
	timer.deadline = timer.clock.now.Add(duration)
	timer.active = true
	return wasActive
}
