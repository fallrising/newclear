package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type HTTPTransport struct {
	client    HTTPDoer
	mu        sync.RWMutex
	endpoints map[uint32]*url.URL
	current   uint32
}

func NewHTTPTransport(client HTTPDoer, endpoints map[uint32]string, initialBroker uint32) (*HTTPTransport, error) {
	if client == nil {
		client = http.DefaultClient
	}
	if len(endpoints) == 0 {
		return nil, errors.New("at least one known broker endpoint is required")
	}
	parsed := make(map[uint32]*url.URL, len(endpoints))
	for brokerID, endpoint := range endpoints {
		if brokerID == 0 {
			return nil, errors.New("broker IDs must be positive")
		}
		value, err := url.Parse(endpoint)
		if err != nil || value.Scheme != "http" && value.Scheme != "https" || value.Host == "" || value.User != nil {
			return nil, fmt.Errorf("invalid endpoint for broker %d", brokerID)
		}
		copy := *value
		parsed[brokerID] = &copy
	}
	if _, exists := parsed[initialBroker]; !exists {
		return nil, errors.New("initial broker is not in the known endpoint set")
	}
	return &HTTPTransport{client: client, endpoints: parsed, current: initialBroker}, nil
}

func (transport *HTTPTransport) Produce(ctx context.Context, requestID string, request protocol.ProduceRequest) (protocol.ProduceResponseData, error) {
	var envelope protocol.ProduceResponse
	if err := transport.post(ctx, "/v1/produce", requestID, request, &envelope); err != nil {
		return protocol.ProduceResponseData{}, err
	}
	if envelope.RequestID != requestID {
		return protocol.ProduceResponseData{}, errors.New("produce response request_id mismatch")
	}
	return envelope.Data, nil
}

func (transport *HTTPTransport) OpenProducer(ctx context.Context, traceRequestID string, request protocol.OpenProducerRequest) (protocol.OpenProducerResponseData, error) {
	var envelope protocol.OpenProducerResponse
	if err := transport.post(ctx, "/v1/producers/open", traceRequestID, request, &envelope); err != nil {
		return protocol.OpenProducerResponseData{}, err
	}
	if envelope.RequestID != traceRequestID {
		return protocol.OpenProducerResponseData{}, errors.New("OpenProducer response request_id mismatch")
	}
	return envelope.Data, nil
}

func (transport *HTTPTransport) CurrentBroker() uint32 {
	transport.mu.RLock()
	defer transport.mu.RUnlock()
	return transport.current
}

func (transport *HTTPTransport) post(ctx context.Context, path, requestID string, body, destination any) error {
	if err := protocol.ValidateRequestID(requestID); err != nil {
		return err
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	if len(encoded) > protocol.MaxHTTPBodyBytes {
		return errors.New("encoded request exceeds HTTP body limit")
	}
	endpoint := transport.endpoint(path)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-ID", requestID)
	response, err := transport.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	responseBytes, err := io.ReadAll(io.LimitReader(response.Body, int64(protocol.MaxHTTPBodyBytes)+1))
	if err != nil {
		return err
	}
	if len(responseBytes) > protocol.MaxHTTPBodyBytes {
		return errors.New("HTTP response exceeds configured limit")
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		if err := jsonstrict.Decode(responseBytes, destination); err != nil {
			return fmt.Errorf("decode success response: %w", err)
		}
		return nil
	}
	var envelope protocol.ErrorEnvelope
	if err := jsonstrict.Decode(responseBytes, &envelope); err != nil {
		return fmt.Errorf("decode error response: %w", err)
	}
	if envelope.RequestID != requestID {
		return errors.New("error response request_id mismatch")
	}
	if envelope.Error.Code == "NOT_LEADER" {
		transport.acceptLeaderHint(envelope.Error.Details)
	}
	return &ResponseError{HTTPStatus: response.StatusCode, API: envelope.Error}
}

func (transport *HTTPTransport) endpoint(path string) string {
	transport.mu.RLock()
	base := transport.endpoints[transport.current]
	copy := *base
	transport.mu.RUnlock()
	copy.Path = path
	copy.RawPath = ""
	copy.RawQuery = ""
	copy.Fragment = ""
	return copy.String()
}

func (transport *HTTPTransport) acceptLeaderHint(details map[string]any) {
	value, exists := details["leader_id"]
	if !exists {
		return
	}
	var brokerID uint64
	switch typed := value.(type) {
	case float64:
		if typed <= 0 || typed > math.MaxUint32 || math.Trunc(typed) != typed {
			return
		}
		brokerID = uint64(typed)
	case string:
		parsed, err := strconv.ParseUint(typed, 10, 32)
		if err != nil || parsed == 0 {
			return
		}
		brokerID = parsed
	default:
		return
	}
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if _, known := transport.endpoints[uint32(brokerID)]; known {
		transport.current = uint32(brokerID)
	}
}

var _ Transport = (*HTTPTransport)(nil)
