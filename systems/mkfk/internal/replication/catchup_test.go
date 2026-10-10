package replication

import (
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// Under a steady write stream, follower 2 always acknowledges the log as it
// was one round trip (200 ms) earlier; follower 3 stops at the first entry.
// For eight seconds, four lag windows, follower 2 never falls more than one
// round trip behind and stays in the ISR. Follower 3 is evicted once it has
// trailed for longer than the window, even though it keeps answering.
func TestM7FollowerOneRoundTripBehindStaysInISRWhileStuckFollowerIsEvicted(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{MaxPendingOperations: 64, MaxOperationHistory: 128, MaxGateHistory: 128})
	leader := cluster.elect(t, 1)
	term := cluster.nodes[1].Snapshot().Term
	start := cluster.now
	stuckAt := cluster.nodes[1].Snapshot().LastLogIndex
	previous := stuckAt
	var evictedAt time.Duration
	for step := 1; step <= 40; step++ {
		now := start.Add(time.Duration(step) * 200 * time.Millisecond)
		id := fmt.Sprintf("op-%d", step)
		if _, _, _, err := leader.ProposeData(id, id, 1, []storage.DataRecord{{Value: []byte("load")}}, now); err != nil {
			t.Fatalf("step %d: %v", step, err)
		}
		last := cluster.nodes[1].Snapshot().LastLogIndex
		if _, err := leader.HandleReady(raft.Ready{LeaderReady: true, DurableAcks: []raft.DurableAck{
			{PeerID: 2, Term: term, MatchIndex: previous, RPCID: uint64(1000 + step)},
			{PeerID: 3, Term: term, MatchIndex: stuckAt, RPCID: uint64(2000 + step)},
		}}, now); err != nil {
			t.Fatal(err)
		}
		previous = last
		evicted := leader.AdvanceTime(now)
		if reflect.DeepEqual(evicted, []uint32{3}) {
			evictedAt = now.Sub(start)
		}
		if !contains(leader.ISR(), 2) {
			t.Fatalf("follower one round trip behind was evicted at step %d: %+v", step, leader.PeerObservations())
		}
	}
	if evictedAt == 0 || evictedAt > DefaultLagWindow+time.Second {
		t.Fatalf("stuck follower evicted at %s, want within one window plus a step", evictedAt)
	}
}
