package client

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

// crashBeforeCommit, once armed, models a process killed after Process
// returned but before its CommitOffsets left the host.
type crashBeforeCommit struct {
	GroupTransport
	armed bool
}

func (c *crashBeforeCommit) CommitOffsets(ctx context.Context, id, g string, r protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	if c.armed {
		return protocol.CommitOffsetsResponseData{}, errInjectedCrash
	}
	return c.GroupTransport.CommitOffsets(ctx, id, g, r)
}

func assignmentOf(consumer *GroupConsumer) []uint32 {
	var partitions []uint32
	for _, partition := range consumer.Assignment() {
		partitions = append(partitions, partition.Partition)
	}
	return partitions
}

func expectAssignments(t *testing.T, broker *m6Broker, step string, want map[string][]uint32, consumers map[string]*GroupConsumer) {
	t.Helper()
	got := map[string][]uint32{}
	for member, consumer := range consumers {
		got[member] = assignmentOf(consumer)
	}
	view := broker.view("billing")
	t.Logf("%s: generation=%d phase=%s assignment=%v", step, view.Generation, view.Phase, got)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s: assignment = %v, want %v", step, got, want)
	}
}

func pollAll(t *testing.T, consumers ...*GroupConsumer) {
	t.Helper()
	for _, consumer := range consumers {
		if err := consumer.Poll(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func produceAll(broker *m6Broker, values ...string) {
	for partition := uint32(0); partition < m6Partitions; partition++ {
		broker.produce(partition, values...)
	}
}

// TestM6DemoRebalanceCrashAndCoordinatorRestart is the M6 demo: 3 partitions,
// 2 members then a 3rd, a member killed between process and commit, and a
// coordinator restart. It shows the at-least-once reprocessing it causes.
func TestM6DemoRebalanceCrashAndCoordinatorRestart(t *testing.T) {
	t.Parallel()
	broker := newM6Broker(t)
	log := &processed{}
	produceAll(broker, "v0", "v1")
	c1Transport := &crashBeforeCommit{GroupTransport: broker.transport()}
	c1 := newTestConsumer(t, c1Transport, "c1", log.by("c1"))
	c2 := newTestConsumer(t, broker.transport(), "c2", log.by("c2"))
	stabilize(t, broker, c1, c2)
	expectAssignments(t, broker, "two members", map[string][]uint32{"c1": {0, 2}, "c2": {1}}, map[string]*GroupConsumer{"c1": c1, "c2": c2})
	pollAll(t, c1, c2)
	generations := []uint64{c1.Generation()}

	c3 := newTestConsumer(t, broker.transport(), "c3", log.by("c3"))
	stabilize(t, broker, c1, c2, c3)
	expectAssignments(t, broker, "third member joined", map[string][]uint32{"c1": {0}, "c2": {1}, "c3": {2}},
		map[string]*GroupConsumer{"c1": c1, "c2": c2, "c3": c3})
	generations = append(generations, c3.Generation())

	produceAll(broker, "v2", "v3")
	c1Transport.armed = true
	if err := c1.Poll(context.Background()); !errors.Is(err, errInjectedCrash) {
		t.Fatalf("c1 crash = %v", err)
	}
	t.Logf("c1 processed events/0 offsets 2..3 and was killed before committing")

	broker.clock.Advance(6 * time.Second)
	pollAll(t, c2, c3)
	broker.checkTimers()
	stabilize(t, broker, c2, c3)
	expectAssignments(t, broker, "c1 session expired", map[string][]uint32{"c2": {0, 2}, "c3": {1}}, map[string]*GroupConsumer{"c2": c2, "c3": c3})
	generations = append(generations, c2.Generation())
	pollAll(t, c2, c3)

	broker.restart()
	t.Logf("coordinator killed and recovered from its WAL")
	produceAll(broker, "v4")
	stabilize(t, broker, c2, c3)
	expectAssignments(t, broker, "after coordinator restart", map[string][]uint32{"c2": {0, 2}, "c3": {1}}, map[string]*GroupConsumer{"c2": c2, "c3": c3})
	generations = append(generations, c2.Generation())
	pollAll(t, c2, c3)

	for i := 1; i < len(generations); i++ {
		if generations[i] <= generations[i-1] {
			t.Fatalf("generations %v are not strictly increasing", generations)
		}
	}
	seen := map[string]int{}
	for _, call := range log.calls {
		seen[call[strings.Index(call, ":")+1:]]++
	}
	for partition := 0; partition < m6Partitions; partition++ {
		for offset := 0; offset < 5; offset++ {
			key := fmt.Sprintf("%d@%d", partition, offset)
			want := 1
			if key == "0@2" || key == "0@3" {
				want = 2 // processed by c1 before its crash, then again by c2
			}
			if seen[key] != want {
				t.Fatalf("%s processed %d times, want %d; calls=%v", key, seen[key], want, log.calls)
			}
		}
	}
	for partition, offset := range committedOffsets(t, broker) {
		if offset == nil || *offset != 5 {
			t.Fatalf("events/%d committed = %v, want 5", partition, offset)
		}
	}
	t.Logf("generations=%v process calls=%d (15 records, 2 reprocessed)", generations, len(log.calls))
}
