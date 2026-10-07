package transport

import (
	"context"
	"errors"
	"net/http"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// ErrUnknownPartition is returned by a FetchBackend that does not host the
// requested topic partition.
var ErrUnknownPartition = errors.New("unknown topic or partition")

// FetchBackend reads committed records below the high watermark after the
// partition leader's read barrier.
type FetchBackend interface {
	Fetch(context.Context, protocol.FetchRequest) (protocol.FetchResponseData, error)
}

type FetchHandler struct {
	backend FetchBackend
}

func NewFetchHandler(backend FetchBackend) (*FetchHandler, error) {
	if backend == nil {
		return nil, errors.New("fetch backend is required")
	}
	return &FetchHandler{backend: backend}, nil
}

func (handler *FetchHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get(RequestIDHeader)
	if err := protocol.ValidateRequestID(requestID); err != nil {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "X-Request-ID must be a valid safe token.")
		return
	}
	if request.URL.Path != "/v1/fetch" {
		writeNotApplied(response, http.StatusNotFound, requestID, "UNKNOWN_ENDPOINT", "The requested endpoint does not exist.")
		return
	}
	if request.Method != http.MethodGet {
		writeNotApplied(response, http.StatusMethodNotAllowed, requestID, "INVALID_REQUEST", "This endpoint accepts GET only.")
		return
	}
	fetchRequest, err := protocol.ParseFetchQuery(request.URL.Query())
	if err != nil {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "The fetch query does not match the v1 contract.")
		return
	}
	data, err := handler.backend.Fetch(request.Context(), fetchRequest)
	if err != nil {
		writeFetchError(response, requestID, err)
		return
	}
	writeJSON(response, http.StatusOK, protocol.FetchResponse{RequestID: requestID, Data: data})
}

func writeFetchError(response http.ResponseWriter, requestID string, err error) {
	apiError := protocol.APIError{Outcome: protocol.OutcomeNotApplicable}
	status := http.StatusServiceUnavailable
	var budget *storage.ReadBudgetTooSmallError
	switch {
	case errors.As(err, &budget):
		status, apiError.Code = http.StatusBadRequest, "FETCH_BUDGET_TOO_SMALL"
		apiError.Message = "The first record exceeds max_bytes."
		apiError.Details = map[string]any{"required_bytes": budget.RequiredBytes}
	case errors.Is(err, storage.ErrOffsetOutOfRange):
		status, apiError.Code = http.StatusConflict, "OFFSET_OUT_OF_RANGE"
		apiError.Message = "The offset is beyond the committed high watermark."
	case errors.Is(err, ErrUnknownPartition):
		status, apiError.Code = http.StatusNotFound, "UNKNOWN_TOPIC_OR_PARTITION"
		apiError.Message = "The topic partition does not exist."
	case errors.Is(err, raft.ErrNotLeader):
		status, apiError.Code, apiError.Retryable = http.StatusConflict, "NOT_LEADER", true
		apiError.Message = "This broker is not the partition leader."
		apiError.Details = hintDetails(err)
	case errors.Is(err, raft.ErrLeaderNotReady), errors.Is(err, replication.ErrReadBarrier):
		apiError.Code, apiError.Retryable = "NOT_READY", true
		apiError.Message = "The leader has not completed its read barrier."
	case errors.Is(err, replication.ErrBackpressure):
		status, apiError.Code, apiError.Retryable = http.StatusTooManyRequests, "RESOURCE_EXHAUSTED", true
		apiError.Message = "The partition read capacity is exhausted."
	default:
		apiError.Code, apiError.Retryable = "DEPENDENCY_UNAVAILABLE", true
		apiError.Message = "The fetch could not be completed."
	}
	writeError(response, status, requestID, apiError)
}
