// Package partition runs one Raft partition as a single-owner actor: every
// Step, Tick, proposal, and read barrier executes on one goroutine, and
// asynchronous results return to waiting callers through channels.
package partition

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

const (
	DefaultInboxSize       = 1024
	DefaultMaxPendingReads = 256
)

var (
	ErrClosed       = errors.New("partition actor is closed")
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
}

type Actor struct {
	node     *raft.Node
	handler  Handler
	clock    adapters.Clock
	ticks    adapters.Clock
	sender   Sender
	tick     time.Duration
	maxReads int
	calls    chan func()
	inbox    chan raft.Message
	stop     chan struct{}
	done     chan struct{}
	start    sync.Once
	close    sync.Once
	failed   atomic.Bool
	dropped  atomic.Uint64
	rejected atomic.Uint64
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
		tick: config.TickInterval, maxReads: config.MaxPendingReads,
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
			call()
		case message := <-a.inbox:
			if !a.failed.Load() {
				a.step(message, nil)
			}
		case <-timer.C():
			timer.Reset(a.tick)
			a.onTick()
		}
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
		result <- call()
	}
	select {
	case a.calls <- wrapped:
		return <-result
	case <-ctx.Done():
		return ctx.Err()
	case <-a.done:
		return ErrClosed
	}
}

// Snapshot returns the Raft node's state.
func (a *Actor) Snapshot(ctx context.Context) (raft.Snapshot, error) {
	var snapshot raft.Snapshot
	err := a.Do(ctx, func() error {
		snapshot = a.node.Snapshot()
		return nil
	})
	return snapshot, err
}

// Campaign starts an election now instead of waiting for a timeout.
func (a *Actor) Campaign(ctx context.Context) error {
	return a.Do(ctx, func() error { return a.Process(a.node.Campaign()) })
}

// Process hands a Ready produced on the actor goroutine to the handler and
// sends its messages. err is the error of the call that made the Ready.
func (a *Actor) Process(ready raft.Ready, err error) error {
	if err != nil {
		return err
	}
	messages, err := a.handle(ready)
	a.Send(messages)
	return err
}

// Send queues messages produced on the actor goroutine.
func (a *Actor) Send(messages []raft.Message) {
	if a.sender == nil {
		return
	}
	for _, message := range messages {
		a.sender.Send(message)
	}
}

// Deliver queues an inbound message without waiting; a full inbox drops it,
// which Raft treats like any other lost message.
func (a *Actor) Deliver(message raft.Message) bool {
	select {
	case a.inbox <- message:
		return true
	default:
		a.dropped.Add(1)
		return false
	}
}

// Step applies a peer request and returns the responses addressed back to
// its sender, so a request/response transport can carry them in its reply.
func (a *Actor) Step(ctx context.Context, request raft.Message) ([]raft.Message, error) {
	var replies []raft.Message
	err := a.Do(ctx, func() error {
		var err error
		replies, err = a.step(request, func(message raft.Message) bool {
			return message.To == request.From && message.RPCID == request.RPCID
		})
		return err
	})
	return replies, err
}

func (a *Actor) step(message raft.Message, isReply func(raft.Message) bool) ([]raft.Message, error) {
	ready, err := a.node.Step(message)
	if err != nil {
		a.rejected.Add(1)
		return nil, err
	}
	messages, err := a.handle(ready)
	var replies []raft.Message
	for _, outbound := range messages {
		if isReply != nil && isReply(outbound) {
			replies = append(replies, outbound)
			continue
		}
		a.Send([]raft.Message{outbound})
	}
	return replies, err
}

func (a *Actor) onTick() {
	if a.failed.Load() {
		return
	}
	if err := a.Process(a.node.Tick()); err != nil {
		a.fail(err)
		return
	}
	messages, err := a.handler.Tick(a.clock.Now())
	a.Send(messages)
	if err != nil {
		a.fail(err)
	}
}

func (a *Actor) handle(ready raft.Ready) ([]raft.Message, error) {
	messages, err := a.handler.HandleReady(ready, a.clock.Now())
	if err != nil {
		a.fail(err)
		return messages, err
	}
	a.resolveReads(ready)
	return messages, nil
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
