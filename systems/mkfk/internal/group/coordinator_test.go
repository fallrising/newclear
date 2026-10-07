package group

import (
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

func (cluster *groupCluster) join(t *testing.T, id uint32, group, member string) Ticket {
	t.Helper()
	ticket, out, err := cluster.coords[id].Join(group, protocol.JoinGroupRequest{
		MemberID: member, Subscription: []string{"events"}, RequestID: "join-" + member,
	}, cluster.now)
	cluster.handle(t, id, out, err)
	cluster.drain(t)
	return ticket
}

func (cluster *groupCluster) sync(t *testing.T, id uint32, group, member string, generation uint64) (Status, error) {
	t.Helper()
	status, out, err := cluster.coords[id].Sync(group, protocol.SyncGroupRequest{
		MemberID: member, Generation: protocol.DecimalUint64(generation), Revoked: true,
	}, cluster.now)
	cluster.handle(t, id, out, nil)
	cluster.drain(t)
	return status, err
}

// stabilize has every member of the group revoke and sync until STABLE.
func (cluster *groupCluster) stabilize(t *testing.T, id uint32, group string) uint64 {
	t.Helper()
	view, _ := cluster.coords[id].State().Group(group)
	for _, member := range view.Members {
		if _, err := cluster.sync(t, id, group, member, view.Generation); err != nil {
			t.Fatalf("sync %s: %v", member, err)
		}
	}
	if after, _ := cluster.coords[id].State().Group(group); after.Phase != PhaseStable || after.Generation != view.Generation {
		t.Fatalf("group %s = %+v, want STABLE generation %d", group, after, view.Generation)
	}
	return view.Generation
}

func (cluster *groupCluster) commit(t *testing.T, id uint32, group, member, requestID string, generation uint64, partition uint32, offset uint64) Ticket {
	t.Helper()
	ticket, out, err := cluster.coords[id].CommitOffsets(group, protocol.CommitOffsetsRequest{
		MemberID: member, Generation: protocol.DecimalUint64(generation), RequestID: requestID,
		Offsets: []protocol.OffsetCommit{{Topic: "events", Partition: partition, Offset: protocol.DecimalUint64(offset)}},
	}, cluster.hw, cluster.now)
	cluster.handle(t, id, out, err)
	return ticket
}

func (cluster *groupCluster) heartbeatMember(t *testing.T, id uint32, group, member string, generation uint64) {
	t.Helper()
	_, _ = cluster.coords[id].Heartbeat(group, protocol.HeartbeatRequest{MemberID: member, Generation: protocol.DecimalUint64(generation)}, cluster.now)
}

func (cluster *groupCluster) checkTimers(t *testing.T, id uint32) {
	t.Helper()
	out, err := cluster.coords[id].CheckTimers(cluster.now)
	cluster.handle(t, id, out, err)
	cluster.drain(t)
}

func (cluster *groupCluster) seedHighWatermarks(value uint64) {
	for partition := uint32(0); partition < testTopics["events"]; partition++ {
		cluster.hw[TopicPartition{Topic: "events", Partition: partition}] = value
	}
}

func TestM6CG03SessionTimeoutRemovesSilentMember(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 1)
	cluster.elect(t, 1)
	cluster.join(t, 1, "g", "m1")
	cluster.join(t, 1, "g", "m2")
	generation := cluster.stabilize(t, 1, "g")
	for step := 0; step < 3; step++ {
		cluster.now = cluster.now.Add(2 * time.Second)
		cluster.heartbeatMember(t, 1, "g", "m1", generation)
		cluster.checkTimers(t, 1)
	}
	view, _ := cluster.coords[1].State().Group("g")
	if view.Generation != generation+1 || len(view.Members) != 1 || view.Members[0] != "m1" {
		t.Fatalf("after m2 went silent: %+v", view)
	}
	cluster.stabilize(t, 1, "g")
	if assigned, _ := cluster.coords[1].State().Assignment("g", "m1"); len(assigned) != 3 {
		t.Fatalf("survivor assignment = %v, want all 3 partitions", assigned)
	}
}

func TestM6CG03RebalanceDeadlineRemovesMemberThatNeverRevokes(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 1)
	cluster.elect(t, 1)
	cluster.join(t, 1, "g", "m1")
	cluster.join(t, 1, "g", "m2")
	cluster.stabilize(t, 1, "g")
	cluster.join(t, 1, "g", "m3")
	view, _ := cluster.coords[1].State().Group("g")
	for _, member := range []string{"m1", "m3"} {
		if _, err := cluster.sync(t, 1, "g", member, view.Generation); err != nil {
			t.Fatal(err)
		}
	}
	for elapsed := time.Duration(0); elapsed <= DefaultRebalanceTimeout; elapsed += 2 * time.Second {
		cluster.now = cluster.now.Add(2 * time.Second)
		for _, member := range []string{"m1", "m2", "m3"} {
			cluster.heartbeatMember(t, 1, "g", member, view.Generation)
		}
		cluster.checkTimers(t, 1)
	}
	after, _ := cluster.coords[1].State().Group("g")
	if after.Generation != view.Generation+1 || len(after.Members) != 2 || after.Members[1] != "m3" {
		t.Fatalf("m2 never revoked but group is %+v", after)
	}
}

func TestM6CG04CommitThatAppliesAfterRebalanceIsRejected(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 3)
	cluster.elect(t, 1)
	cluster.seedHighWatermarks(10)
	cluster.join(t, 1, "g", "m1")
	generation := cluster.stabilize(t, 1, "g")
	// The JOIN reaches the log first; the commit passed its pre-check under the
	// old generation but applies after the rebalance.
	_, out, err := cluster.coords[1].Join("g", protocol.JoinGroupRequest{MemberID: "m2", Subscription: []string{"events"}, RequestID: "join-m2"}, cluster.now)
	cluster.handle(t, 1, out, err)
	ticket := cluster.commit(t, 1, "g", "m1", "racing", generation, 0, 5)
	cluster.drain(t)
	cluster.heartbeat(t, 1)
	if got := cluster.completion(t, 1, ticket); !IsCode(got.Result.Err, CodeIllegalGeneration) {
		t.Fatalf("racing commit completion = %+v", got)
	}
	if _, ok := cluster.coords[1].State().CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0}); ok {
		t.Fatal("racing commit wrote an offset")
	}
}

func TestM6CG05ProcessBeforeCommitCrashReprocessesAndCommitAfterCrashResumes(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 1)
	cluster.elect(t, 1)
	cluster.seedHighWatermarks(20)
	cluster.join(t, 1, "g", "m1")
	generation := cluster.stabilize(t, 1, "g")
	committed := cluster.commit(t, 1, "g", "m1", "c1", generation, 0, 5)
	if got := cluster.completion(t, 1, committed); got.Unknown || got.Result.Err != nil {
		t.Fatalf("first commit = %+v", got)
	}
	// The worker processes records 5..9 and crashes before committing 10;
	// the coordinator process restarts on the same WAL.
	cluster.start(t, 1)
	cluster.elect(t, 1)
	if offset, _ := cluster.coords[1].State().CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0}); offset != 5 {
		t.Fatalf("after crash before commit: resume offset %d, want 5 (records 5..9 are reprocessed)", offset)
	}
	generation = cluster.stabilize(t, 1, "g")
	cluster.commit(t, 1, "g", "m1", "c2", generation, 0, 10)
	cluster.start(t, 1)
	cluster.elect(t, 1)
	if offset, _ := cluster.coords[1].State().CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0}); offset != 10 {
		t.Fatalf("after crash following commit: resume offset %d, want 10", offset)
	}
}

func TestM6CG06FailoverKeepsOffsetsAndNeverReusesGeneration(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 3)
	cluster.elect(t, 1)
	cluster.seedHighWatermarks(10)
	cluster.join(t, 1, "g", "m1")
	generation := cluster.stabilize(t, 1, "g")
	cluster.commit(t, 1, "g", "m1", "c1", generation, 0, 7)
	cluster.drain(t)
	cluster.heartbeat(t, 1)
	cluster.isolate(1)
	successor := cluster.elect(t, 2)
	view, _ := successor.State().Group("g")
	offset, _ := successor.State().CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0})
	if view.Generation <= generation || view.Phase != PhasePreparing || offset != 7 {
		t.Fatalf("after failover: %+v offset %d; want generation > %d, PREPARING, offset 7", view, offset, generation)
	}
	stale := cluster.commit(t, 2, "g", "m1", "stale", generation, 0, 9)
	cluster.drain(t)
	if got := cluster.completion(t, 2, stale); !IsCode(got.Result.Err, CodeIllegalGeneration) {
		t.Fatalf("old-session commit after failover = %+v", got)
	}
}

func TestM6CG06IsolatedOldLeaderCommitNeverSucceeds(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 3)
	cluster.elect(t, 1)
	cluster.seedHighWatermarks(10)
	cluster.join(t, 1, "g", "m1")
	generation := cluster.stabilize(t, 1, "g")
	cluster.isolate(1)
	orphan := cluster.commit(t, 1, "g", "m1", "orphan", generation, 0, 6)
	cluster.drain(t)
	cluster.elect(t, 2)
	cluster.heal()
	cluster.heartbeat(t, 2)
	if got := cluster.completion(t, 1, orphan); !got.Unknown {
		t.Fatalf("old leader reported %+v for an entry that never committed", got)
	}
	for _, id := range cluster.voters {
		if _, ok := cluster.coords[id].State().CommittedOffset("g", TopicPartition{Topic: "events", Partition: 0}); ok {
			t.Fatalf("node %d applied the orphaned commit", id)
		}
	}
}

func TestCoordinatorRejectsRequestsUntilServing(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 3)
	_, _, err := cluster.coords[1].Join("g", protocol.JoinGroupRequest{MemberID: "m1", Subscription: []string{"events"}, RequestID: "r"}, cluster.now)
	if !IsCode(err, CodeNotCoordinator) {
		t.Fatalf("join on a follower: %v", err)
	}
}

func TestCommitWithoutHighWatermarkProofIsUnavailable(t *testing.T) {
	t.Parallel()
	cluster := newGroupCluster(t, 1)
	cluster.elect(t, 1)
	cluster.join(t, 1, "g", "m1")
	generation := cluster.stabilize(t, 1, "g")
	_, _, err := cluster.coords[1].CommitOffsets("g", protocol.CommitOffsetsRequest{
		MemberID: "m1", Generation: protocol.DecimalUint64(generation), RequestID: "c",
		Offsets: []protocol.OffsetCommit{{Topic: "events", Partition: 0, Offset: 1}},
	}, cluster.hw, cluster.now)
	if !IsCode(err, CodeDependencyFailed) {
		t.Fatalf("commit without HW proof: %v", err)
	}
}
