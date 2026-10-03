package httpapi

import (
	"bytes"
	"context"
	"errors"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const (
	testProjectID = domain.ProjectID("prj_01ARZ3NDEK")
	testCommandID = "cmd_01ARZ3NDEK"
)

type commandStub struct {
	calls   int
	outcome command.Outcome
	err     error
}

func (stub *commandStub) result() (command.Outcome, error) {
	stub.calls++
	return stub.outcome, stub.err
}

func (stub *commandStub) CreateProject(context.Context, domain.ActorID, command.CreateProject) (command.Outcome, error) {
	return stub.result()
}

func (stub *commandStub) CreateWorkItem(context.Context, domain.ActorID, command.CreateWorkItem) (command.Outcome, error) {
	return stub.result()
}

func (stub *commandStub) MarkReady(context.Context, domain.ActorID, command.MarkReady) (command.Outcome, error) {
	return stub.result()
}

func (stub *commandStub) DispatchRun(context.Context, domain.ActorID, command.DispatchRun) (command.Outcome, error) {
	return stub.result()
}

func (stub *commandStub) CompleteWorkItem(context.Context, domain.ActorID, command.CompleteWorkItem) (command.Outcome, error) {
	return stub.result()
}

type authorityStub struct {
	authenticateCalls int
	projectCalls      int
	resultCalls       int
	authenticateErr   error
	projectErr        error
	resultErr         error
	revoked           <-chan struct{}
	revokedCalls      int
}

func (stub *authorityStub) Authenticate(context.Context, string) (Session, error) {
	stub.authenticateCalls++
	if stub.authenticateErr != nil {
		return Session{}, stub.authenticateErr
	}
	return Session{ID: "session", Principal: domain.ActorID("actor")}, nil
}

func (stub *authorityStub) AuthorizeProject(context.Context, Session, domain.ProjectID) error {
	stub.projectCalls++
	return stub.projectErr
}

func (stub *authorityStub) AuthorizeCommandResult(context.Context, Session, domain.ProjectID, string) error {
	stub.resultCalls++
	return stub.resultErr
}

func (stub *authorityStub) Revoked(Session) <-chan struct{} {
	stub.revokedCalls++
	return stub.revoked
}

type resultStub struct {
	calls  int
	result StoredCommandResult
	err    error
}

func (stub *resultStub) LoadCommandResult(context.Context, domain.ProjectID, string) (StoredCommandResult, error) {
	stub.calls++
	return stub.result.Clone(), stub.err
}

type projectionStub struct {
	snapshotCalls int
	replayCalls   int
	snapshot      ProjectionSnapshot
	replay        ProjectionReplay
	err           error
	snapshotFn    func() ProjectionSnapshot
	replayFn      func() ProjectionReplay
}

func (stub *projectionStub) Snapshot(context.Context, domain.ProjectID) (ProjectionSnapshot, error) {
	stub.snapshotCalls++
	if stub.snapshotFn != nil {
		return stub.snapshotFn().Clone(), stub.err
	}
	return stub.snapshot.Clone(), stub.err
}

func (stub *projectionStub) Replay(context.Context, domain.ProjectID, port.Cursor) (ProjectionReplay, error) {
	stub.replayCalls++
	if stub.replayFn != nil {
		return stub.replayFn().Clone(), stub.err
	}
	return stub.replay.Clone(), stub.err
}

type readSpy struct {
	reads int
	body  *strings.Reader
}

func (spy *readSpy) Read(destination []byte) (int, error) {
	spy.reads++
	return spy.body.Read(destination)
}

func testServer(t *testing.T, commands *commandStub, results *resultStub, projections *projectionStub, authority *authorityStub, hub *Hub) *Server {
	t.Helper()
	if commands == nil {
		commands = &commandStub{}
	}
	if results == nil {
		results = &resultStub{}
	}
	if projections == nil {
		projections = &projectionStub{snapshot: ProjectionSnapshot{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1}, Payload: []byte(`{"api_version":"v1"}`)}}
	}
	if authority == nil {
		authority = &authorityStub{}
	}
	if hub == nil {
		hub = NewHub()
	}
	server, err := NewServer(commands, results, projections, authority, hub, Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	return server
}

func addSession(request *http.Request) {
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "token"})
}

func TestHTTP_AuthorizationAndCanonicalRouteBeforeSensitiveLookup(t *testing.T) {
	t.Run("authentication precedes body and project resolution", func(t *testing.T) {
		authority := &authorityStub{}
		results := &resultStub{}
		projections := &projectionStub{}
		body := &readSpy{body: strings.NewReader(`{"secret":"do-not-read"}`)}
		request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+string(testProjectID)+"/commands", body)
		response := httptest.NewRecorder()
		testServer(t, nil, results, projections, authority, nil).ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized || body.reads != 0 || authority.projectCalls != 0 || results.calls != 0 || projections.snapshotCalls != 0 {
			t.Fatalf("status=%d reads=%d project_auth=%d result_reads=%d projection_reads=%d", response.Code, body.reads, authority.projectCalls, results.calls, projections.snapshotCalls)
		}
	})

	t.Run("noncanonical path precedes session authority", func(t *testing.T) {
		authority := &authorityStub{}
		request := httptest.NewRequest(http.MethodGet, "/api/v1//projects/"+string(testProjectID)+"/board", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, nil, authority, nil).ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || authority.authenticateCalls != 0 {
			t.Fatalf("status=%d authenticate_calls=%d", response.Code, authority.authenticateCalls)
		}
	})

	t.Run("authorization precedes immutable result lookup", func(t *testing.T) {
		authority := &authorityStub{resultErr: ErrPermissionDenied}
		results := &resultStub{}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/commands/"+testCommandID, nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, results, nil, authority, nil).ServeHTTP(response, request)
		if response.Code != http.StatusNotFound || authority.resultCalls != 1 || results.calls != 0 {
			t.Fatalf("status=%d result_auth=%d result_reads=%d", response.Code, authority.resultCalls, results.calls)
		}
	})
}

func TestT079OriginHeaderMustBeUnambiguous(t *testing.T) {
	const body = `{"command_id":"cmd_01ARZ3NDEK","idempotency_key":"d9428888-122b-11e1-b85c-61cd3cbb3210","project_id":"prj_01ARZ3NDEK","expected_version":0,"issued_at":"2026-09-09T00:00:00Z","name":"name","repository":{"root_hint":"/repo","approved_ref":"main"}}`
	tests := map[string][]string{
		"duplicate fields": {"https://taskboard.test", "https://evil.test"},
		"comma combined":   {"https://taskboard.test, https://evil.test"},
		"missing":          nil,
		"wrong":            {"https://evil.test"},
	}
	for name, origins := range tests {
		t.Run(name, func(t *testing.T) {
			commands := &commandStub{outcome: command.Outcome{Payload: []byte(`{"ok":true}`)}}
			requestBody := &readSpy{body: strings.NewReader(body)}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", requestBody)
			request.Header.Set("Content-Type", "application/json")
			for _, origin := range origins {
				request.Header.Add("Origin", origin)
			}
			addSession(request)
			response := httptest.NewRecorder()
			testServer(t, commands, nil, nil, nil, nil).ServeHTTP(response, request)
			if response.Code != http.StatusForbidden || requestBody.reads != 0 || commands.calls != 0 {
				t.Fatalf("status=%d body_reads=%d command_calls=%d", response.Code, requestBody.reads, commands.calls)
			}
		})
	}

	t.Run("GET does not require Origin", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/board", nil)
		request.Header.Add("Origin", "https://taskboard.test")
		request.Header.Add("Origin", "https://evil.test")
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, nil, nil, nil).ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
	})
}

func TestHTTPDigestCodec_WireRoundTripAndRejectsInvalidSpellings(t *testing.T) {
	bare := domain.HashBytes([]byte("candidate"))
	wire, err := EncodeSHA256(bare)
	if err != nil {
		t.Fatalf("EncodeSHA256: %v", err)
	}
	if wire != "sha256:"+bare.String() {
		t.Fatalf("wire=%q", wire)
	}
	decoded, err := DecodeSHA256(wire)
	if err != nil || decoded != bare {
		t.Fatalf("round trip digest=%v err=%v", decoded, err)
	}
	invalid := []string{
		bare.String(),
		"sha256:sha256:" + bare.String(),
		"SHA256:" + bare.String(),
		"sha256:" + strings.ToUpper(bare.String()),
		"sha256:" + bare.String()[:63],
		"sha256:" + bare.String()[:63] + "g",
		"sha256:" + strings.Repeat("0", 64),
	}
	for _, value := range invalid {
		if _, err := DecodeSHA256(value); !errors.Is(err, ErrInvalidSHA256) {
			t.Errorf("DecodeSHA256(%q) err=%v", value, err)
		}
	}
}

func TestHTTP_StrictJSONPathCursorAndStoredResult(t *testing.T) {
	t.Run("duplicate JSON member is rejected", func(t *testing.T) {
		commands := &commandStub{outcome: command.Outcome{Payload: []byte(`{"ok":true}`)}}
		body := `{"command_id":"cmd_01ARZ3NDEK","command_id":"cmd_01ARZ3NDEM","idempotency_key":"d9428888-122b-11e1-b85c-61cd3cbb3210","project_id":"prj_01ARZ3NDEK","expected_version":0,"issued_at":"2026-09-09T00:00:00Z","name":"name","repository":{"root_hint":"/repo","approved_ref":"main"}}`
		request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", "https://taskboard.test")
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, commands, nil, nil, nil, nil).ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || commands.calls != 0 {
			t.Fatalf("status=%d command_calls=%d body=%s", response.Code, commands.calls, response.Body.String())
		}
	})

	t.Run("malformed cursor fails before projection read", func(t *testing.T) {
		projections := &projectionStub{}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events?cursor=01:2", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, nil, nil).ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || projections.replayCalls != 0 || projections.snapshotCalls != 0 {
			t.Fatalf("status=%d replay=%d snapshot=%d", response.Code, projections.replayCalls, projections.snapshotCalls)
		}
	})

	t.Run("canonical stored result bytes are immutable and exact", func(t *testing.T) {
		metadata := command.Metadata{CommandID: testCommandID, CorrelationID: "correlation"}
		success, err := command.CanonicalSuccess(metadata, command.CreateProjectOperation, command.Result{
			Type: "ProjectCreated", ProjectID: testProjectID, Version: 1,
		}, 1, port.Cursor{Epoch: 1, Sequence: 1})
		if err != nil {
			t.Fatalf("CanonicalSuccess: %v", err)
		}
		failure, err := command.CanonicalFailure(metadata, command.NewError(command.CodeInvalidRequest, "request is invalid", false, nil, nil))
		if err != nil {
			t.Fatalf("CanonicalFailure: %v", err)
		}
		for name, payload := range map[string][]byte{"success": success, "failure": failure} {
			t.Run(name, func(t *testing.T) {
				results := &resultStub{result: StoredCommandResult{CommandID: testCommandID, ProjectID: testProjectID, Digest: domain.HashBytes(payload), Payload: payload}}
				request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/commands/"+testCommandID, nil)
				addSession(request)
				response := httptest.NewRecorder()
				testServer(t, nil, results, nil, nil, nil).ServeHTTP(response, request)
				if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), payload) {
					t.Fatalf("status=%d payload=%q", response.Code, response.Body.Bytes())
				}
				response.Body.Bytes()[0] = '!'
				if results.result.Payload[0] != '{' {
					t.Fatal("response mutation aliased stored result")
				}
			})
		}
	})

	t.Run("corrupt stored result fails closed", func(t *testing.T) {
		payload := []byte(`{"ok":true}`)
		results := &resultStub{result: StoredCommandResult{CommandID: testCommandID, ProjectID: testProjectID, Digest: domain.HashBytes([]byte("different")), Payload: payload}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/commands/"+testCommandID, nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, results, nil, nil, nil).ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("status=%d", response.Code)
		}
	})
}

func TestT077MalformedStoredResultFailsClosed(t *testing.T) {
	metadata := command.Metadata{CommandID: testCommandID, CorrelationID: "correlation"}
	validSuccess, err := command.CanonicalSuccess(metadata, command.CreateProjectOperation, command.Result{
		Type: "ProjectCreated", ProjectID: testProjectID, Version: 1,
	}, 1, port.Cursor{Epoch: 1, Sequence: 1})
	if err != nil {
		t.Fatalf("CanonicalSuccess: %v", err)
	}
	wrongIdentity, err := command.CanonicalFailure(
		command.Metadata{CommandID: "cmd_01ARZ3NDEM", CorrelationID: "correlation"},
		command.NewError(command.CodeInvalidRequest, "request is invalid", false, nil, nil),
	)
	if err != nil {
		t.Fatalf("CanonicalFailure: %v", err)
	}
	malformed := map[string][]byte{
		"incomplete failure":   []byte(`{"api_version":"v1","ok":false}`),
		"duplicate member":     []byte(`{"api_version":"v1","api_version":"v1","ok":false}`),
		"noncanonical spacing": append(bytes.Clone(validSuccess), '\n'),
		"unknown operation":    bytes.Replace(validSuccess, []byte(command.CreateProjectOperation), []byte("UnknownOperation"), 1),
		"wrong command":        wrongIdentity,
	}
	for name, payload := range malformed {
		t.Run(name, func(t *testing.T) {
			results := &resultStub{result: StoredCommandResult{CommandID: testCommandID, ProjectID: testProjectID, Digest: domain.HashBytes(payload), Payload: payload}}
			request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/commands/"+testCommandID, nil)
			addSession(request)
			response := httptest.NewRecorder()
			testServer(t, nil, results, nil, nil, nil).ServeHTTP(response, request)
			if response.Code != http.StatusNotFound {
				t.Fatalf("status=%d body=%q", response.Code, response.Body.Bytes())
			}
		})
	}
}

func TestHTTP_ProductionImportAndCompositionBoundary(t *testing.T) {
	t.Parallel()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), name, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		for _, imported := range file.Imports {
			path := strings.Trim(imported.Path.Value, `"`)
			if strings.Contains(path, "/domain/sqlite") || strings.Contains(path, "/executor/fake") || path == "os/exec" {
				t.Errorf("production transport %s imports forbidden concrete package %s", name, path)
			}
		}
	}
	wiring, err := os.ReadFile(filepath.Join("..", "..", "..", "cmd", "taskboard", "wiring.go"))
	if err != nil {
		t.Fatalf("read composition root: %v", err)
	}
	for _, required := range []string{"/domain/sqlite", "/executor/fake", "/application/service", "/transport/httpapi"} {
		if !bytes.Contains(wiring, []byte(required)) {
			t.Errorf("composition root lacks %s", required)
		}
	}
}

var _ io.Reader = (*readSpy)(nil)
