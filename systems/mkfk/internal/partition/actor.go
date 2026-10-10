// Package partition runs one Raft partition as a single-owner actor: every
// Step, Tick, proposal, and read barrier executes on one goroutine, and
// asynchronous results return to waiting callers through channels.
package partition

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

const (
	DefaultInboxSize       = 1024
	DefaultMaxPendingReads = 256
	// StallThreshold is how long one call, step, or tick may hold the actor
	// before it counts as a stall. Ticks and peer steps wait behind it, so a
	// stall near the election timeout can cost leadership.
	StallThreshold = 500 * time.Millisecond
)

var (
	ErrClosed       = errors.New("partition actor is closed")
	ErrBusy         = errors.New("partition actor did not accept the call before its deadline")
	ErrStorage      = errors.New("partition storage failed; the last write's outcome is unknown")
	ErrFailed       = errors.New("partition actor stopped after a storage or apply failure")
	ErrReadTimeout  = errors.New("read barrier did not complete before the deadline")
	ErrReadCapacity = errors.New("pending read barrier capacity is exhausted")
)

// Handler applies one Raft Ready to the partition's state machine and
// returns the messages to send. An error is fatal: the actor stops serving.
type Handler interface {
	HandleReady(ready raft.Ready, now time.Time) ([]raft.Message, error)
	Tick(now time.Time) ([]raft.Message, error)
}

// Sender queues an outbound message. It must not block the actor.
type Sender interface {
	Send(message raft.Message)
}

type Config struct {
	Node  *raft.Node
	Clock adapters.Clock
	// TickClock schedules Tick; it defaults to Clock. A test can pass a clock
	// it never advances to drive Raft and timers only by explicit calls.
	TickClock       adapters.Clock
	Sender          Sender
	TickInterval    time.Duration
	InboxSize       int
	MaxPendingReads int
	// OnRoleChange, when set, observes role changes on the actor goroutine.
	OnRoleChange func(raft.RoleChange)
	// OnStall, when set, observes each call, step, or tick that held the
	// actor for at least StallThreshold, on the actor goroutine.
	OnStall func(kind string, held time.Duration)
	// StorageFailed, when set, reports a quarantined log. The actor then
	// stops serving instead of retrying writes against it.
	StorageFailed func() bool
}

type Actor struct {
	node     *raft.Node
	handler  Handler
	clock    adapters.Clock
	ticks    adapters.Clock
	sender   Sender
	tick     time.Duration
	maxReads int
	onRole   func(raft.RoleChange)
	onStall  func(string, time.Duration)
	storage  func() bool
	calls    chan func()
	inbox    chan raft.Message
	stop     chan struct{}
	done     chan struct{}
	start    sync.Once
	close    sync.Once
	failed   atomic.Bool
	dropped  atomic.Uint64
	rejected atomic.Uint64
	stalls   atomic.Uint64
	stallMax atomic.Int64
	cause    atomic.Value

	// Actor goroutine only.
	readSeq uint64
	reads   map[string]func(error)
}

func New(config Config, handler Handler) (*Actor, error) {
	if config.Node == nil || config.Clock == nil || handler == nil {
		return nil, errors.New("node, clock, and handler are required")
	}
	if config.Sender == nil && config.Node.Snapshot().Quorum > 1 {
		return nil, errors.New("a replicated partition needs a peer sender")
	}
	if config.TickClock == nil {
		config.TickClock = config.Clock
	}
	if config.TickInterval == 0 {
		config.TickInterval = raft.DefaultTickInterval
	}
	if config.InboxSize == 0 {
		config.InboxSize = DefaultInboxSize
	}
	if config.MaxPendingReads == 0 {
		config.MaxPendingReads = DefaultMaxPendingReads
	}
	if config.TickInterval < 0 || config.InboxSize < 0 || config.MaxPendingReads < 0 {
		return nil, errors.New("tick interval, inbox size, and read cap must be positive")
	}
	return &Actor{
		node: config.Node, handler: handler, clock: config.Clock, ticks: config.TickClock, sender: config.Sender,
		tick: config.TickInterval, maxReads: config.MaxPendingReads, onRole: config.OnRoleChange, onStall: config.OnStall, storage: config.StorageFailed,
		calls: make(chan func()), inbox: make(chan raft.Message, config.InboxSize),
		stop: make(chan struct{}), done: make(chan struct{}), reads: make(map[string]func(error)),
	}, nil
}

// Start launches the actor goroutine; later calls do nothing.
func (a *Actor) Start() {
	a.start.Do(func() { go a.run() })
}

// Close stops the actor and waits for it. The caller owns the log.
func (a *Actor) Close() {
	a.Start()
	a.close.Do(func() { close(a.stop) })
	<-a.done
}

// Done is closed once the actor goroutine has exited.
func (a *Actor) Done() <-chan struct{} { return a.done }

// Err returns the storage or apply error that stopped the partition, if any.
func (a *Actor) Err() error {
	if cause, ok := a.cause.Load().(error); ok {
		return cause
	}
	return nil
}

// Dropped counts inbound messages discarded because the inbox was full;
// Rejected counts peer messages the Raft core refused.
func (a *Actor) Dropped() uint64  { return a.dropped.Load() }
func (a *Actor) Rejected() uint64 { return a.rejected.Load() }

func (a *Actor) run() {
	defer close(a.done)
	timer := a.ticks.NewTimer(a.tick)
	defer timer.Stop()
	for {
		select {
		case <-a.stop:
			return
		case call := <-a.calls:
			started := a.clock.Now()
			call()
			a.observeHold("call", started)
		case message := <-a.inbox:
			if !a.failed.Load() {
				started := a.clock.Now()
				a.step(message, nil)
				a.observeHold("step", started)
			}
		case <-timer.C():
			timer.Reset(a.tick)
			started := a.clock.Now()
			a.onTick()
			a.observeHold("tick", started)
		}
	}
}

func (a *Actor) observeHold(kind string, started time.Time) {
	held := a.clock.Now().Sub(started)
	if held < StallThreshold {
		return
	}
	a.stalls.Add(1)
	for {
		current := a.stallMax.Load()
		if int64(held) <= current || a.stallMax.CompareAndSwap(current, int64(held)) {
			break
		}
	}
	if a.onStall != nil {
		a.onStall(kind, held)
	}
}

// Do runs call on the actor goroutine and returns its error.
func (a *Actor) Do(ctx context.Context, call func() error) error {
	result := make(chan error, 1)
	wrapped := func() {
		if a.failed.Load() {
			result <- ErrFailed
			return
		}
		err := call()
		if err != nil && a.storageFailed() {
			a.fail(err)
			err = fmt.Errorf("%w: %v", ErrStorage, err)
		}
		result <- err
	}
	select {
	case a.calls <- wrapped:
		return <-result
	case <-ctx.Done():
		return fmt.Errorf("%w: %v", ErrBusy, ctx.Err())
	case <-a.done:
		return ErrClosed
	}
}

func (a *Actor) storageFailed() bool {
	return a.storage != nil && a.storage()
}

func (a *Actor) fail(err error) {
	if a.failed.Swap(true) {
		return
	}
	a.cause.Store(err)
	for readContext, resolve := range a.reads {
		delete(a.reads, readContext)
		resolve(ErrFailed)
	}
}
