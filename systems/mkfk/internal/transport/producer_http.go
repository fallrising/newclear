// Package transport implements bounded HTTP/JSON v1 adapters. Consensus and
// producer state remain owned by partition actors behind these interfaces.
package transport

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/fallrising/newclear/systems/mkfk/internal/producer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
)

const RequestIDHeader = "X-Request-ID"

type ProducerBackend interface {
	OpenProducer(context.Context, protocol.OpenProducerRequest) (producer.OpenResult, error)
	Produce(context.Context, string, protocol.ProduceRequest) (producer.ProduceResult, error)
}

type ProducerHandler struct {
	backend ProducerBackend
}

func NewProducerHandler(backend ProducerBackend) (*ProducerHandler, error) {
	if backend == nil {
		return nil, errors.New("producer backend is required")
	}
	return &ProducerHandler{backend: backend}, nil
}

func (handler *ProducerHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get(RequestIDHeader)
	if err := protocol.ValidateRequestID(requestID); err != nil {
		writeError(response, http.StatusBadRequest, requestID, protocol.APIError{
			Code: "INVALID_REQUEST", Message: "X-Request-ID must be a valid safe token.",
			Outcome: protocol.OutcomeNotApplied,
		})
		return
	}
	if request.Method != http.MethodPost {
		writeError(response, http.StatusMethodNotAllowed, requestID, protocol.APIError{
			Code: "INVALID_REQUEST", Message: "This endpoint accepts POST only.",
			Outcome: protocol.OutcomeNotApplied,
		})
		return
	}
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(response, http.StatusBadRequest, requestID, protocol.APIError{
			Code: "INVALID_REQUEST", Message: "Content-Type must be application/json.",
			Outcome: protocol.OutcomeNotApplied,
		})
		return
	}
	body, tooLarge, err := readBoundedBody(request.Body)
	if err != nil {
		writeError(response, http.StatusBadRequest, requestID, protocol.APIError{
			Code: "INVALID_REQUEST", Message: "The request body could not be read.",
			Outcome: protocol.OutcomeNotApplied,
		})
		return
	}
	if tooLarge {
		writeError(response, http.StatusRequestEntityTooLarge, requestID, protocol.APIError{
			Code: "REQUEST_TOO_LARGE", Message: "The request body exceeds the configured limit.",
			Outcome: protocol.OutcomeNotApplied,
		})
		return
	}
	switch request.URL.Path {
	case "/v1/producers/open":
		handler.open(response, request, requestID, body)
	case "/v1/produce":
		handler.produce(response, request, requestID, body)
	default:
		writeError(response, http.StatusNotFound, requestID, protocol.APIError{
			Code: "UNKNOWN_ENDPOINT", Message: "The requested endpoint does not exist.",
			Outcome: protocol.OutcomeNotApplied,
		})
	}
}

func (handler *ProducerHandler) open(response http.ResponseWriter, request *http.Request, requestID string, body []byte) {
	var openRequest protocol.OpenProducerRequest
	if err := protocol.DecodeJSON(body, &openRequest); err != nil {
		writeInvalid(response, requestID)
		return
	}
	if err := openRequest.Validate(); err != nil {
		writeInvalid(response, requestID)
		return
	}
	result, err := handler.backend.OpenProducer(request.Context(), openRequest)
	if err != nil {
		writeMappedError(response, requestID, err)
		return
	}
	if result.Status != producer.OperationSucceeded {
		writeUnknownTimeout(response, requestID, "The OpenProducer outcome is unknown; retry the identical request.")
		return
	}
	writeJSON(response, http.StatusOK, protocol.OpenProducerResponse{
		RequestID: requestID,
		Data: protocol.OpenProducerResponseData{
			ProducerID: result.ProducerID, Epoch: protocol.DecimalUint64(result.Epoch),
			LeaderTerm: protocol.DecimalUint64(result.LeaderTerm),
		},
	})
}

func (handler *ProducerHandler) produce(response http.ResponseWriter, request *http.Request, requestID string, body []byte) {
	var produceRequest protocol.ProduceRequest
	if err := protocol.DecodeJSON(body, &produceRequest); err != nil {
		writeInvalid(response, requestID)
		return
	}
	if _, err := produceRequest.Validate(); err != nil {
		code := "INVALID_REQUEST"
		if produceRequest.Acks != "all" {
			code = "UNSUPPORTED_ACKS"
		}
		writeError(response, http.StatusBadRequest, requestID, protocol.APIError{
			Code: code, Message: "The produce request is invalid.", Outcome: protocol.OutcomeNotApplied,
		})
		return
	}
	result, err := handler.backend.Produce(request.Context(), requestID, produceRequest)
	if err != nil {
		writeMappedError(response, requestID, err)
		return
	}
	if result.Status != producer.OperationSucceeded {
		writeUnknownTimeout(response, requestID, "The append outcome is unknown; retry the identical batch.")
		return
	}
	writeJSON(response, http.StatusOK, protocol.ProduceResponse{
		RequestID: requestID,
		Data: protocol.ProduceResponseData{
			BaseOffset: protocol.DecimalUint64(result.BaseOffset), LastOffset: protocol.DecimalUint64(result.LastOffset),
			NextSequence: protocol.DecimalUint64(result.NextSequence), Duplicate: result.Duplicate,
			LeaderTerm: protocol.DecimalUint64(result.LeaderTerm),
		},
	})
}

func readBoundedBody(body io.ReadCloser) ([]byte, bool, error) {
	defer body.Close()
	limited := io.LimitReader(body, int64(protocol.MaxHTTPBodyBytes)+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, false, err
	}
	return data, len(data) > protocol.MaxHTTPBodyBytes, nil
}

func writeInvalid(response http.ResponseWriter, requestID string) {
	writeError(response, http.StatusBadRequest, requestID, protocol.APIError{
		Code: "INVALID_REQUEST", Message: "The JSON request does not match the v1 contract.",
		Outcome: protocol.OutcomeNotApplied,
	})
}

func writeMappedError(response http.ResponseWriter, requestID string, err error) {
	var producerError *producer.Error
	if errors.As(err, &producerError) {
		status := http.StatusConflict
		retryable := false
		if producerError.Code == producer.CodeProducerBusy {
			retryable = true
		}
		if producerError.Code == producer.CodeProducerLimit {
			status = http.StatusTooManyRequests
			retryable = true
		}
		writeError(response, status, requestID, protocol.APIError{
			Code: string(producerError.Code), Message: producerError.Message,
			Retryable: retryable, Outcome: protocol.OutcomeNotApplied,
		})
		return
	}
	switch {
	case errors.Is(err, raft.ErrNotLeader):
		writeError(response, http.StatusConflict, requestID, protocol.APIError{
			Code: "NOT_LEADER", Message: "This broker is not the partition leader.", Retryable: true,
			Outcome: protocol.OutcomeNotApplied,
		})
	case errors.Is(err, raft.ErrLeaderNotReady):
		writeError(response, http.StatusServiceUnavailable, requestID, protocol.APIError{
			Code: "NOT_READY", Message: "The leader has not completed its current-term barrier.", Retryable: true,
			Outcome: protocol.OutcomeNotApplied,
		})
	case errors.Is(err, replication.ErrNotEnoughReplicas):
		writeError(response, http.StatusServiceUnavailable, requestID, protocol.APIError{
			Code: "NOT_ENOUGH_REPLICAS", Message: "The current ISR is below min_isr.", Retryable: true,
			Outcome: protocol.OutcomeNotApplied,
		})
	case errors.Is(err, replication.ErrBackpressure):
		writeError(response, http.StatusTooManyRequests, requestID, protocol.APIError{
			Code: "RESOURCE_EXHAUSTED", Message: "The partition request capacity is exhausted.", Retryable: true,
			Outcome: protocol.OutcomeNotApplied,
		})
	default:
		writeError(response, http.StatusServiceUnavailable, requestID, protocol.APIError{
			Code: "DEPENDENCY_UNAVAILABLE", Message: "The partition operation could not be completed.", Retryable: true,
			Outcome: protocol.OutcomeNotApplied,
		})
	}
}

func writeUnknownTimeout(response http.ResponseWriter, requestID, message string) {
	writeError(response, http.StatusGatewayTimeout, requestID, protocol.APIError{
		Code: "REQUEST_TIMEOUT", Message: message, Retryable: true, Outcome: protocol.OutcomeUnknown,
	})
}

func writeError(response http.ResponseWriter, status int, requestID string, apiError protocol.APIError) {
	writeJSON(response, status, protocol.ErrorEnvelope{RequestID: requestID, Error: apiError})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
