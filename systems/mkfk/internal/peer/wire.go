// Package peer carries Raft RPCs between brokers as HTTP/JSON (ADR-008,
// ADR-011). Each request names its cluster, topology hash, and partition;
// the response body carries the algorithm-level reply, never just a 200.
package peer

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const (
	MaxBodyBytes      = 8 << 20
	PathRequestVote   = "/peer/v1/request-vote"
	PathAppendEntries = "/peer/v1/append-entries"
	PathReadBarrier   = "/peer/v1/read-barrier"
	PathHighWatermark = "/peer/v1/high-watermark"
)

type Partition struct {
	Topic string `json:"topic"`
	ID    uint32 `json:"id"`
}

type Entry struct {
	Kind          uint8                  `json:"kind"`
	LogIndex      protocol.DecimalUint64 `json:"log_index"`
	Term          protocol.DecimalUint64 `json:"term"`
	PayloadBase64 string                 `json:"payload_base64"`
}

type Vote struct {
	LastLogIndex protocol.DecimalUint64 `json:"last_log_index"`
	LastLogTerm  protocol.DecimalUint64 `json:"last_log_term"`
}

type VoteResponse struct {
	VoteGranted bool `json:"vote_granted"`
}

type Append struct {
	PrevLogIndex protocol.DecimalUint64 `json:"prev_log_index"`
	PrevLogTerm  protocol.DecimalUint64 `json:"prev_log_term"`
	LeaderCommit protocol.DecimalUint64 `json:"leader_commit"`
	ReadContext  string                 `json:"read_context"`
	Entries      []Entry                `json:"entries"`
}

type AppendResponse struct {
	Success       bool                   `json:"success"`
	MatchedIndex  protocol.DecimalUint64 `json:"matched_index"`
	ConflictIndex protocol.DecimalUint64 `json:"conflict_index"`
	ReadContext   string                 `json:"read_context"`
}

// Message is the wire form of one raft.Message.
type Message struct {
	ClusterID      string                 `json:"cluster_id"`
	ConfigHash     string                 `json:"config_hash"`
	Partition      Partition              `json:"partition"`
	Kind           string                 `json:"kind"`
	From           uint32                 `json:"from"`
	To             uint32                 `json:"to"`
	Term           protocol.DecimalUint64 `json:"term"`
	RPCID          protocol.DecimalUint64 `json:"rpc_id"`
	Vote           *Vote                  `json:"vote,omitempty"`
	VoteResponse   *VoteResponse          `json:"vote_response,omitempty"`
	Append         *Append                `json:"append,omitempty"`
	AppendResponse *AppendResponse        `json:"append_response,omitempty"`
}

// StepResponse carries the receiver's reply to one request; Reply is nil
// only when the Raft core produced none.
type StepResponse struct {
	Reply *Message `json:"reply"`
}

type HighWatermarkRequest struct {
	ClusterID  string    `json:"cluster_id"`
	ConfigHash string    `json:"config_hash"`
	Partition  Partition `json:"partition"`
}

type HighWatermarkResponse struct {
	HighWatermark protocol.DecimalUint64 `json:"high_watermark"`
}

type ErrorBody struct {
	Error WireError `json:"error"`
}

type WireError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	LeaderID uint32 `json:"leader_id,omitempty"`
}

// GroupID names a partition's Raft group, e.g. "events/0".
func GroupID(topic string, partition uint32) string {
	return topic + "/" + strconv.FormatUint(uint64(partition), 10)
}

func parseGroupID(group string) (Partition, error) {
	separator := strings.LastIndexByte(group, '/')
	if separator <= 0 {
		return Partition{}, fmt.Errorf("invalid Raft group %q", group)
	}
	id, err := strconv.ParseUint(group[separator+1:], 10, 32)
	if err != nil {
		return Partition{}, fmt.Errorf("invalid Raft group %q", group)
	}
	return Partition{Topic: group[:separator], ID: uint32(id)}, nil
}

func (p Partition) validate() error {
	return config.ValidateTopicName(p.Topic, p.Topic == "__mkfk_groups")
}

// Encode converts a Raft message to its wire form.
func Encode(message raft.Message) (Message, error) {
	partition, err := parseGroupID(message.Identity.GroupID)
	if err != nil {
		return Message{}, err
	}
	wire := Message{
		ClusterID: message.Identity.ClusterID, ConfigHash: message.Identity.ConfigHash, Partition: partition,
		Kind: string(message.Kind), From: message.From, To: message.To,
		Term: protocol.DecimalUint64(message.Term), RPCID: protocol.DecimalUint64(message.RPCID),
	}
	if vote := message.Vote; vote != nil {
		wire.Vote = &Vote{LastLogIndex: protocol.DecimalUint64(vote.LastLogIndex), LastLogTerm: protocol.DecimalUint64(vote.LastLogTerm)}
	}
	if response := message.VoteResp; response != nil {
		wire.VoteResponse = &VoteResponse{VoteGranted: response.Granted}
	}
	if request := message.Append; request != nil {
		wire.Append = &Append{
			PrevLogIndex: protocol.DecimalUint64(request.PrevLogIndex), PrevLogTerm: protocol.DecimalUint64(request.PrevLogTerm),
			LeaderCommit: protocol.DecimalUint64(request.LeaderCommit), ReadContext: request.ReadContext,
			Entries: make([]Entry, 0, len(request.Entries)),
		}
		for _, frame := range request.Entries {
			wire.Append.Entries = append(wire.Append.Entries, Entry{
				Kind: uint8(frame.Kind), LogIndex: protocol.DecimalUint64(frame.LogIndex), Term: protocol.DecimalUint64(frame.Term),
				PayloadBase64: base64.StdEncoding.EncodeToString(frame.Payload),
			})
		}
	}
	if response := message.AppendResp; response != nil {
		wire.AppendResponse = &AppendResponse{
			Success: response.Success, MatchedIndex: protocol.DecimalUint64(response.MatchedIndex),
			ConflictIndex: protocol.DecimalUint64(response.ConflictIndex), ReadContext: response.ReadContext,
		}
	}
	return wire, nil
}

// Decode validates the wire form and converts it back. Raft re-validates
// identity, terms, and log matching; this only bounds and parses.
func Decode(wire Message) (raft.Message, error) {
	if err := wire.Partition.validate(); err != nil {
		return raft.Message{}, err
	}
	if len(wire.ReadContextOrEmpty()) > 128 {
		return raft.Message{}, errors.New("read context is too long")
	}
	message := raft.Message{
		Kind: raft.MessageKind(wire.Kind),
		Identity: raft.Identity{
			ClusterID: wire.ClusterID, ConfigHash: wire.ConfigHash, GroupID: GroupID(wire.Partition.Topic, wire.Partition.ID),
		},
		From: wire.From, To: wire.To, Term: uint64(wire.Term), RPCID: uint64(wire.RPCID),
	}
	if vote := wire.Vote; vote != nil {
		message.Vote = &raft.RequestVote{LastLogIndex: uint64(vote.LastLogIndex), LastLogTerm: uint64(vote.LastLogTerm)}
	}
	if response := wire.VoteResponse; response != nil {
		message.VoteResp = &raft.RequestVoteResponse{Granted: response.VoteGranted}
	}
	if request := wire.Append; request != nil {
		if len(request.Entries) > raft.MaxAppendEntries {
			return raft.Message{}, fmt.Errorf("AppendEntries carries more than %d entries", raft.MaxAppendEntries)
		}
		message.Append = &raft.AppendEntries{
			PrevLogIndex: uint64(request.PrevLogIndex), PrevLogTerm: uint64(request.PrevLogTerm),
			LeaderCommit: uint64(request.LeaderCommit), ReadContext: request.ReadContext,
		}
		for _, entry := range request.Entries {
			payload, err := base64.StdEncoding.Strict().DecodeString(entry.PayloadBase64)
			if err != nil {
				return raft.Message{}, errors.New("entry payload is not valid base64")
			}
			frame := storage.Frame{Kind: storage.EntryKind(entry.Kind), LogIndex: uint64(entry.LogIndex), Term: uint64(entry.Term), Payload: payload}
			if err := frame.Validate(); err != nil {
				return raft.Message{}, err
			}
			message.Append.Entries = append(message.Append.Entries, frame)
		}
	}
	if response := wire.AppendResponse; response != nil {
		message.AppendResp = &raft.AppendResponse{
			Success: response.Success, MatchedIndex: uint64(response.MatchedIndex),
			ConflictIndex: uint64(response.ConflictIndex), ReadContext: response.ReadContext,
		}
	}
	return message, nil
}

// ReadContextOrEmpty returns the read context an AppendEntries or its
// response carries.
func (m Message) ReadContextOrEmpty() string {
	switch {
	case m.Append != nil:
		return m.Append.ReadContext
	case m.AppendResponse != nil:
		return m.AppendResponse.ReadContext
	}
	return ""
}
