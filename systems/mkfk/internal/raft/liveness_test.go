package raft

import "testing"

// A node with a stale log keeps campaigning with ever higher terms after a
// partition heals. Up-to-date nodes reject its votes and must still reach
// their own election timeout, or no leader is ever elected.
func TestM7StaleCandidateDoesNotResetUpToDateElectionTimers(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 100)
	cluster.isolate(3)
	_, ready, err := cluster.nodes[1].ProposeFrame(fenceFrame(0, 0, "x").Kind, fenceFrame(0, 0, "x").Payload)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, ready)
	cluster.drain(t, 100)
	// The old leader is gone; stale node 3 and up-to-date node 2 can talk.
	cluster.blocked = map[[2]uint32]bool{{1, 2}: true, {2, 1}: true, {1, 3}: true, {3, 1}: true}
	timeout := cluster.nodes[2].config.ElectionTimeoutTicks
	for tick := uint64(0); tick < timeout; tick++ {
		if tick%2 == 0 {
			cluster.queue = nil
			cluster.enqueueReady(t, 3, cluster.campaign(t, 3))
			cluster.drain(t, 10)
			cluster.queue = nil
		}
		ready := cluster.tick(t, 2)
		for _, change := range ready.RoleChanges {
			if change.To == Candidate {
				return
			}
		}
	}
	t.Fatalf("node 2 never campaigned while a stale candidate kept asking for votes: %+v", cluster.nodes[2].Snapshot())
}
