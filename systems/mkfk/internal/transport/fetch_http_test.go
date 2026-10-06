package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

type fakeFetchBackend struct {
	err     error
	calls   int
	request protocol.FetchRequest
}

func (b *fakeFetchBackend) Fetch(_ context.Context, request protocol.FetchRequest) (protocol.FetchResponseData, error) {
	b.calls++
	b.request = request
	key := "aw=="
	return protocol.FetchResponseData{
		Records: []protocol.FetchedRecord{
			{Offset: 4, KeyBase64: &key, ValueBase64: "dg==", AppendTimestampMS: 1700000000000},
			{Offset: 5, ValueBase64: "", AppendTimestampMS: 1700000000001},
		},
		NextOffset: 6, HighWatermark: 6, LogEndOffset: 7, LeaderTerm: 2,
	}, b.err
}

const validFetchTarget = "/v1/fetch?topic=events&partition=1&offset=4&max_bytes=1024&max_wait_ms=0"

func TestM6FetchEndpointMatchesV1Schema(t *testing.T) {
	t.Parallel()
	backend := &fakeFetchBackend{}
	handler, _ := NewFetchHandler(backend)
	response := serveGroupRequest(handler, http.MethodGet, validFetchTarget, "")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	expectSchema(t, "fetchResponse", response)
	want := protocol.FetchRequest{Topic: "events", Partition: 1, Offset: 4, MaxBytes: 1024}
	if backend.request != want {
		t.Fatalf("backend request = %+v, want %+v", backend.request, want)
	}
}

func TestM6FetchErrorsMapToContract(t *testing.T) {
	t.Parallel()
	tests := []struct {
		err    error
		status int
		code   string
	}{
		{&storage.ReadBudgetTooSmallError{RequiredBytes: 4096}, 400, "FETCH_BUDGET_TOO_SMALL"},
		{storage.ErrOffsetOutOfRange, 409, "OFFSET_OUT_OF_RANGE"},
		{ErrUnknownPartition, 404, "UNKNOWN_TOPIC_OR_PARTITION"},
		{raft.ErrNotLeader, 409, "NOT_LEADER"},
		{replication.ErrReadBarrier, 503, "NOT_READY"},
		{replication.ErrBackpressure, 429, "RESOURCE_EXHAUSTED"},
	}
	for _, test := range tests {
		handler, _ := NewFetchHandler(&fakeFetchBackend{err: test.err})
		response := serveGroupRequest(handler, http.MethodGet, validFetchTarget, "")
		var envelope protocol.ErrorEnvelope
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if response.Code != test.status || envelope.Error.Code != test.code || envelope.Error.Outcome != protocol.OutcomeNotApplicable {
			t.Fatalf("%v: status=%d envelope=%+v", test.err, response.Code, envelope.Error)
		}
		expectSchema(t, "errorEnvelope", response)
	}
}

func TestM6OP01MalformedFetchQueriesNeverReachBackend(t *testing.T) {
	t.Parallel()
	targets := []string{
		"/v1/fetch?topic=events&partition=1&offset=04&max_bytes=1024&max_wait_ms=0",
		"/v1/fetch?topic=events&partition=1&offset=4&max_bytes=0&max_wait_ms=0",
		"/v1/fetch?topic=events&partition=1&offset=4&max_bytes=4194305&max_wait_ms=0",
		"/v1/fetch?topic=events&partition=1&offset=4&max_bytes=1024&max_wait_ms=5001",
		"/v1/fetch?topic=events&partition=1&offset=4&max_bytes=1024",
		"/v1/fetch?topic=events&topic=orders&partition=1&offset=4&max_bytes=1024&max_wait_ms=0",
		"/v1/fetch?topic=__mkfk_groups&partition=0&offset=0&max_bytes=1024&max_wait_ms=0",
		validFetchTarget + "&isolation=none",
	}
	backend := &fakeFetchBackend{}
	handler, _ := NewFetchHandler(backend)
	for _, target := range targets {
		response := serveGroupRequest(handler, http.MethodGet, target, "")
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: status=%d body=%s", target, response.Code, response.Body.String())
		}
	}
	if response := serveGroupRequest(handler, http.MethodPost, validFetchTarget, "{}"); response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST fetch status = %d", response.Code)
	}
	if backend.calls != 0 {
		t.Fatalf("%d malformed fetches reached the backend", backend.calls)
	}
}
