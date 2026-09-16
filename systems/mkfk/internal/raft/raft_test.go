package raft

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

var testIdentity = Identity{ClusterID: "raft-test", ConfigHash: "config-v1", GroupID: "events/0"}

func TestM3RP01DurableVoteFencesSameTermCandidates(t *testing.T) {
	t.Parallel()
	log := newMemoryLog()
	node := newTestNode(t, 2, log)
	request := voteRequest(1, 2, 1, 0, 0, 11)
	ready, err := node.Step(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(ready.Messages) != 1 || !ready.Messages[0].VoteResp.Granted {
		t.Fatalf("first vote response = %#v", ready.Messages)
	}
	if len(log.events) == 0 || log.events[len(log.events)-1] != "hardstate-sync(term=1,vote=1,commit=0)" {
		t.Fatalf("vote response preceded persistence: %v", log.events)
	}
	ready, err = node.Step(request)
	if err != nil || !ready.Messages[0].VoteResp.Granted {
		t.Fatalf("same-candidate retry = %#v, %v", ready.Messages, err)
	}
	ready, err = node.Step(voteRequest(3, 2, 1, 0, 0, 12))
	if err != nil {
		t.Fatal(err)
	}
	if ready.Messages[0].VoteResp.Granted {
		t.Fatal("same-term vote for a different candidate was granted")
	}
}

func TestM3RP02VoteCrashBoundary(t *testing.T) {
	t.Parallel()
	log := newMemoryLog()
	log.failHardState = true
	node := newTestNode(t, 2, log)
	ready, err := node.Step(voteRequest(1, 2, 1, 0, 0, 1))
	if err == nil || len(ready.Messages) != 0 {
		t.Fatalf("failed vote persistence emitted response: %#v, %v", ready, err)
	}
	if log.state.CurrentTerm != 0 || log.state.VotedFor != nil {
		t.Fatalf("failed persistence changed hardstate: %#v", log.state)
	}

	log.failHardState = false
	ready, err = node.Step(voteRequest(1, 2, 1, 0, 0, 2))
	if err != nil || !ready.Messages[0].VoteResp.Granted {
		t.Fatalf("durable vote failed: %#v, %v", ready, err)
	}
	restarted := newTestNode(t, 2, log)
	ready, err = restarted.Step(voteRequest(3, 2, 1, 0, 0, 3))
	if err != nil {
		t.Fatal(err)
	}
	if ready.Messages[0].VoteResp.Granted {
		t.Fatal("restart forgot the durable same-term vote")
	}
}

func TestM3RP03VoteFreshnessUsesLastTermAndIndexNotLEO(t *testing.T) {
	t.Parallel()
	log := newMemoryLog()
	log.frames = []storage.Frame{
		noopFrame(1, 1),
		noopFrame(2, 2),
	}
	log.state = storage.HardState{CurrentTerm: 2}
	node := newTestNode(t, 2, log)
	// The candidate claims a larger internal index (and could have a larger
	// DATA LEO), but its last term is older than this receiver's.
	ready, err := node.Step(voteRequest(3, 2, 3, 3, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if ready.Messages[0].VoteResp.Granted {
		t.Fatal("candidate with an older last term won by having a larger index")
	}
}

func TestM3RP04ConflictReconciliationAndIdempotentReplay(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.logs[1].frames = []storage.Frame{noopFrame(1, 1)}
	cluster.logs[2].frames = []storage.Frame{noopFrame(1, 1), fenceFrame(2, 1, "old-a"), fenceFrame(3, 1, "old-b")}
	cluster.logs[3].frames = []storage.Frame{noopFrame(1, 1)}
	for id := uint32(1); id <= 3; id++ {
		cluster.logs[id].state = storage.HardState{CurrentTerm: 1, CommitIndex: 1}
		cluster.restart(t, id)
	}
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 200)
	leader := cluster.nodes[1].Snapshot()
	if leader.Role != Leader || !leader.LeaderReady || leader.CommitIndex < 2 {
		t.Fatalf("leader after reconcile = %#v", leader)
	}
	for _, id := range []uint32{2, 3} {
		if !frameEqual(cluster.logs[id].frames[0], cluster.logs[1].frames[0]) ||
			!frameEqual(cluster.logs[id].frames[1], cluster.logs[1].frames[1]) {
			t.Fatalf("node %d did not reconcile to leader prefix", id)
		}
	}
	before := cloneFrames(cluster.logs[2].frames)
	duplicate := Message{
		Kind: MessageAppendEntries, Identity: testIdentity, From: 1, To: 2,
		Term: leader.Term, RPCID: 999,
		Append: &AppendEntries{
			PrevLogIndex: 1, PrevLogTerm: 1,
			Entries: []storage.Frame{cluster.logs[1].frames[1]}, LeaderCommit: leader.CommitIndex,
		},
	}
	ready, err := cluster.nodes[2].Step(duplicate)
	if err != nil || len(ready.Messages) != 1 || !ready.Messages[0].AppendResp.Success {
		t.Fatalf("duplicate append = %#v, %v", ready, err)
	}
	if !reflect.DeepEqual(before, cluster.logs[2].frames) {
		t.Fatal("idempotent AppendEntries replay rewrote the log")
	}
}

func TestM3RP05OldTermMajorityWaitsForCurrentTermNOOP(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	for id := uint32(1); id <= 3; id++ {
		cluster.logs[id].frames = []storage.Frame{noopFrame(1, 1)}
		cluster.logs[id].state = storage.HardState{CurrentTerm: 1}
		cluster.restart(t, id)
	}
	ready := cluster.campaign(t, 1)
	cluster.enqueueReady(t, 1, ready)
	// Deliver only the vote request and response needed to elect node 1. The
	// old-term entry exists on a majority, but no current-term entry is known
	// durable on a majority yet.
	cluster.deliverMatching(t, func(message Message) bool { return message.Kind == MessageRequestVote && message.To == 2 })
	cluster.deliverMatching(t, func(message Message) bool { return message.Kind == MessageRequestVoteResponse && message.To == 1 })
	if snapshot := cluster.nodes[1].Snapshot(); snapshot.Role != Leader || snapshot.CommitIndex != 0 || snapshot.LeaderReady {
		t.Fatalf("old-term majority advanced commit before NOOP quorum: %#v", snapshot)
	}
	cluster.drain(t, 200)
	if snapshot := cluster.nodes[1].Snapshot(); !snapshot.LeaderReady || snapshot.CommitIndex < 2 {
		t.Fatalf("current-term NOOP did not establish readiness: %#v", snapshot)
	}
}

func TestM3RP06IsolatedOldLeaderCannotCommitOrRead(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 200)
	if !cluster.nodes[1].Snapshot().LeaderReady {
		t.Fatal("node 1 did not become ready leader")
	}
	_, ready, err := cluster.nodes[1].ProposeData(1, []storage.DataRecord{{Key: nil, Value: []byte("committed")}})
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, ready)
	cluster.drain(t, 200)
	cluster.enqueueReady(t, 1, cluster.tick(t, 1))
	cluster.enqueueReady(t, 1, cluster.tick(t, 1))
	cluster.drain(t, 200)
	committed := cluster.nodes[1].Snapshot().CommitIndex
	if committed < 2 {
		t.Fatalf("data did not commit: %#v", cluster.nodes[1].Snapshot())
	}

	cluster.isolate(1)
	cluster.enqueueReady(t, 2, cluster.campaign(t, 2))
	cluster.drain(t, 300)
	if snapshot := cluster.nodes[2].Snapshot(); snapshot.Role != Leader || !snapshot.LeaderReady || snapshot.Term <= cluster.nodes[1].Snapshot().Term {
		t.Fatalf("majority side did not elect a newer leader: %#v", snapshot)
	}
	oldCommit := cluster.nodes[1].Snapshot().CommitIndex
	_, oldReady, err := cluster.nodes[1].ProposeData(2, []storage.DataRecord{{Key: nil, Value: []byte("isolated")}})
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, oldReady)
	readReady, err := cluster.nodes[1].RequestRead("old-leader-read")
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, readReady)
	cluster.drain(t, 50)
	if cluster.nodes[1].Snapshot().CommitIndex != oldCommit {
		t.Fatal("isolated old leader committed a new local write")
	}
	if cluster.completedReads["old-leader-read"] {
		t.Fatal("isolated old leader completed a quorum read")
	}
	for _, id := range []uint32{2, 3} {
		if cluster.logs[id].state.CommitIndex < committed {
			t.Fatalf("new majority node %d lost committed prefix", id)
		}
	}
}

func TestM3RP07RestartAllAndQuorumLoss(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 200)
	_, ready, err := cluster.nodes[1].ProposeData(1, []storage.DataRecord{{Key: nil, Value: []byte("survives")}})
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, ready)
	cluster.drain(t, 200)
	cluster.enqueueReady(t, 1, cluster.tick(t, 1))
	cluster.enqueueReady(t, 1, cluster.tick(t, 1))
	cluster.drain(t, 200)
	committed := cluster.nodes[1].Snapshot().CommitIndex
	for id := uint32(1); id <= 3; id++ {
		cluster.restart(t, id)
		if len(cluster.nodes[id].RecoveredApplied()) < 2 {
			t.Fatalf("node %d did not replay committed prefix", id)
		}
	}
	cluster.queue = nil
	cluster.enqueueReady(t, 2, cluster.campaign(t, 2))
	cluster.drain(t, 300)
	if snapshot := cluster.nodes[2].Snapshot(); !snapshot.LeaderReady || snapshot.CommitIndex < committed {
		t.Fatalf("all-node restart did not recover: %#v", snapshot)
	}

	cluster.isolate(2)
	cluster.queue = nil
	before := cluster.nodes[2].Snapshot().CommitIndex
	// A new campaign increments the durable term, but one voter alone cannot
	// become ready or commit a NOOP in RF3.
	cluster.restart(t, 2)
	cluster.enqueueReady(t, 2, cluster.campaign(t, 2))
	cluster.drain(t, 50)
	if snapshot := cluster.nodes[2].Snapshot(); snapshot.Role == Leader || snapshot.CommitIndex != before {
		t.Fatalf("single surviving voter degraded quorum: %#v", snapshot)
	}
}

func TestM3ReadIndexRequiresCurrentTermMajority(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 200)
	ready, err := cluster.nodes[1].RequestRead("read-1")
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, ready)
	cluster.drain(t, 100)
	if !cluster.completedReads["read-1"] {
		t.Fatal("healthy leader did not complete majority ReadIndex")
	}
	cluster.isolate(1)
	ready, err = cluster.nodes[1].RequestRead("read-isolated")
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueueReady(t, 1, ready)
	cluster.drain(t, 50)
	if cluster.completedReads["read-isolated"] {
		t.Fatal("isolated leader completed ReadIndex")
	}
}

func TestM4DurableAckRequiresExactValidatedAppendRPC(t *testing.T) {
	t.Parallel()
	cluster := newMemoryCluster(t)
	cluster.enqueueReady(t, 1, cluster.campaign(t, 1))
	cluster.drain(t, 200)
	cluster.enqueueReady(t, 1, cluster.tick(t, 1))
	heartbeats := cluster.tick(t, 1)
	var appendMessage Message
	for _, message := range heartbeats.Messages {
		if message.To == 2 {
			appendMessage = message
			break
		}
	}
	if appendMessage.Append == nil {
		t.Fatal("leader did not emit heartbeat to node 2")
	}
	followerReady, err := cluster.nodes[2].Step(appendMessage)
	if err != nil || len(followerReady.Messages) != 1 || !followerReady.Messages[0].AppendResp.Success {
		t.Fatalf("follower response = %#v, %v", followerReady, err)
	}
	response := followerReady.Messages[0]
	unknown := response
	unknown.RPCID++
	ready, err := cluster.nodes[1].Step(unknown)
	if err != nil || len(ready.DurableAcks) != 0 {
		t.Fatalf("unknown RPC emitted durable ACK: %#v, %v", ready.DurableAcks, err)
	}
	ready, err = cluster.nodes[1].Step(response)
	if err != nil || len(ready.DurableAcks) != 1 {
		t.Fatalf("validated response durable ACK = %#v, %v", ready.DurableAcks, err)
	}
	ack := ready.DurableAcks[0]
	if ack.PeerID != 2 || ack.Term != response.Term || ack.RPCID != response.RPCID || ack.MatchIndex != response.AppendResp.MatchedIndex {
		t.Fatalf("durable ACK does not identify the validated response: %#v", ack)
	}
	ready, err = cluster.nodes[1].Step(response)
	if err != nil || len(ready.DurableAcks) != 0 {
		t.Fatalf("duplicate response emitted a second durable ACK: %#v, %v", ready.DurableAcks, err)
	}
}

func TestM3FollowerCommitIsCappedByRPCVerifiedPrefix(t *testing.T) {
	t.Parallel()
	log := newMemoryLog()
	log.frames = []storage.Frame{noopFrame(1, 1), fenceFrame(2, 1, "unverified-local-extra")}
	log.state = storage.HardState{CurrentTerm: 1}
	node := newTestNode(t, 2, log)
	message := Message{
		Kind: MessageAppendEntries, Identity: testIdentity, From: 1, To: 2, Term: 1, RPCID: 9,
		Append: &AppendEntries{PrevLogIndex: 1, PrevLogTerm: 1, LeaderCommit: 2},
	}
	ready, err := node.Step(message)
	if err != nil {
		t.Fatal(err)
	}
	if !ready.Messages[0].AppendResp.Success || ready.Messages[0].AppendResp.MatchedIndex != 1 {
		t.Fatalf("heartbeat response = %#v", ready.Messages[0])
	}
	if snapshot := node.Snapshot(); snapshot.CommitIndex != 1 || snapshot.LastApplied != 1 {
		t.Fatalf("heartbeat committed unverified local tail: %#v", snapshot)
	}

	different := fenceFrame(2, 1, "same-term-different-bytes")
	message.RPCID++
	message.Append = &AppendEntries{
		PrevLogIndex: 1, PrevLogTerm: 1, Entries: []storage.Frame{different}, LeaderCommit: 1,
	}
	if ready, err := node.Step(message); err == nil || len(ready.Messages) != 0 {
		t.Fatalf("same-term content corruption was accepted: %#v, %v", ready, err)
	}
}

func TestM3RF1CommitsNOOPAndProposalLocally(t *testing.T) {
	t.Parallel()
	log := newMemoryLog()
	node, err := NewNode(Config{
		Identity: testIdentity, NodeID: 1, Voters: []uint32{1},
		ElectionTimeoutTicks: 5, HeartbeatTicks: 1,
	}, log)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := node.Campaign()
	if err != nil {
		t.Fatal(err)
	}
	if !ready.LeaderReady || node.Snapshot().CommitIndex != 1 || len(ready.Applied) != 1 {
		t.Fatalf("RF1 leader barrier = %#v / %#v", ready, node.Snapshot())
	}
	index, ready, err := node.ProposeData(1, []storage.DataRecord{{Key: nil, Value: []byte("rf1")}})
	if err != nil {
		t.Fatal(err)
	}
	if index != 2 || node.Snapshot().CommitIndex != 2 || len(ready.Applied) != 1 {
		t.Fatalf("RF1 proposal = index %d, %#v / %#v", index, ready, node.Snapshot())
	}
}

func TestM3InjectedElectionTimeoutRange(t *testing.T) {
	t.Parallel()
	for value, want := range map[uint64]uint64{0: 6, 6: 12, 7: 6, 99: 7} {
		got, err := RandomElectionTimeout(fixedRandom(value))
		if err != nil || got != want {
			t.Fatalf("random %d produced %d, %v; want %d", value, got, err, want)
		}
	}
}

func TestM3DeterministicModel100Seeds1000Events(t *testing.T) {
	for seed := int64(0); seed < 100; seed++ {
		seed := seed
		t.Run(fmt.Sprintf("seed-%03d", seed), func(t *testing.T) {
			cluster := newMemoryCluster(t)
			random := rand.New(rand.NewSource(seed))
			for event := 0; event < 1000; event++ {
				id := uint32(random.Intn(3) + 1)
				switch random.Intn(7) {
				case 0:
					cluster.enqueueReady(t, id, cluster.tick(t, id))
				case 1:
					cluster.deliverRandom(t, random)
				case 2:
					cluster.dropRandom(random)
				case 3:
					cluster.enqueueReady(t, id, cluster.campaign(t, id))
				case 4:
					cluster.restart(t, id)
				case 5:
					if snapshot := cluster.nodes[id].Snapshot(); snapshot.Role == Leader && snapshot.LeaderReady {
						_, ready, err := cluster.nodes[id].ProposeFrame(storage.KindNOOP, []byte("{}"))
						if err != nil {
							t.Fatal(err)
						}
						cluster.enqueueReady(t, id, ready)
					}
				case 6:
					if len(cluster.queue) > 500 {
						cluster.queue = cluster.queue[len(cluster.queue)-500:]
					}
				}
				cluster.assertSafety(t, seed, event)
			}
		})
	}
}

func voteRequest(from, to uint32, term, lastIndex, lastTerm, rpcID uint64) Message {
	return Message{
		Kind: MessageRequestVote, Identity: testIdentity, From: from, To: to,
		Term: term, RPCID: rpcID, Vote: &RequestVote{LastLogIndex: lastIndex, LastLogTerm: lastTerm},
	}
}

func noopFrame(index, term uint64) storage.Frame {
	return storage.Frame{Kind: storage.KindNOOP, LogIndex: index, Term: term, Payload: []byte("{}")}
}

func fenceFrame(index, term uint64, value string) storage.Frame {
	payload, _ := json.Marshal(map[string]string{"value": value})
	return storage.Frame{Kind: storage.KindFence, LogIndex: index, Term: term, Payload: payload}
}

type memoryLog struct {
	frames        []storage.Frame
	state         storage.HardState
	events        []string
	failHardState bool
}

func newMemoryLog() *memoryLog { return &memoryLog{} }

func (log *memoryLog) HardState() storage.HardState {
	state := log.state
	state.VotedFor = cloneVote(state.VotedFor)
	return state
}

func (log *memoryLog) PersistHardState(state storage.HardState) error {
	if log.failHardState {
		return errors.New("injected hardstate sync failure")
	}
	if state.CurrentTerm < log.state.CurrentTerm || state.CommitIndex < log.state.CommitIndex || state.CommitIndex > log.LastLogIndex() {
		return errors.New("invalid hardstate transition")
	}
	if state.CurrentTerm == log.state.CurrentTerm && log.state.VotedFor != nil &&
		(state.VotedFor == nil || *state.VotedFor != *log.state.VotedFor) {
		return errors.New("same-term vote changed")
	}
	log.state = state
	log.state.VotedFor = cloneVote(state.VotedFor)
	vote := uint32(0)
	if state.VotedFor != nil {
		vote = *state.VotedFor
	}
	log.events = append(log.events, fmt.Sprintf("hardstate-sync(term=%d,vote=%d,commit=%d)", state.CurrentTerm, vote, state.CommitIndex))
	return nil
}

func (log *memoryLog) LastLogIndex() uint64 { return uint64(len(log.frames)) }

func (log *memoryLog) Term(index uint64) (uint64, error) {
	if index == 0 || index > uint64(len(log.frames)) {
		return 0, errors.New("missing log index")
	}
	return log.frames[index-1].Term, nil
}

func (log *memoryLog) ReadEntries(from uint64, maxBytes int) ([]storage.Frame, error) {
	if from == 0 || maxBytes <= 0 {
		return nil, errors.New("invalid read")
	}
	result := make([]storage.Frame, 0)
	used := 0
	for index := from; index <= uint64(len(log.frames)); index++ {
		frame := log.frames[index-1]
		encoded, err := storage.EncodeFrame(frame)
		if err != nil {
			return nil, err
		}
		if len(result) == 0 && len(encoded) > maxBytes {
			return nil, errors.New("budget too small")
		}
		if used+len(encoded) > maxBytes {
			break
		}
		result = append(result, cloneFrames([]storage.Frame{frame})[0])
		used += len(encoded)
	}
	return result, nil
}

func (log *memoryLog) AppendEntries(entries []storage.Frame) error {
	expected := uint64(len(log.frames) + 1)
	for _, entry := range entries {
		if entry.LogIndex != expected {
			return errors.New("append gap")
		}
		if _, err := storage.EncodeFrame(entry); err != nil {
			return err
		}
		log.frames = append(log.frames, cloneFrames([]storage.Frame{entry})[0])
		log.events = append(log.events, fmt.Sprintf("wal-sync(index=%d)", entry.LogIndex))
		expected++
	}
	return nil
}

func (log *memoryLog) TruncateSuffix(from uint64) error {
	if from <= log.state.CommitIndex {
		return storage.ErrCommittedTruncate
	}
	if from == 0 || from > uint64(len(log.frames)+1) {
		return errors.New("invalid truncate")
	}
	log.frames = log.frames[:from-1]
	log.events = append(log.events, fmt.Sprintf("truncate-sync(from=%d)", from))
	return nil
}

func (log *memoryLog) LEO() uint64 {
	var leo uint64
	for _, frame := range log.frames {
		if frame.Kind != storage.KindData {
			continue
		}
		var payload storage.DataPayload
		if err := json.Unmarshal(frame.Payload, &payload); err == nil {
			leo += uint64(len(payload.Records))
		}
	}
	return leo
}

type memoryCluster struct {
	nodes          map[uint32]*Node
	logs           map[uint32]*memoryLog
	queue          []Message
	blocked        map[[2]uint32]bool
	completedReads map[string]bool
}

func newMemoryCluster(t *testing.T) *memoryCluster {
	t.Helper()
	cluster := &memoryCluster{
		nodes: make(map[uint32]*Node), logs: make(map[uint32]*memoryLog),
		blocked: make(map[[2]uint32]bool), completedReads: make(map[string]bool),
	}
	for id := uint32(1); id <= 3; id++ {
		cluster.logs[id] = newMemoryLog()
		cluster.restart(t, id)
	}
	return cluster
}

func newTestNode(t *testing.T, id uint32, log DurableLog) *Node {
	t.Helper()
	node, err := NewNode(Config{
		Identity: testIdentity, NodeID: id, Voters: []uint32{1, 2, 3},
		ElectionTimeoutTicks: 5 + uint64(id), HeartbeatTicks: 2,
	}, log)
	if err != nil {
		t.Fatal(err)
	}
	return node
}

func (cluster *memoryCluster) restart(t *testing.T, id uint32) {
	t.Helper()
	cluster.nodes[id] = newTestNode(t, id, cluster.logs[id])
}

func (cluster *memoryCluster) campaign(t *testing.T, id uint32) Ready {
	t.Helper()
	ready, err := cluster.nodes[id].Campaign()
	if err != nil {
		t.Fatal(err)
	}
	return ready
}

func (cluster *memoryCluster) tick(t *testing.T, id uint32) Ready {
	t.Helper()
	ready, err := cluster.nodes[id].Tick()
	if err != nil {
		t.Fatal(err)
	}
	return ready
}

func (cluster *memoryCluster) enqueueReady(t *testing.T, _ uint32, ready Ready) {
	t.Helper()
	cluster.queue = append(cluster.queue, ready.Messages...)
	for _, state := range ready.ReadStates {
		cluster.completedReads[state.Context] = true
	}
}

func (cluster *memoryCluster) deliverMatching(t *testing.T, match func(Message) bool) bool {
	t.Helper()
	for index, message := range cluster.queue {
		if !match(message) {
			continue
		}
		cluster.queue = append(cluster.queue[:index], cluster.queue[index+1:]...)
		cluster.deliver(t, message)
		return true
	}
	return false
}

func (cluster *memoryCluster) deliver(t *testing.T, message Message) {
	t.Helper()
	if cluster.blocked[[2]uint32{message.From, message.To}] {
		return
	}
	ready, err := cluster.nodes[message.To].Step(message)
	if err != nil {
		t.Fatalf("deliver %s %d->%d term %d: %v", message.Kind, message.From, message.To, message.Term, err)
	}
	cluster.enqueueReady(t, message.To, ready)
}

func (cluster *memoryCluster) drain(t *testing.T, limit int) {
	t.Helper()
	for len(cluster.queue) > 0 && limit > 0 {
		message := cluster.queue[0]
		cluster.queue = cluster.queue[1:]
		cluster.deliver(t, message)
		limit--
	}
	if limit == 0 && len(cluster.queue) > 0 {
		t.Fatalf("message queue did not quiesce (%d remain)", len(cluster.queue))
	}
}

func (cluster *memoryCluster) isolate(id uint32) {
	for peer := uint32(1); peer <= 3; peer++ {
		if peer != id {
			cluster.blocked[[2]uint32{id, peer}] = true
			cluster.blocked[[2]uint32{peer, id}] = true
		}
	}
}

func (cluster *memoryCluster) deliverRandom(t *testing.T, random *rand.Rand) {
	t.Helper()
	if len(cluster.queue) == 0 {
		return
	}
	index := random.Intn(len(cluster.queue))
	message := cluster.queue[index]
	cluster.queue = append(cluster.queue[:index], cluster.queue[index+1:]...)
	cluster.deliver(t, message)
}

func (cluster *memoryCluster) dropRandom(random *rand.Rand) {
	if len(cluster.queue) == 0 {
		return
	}
	index := random.Intn(len(cluster.queue))
	cluster.queue = append(cluster.queue[:index], cluster.queue[index+1:]...)
}

func (cluster *memoryCluster) assertSafety(t *testing.T, seed int64, event int) {
	t.Helper()
	leaders := make(map[uint64]uint32)
	for id, node := range cluster.nodes {
		snapshot := node.Snapshot()
		if snapshot.CommitIndex > snapshot.LastLogIndex || snapshot.LastApplied != snapshot.CommitIndex {
			t.Fatalf("seed=%d event=%d invalid bounds on node %d: %#v", seed, event, id, snapshot)
		}
		if snapshot.Role == Leader {
			if other, exists := leaders[snapshot.Term]; exists && other != id {
				t.Fatalf("seed=%d event=%d leaders %d and %d in term %d", seed, event, other, id, snapshot.Term)
			}
			leaders[snapshot.Term] = id
		}
	}
	for left := uint32(1); left <= 3; left++ {
		for right := left + 1; right <= 3; right++ {
			through := cluster.logs[left].state.CommitIndex
			if cluster.logs[right].state.CommitIndex < through {
				through = cluster.logs[right].state.CommitIndex
			}
			for index := uint64(1); index <= through; index++ {
				if !frameEqual(cluster.logs[left].frames[index-1], cluster.logs[right].frames[index-1]) {
					t.Fatalf("seed=%d event=%d committed prefix differs at %d between %d and %d", seed, event, index, left, right)
				}
			}
		}
	}
}

var _ DurableLog = (*memoryLog)(nil)

type fixedRandom uint64

func (random fixedRandom) Uint64() (uint64, error) { return uint64(random), nil }
