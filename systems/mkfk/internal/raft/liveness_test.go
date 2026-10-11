package raft

import (
	"math/rand"
	"testing"
)

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

// Two followers configured with the same election timeout lose their leader.
// Each draws a new timeout when it follows a new term or campaigns, so one of
// them wins instead of both campaigning on the same tick forever.
func TestM7EqualElectionTimeoutsStillElectALeader(t *testing.T) {
	t.Parallel()
	for seed := int64(0); seed < 50; seed++ {
		cluster := newMemoryCluster(t)
		for _, id := range []uint32{2, 3} {
			random := rand.New(rand.NewSource(seed*10 + int64(id)))
			node, err := NewNode(Config{
				Identity: testIdentity, NodeID: id, Voters: []uint32{1, 2, 3}, ElectionTimeoutTicks: 8, HeartbeatTicks: 1,
				NextElectionTimeout: func() (uint64, error) { return RandomElectionTimeout(sourceOf{random}) },
			}, cluster.logs[id])
			if err != nil {
				t.Fatal(err)
			}
			cluster.nodes[id] = node
		}
		cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
		cluster.drain(t, 100)
		cluster.isolate(1)
		if !electsWithin(t, cluster, 200) {
			t.Fatalf("seed %d: no leader after 200 ticks: %+v", seed, cluster.nodes[2].Snapshot())
		}
	}
}

// electsWithin ticks nodes 2 and 3 together until one of them leads.
func electsWithin(t *testing.T, cluster *memoryCluster, ticks int) bool {
	t.Helper()
	for range ticks {
		for _, id := range []uint32{2, 3} {
			cluster.enqueueReady(t, id, cluster.tick(t, id))
		}
		cluster.drain(t, 100)
		for _, id := range []uint32{2, 3} {
			if cluster.nodes[id].Snapshot().Role == Leader {
				return true
			}
		}
	}
	return false
}

type sourceOf struct{ random *rand.Rand }

func (source sourceOf) Uint64() (uint64, error) { return source.random.Uint64(), nil }
