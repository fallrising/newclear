package group

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

const DefaultRequestTimeout = 5 * time.Second

// ErrOutcomeUnknown means a proposal was appended but leadership changed
// before it applied: it may or may not be committed.
var ErrOutcomeUnknown = errors.New("group command outcome is unknown")

// ProofSource returns a quorum-confirmed high watermark for a data
// partition, obtained from that partition's current leader.
type ProofSource interface {
	HighWatermark(ctx context.Context, topic string, partition uint32) (uint64, error)
}

type ServiceConfig struct {
	Node           *raft.Node
	Coordinator    CoordinatorConfig
	Proofs         ProofSource
	Clock          adapters.Clock
	TickClock      adapters.Clock
	Sender         partition.Sender
	OnRoleChange   func(raft.RoleChange)
	StorageFailed  func() bool
	TickInterval   time.Duration
	RequestTimeout time.Duration
}

// Service runs the __mkfk_groups partition's Coordinator on a partition
// actor and serves it to concurrent callers. Proposals complete when their
// entry applies; reads pass a Raft read barrier first. An RF1 node is
// elected at start; an RF3 node takes part in elections through its ticks.
type Service struct {
	actor       *partition.Actor
	coordinator *Coordinator
	node        *raft.Node
	clock       adapters.Clock
	proofs      ProofSource
	timeout     time.Duration

	// Actor goroutine only.
	waiters map[Ticket]chan Completion
}

func NewService(config ServiceConfig) (*Service, error) {
	if config.Clock == nil || config.Proofs == nil {
		return nil, errors.New("clock and proof source are required")
	}
	if config.RequestTimeout == 0 {
		config.RequestTimeout = DefaultRequestTimeout
	}
	coordinator, err := NewCoordinator(config.Node, config.Coordinator)
	if err != nil {
		return nil, err
	}
	service := &Service{
		coordinator: coordinator, node: config.Node, clock: config.Clock, proofs: config.Proofs,
		timeout: config.RequestTimeout, waiters: make(map[Ticket]chan Completion),
	}
	service.actor, err = partition.New(partition.Config{
		Node: config.Node, Clock: config.Clock, TickClock: config.TickClock, Sender: config.Sender,
		TickInterval: config.TickInterval, OnRoleChange: config.OnRoleChange,
		StorageFailed: config.StorageFailed,
	}, service)
	if err != nil {
		return nil, err
	}
	service.actor.Start()
	if config.Node.Snapshot().Quorum > 1 {
		return service, nil
	}
	if err := service.actor.Campaign(context.Background()); err != nil {
		service.Close()
		return nil, err
	}
	var serving bool
	_ = service.actor.Do(context.Background(), func() error { serving = coordinator.Serving(); return nil })
	if !serving {
		service.Close()
		return nil, fmt.Errorf("RF1 coordinator is not serving after election: %+v", config.Node.Snapshot())
	}
	return service, nil
}

func (s *Service) Actor() *partition.Actor { return s.actor }

// Close stops the actor. The caller owns and closes the underlying log.
func (s *Service) Close() { s.actor.Close() }

// HandleReady implements partition.Handler.
func (s *Service) HandleReady(ready raft.Ready, now time.Time) ([]raft.Message, error) {
	out, err := s.coordinator.HandleReady(ready, now)
	s.dispatch(out.Completions)
	return out.Messages, err
}

// Tick implements partition.Handler: session and rebalance timers run on
// every tick while this node serves.
func (s *Service) Tick(now time.Time) ([]raft.Message, error) {
	out, err := s.coordinator.CheckTimers(now)
	s.dispatch(out.Completions)
	return out.Messages, err
}

// CheckTimers expires lapsed sessions and rebalance deadlines now.
func (s *Service) CheckTimers(ctx context.Context) error {
	return s.actor.Do(ctx, func() error {
		out, err := s.coordinator.CheckTimers(s.clock.Now())
		s.emit(out)
		return err
	})
}

// Serving reports whether this node is the serving coordinator.
func (s *Service) Serving(ctx context.Context) (bool, error) {
	var serving bool
	err := s.actor.Do(ctx, func() error { serving = s.coordinator.Serving(); return nil })
	return serving, err
}

// View returns a copy of one group's committed state.
func (s *Service) View(ctx context.Context, groupID string) (View, bool, error) {
	var view View
	var exists bool
	err := s.actor.Do(ctx, func() error {
		view, exists = s.coordinator.State().Group(groupID)
		return nil
	})
	return view, exists, err
}

// emit sends messages and settles completions produced on the actor.
func (s *Service) emit(out Output) {
	s.actor.Send(out.Messages)
	s.dispatch(out.Completions)
}

func (s *Service) dispatch(completions []Completion) {
	for _, completion := range completions {
		ticket := Ticket{Index: completion.Index, RequestID: completion.RequestID}
		if wait, ok := s.waiters[ticket]; ok {
			delete(s.waiters, ticket)
			wait <- completion
		}
	}
}

type proposeCall func(now time.Time) (Ticket, Output, error)

// propose runs a client proposal and waits until its entry applies. A
// deadline or leadership loss after the append leaves the outcome unknown.
func (s *Service) propose(ctx context.Context, call proposeCall) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	wait := make(chan Completion, 1)
	var ticket Ticket
	err := s.actor.Do(ctx, func() error {
		var out Output
		var err error
		ticket, out, err = call(s.clock.Now())
		if err == nil {
			s.waiters[ticket] = wait
		}
		s.emit(out)
		return err
	})
	if err != nil {
		return Result{}, err
	}
	select {
	case completion := <-wait:
		return outcome(completion)
	case <-s.actor.Done():
		return Result{}, ErrOutcomeUnknown
	case <-ctx.Done():
	}
	_ = s.actor.Do(context.Background(), func() error {
		delete(s.waiters, ticket)
		return nil
	})
	select {
	case completion := <-wait:
		return outcome(completion)
	default:
		return Result{}, ErrOutcomeUnknown
	}
}

func outcome(completion Completion) (Result, error) {
	if completion.Unknown {
		return Result{}, ErrOutcomeUnknown
	}
	return completion.Result, completion.Result.Err
}

// read runs onConfirmed after a Raft read barrier proves this node still
// leads a current-term majority. A deposed coordinator never reads.
func (s *Service) read(ctx context.Context, onConfirmed func() error) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	err := s.actor.Read(ctx, partition.ReadBarrier{
		Begin:     s.node.RequestRead,
		Confirmed: func(string) error { return onConfirmed() },
		Cancel:    s.node.CancelRead,
	})
	switch {
	case errors.Is(err, partition.ErrReadTimeout), errors.Is(err, partition.ErrReadCapacity):
		return groupError(CodeDependencyFailed, "read barrier did not complete: %v", err)
	}
	return err
}

var _ partition.Handler = (*Service)(nil)
