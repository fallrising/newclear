package group

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

var testTopics = map[string]uint32{"events": 3, "orders": 2}

func newTestState(t *testing.T) *State {
	t.Helper()
	state, err := NewState(Config{Partitions: func(topic string) (uint32, bool) {
		count, ok := testTopics[topic]
		return count, ok
	}})
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func mustApply(t *testing.T, state *State, command storage.GroupCommand) Result {
	t.Helper()
	result := state.Apply(command)
	if result.Err != nil {
		t.Fatalf("%s %s: %v", command.Type, command.MemberID, result.Err)
	}
	return result
}

func join(group, member string) storage.GroupCommand {
	return storage.GroupCommand{Type: storage.GroupJoin, GroupID: group, RequestID: "join-" + member, MemberID: member, Subscription: []string{"events"}}
}

func syncReady(group, member string, generation uint64) storage.GroupCommand {
	return storage.GroupCommand{Type: storage.GroupSyncReady, GroupID: group, MemberID: member, Generation: generation}
}

func setAssignment(group string, generation uint64) storage.GroupCommand {
	return storage.GroupCommand{Type: storage.GroupSetAssignment, GroupID: group, RequestID: fmt.Sprintf("assign-%d", generation), Generation: generation}
}

func commit(group, member, requestID string, generation uint64, offsets ...storage.GroupOffset) storage.GroupCommand {
	return storage.GroupCommand{Type: storage.GroupCommitOffsets, GroupID: group, RequestID: requestID, MemberID: member, Generation: generation, Offsets: offsets}
}

func offset(partition uint32, value, hw uint64) storage.GroupOffset {
	return storage.GroupOffset{Topic: "events", Partition: partition, Offset: value, HighWatermark: hw}
}

// stabilize joins members in the given order, syncs everyone and assigns.
func stabilize(t *testing.T, state *State, group string, members ...string) uint64 {
	t.Helper()
	for _, member := range members {
		mustApply(t, state, join(group, member))
	}
	view, _ := state.Group(group)
	for _, member := range view.Members {
		mustApply(t, state, syncReady(group, member, view.Generation))
	}
	if result := mustApply(t, state, setAssignment(group, view.Generation)); result.Phase != PhaseStable {
		t.Fatalf("phase = %s, want STABLE", result.Phase)
	}
	return view.Generation
}

func assignments(t *testing.T, state *State, group string, members []string) map[string][]TopicPartition {
	t.Helper()
	out := make(map[string][]TopicPartition, len(members))
	for _, member := range members {
		assigned, ok := state.Assignment(group, member)
		if !ok {
			t.Fatalf("member %s has no assignment", member)
		}
		out[member] = assigned
	}
	return out
}

func TestM6CG01RoundRobinIsDeterministicAndCoversEveryPartition(t *testing.T) {
	t.Parallel()
	for _, members := range [][]string{{"m1"}, {"m2", "m1"}, {"m3", "m1", "m2"}, {"m5", "m2", "m4", "m1", "m3"}} {
		reversed := append([]string(nil), members...)
		for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
			reversed[i], reversed[j] = reversed[j], reversed[i]
		}
		first, second := newTestState(t), newTestState(t)
		stabilize(t, first, "g", members...)
		stabilize(t, second, "g", reversed...)
		got := assignments(t, first, "g", members)
		if !reflect.DeepEqual(got, assignments(t, second, "g", members)) {
			t.Fatalf("%v: assignment depends on join order", members)
		}
		seen := map[TopicPartition]string{}
		for member, partitions := range got {
			for _, partition := range partitions {
				if previous, dup := seen[partition]; dup {
					t.Fatalf("%v: %v assigned to %s and %s", members, partition, previous, member)
				}
				seen[partition] = member
			}
		}
		if len(seen) != int(testTopics["events"]) {
			t.Fatalf("%v: covered %d partitions, want %d", members, len(seen), testTopics["events"])
		}
	}
}

func TestM6CG01ExtraMembersReceiveEmptyAssignment(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	stabilize(t, state, "g", "m1", "m2", "m3", "m4", "m5")
	if got := assignments(t, state, "g", []string{"m4", "m5"}); len(got["m4"])+len(got["m5"]) != 0 {
		t.Fatalf("members beyond the partition count got %v", got)
	}
}

func TestM6CG02GroupsOnTheSameTopicAreIndependent(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generationA := stabilize(t, state, "a", "m1")
	stabilize(t, state, "b", "m1", "m2")
	mustApply(t, state, commit("a", "m1", "c1", generationA, offset(0, 5, 5)))
	if _, ok := state.CommittedOffset("b", TopicPartition{Topic: "events", Partition: 0}); ok {
		t.Fatal("commit in group a leaked into group b")
	}
}

func TestM6CG03JoinStartsNewGenerationAndAssignsOnlyAfterSetAssignment(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generation := stabilize(t, state, "g", "m1")
	joined := mustApply(t, state, join("g", "m2"))
	if joined.Generation != generation+1 || joined.Phase != PhasePreparing {
		t.Fatalf("after join: %+v, want generation %d PREPARING", joined, generation+1)
	}
	if _, ok := state.Assignment("g", "m1"); ok {
		t.Fatal("old assignment still served while rebalancing")
	}
	mustApply(t, state, syncReady("g", "m1", joined.Generation))
	if result := state.Apply(setAssignment("g", joined.Generation)); !IsCode(result.Err, CodeRebalanceInProgress) {
		t.Fatalf("assignment before every member synced: %v", result.Err)
	}
}

func TestM6CG03UnresponsiveMemberIsRemovedByNewGeneration(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generation := stabilize(t, state, "g", "m1", "m2")
	rebalance := mustApply(t, state, storage.GroupCommand{Type: storage.GroupBeginRebalance, GroupID: "g", RequestID: "r", ExpectedGeneration: generation, Generation: generation + 1})
	mustApply(t, state, syncReady("g", "m1", rebalance.Generation))
	removed := mustApply(t, state, storage.GroupCommand{Type: storage.GroupRemoveMembers, GroupID: "g", RequestID: "expire", MemberIDs: []string{"m2"}, ExpectedGeneration: rebalance.Generation})
	mustApply(t, state, syncReady("g", "m1", removed.Generation))
	mustApply(t, state, setAssignment("g", removed.Generation))
	if got := assignments(t, state, "g", []string{"m1"}); len(got["m1"]) != 3 {
		t.Fatalf("surviving member got %v, want all 3 partitions", got["m1"])
	}
}

func TestM6CG03LateSyncAndStaleTimerDoNotChangeState(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generation := stabilize(t, state, "g", "m1")
	current := mustApply(t, state, join("g", "m2"))
	before, _ := state.Group("g")
	late := state.Apply(syncReady("g", "m1", generation))
	stale := state.Apply(storage.GroupCommand{Type: storage.GroupRemoveMembers, GroupID: "g", RequestID: "old", MemberIDs: []string{"m1"}, ExpectedGeneration: generation})
	after, _ := state.Group("g")
	if !IsCode(late.Err, CodeIllegalGeneration) || !IsCode(stale.Err, CodeIllegalGeneration) || !reflect.DeepEqual(before, after) || after.Generation != current.Generation {
		t.Fatalf("late sync %v / stale removal %v changed state %+v -> %+v", late.Err, stale.Err, before, after)
	}
}

func TestM6CG04StaleNonOwnerAndRacingCommitsAreRejected(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generation := stabilize(t, state, "g", "m1", "m2")
	m1, _ := state.Assignment("g", "m1")
	m2, _ := state.Assignment("g", "m2")
	nonOwner := state.Apply(commit("g", "m1", "c1", generation, offset(m2[0].Partition, 1, 9)))
	// A commit proposed in generation g that applies after the rebalance began.
	mustApply(t, state, join("g", "m3"))
	racing := state.Apply(commit("g", "m1", "c2", generation, offset(m1[0].Partition, 1, 9)))
	stale := state.Apply(commit("g", "m1", "c3", generation-1, offset(m1[0].Partition, 1, 9)))
	if !IsCode(nonOwner.Err, CodeNotOwner) || !IsCode(racing.Err, CodeIllegalGeneration) || !IsCode(stale.Err, CodeIllegalGeneration) {
		t.Fatalf("non-owner %v, racing %v, stale %v", nonOwner.Err, racing.Err, stale.Err)
	}
	for partition := uint32(0); partition < 3; partition++ {
		if _, ok := state.CommittedOffset("g", TopicPartition{Topic: "events", Partition: partition}); ok {
			t.Fatalf("rejected commit wrote partition %d", partition)
		}
	}
}

func TestM6CG04StaleWorkerKeepsRunningButCannotCommit(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generation := stabilize(t, state, "g", "m1")
	mustApply(t, state, join("g", "m2"))
	// m1 never learned about the rebalance and still processes its old partitions.
	result := state.Apply(commit("g", "m1", "late", generation, offset(0, 4, 9)))
	if !IsCode(result.Err, CodeIllegalGeneration) {
		t.Fatalf("stale worker commit: %v", result.Err)
	}
}

func TestM6CG07InvalidOffsetsAreRejectedWithoutPartialCommit(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generation := stabilize(t, state, "g", "m1")
	mustApply(t, state, commit("g", "m1", "base", generation, offset(0, 5, 5), offset(1, 5, 5)))
	cases := []struct {
		name    string
		want    ErrorCode
		command storage.GroupCommand
	}{
		{"beyond high watermark", CodeOffsetOutOfRange, commit("g", "m1", "beyond-hw", generation, offset(0, 6, 5))},
		{"regression", CodeOffsetRegression, commit("g", "m1", "regress", generation, offset(0, 4, 5))},
		// partition 1 regresses and partition 2 is valid: neither may change.
		{"mixed", CodeOffsetRegression, commit("g", "m1", "mixed", generation, offset(1, 3, 5), offset(2, 2, 5))},
	}
	for _, tc := range cases {
		if result := state.Apply(tc.command); !IsCode(result.Err, tc.want) {
			t.Fatalf("%s: got %v, want %s", tc.name, result.Err, tc.want)
		}
	}
	if _, ok := state.CommittedOffset("g", TopicPartition{Topic: "events", Partition: 2}); ok {
		t.Fatal("partially invalid commit wrote partition 2")
	}
	if got, _ := state.CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0}); got != 5 {
		t.Fatalf("partition 0 = %d, want 5", got)
	}
}

func TestCommitRetryReturnsOriginalResultAfterRebalance(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	generation := stabilize(t, state, "g", "m1")
	original := commit("g", "m1", "once", generation, offset(0, 3, 3))
	mustApply(t, state, original)
	mustApply(t, state, join("g", "m2"))
	if retry := state.Apply(original); retry.Err != nil {
		t.Fatalf("retry of an applied commit after rebalance: %v", retry.Err)
	}
	conflict := commit("g", "m1", "once", generation, offset(0, 2, 3))
	if result := state.Apply(conflict); !IsCode(result.Err, CodeRequestConflict) {
		t.Fatalf("reused request_id with different offsets: %v", result.Err)
	}
}

func TestReplayRebuildsCommittedOffsetsAndGeneration(t *testing.T) {
	t.Parallel()
	commands := []storage.GroupCommand{
		join("g", "m1"), syncReady("g", "m1", 1), setAssignment("g", 1),
		commit("g", "m1", "c1", 1, offset(0, 7, 7)),
		{Type: storage.GroupBeginRebalance, GroupID: "g", RequestID: "term-2", ExpectedGeneration: 1, Generation: 2},
	}
	var frames []storage.Frame
	live := newTestState(t)
	for index, command := range commands {
		frame, err := storage.NewGroupFrame(uint64(index+1), 1, command)
		if err != nil {
			t.Fatal(err)
		}
		frames = append(frames, frame)
		mustApply(t, live, command)
	}
	replayed := newTestState(t)
	if err := replayed.Replay(frames); err != nil {
		t.Fatal(err)
	}
	liveView, _ := live.Group("g")
	replayedView, _ := replayed.Group("g")
	offsetLive, _ := live.CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0})
	offsetReplayed, _ := replayed.CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0})
	if !reflect.DeepEqual(liveView, replayedView) || offsetLive != offsetReplayed || replayedView.Generation != 2 {
		t.Fatalf("replay = %+v offset %d, live = %+v offset %d", replayedView, offsetReplayed, liveView, offsetLive)
	}
}

func TestJoinRejectsDifferentSubscriptionAndUnknownTopic(t *testing.T) {
	t.Parallel()
	state := newTestState(t)
	stabilize(t, state, "g", "m1")
	other := join("g", "m2")
	other.Subscription = []string{"orders"}
	unknown := join("h", "m1")
	unknown.Subscription = []string{"missing"}
	if result := state.Apply(other); !IsCode(result.Err, CodeInvalidRequest) {
		t.Fatalf("different subscription: %v", result.Err)
	}
	if result := state.Apply(unknown); !IsCode(result.Err, CodeUnknownTopic) {
		t.Fatalf("unknown topic: %v", result.Err)
	}
}
