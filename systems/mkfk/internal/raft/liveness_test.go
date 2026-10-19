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

// Today's election, as specified in docs/sdd/02-replication.md §3 and left
// unchanged by ADR-014. A candidate increments its term and sends RequestVote
// before any peer has granted a vote. One such request makes the current
// leader persist that term and step down, even when the candidate's log is
// stale and the vote is refused. The candidate stays a candidate after that
// refusal is delivered: it becomes leader only with a majority of granted votes.
// Pre-vote would change this sequence; it is not implemented.
func TestHigherTermRequestVoteFromUnconfirmedCandidateStepsDownLeader(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 100)
	leader := cluster.nodes[1].Snapshot()
	if leader.Role != Leader || !leader.LeaderReady {
		t.Fatalf("node 1 did not become a ready leader: %+v", leader)
	}

	cluster.isolate(3)
	frame := fenceFrame(0, 0, "x")
	_, ready, err := cluster.nodes[1].ProposeFrame(frame.Kind, frame.Payload)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, ready)
	cluster.drain(t, 100)
	if len(cluster.queue) != 0 {
		t.Fatalf("queue not empty before the disruptive vote: %+v", cluster.queue)
	}
	leader = cluster.nodes[1].Snapshot()
	behind := cluster.nodes[3].Snapshot()
	if behind.LastLogIndex >= leader.LastLogIndex {
		t.Fatalf("node 3 log index %d is not behind leader index %d", behind.LastLogIndex, leader.LastLogIndex)
	}

	// Keep the campaign messages. deliver drops anything still isolated, so
	// enqueueing them now would lose the RequestVote.
	campaign := cluster.campaign(t, 3)
	candidate := cluster.nodes[3].Snapshot()
	if candidate.Role != Candidate || candidate.Term != leader.Term+1 {
		t.Fatalf("node 3 did not campaign at the next term: %+v", candidate)
	}
	var vote Message
	var found bool
	for _, message := range campaign.Messages {
		if message.Kind == MessageRequestVote && message.To == 1 {
			vote = message
			found = true
			break
		}
	}
	if !found || vote.Term != candidate.Term {
		t.Fatalf("candidate ready has no current-term RequestVote for node 1: %+v", campaign.Messages)
	}

	cluster.blocked = map[[2]uint32]bool{}
	cluster.deliver(t, vote)

	steppedDown := cluster.nodes[1].Snapshot()
	if steppedDown.Role != Follower || steppedDown.Term != candidate.Term || steppedDown.LeaderReady {
		t.Fatalf("leader after one unconfirmed RequestVote: %+v", steppedDown)
	}
	if steppedDown.VotedFor != nil {
		t.Fatalf("leader granted the stale vote: voted for %d", *steppedDown.VotedFor)
	}
	persisted := cluster.logs[1].HardState()
	if persisted.CurrentTerm != candidate.Term || persisted.VotedFor != nil {
		t.Fatalf("persisted hard state = %+v, want term %d and no vote", persisted, candidate.Term)
	}
	if cluster.nodes[3].Snapshot().Role != Candidate {
		t.Fatalf("candidate became %s without a majority of granted votes", cluster.nodes[3].Snapshot().Role)
	}
	selfVote := cluster.logs[3].HardState()
	if selfVote.VotedFor == nil || *selfVote.VotedFor != 3 || selfVote.CurrentTerm != candidate.Term {
		t.Fatalf("candidate hard state = %+v, want term %d and a vote for itself", selfVote, candidate.Term)
	}
	peer := cluster.nodes[2].Snapshot()
	if peer.Role != Follower || peer.Term != leader.Term {
		t.Fatalf("node 2 changed without receiving the vote: %+v", peer)
	}
	if len(cluster.queue) != 1 || cluster.queue[0].Kind != MessageRequestVoteResponse ||
		cluster.queue[0].VoteResp == nil || cluster.queue[0].VoteResp.Granted {
		t.Fatalf("vote response = %+v, want one refusal", cluster.queue)
	}
	refusal := cluster.queue[0]
	cluster.queue = nil
	cluster.deliver(t, refusal)
	if after := cluster.nodes[3].Snapshot(); after.Role != Candidate || after.Term != candidate.Term {
		t.Fatalf("candidate after the delivered refusal: %+v", after)
	}
}

type sourceOf struct{ random *rand.Rand }

func (source sourceOf) Uint64() (uint64, error) { return source.random.Uint64(), nil }
