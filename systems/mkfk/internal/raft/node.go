package raft

import (
	"bytes"
	"errors"
	"fmt"
	"math"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

type peerProgress struct {
	nextIndex  uint64
	matchIndex uint64
	latestRPC  uint64
}

type sentAppend struct {
	peer        uint32
	term        uint64
	prevIndex   uint64
	lastIndex   uint64
	readContext string
	readIndex   uint64
}

type pendingRead struct {
	index uint64
	acks  map[uint32]struct{}
}

type Node struct {
	config           Config
	log              DurableLog
	role             Role
	term             uint64
	votedFor         *uint32
	leaderID         uint32
	commitIndex      uint64
	lastApplied      uint64
	electionElapsed  uint64
	heartbeatElapsed uint64
	votes            map[uint32]bool
	progress         map[uint32]*peerProgress
	rpcSequence      uint64
	sent             map[uint64]sentAppend
	pendingReads     map[string]*pendingRead
	noopIndex        uint64
	leaderReady      bool
	recoveredApplied []storage.Frame
}

func NewNode(config Config, log DurableLog) (*Node, error) {
	config, err := config.validate()
	if err != nil {
		return nil, err
	}
	if log == nil {
		return nil, errors.New("durable log is required")
	}
	hardState := log.HardState()
	node := &Node{
		config:       config,
		log:          log,
		role:         Follower,
		term:         hardState.CurrentTerm,
		votedFor:     cloneVote(hardState.VotedFor),
		commitIndex:  hardState.CommitIndex,
		votes:        make(map[uint32]bool),
		progress:     make(map[uint32]*peerProgress),
		sent:         make(map[uint64]sentAppend),
		pendingReads: make(map[string]*pendingRead),
	}
	if hardState.CommitIndex > 0 {
		applied, err := node.readRange(1, hardState.CommitIndex)
		if err != nil {
			return nil, fmt.Errorf("replay committed prefix: %w", err)
		}
		node.recoveredApplied = applied
		node.lastApplied = hardState.CommitIndex
	}
	return node, nil
}

func (node *Node) Snapshot() Snapshot {
	return Snapshot{
		NodeID:       node.config.NodeID,
		Role:         node.role,
		Term:         node.term,
		VotedFor:     cloneVote(node.votedFor),
		LeaderID:     node.leaderID,
		LastLogIndex: node.log.LastLogIndex(),
		CommitIndex:  node.commitIndex,
		LastApplied:  node.lastApplied,
		LeaderReady:  node.leaderReady,
		Quorum:       node.quorum(),
	}
}

func (node *Node) RecoveredApplied() []storage.Frame {
	result := cloneFrames(node.recoveredApplied)
	node.recoveredApplied = nil
	return result
}

// Entry returns a defensive copy for higher-level operation lookup. Consensus
// matching still uses the internal durable-log path.
func (node *Node) Entry(index uint64) (storage.Frame, error) {
	frame, err := node.readOne(index)
	if err != nil {
		return storage.Frame{}, err
	}
	frame.Payload = append([]byte(nil), frame.Payload...)
	return frame, nil
}

func (node *Node) Tick() (Ready, error) {
	ready := Ready{LeaderReady: node.leaderReady}
	if node.role == Leader {
		node.heartbeatElapsed++
		if node.heartbeatElapsed < node.config.HeartbeatTicks {
			return ready, nil
		}
		node.heartbeatElapsed = 0
		messages, err := node.broadcastAppend("")
		if err != nil {
			return Ready{}, err
		}
		ready.Messages = messages
		return ready, nil
	}
	node.electionElapsed++
	if node.electionElapsed < node.config.ElectionTimeoutTicks {
		return ready, nil
	}
	return node.startElection()
}

func (node *Node) Campaign() (Ready, error) {
	if node.role == Leader {
		return Ready{LeaderReady: node.leaderReady}, nil
	}
	return node.startElection()
}

func (node *Node) Step(message Message) (Ready, error) {
	ready := Ready{LeaderReady: node.leaderReady}
	if err := node.validateMessage(message); err != nil {
		return Ready{}, err
	}
	if message.Term > node.term {
		change, err := node.becomeFollower(message.Term, 0)
		if err != nil {
			return Ready{}, err
		}
		if change != nil {
			ready.RoleChanges = append(ready.RoleChanges, *change)
		}
	}
	switch message.Kind {
	case MessageRequestVote:
		result, err := node.stepRequestVote(message)
		ready.merge(result)
		return ready, err
	case MessageRequestVoteResponse:
		result, err := node.stepVoteResponse(message)
		ready.merge(result)
		return ready, err
	case MessageAppendEntries:
		result, err := node.stepAppendEntries(message)
		ready.merge(result)
		return ready, err
	case MessageAppendResponse:
		result, err := node.stepAppendResponse(message)
		ready.merge(result)
		return ready, err
	default:
		return Ready{}, fmt.Errorf("unknown message kind %q", message.Kind)
	}
}

func (node *Node) ProposeData(timestamp uint64, records []storage.DataRecord) (uint64, Ready, error) {
	if node.role != Leader {
		return 0, Ready{}, ErrNotLeader
	}
	if !node.leaderReady {
		return 0, Ready{}, ErrLeaderNotReady
	}
	index := node.log.LastLogIndex() + 1
	frame, err := storage.NewStandaloneDataFrame(index, node.term, node.log.LEO(), timestamp, records)
	if err != nil {
		return 0, Ready{}, err
	}
	ready, err := node.proposeFrame(frame)
	return index, ready, err
}

func (node *Node) ProposeFrame(kind storage.EntryKind, payload []byte) (uint64, Ready, error) {
	if node.role != Leader {
		return 0, Ready{}, ErrNotLeader
	}
	if !node.leaderReady {
		return 0, Ready{}, ErrLeaderNotReady
	}
	index := node.log.LastLogIndex() + 1
	frame := storage.Frame{Kind: kind, LogIndex: index, Term: node.term, Payload: append([]byte(nil), payload...)}
	ready, err := node.proposeFrame(frame)
	return index, ready, err
}

func (node *Node) RequestRead(context string) (Ready, error) {
	if node.role != Leader {
		return Ready{}, ErrNotLeader
	}
	if !node.leaderReady {
		return Ready{}, ErrLeaderNotReady
	}
	if context == "" {
		return Ready{}, errors.New("read context is required")
	}
	if _, exists := node.pendingReads[context]; exists {
		return Ready{}, errors.New("read context is already pending")
	}
	request := &pendingRead{index: node.commitIndex, acks: map[uint32]struct{}{node.config.NodeID: {}}}
	node.pendingReads[context] = request
	ready := Ready{LeaderReady: node.leaderReady}
	if node.quorum() == 1 {
		ready.ReadStates = append(ready.ReadStates, ReadState{Context: context, Index: request.index})
		delete(node.pendingReads, context)
		return ready, nil
	}
	messages, err := node.broadcastAppend(context)
	if err != nil {
		delete(node.pendingReads, context)
		return Ready{}, err
	}
	ready.Messages = messages
	return ready, nil
}

func (node *Node) startElection() (Ready, error) {
	if node.term == math.MaxInt64 {
		return Ready{}, errors.New("raft term overflow")
	}
	previousRole := node.role
	newTerm := node.term + 1
	self := node.config.NodeID
	state := storage.HardState{CurrentTerm: newTerm, VotedFor: &self, CommitIndex: node.commitIndex}
	if err := node.log.PersistHardState(state); err != nil {
		return Ready{}, fmt.Errorf("persist self vote: %w", err)
	}
	node.term = newTerm
	node.votedFor = &self
	node.role = Candidate
	node.leaderID = 0
	node.electionElapsed = 0
	node.votes = map[uint32]bool{self: true}
	node.clearLeaderState()
	ready := Ready{
		LeaderReady: false,
		RoleChanges: []RoleChange{{From: previousRole, To: Candidate, Term: node.term}},
	}
	if node.quorum() == 1 {
		leaderReady, err := node.becomeLeader()
		ready.merge(leaderReady)
		return ready, err
	}
	lastIndex := node.log.LastLogIndex()
	lastTerm, err := node.termAt(lastIndex)
	if err != nil {
		return Ready{}, err
	}
	for _, voter := range node.config.Voters {
		if voter == self {
			continue
		}
		ready.Messages = append(ready.Messages, Message{
			Kind:     MessageRequestVote,
			Identity: node.config.Identity,
			From:     self,
			To:       voter,
			Term:     node.term,
			RPCID:    node.nextRPCID(),
			Vote:     &RequestVote{LastLogIndex: lastIndex, LastLogTerm: lastTerm},
		})
	}
	return ready, nil
}

func (node *Node) becomeLeader() (Ready, error) {
	previousRole := node.role
	node.role = Leader
	node.leaderID = node.config.NodeID
	node.electionElapsed = 0
	node.heartbeatElapsed = 0
	node.votes = make(map[uint32]bool)
	node.progress = make(map[uint32]*peerProgress)
	node.sent = make(map[uint64]sentAppend)
	node.pendingReads = make(map[string]*pendingRead)
	node.leaderReady = false
	next := node.log.LastLogIndex() + 1
	for _, voter := range node.config.Voters {
		if voter != node.config.NodeID {
			node.progress[voter] = &peerProgress{nextIndex: next}
		}
	}
	noop := storage.Frame{Kind: storage.KindNOOP, LogIndex: next, Term: node.term, Payload: []byte("{}")}
	if err := node.log.AppendEntries([]storage.Frame{noop}); err != nil {
		node.role = Follower
		node.leaderID = 0
		node.clearLeaderState()
		return Ready{}, fmt.Errorf("persist leader NOOP: %w", err)
	}
	node.noopIndex = next
	ready := Ready{RoleChanges: []RoleChange{{From: previousRole, To: Leader, Term: node.term, LeaderID: node.config.NodeID}}}
	applied, err := node.advanceCommit()
	if err != nil {
		return Ready{}, err
	}
	ready.Applied = append(ready.Applied, applied...)
	messages, err := node.broadcastAppend("")
	if err != nil {
		return Ready{}, err
	}
	ready.Messages = append(ready.Messages, messages...)
	ready.LeaderReady = node.leaderReady
	return ready, nil
}

func (node *Node) becomeFollower(term uint64, leaderID uint32) (*RoleChange, error) {
	previousRole := node.role
	if term < node.term {
		return nil, errors.New("cannot move to an older term")
	}
	if term > node.term {
		state := storage.HardState{CurrentTerm: term, CommitIndex: node.commitIndex}
		if err := node.log.PersistHardState(state); err != nil {
			return nil, fmt.Errorf("persist higher term: %w", err)
		}
		node.term = term
		node.votedFor = nil
	}
	node.role = Follower
	node.leaderID = leaderID
	node.electionElapsed = 0
	node.clearLeaderState()
	if previousRole == Follower {
		return nil, nil
	}
	return &RoleChange{From: previousRole, To: Follower, Term: node.term, LeaderID: leaderID}, nil
}

func (node *Node) clearLeaderState() {
	node.progress = make(map[uint32]*peerProgress)
	node.sent = make(map[uint64]sentAppend)
	node.pendingReads = make(map[string]*pendingRead)
	node.noopIndex = 0
	node.leaderReady = false
	node.heartbeatElapsed = 0
}

func (node *Node) proposeFrame(frame storage.Frame) (Ready, error) {
	if err := node.log.AppendEntries([]storage.Frame{frame}); err != nil {
		return Ready{}, err
	}
	ready := Ready{LeaderReady: node.leaderReady}
	applied, err := node.advanceCommit()
	if err != nil {
		return Ready{}, err
	}
	ready.Applied = append(ready.Applied, applied...)
	messages, err := node.broadcastAppend("")
	if err != nil {
		return Ready{}, err
	}
	ready.Messages = messages
	ready.LeaderReady = node.leaderReady
	return ready, nil
}

func (node *Node) validateMessage(message Message) error {
	if message.Identity != node.config.Identity {
		return ErrIdentity
	}
	if message.To != node.config.NodeID || !node.isVoter(message.From) {
		return errors.New("raft message endpoint is not in the fixed voter set")
	}
	if message.Term == 0 || message.Term > math.MaxInt64 || message.RPCID == 0 {
		return errors.New("raft message term and RPC ID must be positive")
	}
	switch message.Kind {
	case MessageRequestVote:
		if message.Vote == nil || message.VoteResp != nil || message.Append != nil || message.AppendResp != nil {
			return errors.New("invalid RequestVote envelope")
		}
	case MessageRequestVoteResponse:
		if message.VoteResp == nil || message.Vote != nil || message.Append != nil || message.AppendResp != nil {
			return errors.New("invalid RequestVoteResponse envelope")
		}
	case MessageAppendEntries:
		if message.Append == nil || message.Vote != nil || message.VoteResp != nil || message.AppendResp != nil {
			return errors.New("invalid AppendEntries envelope")
		}
	case MessageAppendResponse:
		if message.AppendResp == nil || message.Vote != nil || message.VoteResp != nil || message.Append != nil {
			return errors.New("invalid AppendResponse envelope")
		}
	default:
		return errors.New("unknown raft message kind")
	}
	return nil
}

func (node *Node) response(kind MessageKind, request Message) Message {
	return Message{
		Kind:     kind,
		Identity: node.config.Identity,
		From:     node.config.NodeID,
		To:       request.From,
		Term:     node.term,
		RPCID:    request.RPCID,
	}
}

func (node *Node) quorum() int {
	return len(node.config.Voters)/2 + 1
}

func (node *Node) isVoter(id uint32) bool {
	for _, voter := range node.config.Voters {
		if voter == id {
			return true
		}
	}
	return false
}

func (node *Node) nextRPCID() uint64 {
	node.rpcSequence++
	if node.rpcSequence == 0 {
		panic("raft RPC ID overflow")
	}
	return node.rpcSequence
}

func (node *Node) termAt(index uint64) (uint64, error) {
	if index == 0 {
		return 0, nil
	}
	return node.log.Term(index)
}

func (node *Node) readOne(index uint64) (storage.Frame, error) {
	entries, err := node.log.ReadEntries(index, storage.MaxWALFrameBytes)
	if err != nil {
		return storage.Frame{}, err
	}
	if len(entries) == 0 || entries[0].LogIndex != index {
		return storage.Frame{}, fmt.Errorf("log index %d is missing", index)
	}
	return entries[0], nil
}

func (node *Node) readRange(from, through uint64) ([]storage.Frame, error) {
	if from > through {
		return nil, nil
	}
	result := make([]storage.Frame, 0, through-from+1)
	for index := from; index <= through; index++ {
		frame, err := node.readOne(index)
		if err != nil {
			return nil, err
		}
		result = append(result, frame)
	}
	return result, nil
}

func frameEqual(left, right storage.Frame) bool {
	return left.Kind == right.Kind && left.LogIndex == right.LogIndex && left.Term == right.Term && bytes.Equal(left.Payload, right.Payload)
}

func cloneVote(vote *uint32) *uint32 {
	if vote == nil {
		return nil
	}
	copy := *vote
	return &copy
}

func cloneFrames(frames []storage.Frame) []storage.Frame {
	result := make([]storage.Frame, len(frames))
	for i, frame := range frames {
		result[i] = frame
		result[i].Payload = append([]byte(nil), frame.Payload...)
	}
	return result
}
