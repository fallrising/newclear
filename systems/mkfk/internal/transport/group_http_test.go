package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/fallrising/newclear/systems/mkfk/internal/group"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

const v1SchemaURL = "https://mkfk.invalid/schemas/v1.json"

func compileV1(t *testing.T, definition string) *jsonschema.Schema {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "api", "schemas", "v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var document any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource(v1SchemaURL, document); err != nil {
		t.Fatal(err)
	}
	schema, err := compiler.Compile(v1SchemaURL + "#/$defs/" + definition)
	if err != nil {
		t.Fatal(err)
	}
	return schema
}

func expectSchema(t *testing.T, definition string, response *httptest.ResponseRecorder) {
	t.Helper()
	var document any
	decoder := json.NewDecoder(bytes.NewReader(response.Body.Bytes()))
	decoder.UseNumber()
	if err := decoder.Decode(&document); err != nil {
		t.Fatal(err)
	}
	if err := compileV1(t, definition).Validate(document); err != nil {
		t.Fatalf("%s does not match %s: %v", response.Body.String(), definition, err)
	}
}

type fakeGroupBackend struct {
	err        error
	calls      int
	groupID    string
	partitions []protocol.TopicPartition
}

func (b *fakeGroupBackend) record(groupID string) error {
	b.calls++
	b.groupID = groupID
	return b.err
}

func (b *fakeGroupBackend) JoinGroup(_ context.Context, g string, _ protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error) {
	return protocol.JoinGroupResponseData{Generation: 3, State: "PREPARING", CoordinatorTerm: 2}, b.record(g)
}

func (b *fakeGroupBackend) SyncGroup(_ context.Context, g string, _ protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error) {
	return protocol.SyncGroupResponseData{Generation: 3, State: "STABLE", Assignment: []protocol.TopicPartition{{Topic: "events", Partition: 1}}}, b.record(g)
}

func (b *fakeGroupBackend) Heartbeat(_ context.Context, g string, _ protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error) {
	return protocol.HeartbeatResponseData{Generation: 4, State: "PREPARING", RebalanceRequired: true}, b.record(g)
}

func (b *fakeGroupBackend) LeaveGroup(_ context.Context, g string, _ protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error) {
	return protocol.LeaveGroupResponseData{Removed: true, Generation: 4}, b.record(g)
}

func (b *fakeGroupBackend) CommitOffsets(_ context.Context, g string, r protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	return protocol.CommitOffsetsResponseData{Generation: r.Generation, Offsets: r.Offsets}, b.record(g)
}

func (b *fakeGroupBackend) CommittedOffsets(_ context.Context, g string, p []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error) {
	b.partitions = p
	committed := protocol.DecimalUint64(7)
	return protocol.GetOffsetsResponseData{Offsets: []protocol.CommittedOffset{
		{Topic: p[0].Topic, Partition: p[0].Partition, Offset: &committed}, {Topic: p[1].Topic, Partition: p[1].Partition},
	}}, b.record(g)
}

func serveGroupRequest(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set(RequestIDHeader, "trace-group")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

var groupEndpoints = []struct {
	action, method, body, schema string
}{
	{"join", http.MethodPost, `{"member_id":"m1","subscription":["events"],"request_id":"join-1"}`, "joinGroupResponse"},
	{"sync", http.MethodPost, `{"member_id":"m1","generation":"3","revoked":true}`, "syncGroupResponse"},
	{"heartbeat", http.MethodPost, `{"member_id":"m1","generation":"3"}`, "heartbeatResponse"},
	{"leave", http.MethodPost, `{"member_id":"m1","generation":"3","request_id":"leave-1"}`, "leaveGroupResponse"},
	{"offsets/commit", http.MethodPost, `{"member_id":"m1","generation":"3","request_id":"c-1","offsets":[{"topic":"events","partition":1,"offset":"7"}]}`, "commitOffsetsResponse"},
	{"offsets?partition=events/0&partition=orders/2", http.MethodGet, "", "getOffsetsResponse"},
}

func TestM6GroupEndpointsMatchV1Schemas(t *testing.T) {
	t.Parallel()
	for _, endpoint := range groupEndpoints {
		backend := &fakeGroupBackend{}
		handler, _ := NewGroupHandler(backend)
		response := serveGroupRequest(handler, endpoint.method, "/v1/groups/billing/"+endpoint.action, endpoint.body)
		if response.Code != http.StatusOK || backend.calls != 1 || backend.groupID != "billing" {
			t.Fatalf("%s: status=%d calls=%d group=%q body=%s", endpoint.action, response.Code, backend.calls, backend.groupID, response.Body.String())
		}
		expectSchema(t, endpoint.schema, response)
	}
}

func TestM6GetOffsetsParsesEveryRequestedPartition(t *testing.T) {
	t.Parallel()
	backend := &fakeGroupBackend{}
	handler, _ := NewGroupHandler(backend)
	serveGroupRequest(handler, http.MethodGet, "/v1/groups/billing/offsets?partition=events/0&partition=orders/2", "")
	want := []protocol.TopicPartition{{Topic: "events", Partition: 0}, {Topic: "orders", Partition: 2}}
	if fmt.Sprint(backend.partitions) != fmt.Sprint(want) {
		t.Fatalf("partitions = %v, want %v", backend.partitions, want)
	}
}

func TestM6GroupErrorsMapToContract(t *testing.T) {
	t.Parallel()
	tests := []struct {
		action  string
		err     error
		status  int
		code    string
		outcome protocol.Outcome
		retry   bool
	}{
		{"offsets/commit", &group.Error{Code: group.CodeIllegalGeneration, Message: "stale"}, 409, "ILLEGAL_GENERATION", protocol.OutcomeNotApplied, false},
		{"offsets/commit", &group.Error{Code: group.CodeOffsetOutOfRange, Message: "beyond HW"}, 409, "OFFSET_OUT_OF_RANGE", protocol.OutcomeNotApplied, false},
		{"offsets/commit", &group.Error{Code: group.CodeDependencyFailed, Message: "no HW"}, 503, "DEPENDENCY_UNAVAILABLE", protocol.OutcomeNotApplied, true},
		{"offsets/commit", group.ErrOutcomeUnknown, 504, "REQUEST_TIMEOUT", protocol.OutcomeUnknown, true},
		{"join", &group.Error{Code: group.CodeUnknownTopic, Message: "no topic"}, 404, "UNKNOWN_TOPIC_OR_PARTITION", protocol.OutcomeNotApplied, false},
		{"join", &group.Error{Code: group.CodeResourceExhausted, Message: "full"}, 429, "RESOURCE_EXHAUSTED", protocol.OutcomeNotApplied, true},
		{"sync", raft.ErrNotLeader, 409, "NOT_COORDINATOR", protocol.OutcomeNotApplied, true},
		{"heartbeat", &group.Error{Code: group.CodeIllegalGeneration, Message: "rejoin"}, 409, "ILLEGAL_GENERATION", protocol.OutcomeNotApplicable, false},
		{"offsets?partition=events/0&partition=events/1", &group.Error{Code: group.CodeNotCoordinator, Message: "barrier"}, 409, "NOT_COORDINATOR", protocol.OutcomeNotApplicable, true},
	}
	for _, test := range tests {
		handler, _ := NewGroupHandler(&fakeGroupBackend{err: test.err})
		method, body := http.MethodPost, ""
		for _, endpoint := range groupEndpoints {
			if endpoint.action == test.action {
				body = endpoint.body
			}
		}
		if strings.HasPrefix(test.action, "offsets?") {
			method = http.MethodGet
		}
		response := serveGroupRequest(handler, method, "/v1/groups/billing/"+test.action, body)
		var envelope protocol.ErrorEnvelope
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if response.Code != test.status || envelope.Error.Code != test.code || envelope.Error.Outcome != test.outcome || envelope.Error.Retryable != test.retry {
			t.Fatalf("%s %v: status=%d envelope=%+v", test.action, test.err, response.Code, envelope.Error)
		}
		expectSchema(t, "errorEnvelope", response)
	}
}

func TestM6OP01MalformedGroupRequestsNeverReachBackend(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, method, target, body string
		status                     int
	}{
		{"unknown-field", http.MethodPost, "/v1/groups/billing/join", `{"member_id":"m1","subscription":["events"],"request_id":"j","secret":"do-not-reflect"}`, 400},
		{"duplicate-key", http.MethodPost, "/v1/groups/billing/sync", `{"member_id":"m1","generation":"3","generation":"4","revoked":true}`, 400},
		{"non-canonical-generation", http.MethodPost, "/v1/groups/billing/heartbeat", `{"member_id":"m1","generation":"03"}`, 400},
		{"missing-request-id", http.MethodPost, "/v1/groups/billing/leave", `{"member_id":"m1","generation":"3"}`, 400},
		{"empty-offsets", http.MethodPost, "/v1/groups/billing/offsets/commit", `{"member_id":"m1","generation":"3","request_id":"c","offsets":[]}`, 400},
		{"unsafe-group", http.MethodPost, "/v1/groups/bad%20group/join", `{"member_id":"m1","subscription":["events"],"request_id":"j"}`, 400},
		{"get-on-join", http.MethodGet, "/v1/groups/billing/join", "", 405},
		{"post-on-offsets", http.MethodPost, "/v1/groups/billing/offsets", `{}`, 405},
		{"unknown-action", http.MethodPost, "/v1/groups/billing/delete", `{}`, 404},
		{"offsets-without-partition", http.MethodGet, "/v1/groups/billing/offsets", "", 400},
		{"offsets-repeated", http.MethodGet, "/v1/groups/billing/offsets?partition=events/0&partition=events/0", "", 400},
		{"offsets-unknown-param", http.MethodGet, "/v1/groups/billing/offsets?partition=events/0&all=true", "", 400},
		{"offsets-internal-topic", http.MethodGet, "/v1/groups/billing/offsets?partition=__mkfk_groups/0", "", 400},
		{"oversized", http.MethodPost, "/v1/groups/billing/join", strings.Repeat(" ", protocol.MaxHTTPBodyBytes+1), 413},
	}
	backend := &fakeGroupBackend{}
	handler, _ := NewGroupHandler(backend)
	for _, test := range tests {
		response := serveGroupRequest(handler, test.method, test.target, test.body)
		if response.Code != test.status || strings.Contains(response.Body.String(), "do-not-reflect") {
			t.Fatalf("%s: status=%d body=%s", test.name, response.Code, response.Body.String())
		}
		expectSchema(t, "errorEnvelope", response)
	}
	if backend.calls != 0 {
		t.Fatalf("%d malformed requests reached the backend", backend.calls)
	}
}
