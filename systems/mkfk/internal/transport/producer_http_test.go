package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/producer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

func TestM5PublicProducerEndpoints(t *testing.T) {
	t.Parallel()
	backend := &fakeProducerBackend{
		openResult: producer.OpenResult{
			ProducerID: testHTTPProducerID, Epoch: 0, LeaderTerm: 7, Status: producer.OperationSucceeded,
		},
		produceResult: producer.ProduceResult{
			ProducerID: testHTTPProducerID, Epoch: 0, BaseOffset: 4, LastOffset: 4,
			NextSequence: 1, LeaderTerm: 7, Status: producer.OperationSucceeded,
		},
	}
	handler, err := NewProducerHandler(backend)
	if err != nil {
		t.Fatal(err)
	}
	openResponse := serveProducerRequest(handler, "/v1/producers/open", "trace-open", `{
  "topic":"events","partition":0,
  "producer_id":"90f67d4e-13c5-4a3c-8d62-443f1bbb1af4",
  "expected_epoch":"-1","request_id":"open-1"
}`)
	if openResponse.Code != http.StatusOK {
		t.Fatalf("open status=%d body=%s", openResponse.Code, openResponse.Body.String())
	}
	var openEnvelope protocol.OpenProducerResponse
	if err := json.Unmarshal(openResponse.Body.Bytes(), &openEnvelope); err != nil {
		t.Fatal(err)
	}
	if openEnvelope.RequestID != "trace-open" || openEnvelope.Data.ProducerID != testHTTPProducerID || openEnvelope.Data.Epoch != 0 || openEnvelope.Data.LeaderTerm != 7 {
		t.Fatalf("open response = %#v", openEnvelope)
	}
	produceResponse := serveProducerRequest(handler, "/v1/produce", "trace-produce", validProduceJSON)
	if produceResponse.Code != http.StatusOK {
		t.Fatalf("produce status=%d body=%s", produceResponse.Code, produceResponse.Body.String())
	}
	var produceEnvelope protocol.ProduceResponse
	if err := json.Unmarshal(produceResponse.Body.Bytes(), &produceEnvelope); err != nil {
		t.Fatal(err)
	}
	if produceEnvelope.RequestID != "trace-produce" || produceEnvelope.Data.BaseOffset != 4 || produceEnvelope.Data.NextSequence != 1 || produceEnvelope.Data.Duplicate {
		t.Fatalf("produce response = %#v", produceEnvelope)
	}
}

func TestM5OP01MalformedProducerRequestsAreRejectedBeforeBackend(t *testing.T) {
	t.Parallel()
	backend := &fakeProducerBackend{}
	handler, err := NewProducerHandler(backend)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		path string
		body string
		want int
	}{
		{name: "duplicate-key", path: "/v1/produce", body: strings.Replace(validProduceJSON, `"acks":"all"`, `"acks":"all","acks":"all"`, 1), want: 400},
		{name: "unknown-field", path: "/v1/produce", body: strings.Replace(validProduceJSON, `"acks":"all"`, `"acks":"all","secret":"do-not-reflect"`, 1), want: 400},
		{name: "bad-base64", path: "/v1/produce", body: strings.Replace(validProduceJSON, `"aGVsbG8="`, `"%%%"`, 1), want: 400},
		{name: "unsupported-acks", path: "/v1/produce", body: strings.Replace(validProduceJSON, `"acks":"all"`, `"acks":"one"`, 1), want: 400},
		{name: "oversized", path: "/v1/produce", body: strings.Repeat(" ", protocol.MaxHTTPBodyBytes+1), want: 413},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			response := serveProducerRequest(handler, test.path, "trace-invalid", test.body)
			if response.Code != test.want {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "do-not-reflect") || strings.Contains(response.Body.String(), "aGVsbG8=") {
				t.Fatal("error response leaked request payload")
			}
		})
	}
	if backend.openCalls != 0 || backend.produceCalls != 0 {
		t.Fatalf("invalid requests reached backend: open=%d produce=%d", backend.openCalls, backend.produceCalls)
	}
}

func TestM5HTTPUnknownOutcomeAndTypedConflict(t *testing.T) {
	t.Parallel()
	backend := &fakeProducerBackend{produceResult: producer.ProduceResult{Status: producer.OperationPending}}
	handler, _ := NewProducerHandler(backend)
	response := serveProducerRequest(handler, "/v1/produce", "trace-timeout", validProduceJSON)
	if response.Code != http.StatusGatewayTimeout {
		t.Fatalf("timeout status=%d body=%s", response.Code, response.Body.String())
	}
	var timeout protocol.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &timeout); err != nil {
		t.Fatal(err)
	}
	if timeout.Error.Code != "REQUEST_TIMEOUT" || timeout.Error.Outcome != protocol.OutcomeUnknown || !timeout.Error.Retryable {
		t.Fatalf("timeout envelope = %#v", timeout)
	}
	backend.produceErr = &producer.Error{Code: producer.CodeSequenceConflict, Message: "same sequence has different records"}
	response = serveProducerRequest(handler, "/v1/produce", "trace-conflict", validProduceJSON)
	if response.Code != http.StatusConflict {
		t.Fatalf("conflict status=%d body=%s", response.Code, response.Body.String())
	}
	var conflict protocol.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}
	if conflict.Error.Code != string(producer.CodeSequenceConflict) || conflict.Error.Outcome != protocol.OutcomeNotApplied || conflict.Error.Retryable {
		t.Fatalf("conflict envelope = %#v", conflict)
	}
}

const (
	testHTTPProducerID = "90f67d4e-13c5-4a3c-8d62-443f1bbb1af4"
	validProduceJSON   = `{
  "topic":"events","partition":0,
  "producer_id":"90f67d4e-13c5-4a3c-8d62-443f1bbb1af4",
  "epoch":"0","first_sequence":"0","acks":"all",
  "records":[{"key_base64":null,"value_base64":"aGVsbG8="}]
}`
)

type fakeProducerBackend struct {
	openResult    producer.OpenResult
	produceResult producer.ProduceResult
	openErr       error
	produceErr    error
	openCalls     int
	produceCalls  int
}

func (backend *fakeProducerBackend) OpenProducer(_ context.Context, _ protocol.OpenProducerRequest) (producer.OpenResult, error) {
	backend.openCalls++
	return backend.openResult, backend.openErr
}

func (backend *fakeProducerBackend) Produce(_ context.Context, _ string, _ protocol.ProduceRequest) (producer.ProduceResult, error) {
	backend.produceCalls++
	if backend.produceErr != nil {
		return producer.ProduceResult{}, backend.produceErr
	}
	return backend.produceResult, nil
}

func serveProducerRequest(handler http.Handler, path, requestID, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(RequestIDHeader, requestID)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

var _ ProducerBackend = (*fakeProducerBackend)(nil)
