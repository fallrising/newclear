package group

import (
	"context"
	"errors"
	"fmt"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// ErrOutcomeUnknown means a proposal was appended but leadership changed
// before it applied: it may or may not be committed.
var ErrOutcomeUnknown = errors.New("group command outcome is unknown")

var errPeersUnsupported = errors.New("the groups partition needs a peer transport, which arrives in M7")

// Service owns one Coordinator on a single goroutine and serves it to
// concurrent callers. Until brokers talk to each other (M7) it drives an RF1
// __mkfk_groups partition: every proposal commits and applies locally.
type Service struct {
	coordinator *Coordinator
	node        *raft.Node
	clock       adapters.Clock
	calls       chan func()
	stop        chan struct{}
	stopped     chan struct{}
	readSeq     uint64
}

// NewService elects the RF1 node, which runs the failover rebalance for
// groups recovered from the log, and starts the actor.
func NewService(node *raft.Node, config CoordinatorConfig, clock adapters.Clock) (*Service, error) {
	if clock == nil {
		return nil, errors.New("clock is required")
	}
	if node != nil && node.Snapshot().Quorum != 1 {
		return nil, errPeersUnsupported
	}
	coordinator, err := NewCoordinator(node, config)
	if err != nil {
		return nil, err
	}
	service := &Service{
		coordinator: coordinator, node: node, clock: clock,
		calls: make(chan func()), stop: make(chan struct{}), stopped: make(chan struct{}),
	}
	ready, err := node.Campaign()
	if err != nil {
		return nil, err
	}
	if err := service.settle(coordinator.HandleReady(ready, clock.Now())); err != nil {
		return nil, err
	}
	if !coordinator.Serving() {
		return nil, fmt.Errorf("RF1 coordinator is not serving after election: %+v", node.Snapshot())
	}
	go service.run()
	return service, nil
}

func (s *Service) run() {
	defer close(s.stopped)
	for {
		select {
		case call := <-s.calls:
			call()
		case <-s.stop:
			return
		}
	}
}

// Close stops the actor. The caller owns and closes the underlying log.
func (s *Service) Close() {
	close(s.stop)
	<-s.stopped
}

// do runs call on the actor goroutine.
func (s *Service) do(ctx context.Context, call func()) error {
	done := make(chan struct{})
	select {
	case s.calls <- func() { call(); close(done) }:
	case <-ctx.Done():
		return ctx.Err()
	case <-s.stopped:
		return errors.New("group service is closed")
	}
	<-done
	return nil
}

// CheckTimers expires lapsed sessions and rebalance deadlines at clock.Now().
func (s *Service) CheckTimers(ctx context.Context) error {
	var err error
	if callErr := s.do(ctx, func() {
		err = s.settle(s.coordinator.CheckTimers(s.clock.Now()))
	}); callErr != nil {
		return callErr
	}
	return err
}

// View returns a copy of one group's committed state.
func (s *Service) View(ctx context.Context, groupID string) (View, bool, error) {
	var view View
	var exists bool
	err := s.do(ctx, func() { view, exists = s.coordinator.State().Group(groupID) })
	return view, exists, err
}

func (s *Service) settle(out Output, err error) error {
	if err != nil {
		return err
	}
	if len(out.Messages) > 0 {
		return errPeersUnsupported
	}
	return nil
}

// await settles a proposal; on RF1 its completion is in the same Output.
func (s *Service) await(ticket Ticket, out Output, err error) (Result, error) {
	if err := s.settle(out, err); err != nil {
		return Result{}, err
	}
	for _, completion := range out.Completions {
		if completion.Index != ticket.Index || completion.RequestID != ticket.RequestID {
			continue
		}
		if completion.Unknown {
			return Result{}, ErrOutcomeUnknown
		}
		return completion.Result, completion.Result.Err
	}
	return Result{}, ErrOutcomeUnknown
}

// readBarrier confirms leadership for a linearizable read: the read index
// must be applied on this node before state is read.
func (s *Service) readBarrier() error {
	s.readSeq++
	context := fmt.Sprintf("group-read-%d", s.readSeq)
	ready, err := s.node.RequestRead(context)
	if err != nil {
		return err
	}
	if err := s.settle(s.coordinator.HandleReady(ready, s.clock.Now())); err != nil {
		return err
	}
	for _, read := range ready.ReadStates {
		if read.Context == context && s.node.Snapshot().LastApplied >= read.Index {
			return nil
		}
	}
	return groupError(CodeDependencyFailed, "read barrier %s did not complete", context)
}
