package httpapi

import (
	"bytes"
	json "encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"encoding/json/jsontext"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const (
	SessionCookieName = "__Host-hai_session"
	defaultBodyLimit  = int64(1 << 20)
)

var (
	projectPattern = regexp.MustCompile(`^prj_[0-9A-HJKMNP-TV-Z]{10,26}$`)
	workPattern    = regexp.MustCompile(`^wi_[0-9A-HJKMNP-TV-Z]{10,26}$`)
	commandPattern = regexp.MustCompile(`^cmd_[0-9A-HJKMNP-TV-Z]{10,26}$`)
	runPattern     = regexp.MustCompile(`^run_[0-9A-HJKMNP-TV-Z]{10,26}$`)
	uuidPattern    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	acPattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$`)
)

type Config struct {
	Origin       string
	MaxBodyBytes int64
}

type Server struct {
	mux         *http.ServeMux
	commands    CommandService
	results     CommandResultSource
	projections ProjectionSource
	authority   SessionAuthority
	hub         *Hub
	config      Config
}

func NewServer(commands CommandService, results CommandResultSource, projections ProjectionSource, authority SessionAuthority, hub *Hub, config Config) (*Server, error) {
	if commands == nil || results == nil || projections == nil || authority == nil || hub == nil || !validOrigin(config.Origin) {
		return nil, errors.New("invalid HTTP API dependencies")
	}
	if config.MaxBodyBytes == 0 {
		config.MaxBodyBytes = defaultBodyLimit
	}
	if config.MaxBodyBytes < 1 || config.MaxBodyBytes > defaultBodyLimit {
		return nil, errors.New("invalid HTTP body limit")
	}
	server := &Server{commands: commands, results: results, projections: projections, authority: authority, hub: hub, config: config}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/projects", server.createProject)
	mux.HandleFunc("POST /api/v1/projects/{project_id}/commands", server.submitCommand)
	mux.HandleFunc("GET /api/v1/projects/{project_id}/commands/{command_id}", server.getCommandResult)
	mux.HandleFunc("GET /api/v1/projects/{project_id}/board", server.getBoard)
	mux.HandleFunc("GET /api/v1/projects/{project_id}/events", server.streamEvents)
	mux.HandleFunc("/", server.notFound)
	server.mux = mux
	return server, nil
}

func (server *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request == nil || !canonicalPath(request) {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request path is not canonical")
		return
	}
	server.mux.ServeHTTP(response, request)
}

func (server *Server) createProject(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok || !server.sameOrigin(response, request) {
		return
	}
	var wire createProjectRequest
	if !server.decode(response, request, &wire) {
		return
	}
	issuedAt, ok := parseTime(wire.IssuedAt)
	if !ok || !commandPattern.MatchString(wire.CommandID) || !uuidPattern.MatchString(wire.IdempotencyKey) ||
		!projectPattern.MatchString(wire.ProjectID) || wire.ExpectedVersion != 0 ||
		!validWireText(wire.Name, 1, 160) || !validWireText(wire.Repository.RootHint, 1, 512) || !validWireText(wire.Repository.ApprovedRef, 1, 200) {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
		return
	}
	outcome, err := server.commands.CreateProject(request.Context(), session.Principal, command.CreateProject{
		Metadata:  command.Metadata{CommandID: wire.CommandID, IdempotencyKey: wire.IdempotencyKey, ExpectedVersion: wire.ExpectedVersion, IssuedAt: issuedAt, CorrelationID: correlationID(request)},
		ProjectID: domain.ProjectID(wire.ProjectID), Name: wire.Name, RepositoryRoot: wire.Repository.RootHint, ApprovedRef: wire.Repository.ApprovedRef,
	})
	writeOutcome(response, outcome, err)
}

func (server *Server) submitCommand(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok || !server.sameOrigin(response, request) {
		return
	}
	projectID, ok := pathProject(response, request)
	if !ok || !server.authorizeProject(response, request, session, projectID) {
		return
	}
	var envelope commandRequest
	if !server.decode(response, request, &envelope) {
		return
	}
	issuedAt, valid := parseTime(envelope.IssuedAt)
	if !valid || !commandPattern.MatchString(envelope.CommandID) || !uuidPattern.MatchString(envelope.IdempotencyKey) {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
		return
	}
	metadata := command.Metadata{CommandID: envelope.CommandID, IdempotencyKey: envelope.IdempotencyKey, ExpectedVersion: envelope.ExpectedVersion, IssuedAt: issuedAt, CorrelationID: correlationID(request)}
	var outcome command.Outcome
	var err error
	switch command.Operation(envelope.Operation) {
	case command.CreateWorkItemOperation:
		var payload createWorkItemPayload
		if !decodePayload(response, envelope.Payload, &payload) {
			return
		}
		if !workPattern.MatchString(payload.WorkItemID) || !validWireText(payload.Title, 1, 240) || !validWireText(payload.Goal, 1, 8000) || !validWireText(payload.OwnerID, 1, 120) {
			writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
			return
		}
		revisions, valid := decodeRevisions(payload.RequiredACRevisions)
		if !valid {
			writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
			return
		}
		outcome, err = server.commands.CreateWorkItem(request.Context(), session.Principal, command.CreateWorkItem{Metadata: metadata, ProjectID: projectID, WorkItemID: domain.WorkItemID(payload.WorkItemID), Title: payload.Title, Goal: payload.Goal, OwnerID: domain.ActorID(payload.OwnerID), RequiredACRevisions: revisions})
	case command.MarkReadyOperation:
		var payload simpleWorkItemPayload
		if !decodePayload(response, envelope.Payload, &payload) {
			return
		}
		if !workPattern.MatchString(payload.WorkItemID) {
			writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
			return
		}
		outcome, err = server.commands.MarkReady(request.Context(), session.Principal, command.MarkReady{Metadata: metadata, ProjectID: projectID, WorkItemID: domain.WorkItemID(payload.WorkItemID)})
	case command.DispatchRunOperation:
		var payload dispatchRunPayload
		if !decodePayload(response, envelope.Payload, &payload) {
			return
		}
		if !workPattern.MatchString(payload.WorkItemID) || payload.AdapterID != "fake/v1" || !validWireToken(payload.ScenarioID, 1, 120) || payload.RetryOfRunID != "" && !runPattern.MatchString(payload.RetryOfRunID) {
			writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
			return
		}
		outcome, err = server.commands.DispatchRun(request.Context(), session.Principal, command.DispatchRun{Metadata: metadata, ProjectID: projectID, WorkItemID: domain.WorkItemID(payload.WorkItemID), AdapterID: payload.AdapterID, ScenarioID: payload.ScenarioID, RetryOfRunID: domain.RunID(payload.RetryOfRunID)})
	case command.CompleteWorkItemOperation:
		var payload completeWorkItemPayload
		if !decodePayload(response, envelope.Payload, &payload) {
			return
		}
		if !workPattern.MatchString(payload.WorkItemID) || payload.Subject.ProjectID != string(projectID) || payload.Subject.WorkItemID != payload.WorkItemID {
			writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
			return
		}
		subject, subjectErr := payload.Subject.domainValue()
		if subjectErr != nil {
			writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request body is invalid")
			return
		}
		outcome, err = server.commands.CompleteWorkItem(request.Context(), session.Principal, command.CompleteWorkItem{Metadata: metadata, ProjectID: projectID, WorkItemID: domain.WorkItemID(payload.WorkItemID), Subject: subject})
	default:
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "operation is unsupported in v1")
		return
	}
	writeOutcome(response, outcome, err)
}

func (server *Server) getCommandResult(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok {
		return
	}
	projectID, ok := pathProject(response, request)
	commandID := request.PathValue("command_id")
	if !ok || !commandPattern.MatchString(commandID) {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	if err := server.authority.AuthorizeCommandResult(request.Context(), session, projectID, commandID); err != nil {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	result, err := server.results.LoadCommandResult(request.Context(), projectID, commandID)
	if err != nil || result.CommandID != commandID || result.ProjectID != projectID || result.Digest.IsZero() || len(result.Payload) == 0 || domain.HashBytes(result.Payload) != result.Digest {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	if !validStoredCommandResult(result.Payload, commandID) {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	writeJSONBytes(response, http.StatusOK, result.Payload)
}

func validStoredCommandResult(payload []byte, commandID string) bool {
	var discriminator struct {
		OK      *bool `json:"ok"`
		Command struct {
			Operation command.Operation `json:"operation"`
		} `json:"command"`
	}
	if err := json.Unmarshal(payload, &discriminator); err != nil || discriminator.OK == nil {
		return false
	}
	operation := command.CreateProjectOperation
	if *discriminator.OK {
		operation = discriminator.Command.Operation
	}
	_, err := command.DecodeCanonicalResult(payload, commandID, operation)
	return err == nil
}

func (server *Server) getBoard(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok {
		return
	}
	projectID, ok := pathProject(response, request)
	if !ok || !server.authorizeProject(response, request, session, projectID) {
		return
	}
	snapshot, err := server.projections.Snapshot(request.Context(), projectID)
	if err != nil || snapshot.ProjectID != projectID || snapshot.Cursor.Epoch == 0 || len(snapshot.Payload) == 0 {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	writeJSONBytes(response, http.StatusOK, snapshot.Payload)
}

func (server *Server) notFound(response http.ResponseWriter, _ *http.Request) {
	writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
}

func (server *Server) authenticate(response http.ResponseWriter, request *http.Request) (Session, bool) {
	var token string
	count := 0
	for _, cookie := range request.Cookies() {
		if cookie.Name == SessionCookieName {
			token = cookie.Value
			count++
		}
	}
	if count != 1 || token == "" {
		writeAPIError(response, http.StatusUnauthorized, command.CodeUnauthenticated, "authentication is required")
		return Session{}, false
	}
	session, err := server.authority.Authenticate(request.Context(), token)
	if err != nil || session.ID == "" || session.Principal == "" {
		writeAPIError(response, http.StatusUnauthorized, command.CodeUnauthenticated, "authentication is required")
		return Session{}, false
	}
	return session, true
}

func (server *Server) authorizeProject(response http.ResponseWriter, request *http.Request, session Session, projectID domain.ProjectID) bool {
	if err := server.authority.AuthorizeProject(request.Context(), session, projectID); err != nil {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return false
	}
	return true
}

func (server *Server) sameOrigin(response http.ResponseWriter, request *http.Request) bool {
	origins := request.Header.Values("Origin")
	if len(origins) != 1 || origins[0] != server.config.Origin {
		writeAPIError(response, http.StatusForbidden, command.CodePermissionDenied, "same-origin validation failed")
		return false
	}
	return true
}

func (server *Server) decode(response http.ResponseWriter, request *http.Request, destination any) bool {
	mediaType, parameters, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" || len(parameters) != 0 {
		writeAPIError(response, http.StatusUnsupportedMediaType, command.CodeInvalidRequest, "content type must be application/json")
		return false
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, server.config.MaxBodyBytes+1))
	if err != nil || int64(len(body)) > server.config.MaxBodyBytes || len(body) == 0 {
		writeAPIError(response, http.StatusRequestEntityTooLarge, command.CodeInvalidRequest, "request body exceeds the limit")
		return false
	}
	if err := json.Unmarshal(body, destination, json.RejectUnknownMembers(true)); err != nil {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "request JSON is invalid")
		return false
	}
	return true
}

func decodePayload(response http.ResponseWriter, payload jsontext.Value, destination any) bool {
	if len(payload) == 0 || json.Unmarshal(payload, destination, json.RejectUnknownMembers(true)) != nil {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "command payload is invalid")
		return false
	}
	return true
}

func pathProject(response http.ResponseWriter, request *http.Request) (domain.ProjectID, bool) {
	value := request.PathValue("project_id")
	if !projectPattern.MatchString(value) {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return "", false
	}
	return domain.ProjectID(value), true
}

func parseTime(value string) (time.Time, bool) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	return parsed, err == nil && !parsed.IsZero() && value == parsed.UTC().Format(time.RFC3339Nano)
}

func validWireText(value string, minimum, maximum int) bool {
	if !utf8.ValidString(value) {
		return false
	}
	length := utf8.RuneCountInString(value)
	if length < minimum || length > maximum {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

func validWireToken(value string, minimum, maximum int) bool {
	if !validWireText(value, minimum, maximum) {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || strings.ContainsRune("._-", character) {
			continue
		}
		return false
	}
	return true
}

func validOrigin(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && parsed.User == nil && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == ""
}

func canonicalPath(request *http.Request) bool {
	path := request.URL.Path
	return strings.HasPrefix(path, "/api/v1/") && request.URL.RawPath == "" && request.URL.EscapedPath() == path && !strings.Contains(path, "//") && !strings.ContainsAny(path, "\\\x00")
}

func correlationID(request *http.Request) string {
	value := request.Header.Get("X-Correlation-ID")
	if value == "" || len(value) > 80 || strings.ContainsAny(value, "\r\n\x00") {
		return "request"
	}
	return value
}

func writeOutcome(response http.ResponseWriter, outcome command.Outcome, err error) {
	if len(outcome.Payload) == 0 {
		writeAPIError(response, http.StatusServiceUnavailable, command.CodeProjectionUnavailable, "request could not be completed")
		return
	}
	status := http.StatusOK
	if failure, ok := errors.AsType[*command.Error](err); ok {
		status = statusForCode(failure.Code)
	} else if err != nil {
		status = http.StatusServiceUnavailable
	}
	writeJSONBytes(response, status, outcome.Payload)
}

func statusForCode(code string) int {
	switch code {
	case command.CodeUnauthenticated:
		return http.StatusUnauthorized
	case command.CodePermissionDenied:
		return http.StatusForbidden
	case command.CodeNotFound:
		return http.StatusNotFound
	case command.CodeVersionConflict, command.CodeIdempotencyConflict, command.CodeIdempotencyExpired, command.CodeStaleSubject:
		return http.StatusConflict
	case command.CodeLifecycleRejected, command.CodeDoneGateUnsatisfied, command.CodeCapabilityUnsupported, command.CodeOutcomeUnknown:
		return http.StatusUnprocessableEntity
	case command.CodeStorageCorruption, command.CodeProjectionUnavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusBadRequest
	}
}

func writeJSONBytes(response http.ResponseWriter, status int, payload []byte) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(status)
	_, _ = response.Write(bytes.Clone(payload))
}

type apiErrorEnvelope struct {
	APIVersion    string       `json:"api_version"`
	OK            bool         `json:"ok"`
	Error         apiErrorBody `json:"error"`
	CorrelationID string       `json:"correlation_id"`
}

type apiErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func writeAPIError(response http.ResponseWriter, status int, code, message string) {
	payload, _ := json.Marshal(apiErrorEnvelope{APIVersion: "v1", OK: false, Error: apiErrorBody{Code: code, Message: message, Retryable: false}, CorrelationID: "request"})
	writeJSONBytes(response, status, payload)
}

type createProjectRequest struct {
	CommandID       string `json:"command_id"`
	IdempotencyKey  string `json:"idempotency_key"`
	ProjectID       string `json:"project_id"`
	ExpectedVersion uint64 `json:"expected_version"`
	IssuedAt        string `json:"issued_at"`
	Name            string `json:"name"`
	Repository      struct {
		RootHint    string `json:"root_hint"`
		ApprovedRef string `json:"approved_ref"`
	} `json:"repository"`
}

type commandRequest struct {
	CommandID       string         `json:"command_id"`
	IdempotencyKey  string         `json:"idempotency_key"`
	Operation       string         `json:"operation"`
	ExpectedVersion uint64         `json:"expected_version"`
	IssuedAt        string         `json:"issued_at"`
	Payload         jsontext.Value `json:"payload"`
}

type acRevisionWire struct {
	ACID           string `json:"ac_id"`
	RevisionDigest string `json:"revision_digest"`
}

type createWorkItemPayload struct {
	WorkItemID          string           `json:"work_item_id"`
	Title               string           `json:"title"`
	Goal                string           `json:"goal"`
	OwnerID             string           `json:"owner_id"`
	RequiredACRevisions []acRevisionWire `json:"required_ac_revisions"`
}

type simpleWorkItemPayload struct {
	WorkItemID string `json:"work_item_id"`
}

type dispatchRunPayload struct {
	WorkItemID   string `json:"work_item_id"`
	AdapterID    string `json:"adapter_id"`
	ScenarioID   string `json:"scenario_id"`
	RetryOfRunID string `json:"retry_of_run_id,omitempty"`
}

type completeWorkItemPayload struct {
	WorkItemID string                `json:"work_item_id"`
	Subject    completionSubjectWire `json:"completion_subject"`
}

type completionSubjectWire struct {
	ProjectID                   string           `json:"project_id"`
	WorkItemID                  string           `json:"work_item_id"`
	WorkItemVersion             uint64           `json:"work_item_version"`
	CandidateID                 string           `json:"candidate_id"`
	CandidateDigest             string           `json:"candidate_digest"`
	RunID                       string           `json:"run_id"`
	RunInputDigest              string           `json:"run_input_digest"`
	RequiredACRevisions         []acRevisionWire `json:"required_ac_revisions"`
	AcceptedGraphRevisionDigest string           `json:"accepted_graph_revision_digest"`
	PolicyRevisionDigest        string           `json:"policy_revision_digest"`
	CompletionRecipeDigest      string           `json:"completion_recipe_digest"`
	IntegrationBaseDigest       string           `json:"integration_base_digest,omitempty"`
}

func decodeRevisions(source []acRevisionWire) ([]command.ACRevision, bool) {
	if len(source) == 0 {
		return nil, false
	}
	result := make([]command.ACRevision, len(source))
	for index, revision := range source {
		digest, err := DecodeSHA256(revision.RevisionDigest)
		if err != nil || !acPattern.MatchString(revision.ACID) {
			return nil, false
		}
		result[index] = command.ACRevision{ACID: domain.ACID(revision.ACID), RevisionDigest: digest}
	}
	return result, true
}

func (wire completionSubjectWire) domainValue() (domain.CompletionSubject, error) {
	if !projectPattern.MatchString(wire.ProjectID) || !workPattern.MatchString(wire.WorkItemID) || !runPattern.MatchString(wire.RunID) || wire.WorkItemVersion == 0 || !validWireText(wire.CandidateID, 1, 80) {
		return domain.CompletionSubject{}, command.ErrInvalidCommand
	}
	candidate, err := DecodeSHA256(wire.CandidateDigest)
	if err != nil {
		return domain.CompletionSubject{}, err
	}
	runInput, err := DecodeSHA256(wire.RunInputDigest)
	if err != nil {
		return domain.CompletionSubject{}, err
	}
	graph, err := DecodeSHA256(wire.AcceptedGraphRevisionDigest)
	if err != nil {
		return domain.CompletionSubject{}, err
	}
	policy, err := DecodeSHA256(wire.PolicyRevisionDigest)
	if err != nil {
		return domain.CompletionSubject{}, err
	}
	recipe, err := DecodeSHA256(wire.CompletionRecipeDigest)
	if err != nil {
		return domain.CompletionSubject{}, err
	}
	bindings := make([]domain.ACRevisionBinding, len(wire.RequiredACRevisions))
	for index, revision := range wire.RequiredACRevisions {
		digest, err := DecodeSHA256(revision.RevisionDigest)
		if err != nil || !acPattern.MatchString(revision.ACID) {
			return domain.CompletionSubject{}, err
		}
		bindings[index] = domain.ACRevisionBinding{ACID: domain.ACID(revision.ACID), RevisionDigest: digest}
	}
	var base domain.Digest
	if wire.IntegrationBaseDigest != "" {
		base, err = DecodeSHA256(wire.IntegrationBaseDigest)
		if err != nil {
			return domain.CompletionSubject{}, err
		}
	}
	return domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: domain.ProjectID(wire.ProjectID), WorkItemID: domain.WorkItemID(wire.WorkItemID), WorkItemVersion: wire.WorkItemVersion, CandidateID: domain.CandidateID(wire.CandidateID), CandidateDigest: candidate, RunID: domain.RunID(wire.RunID), RunInputDigest: runInput, RequiredACRevisions: bindings, AcceptedGraphRevisionDigest: graph, PolicyRevisionDigest: policy, CompletionRecipeDigest: recipe, IntegrationBaseDigest: base})
}
