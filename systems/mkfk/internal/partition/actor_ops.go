package partition

import (
	"context"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

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
		if a.storageFailed() {
			a.fail(err)
		}
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
	if a.onRole != nil {
		for _, change := range ready.RoleChanges {
			a.onRole(change)
		}
	}
	return messages, nil
}
