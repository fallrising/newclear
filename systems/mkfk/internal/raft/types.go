// Package raft implements mkfk's deterministic, fixed-membership per-
// partition Raft core. It deliberately contains no ISR or client ack policy;
// those are M4 concerns layered above consensus.
package raft

import (
	"errors"
	"fmt"
	"sort"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const (
	MaxAppendEntries = 128
	MaxAppendBytes   = storage.MaxWALFrameBytes
)

type Role string

const (
	Follower  Role = "follower"
	Candidate Role = "candidate"
	Leader    Role = "leader"
)

type MessageKind string

const (
	MessageRequestVote         MessageKind = "request_vote"
	MessageRequestVoteResponse MessageKind = "request_vote_response"
	MessageAppendEntries       MessageKind = "append_entries"
	MessageAppendResponse      MessageKind = "append_entries_response"
)

type Identity struct {
	ClusterID  string
	ConfigHash string
	GroupID    string
}

type RequestVote struct {
	LastLogIndex uint64
	LastLogTerm  uint64
}

type RequestVoteResponse struct {
	Granted bool
}

type AppendEntries struct {
	PrevLogIndex uint64
	PrevLogTerm  uint64
	Entries      []storage.Frame
	LeaderCommit uint64
	ReadContext  string
}

type AppendResponse struct {
	Success       bool
	MatchedIndex  uint64
	ConflictIndex uint64
	ReadContext   string
}

type Message struct {
	Kind       MessageKind
	Identity   Identity
	From       uint32
	To         uint32
	Term       uint64
	RPCID      uint64
	Vote       *RequestVote
	VoteResp   *RequestVoteResponse
	Append     *AppendEntries
	AppendResp *AppendResponse
}

type RoleChange struct {
	From     Role
	To       Role
	Term     uint64
	LeaderID uint32
}

type ReadState struct {
	Context string
	Index   uint64
}

// DurableAck reports a current-term successful AppendEntries response after
// the core has validated it against the exact RPC that was sent.
type DurableAck struct {
	PeerID     uint32
	Term       uint64
	MatchIndex uint64
	RPCID      uint64
}

// Ready is the deterministic result of one Step, Tick, proposal, or read
// request. Messages are emitted only after any prerequisite storage sync has
// completed successfully.
type Ready struct {
	Messages    []Message
	Applied     []storage.Frame
	ReadStates  []ReadState
	DurableAcks []DurableAck
	RoleChanges []RoleChange
	LeaderReady bool
}

func (ready *Ready) merge(other Ready) {
	ready.Messages = append(ready.Messages, other.Messages...)
	ready.Applied = append(ready.Applied, other.Applied...)
	ready.ReadStates = append(ready.ReadStates, other.ReadStates...)
	ready.DurableAcks = append(ready.DurableAcks, other.DurableAcks...)
	ready.RoleChanges = append(ready.RoleChanges, other.RoleChanges...)
	ready.LeaderReady = other.LeaderReady
}

type Config struct {
	Identity             Identity
	NodeID               uint32
	Voters               []uint32
	ElectionTimeoutTicks uint64
	HeartbeatTicks       uint64
}

func (config Config) validate() (Config, error) {
	if config.Identity.ClusterID == "" || config.Identity.ConfigHash == "" || config.Identity.GroupID == "" {
		return Config{}, errors.New("cluster, config, and group identity are required")
	}
	if config.NodeID == 0 {
		return Config{}, errors.New("node ID must be positive")
	}
	if len(config.Voters) != 1 && len(config.Voters) != 3 {
		return Config{}, errors.New("M3 supports only RF1 and RF3 voter sets")
	}
	config.Voters = append([]uint32(nil), config.Voters...)
	sort.Slice(config.Voters, func(i, j int) bool { return config.Voters[i] < config.Voters[j] })
	foundSelf := false
	for index, voter := range config.Voters {
		if voter == 0 || index > 0 && voter == config.Voters[index-1] {
			return Config{}, errors.New("voters must be unique positive node IDs")
		}
		foundSelf = foundSelf || voter == config.NodeID
	}
	if !foundSelf {
		return Config{}, fmt.Errorf("node %d is not in its voter set", config.NodeID)
	}
	if config.ElectionTimeoutTicks < 2 {
		return Config{}, errors.New("election timeout must be at least two ticks")
	}
	if config.HeartbeatTicks == 0 || config.HeartbeatTicks >= config.ElectionTimeoutTicks {
		return Config{}, errors.New("heartbeat ticks must be positive and below election timeout")
	}
	return config, nil
}

type DurableLog interface {
	HardState() storage.HardState
	PersistHardState(storage.HardState) error
	LastLogIndex() uint64
	Term(uint64) (uint64, error)
	ReadEntries(uint64, int) ([]storage.Frame, error)
	AppendEntries([]storage.Frame) error
	TruncateSuffix(uint64) error
	LEO() uint64
}

type Snapshot struct {
	NodeID       uint32
	Role         Role
	Term         uint64
	VotedFor     *uint32
	LeaderID     uint32
	LastLogIndex uint64
	CommitIndex  uint64
	LastApplied  uint64
	LeaderReady  bool
	Quorum       int
}

var (
	ErrNotLeader      = errors.New("raft node is not leader")
	ErrLeaderNotReady = errors.New("leader has not committed its current-term NOOP")
	ErrIdentity       = errors.New("raft message identity mismatch")
)
