package peer

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

var (
	ErrUnknownPartition = errors.New("this broker has no replica of the partition")
	ErrUnavailable      = errors.New("the partition is not serving")
)

// NotLeaderError is a NOT_LEADER answer with the leader this node last
// heard from (0 when unknown).
type NotLeaderError struct{ LeaderID uint32 }

func (e *NotLeaderError) Error() string { return raft.ErrNotLeader.Error() }
func (e *NotLeaderError) Unwrap() error { return raft.ErrNotLeader }

// Backend is the broker side of the peer listener.
type Backend interface {
	Step(ctx context.Context, request raft.Message) ([]raft.Message, error)
	HighWatermark(ctx context.Context, topic string, partition uint32) (uint64, error)
}

// Server serves /peer/v1/* for one broker of one cluster topology.
type Server struct {
	backend    Backend
	clusterID  string
	configHash string
}

func NewServer(backend Backend, clusterID, configHash string) (*Server, error) {
	if backend == nil || clusterID == "" || configHash == "" {
		return nil, errors.New("backend, cluster ID, and config hash are required")
	}
	return &Server{backend: backend, clusterID: clusterID, configHash: configHash}, nil
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" {
		writeError(response, http.StatusBadRequest, WireError{Code: "INVALID_REQUEST", Message: "peer RPCs are JSON POSTs"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, MaxBodyBytes+1))
	if err != nil || len(body) > MaxBodyBytes {
		writeError(response, http.StatusRequestEntityTooLarge, WireError{Code: "REQUEST_TOO_LARGE", Message: "peer body exceeds its cap"})
		return
	}
	if request.URL.Path == PathHighWatermark {
		s.highWatermark(response, request.Context(), body)
		return
	}
	var wire Message
	if err := jsonstrict.Decode(body, &wire); err != nil {
		writeError(response, http.StatusBadRequest, WireError{Code: "INVALID_REQUEST", Message: "malformed peer message"})
		return
	}
	if !pathMatches(request.URL.Path, wire) {
		writeError(response, http.StatusBadRequest, WireError{Code: "INVALID_REQUEST", Message: "message kind does not match the path"})
		return
	}
	if wire.ClusterID != s.clusterID || wire.ConfigHash != s.configHash {
		writeError(response, http.StatusConflict, WireError{Code: "IDENTITY_MISMATCH", Message: "cluster or topology hash differs"})
		return
	}
	message, err := Decode(wire)
	if err != nil {
		writeError(response, http.StatusBadRequest, WireError{Code: "INVALID_REQUEST", Message: "invalid peer message"})
		return
	}
	replies, err := s.backend.Step(request.Context(), message)
	if err != nil {
		writeBackendError(response, err)
		return
	}
	var reply StepResponse
	if len(replies) > 0 {
		encoded, err := Encode(replies[0])
		if err != nil {
			writeError(response, http.StatusInternalServerError, WireError{Code: "INTERNAL", Message: "reply could not be encoded"})
			return
		}
		reply.Reply = &encoded
	}
	writeJSON(response, http.StatusOK, reply)
}

func (s *Server) highWatermark(response http.ResponseWriter, ctx context.Context, body []byte) {
	var wire HighWatermarkRequest
	if err := jsonstrict.Decode(body, &wire); err != nil || wire.Partition.validate() != nil {
		writeError(response, http.StatusBadRequest, WireError{Code: "INVALID_REQUEST", Message: "malformed high-watermark request"})
		return
	}
	if wire.ClusterID != s.clusterID || wire.ConfigHash != s.configHash {
		writeError(response, http.StatusConflict, WireError{Code: "IDENTITY_MISMATCH", Message: "cluster or topology hash differs"})
		return
	}
	hw, err := s.backend.HighWatermark(ctx, wire.Partition.Topic, wire.Partition.ID)
	if err != nil {
		writeBackendError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, HighWatermarkResponse{HighWatermark: protocol.DecimalUint64(hw)})
}

// pathMatches binds each kind to one path: votes, appends without a read
// context, and read-barrier appends with one. Responses travel in replies.
func pathMatches(path string, wire Message) bool {
	switch path {
	case PathRequestVote:
		return wire.Kind == string(raft.MessageRequestVote)
	case PathAppendEntries:
		return wire.Kind == string(raft.MessageAppendEntries) && wire.ReadContextOrEmpty() == ""
	case PathReadBarrier:
		return wire.Kind == string(raft.MessageAppendEntries) && wire.ReadContextOrEmpty() != ""
	}
	return false
}

func writeBackendError(response http.ResponseWriter, err error) {
	var notLeader *NotLeaderError
	switch {
	case errors.As(err, &notLeader):
		writeError(response, http.StatusConflict, WireError{Code: "NOT_LEADER", Message: "not the partition leader", LeaderID: notLeader.LeaderID})
	case errors.Is(err, raft.ErrNotLeader):
		writeError(response, http.StatusConflict, WireError{Code: "NOT_LEADER", Message: "not the partition leader"})
	case errors.Is(err, ErrUnknownPartition):
		writeError(response, http.StatusNotFound, WireError{Code: "UNKNOWN_PARTITION", Message: "no local replica"})
	case errors.Is(err, ErrUnavailable), errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		writeError(response, http.StatusServiceUnavailable, WireError{Code: "NOT_READY", Message: "partition is not serving"})
	default:
		writeError(response, http.StatusConflict, WireError{Code: "REJECTED", Message: "the partition rejected the message"})
	}
}

func writeError(response http.ResponseWriter, status int, wire WireError) {
	writeJSON(response, status, ErrorBody{Error: wire})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
