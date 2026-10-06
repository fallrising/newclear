package client

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/group"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

// processed records every Process call as "<member>:<partition>@<offset>".
type processed struct{ calls []string }

func (p *processed) by(member string) func(context.Context, Message) error {
	return func(_ context.Context, message Message) error {
		p.calls = append(p.calls, fmt.Sprintf("%s:%d@%d", member, message.Partition, message.Offset))
		return nil
	}
}

func newTestConsumer(t *testing.T, transport GroupTransport, member string, process func(context.Context, Message) error) *GroupConsumer {
	t.Helper()
	sequence := 0
	consumer, err := NewGroupConsumer(ConsumerConfig{
		GroupID: "billing", MemberID: member, Topics: []string{"events"}, Transport: transport, Process: process,
		RequestIDs: func() (string, error) { sequence++; return fmt.Sprintf("%s-%d", member, sequence), nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	return consumer
}

// stabilize polls consumers that are not yet STABLE in the group's current
// generation, so a stable consumer never processes records here.
func stabilize(t *testing.T, broker *m6Broker, consumers ...*GroupConsumer) {
	t.Helper()
	for round := 0; round < 20; round++ {
		done := true
		for _, consumer := range consumers {
			view := broker.view("billing")
			if consumer.stable && consumer.Generation() == view.Generation && view.Phase == "STABLE" {
				continue
			}
			done = false
			if err := consumer.Poll(context.Background()); err != nil {
				t.Fatalf("round %d poll: %v", round, err)
			}
		}
		if done {
			return
		}
	}
	t.Fatal("consumers did not reach the group's STABLE generation")
}

func committedOffsets(t *testing.T, broker *m6Broker) map[uint32]*uint64 {
	t.Helper()
	partitions := []protocol.TopicPartition{{Topic: "events", Partition: 0}, {Topic: "events", Partition: 1}, {Topic: "events", Partition: 2}}
	data, err := broker.transport().CommittedOffsets(context.Background(), "read-offsets", "billing", partitions)
	if err != nil {
		t.Fatal(err)
	}
	result := map[uint32]*uint64{}
	for _, entry := range data.Offsets {
		if entry.Offset != nil {
			value := uint64(*entry.Offset)
			result[entry.Partition] = &value
		}
	}
	return result
}

func TestM6CG04SDKStopsStaleGenerationAndNeverCommitsItsWork(t *testing.T) {
	t.Parallel()
	broker := newM6Broker(t)
	broker.produce(0, "a", "b")
	log := &processed{}
	joiner := newTestConsumer(t, broker.transport(), "m2", log.by("m2"))
	var stale *GroupConsumer
	// While m1 processes, m2 joins: m1's commit then names an old generation.
	stale = newTestConsumer(t, broker.transport(), "m1", func(ctx context.Context, message Message) error {
		if err := log.by("m1")(ctx, message); err != nil {
			return err
		}
		if message.Offset == 1 {
			return joiner.Poll(ctx)
		}
		return nil
	})
	stabilize(t, broker, stale)
	if err := stale.Poll(context.Background()); !errors.Is(err, ErrStaleGeneration) {
		t.Fatalf("stale commit error = %v, want ErrStaleGeneration", err)
	}
	if got := committedOffsets(t, broker)[0]; got != nil {
		t.Fatalf("stale generation committed offset %d", *got)
	}
	stabilize(t, broker, stale, joiner)
	for _, consumer := range []*GroupConsumer{stale, joiner} {
		if err := consumer.Poll(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if got := committedOffsets(t, broker)[0]; got == nil || *got != 2 {
		t.Fatalf("events/0 committed = %v, want 2 after the new owner reprocessed", got)
	}
	if len(log.calls) != 4 {
		t.Fatalf("process calls = %v, want offsets 0 and 1 twice (stale then new generation)", log.calls)
	}
}

// dropFirstCommitReply delivers the first CommitOffsets but loses its reply.
type dropFirstCommitReply struct {
	GroupTransport
	dropped bool
	sent    []string
}

func (d *dropFirstCommitReply) CommitOffsets(ctx context.Context, id, g string, r protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	d.sent = append(d.sent, r.RequestID)
	data, err := d.GroupTransport.CommitOffsets(ctx, id, g, r)
	if !d.dropped {
		d.dropped = true
		return protocol.CommitOffsetsResponseData{}, errors.New("connection reset after send")
	}
	return data, err
}

func TestM6SDKRetriesUnknownCommitWithTheSameRequest(t *testing.T) {
	t.Parallel()
	broker := newM6Broker(t)
	broker.produce(1, "x")
	lossy := &dropFirstCommitReply{GroupTransport: broker.transport()}
	log := &processed{}
	consumer := newTestConsumer(t, lossy, "m1", log.by("m1"))
	stabilize(t, broker, consumer)
	if err := consumer.Poll(context.Background()); err == nil {
		t.Fatal("lost commit reply was reported as success")
	}
	if err := consumer.Poll(context.Background()); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if len(lossy.sent) != 2 || lossy.sent[0] != lossy.sent[1] {
		t.Fatalf("commit request IDs = %v, want one identical retry", lossy.sent)
	}
	if got := committedOffsets(t, broker)[1]; got == nil || *got != 1 || len(log.calls) != 1 {
		t.Fatalf("committed=%v processed=%v", got, log.calls)
	}
}

func TestM6CG05CG06RealWALRestartKeepsOffsetsAndFencesOldSessions(t *testing.T) {
	t.Parallel()
	broker := newM6Broker(t)
	for partition := uint32(0); partition < m6Partitions; partition++ {
		broker.produce(partition, "r0", "r1", "r2")
	}
	log := &processed{}
	consumer := newTestConsumer(t, broker.transport(), "m1", log.by("m1"))
	stabilize(t, broker, consumer)
	if err := consumer.Poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	before := broker.view("billing").Generation
	broker.restart()
	after := broker.view("billing")
	if after.Generation != before+1 || after.Phase != "PREPARING" {
		t.Fatalf("after restart group = %+v, want PREPARING generation %d", after, before+1)
	}
	for partition, offset := range committedOffsets(t, broker) {
		if offset == nil || *offset != 3 {
			t.Fatalf("events/%d committed = %v after restart, want 3", partition, offset)
		}
	}
	_, err := broker.transport().CommitOffsets(context.Background(), "old-session", "billing", protocol.CommitOffsetsRequest{
		MemberID: "m1", Generation: protocol.DecimalUint64(before), RequestID: "old-session",
		Offsets: []protocol.OffsetCommit{{Topic: "events", Partition: 0, Offset: 3}},
	})
	if apiCode(err) != "ILLEGAL_GENERATION" {
		t.Fatalf("old-session commit after restart = %v, want ILLEGAL_GENERATION", err)
	}
	stabilize(t, broker, consumer)
	if consumer.Generation() <= before {
		t.Fatalf("generation %d reused after restart (before %d)", consumer.Generation(), before)
	}
	if err := consumer.Poll(context.Background()); err != nil || len(log.calls) != 9 {
		t.Fatalf("resume after restart: err=%v processed=%v", err, log.calls)
	}
}

func TestM6CG03SDKRejoinsAfterItsSessionExpired(t *testing.T) {
	t.Parallel()
	broker := newM6Broker(t)
	log := &processed{}
	consumer := newTestConsumer(t, broker.transport(), "m1", log.by("m1"))
	stabilize(t, broker, consumer)
	broker.clock.Advance(group.DefaultSessionTimeout + time.Second)
	broker.checkTimers()
	if view := broker.view("billing"); len(view.Members) != 0 {
		t.Fatalf("expired member still in group: %+v", view)
	}
	if err := consumer.Poll(context.Background()); !errors.Is(err, ErrStaleGeneration) {
		t.Fatalf("poll after expiry = %v, want ErrStaleGeneration", err)
	}
	broker.produce(2, "after-rejoin")
	stabilize(t, broker, consumer)
	if err := consumer.Poll(context.Background()); err != nil || len(log.calls) != 1 || log.calls[0] != "m1:2@0" {
		t.Fatalf("after rejoin: err=%v processed=%v", err, log.calls)
	}
}

func TestM6SDKDropsUnknownCommitFromAFencedGeneration(t *testing.T) {
	t.Parallel()
	broker := newM6Broker(t)
	broker.produce(0, "a")
	lossy := &dropFirstCommitReply{GroupTransport: broker.transport()}
	consumer := newTestConsumer(t, lossy, "m1", (&processed{}).by("m1"))
	stabilize(t, broker, consumer)
	if err := consumer.Poll(context.Background()); err == nil {
		t.Fatal("lost commit reply was reported as success")
	}
	broker.clock.Advance(group.DefaultSessionTimeout + time.Second)
	broker.checkTimers()
	if err := consumer.Poll(context.Background()); !errors.Is(err, ErrStaleGeneration) {
		t.Fatalf("poll after expiry = %v, want ErrStaleGeneration", err)
	}
	stabilize(t, broker, consumer)
	if err := consumer.Poll(context.Background()); err != nil || len(lossy.sent) != 1 {
		t.Fatalf("first poll of the new generation: err=%v commits=%v", err, lossy.sent)
	}
	if got := committedOffsets(t, broker)[0]; got == nil || *got != 1 {
		t.Fatalf("events/0 committed = %v, want the lost-reply commit to have applied", got)
	}
}
