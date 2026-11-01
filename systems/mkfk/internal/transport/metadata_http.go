package transport

import (
	"context"
	"errors"
	"net/http"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

type MetadataBackend interface {
	Metadata(context.Context) (protocol.MetadataResponseData, error)
}

type MetadataHandler struct {
	backend MetadataBackend
}

func NewMetadataHandler(backend MetadataBackend) (*MetadataHandler, error) {
	if backend == nil {
		return nil, errors.New("metadata backend is required")
	}
	return &MetadataHandler{backend: backend}, nil
}

func (handler *MetadataHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	requestID := request.Header.Get(RequestIDHeader)
	if err := protocol.ValidateRequestID(requestID); err != nil {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "X-Request-ID must be a valid safe token.")
		return
	}
	if request.Method != http.MethodGet || request.URL.RawQuery != "" {
		writeNotApplied(response, http.StatusBadRequest, requestID, "INVALID_REQUEST", "GET /v1/metadata takes no parameters.")
		return
	}
	data, err := handler.backend.Metadata(request.Context())
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, requestID, protocol.APIError{
			Code: "NOT_READY", Message: "Metadata is not available.", Retryable: true, Outcome: protocol.OutcomeNotApplicable,
		})
		return
	}
	writeJSON(response, http.StatusOK, protocol.MetadataResponse{RequestID: requestID, Data: data})
}
