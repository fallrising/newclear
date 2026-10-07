package transport

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"strings"

	"github.com/fallrising/newclear/systems/mkfk/internal/group"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

const groupsPrefix = "/v1/groups/"

// GroupBackend serves consumer-group commands. CommittedOffsets must complete
// a Raft read barrier before reading coordinator state.
type GroupBackend interface {
	JoinGroup(context.Context, string, protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error)
	SyncGroup(context.Context, string, protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error)
	Heartbeat(context.Context, string, protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error)
	LeaveGroup(context.Context, string, protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error)
	CommitOffsets(context.Context, string, protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error)
	CommittedOffsets(context.Context, string, []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error)
}

type GroupHandler struct {
	backend GroupBackend
}

func NewGroupHandler(backend GroupBackend) (*GroupHandler, error) {
	if backend == nil {
		return nil, errors.New("group backend is required")
	}
	return &GroupHandler{backend: backend}, nil
}

type groupCall struct {
	response  http.ResponseWriter
	request   *http.Request
	requestID string
	groupID   string
	mutating  bool
}

func (handler *GroupHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get(RequestIDHeader)
	if err := protocol.ValidateRequestID(requestID); err != nil {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "X-Request-ID must be a valid safe token.")
		return
	}
	groupID, action, found := strings.Cut(strings.TrimPrefix(request.URL.Path, groupsPrefix), "/")
	if !strings.HasPrefix(request.URL.Path, groupsPrefix) || !found {
		writeNotApplied(response, http.StatusNotFound, requestID, "UNKNOWN_ENDPOINT", "The requested endpoint does not exist.")
		return
	}
	if protocol.ValidateGroupID(groupID) != nil {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "The group ID must be a valid safe token.")
		return
	}
	call := groupCall{response: response, request: request, requestID: requestID, groupID: groupID, mutating: true}
	if action == "offsets" {
		call.mutating = false
		handler.getOffsets(call)
		return
	}
	body, ok := readJSONPost(response, request, requestID)
	if !ok {
		return
	}
	switch action {
	case "join":
		serveGroup(call, body, handler.backend.JoinGroup, wrapJoin)
	case "sync":
		serveGroup(call, body, handler.backend.SyncGroup, wrapSync)
	case "heartbeat":
		call.mutating = false
		serveGroup(call, body, handler.backend.Heartbeat, wrapHeartbeat)
	case "leave":
		serveGroup(call, body, handler.backend.LeaveGroup, wrapLeave)
	case "offsets/commit":
		serveGroup(call, body, handler.backend.CommitOffsets, wrapCommit)
	default:
		writeNotApplied(response, http.StatusNotFound, requestID, "UNKNOWN_ENDPOINT", "The requested endpoint does not exist.")
	}
}

func (handler *GroupHandler) getOffsets(call groupCall) {
	if call.request.Method != http.MethodGet {
		writeNotApplied(call.response, http.StatusMethodNotAllowed, call.requestID, "INVALID_REQUEST", "This endpoint accepts GET only.")
		return
	}
	partitions, err := protocol.ParseOffsetsQuery(call.request.URL.Query())
	if err != nil {
		writeNotApplied(call.response, http.StatusBadRequest, call.requestID, "INVALID_REQUEST", "The offsets query does not match the v1 contract.")
		return
	}
	data, err := handler.backend.CommittedOffsets(call.request.Context(), call.groupID, partitions)
	if err != nil {
		writeGroupError(call, err)
		return
	}
	writeJSON(call.response, http.StatusOK, protocol.GetOffsetsResponse{RequestID: call.requestID, Data: data})
}

type validator interface{ Validate() error }

// serveGroup decodes and validates one POST body, calls the backend, and
// writes the success envelope built by wrap.
func serveGroup[Request validator, Data any](call groupCall, body []byte,
	backend func(context.Context, string, Request) (Data, error), wrap func(string, Data) any) {
	var request Request
	if err := protocol.DecodeJSON(body, &request); err != nil || request.Validate() != nil {
		writeInvalid(call.response, call.requestID)
		return
	}
	data, err := backend(call.request.Context(), call.groupID, request)
	if err != nil {
		writeGroupError(call, err)
		return
	}
	writeJSON(call.response, http.StatusOK, wrap(call.requestID, data))
}

func wrapJoin(id string, data protocol.JoinGroupResponseData) any {
	return protocol.JoinGroupResponse{RequestID: id, Data: data}
}

func wrapSync(id string, data protocol.SyncGroupResponseData) any {
	return protocol.SyncGroupResponse{RequestID: id, Data: data}
}

func wrapHeartbeat(id string, data protocol.HeartbeatResponseData) any {
	return protocol.HeartbeatResponse{RequestID: id, Data: data}
}

func wrapLeave(id string, data protocol.LeaveGroupResponseData) any {
	return protocol.LeaveGroupResponse{RequestID: id, Data: data}
}

func wrapCommit(id string, data protocol.CommitOffsetsResponseData) any {
	return protocol.CommitOffsetsResponse{RequestID: id, Data: data}
}

var groupStatus = map[group.ErrorCode]int{
	group.CodeIllegalGeneration: http.StatusConflict, group.CodeNotOwner: http.StatusConflict,
	group.CodeRebalanceInProgress: http.StatusConflict, group.CodeOffsetOutOfRange: http.StatusConflict,
	group.CodeOffsetRegression: http.StatusConflict, group.CodeRequestConflict: http.StatusConflict,
	group.CodeNotCoordinator: http.StatusConflict, group.CodeUnknownTopic: http.StatusNotFound,
	group.CodeInvalidRequest: http.StatusBadRequest, group.CodeResourceExhausted: http.StatusTooManyRequests,
	group.CodeDependencyFailed: http.StatusServiceUnavailable,
}

var groupRetryable = map[group.ErrorCode]bool{
	group.CodeRebalanceInProgress: true, group.CodeNotCoordinator: true,
	group.CodeResourceExhausted: true, group.CodeDependencyFailed: true,
}

// writeGroupError maps backend errors to 03 §1. A rejected command changed
// nothing; a command whose entry may have committed is outcome unknown.
func writeGroupError(call groupCall, err error) {
	outcome := protocol.OutcomeNotApplied
	if !call.mutating {
		outcome = protocol.OutcomeNotApplicable
	}
	var groupErr *group.Error
	switch {
	case errors.As(err, &groupErr):
		status, known := groupStatus[groupErr.Code]
		if !known {
			status = http.StatusServiceUnavailable
		}
		writeError(call.response, status, call.requestID, protocol.APIError{
			Code: string(groupErr.Code), Message: groupErr.Message, Retryable: groupRetryable[groupErr.Code], Outcome: outcome,
			Details: hintDetails(err),
		})
	case errors.Is(err, group.ErrOutcomeUnknown):
		writeUnknownTimeout(call.response, call.requestID, "The group command outcome is unknown; retry the identical request.")
	case errors.Is(err, raft.ErrNotLeader), errors.Is(err, raft.ErrLeaderNotReady):
		writeError(call.response, http.StatusConflict, call.requestID, protocol.APIError{
			Code: string(group.CodeNotCoordinator), Message: "This broker is not the serving group coordinator.",
			Retryable: true, Outcome: outcome, Details: hintDetails(err),
		})
	default:
		if call.mutating {
			outcome = protocol.OutcomeUnknown
		}
		writeError(call.response, http.StatusServiceUnavailable, call.requestID, protocol.APIError{
			Code: string(group.CodeDependencyFailed), Message: "The group operation could not be completed.",
			Retryable: true, Outcome: outcome,
		})
	}
}

// readJSONPost enforces POST, application/json and the body limit.
func readJSONPost(response http.ResponseWriter, request *http.Request, requestID string) ([]byte, bool) {
	if request.Method != http.MethodPost {
		writeNotApplied(response, http.StatusMethodNotAllowed, requestID, "INVALID_REQUEST", "This endpoint accepts POST only.")
		return nil, false
	}
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "Content-Type must be application/json.")
		return nil, false
	}
	body, tooLarge, err := readBoundedBody(request.Body)
	if err != nil {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "The request body could not be read.")
		return nil, false
	}
	if tooLarge {
		writeNotApplied(response, http.StatusRequestEntityTooLarge, requestID, "REQUEST_TOO_LARGE", "The request body exceeds the configured limit.")
		return nil, false
	}
	return body, true
}

func writeNotApplied(response http.ResponseWriter, status int, requestID, code, message string) {
	writeError(response, status, requestID, protocol.APIError{Code: code, Message: message, Outcome: protocol.OutcomeNotApplied})
}
