package raft

import "testing"

// A leader whose peers lose every AppendEntries keeps at most
// MaxInflightAppends unanswered RPCs per peer, stops pipelining proposals
// to them, and replicates everything with the next heartbeat once they
// answer again.
func TestM7LeaderSentTableStaysBoundedWhilePeersLoseMessages(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 100)
	leader := cluster.nodes[1]
	if !leader.Snapshot().LeaderReady {
		t.Fatalf("leader not ready: %+v", leader.Snapshot())
	}
	for index := range 500 {
		if _, _, err := leader.ProposeFrame(fenceFrame(0, 0, "lost").Kind, fenceFrame(0, 0, "lost").Payload); err != nil {
			t.Fatalf("proposal %d: %v", index, err)
		}
		if _, err := leader.Tick(); err != nil {
			t.Fatal(err)
		}
	}
	if len(leader.sent) > 2*MaxInflightAppends {
		t.Fatalf("leader tracks %d unanswered AppendEntries; the cap is %d per peer", len(leader.sent), MaxInflightAppends)
	}
	cluster.queue = nil
	_, ready, err := leader.ProposeFrame(fenceFrame(0, 0, "after").Kind, fenceFrame(0, 0, "after").Payload)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, ready)
	for range 2 * cluster.nodes[1].config.HeartbeatTicks {
		cluster.enqueueReady(t, 1, cluster.tick(t, 1))
	}
	cluster.drain(t, 1000)
	if snapshot := leader.Snapshot(); snapshot.CommitIndex != snapshot.LastLogIndex {
		t.Fatalf("leader did not commit after peers answered: %+v", snapshot)
	}
}
