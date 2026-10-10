// Package httpapi exposes the M1 event endpoints without a public listener.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/adapter"
	"github.com/fallrising/newclear/platform/signal-hub/internal/auth"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

const MaxBodyBytes = 4 << 20

type Server struct {
	db   *store.Store
	auth *auth.Authenticator
	now  func() time.Time
}

func New(db *store.Store, credentials *auth.Authenticator) http.Handler {
	return &Server{db: db, auth: credentials, now: time.Now}
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type ingestResult struct {
	Index     int          `json:"index"`
	Status    int          `json:"status"`
	Seq       int64        `json:"seq,omitempty"`
	Duplicate bool         `json:"duplicate,omitempty"`
	Error     *errorDetail `json:"error,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": errorDetail{code, message}})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	path := r.URL.Path
	if r.Method == http.MethodGet && path == "/healthz" {
		writeJSON(w, 200, map[string]string{"status": "ok"})
		return
	}
	if r.Method == http.MethodGet && path == "/readyz" {
		if s.db.Ready(ctx) != nil {
			writeJSON(w, 503, map[string]string{"status": "not_ready"})
		} else {
			writeJSON(w, 200, map[string]string{"status": "ready"})
		}
		return
	}
	ingest := r.Method == http.MethodPost && (path == "/v1/events" || path == "/v1/adapters/alertmanager")
	query := r.Method == http.MethodGet && (path == "/v1/events" || path == "/v1/sources" || strings.HasPrefix(path, "/v1/events/"))
	if !ingest && !query {
		fail(w, 404, "not_found", "route not found")
		return
	}
	headers := r.Header.Values("Authorization")
	var principal auth.Principal
	var ok bool
	if len(headers) == 1 {
		scheme, token, found := strings.Cut(headers[0], " ")
		if found && strings.EqualFold(scheme, "Bearer") && token != "" && !strings.ContainsAny(token, " \t\r\n") {
			principal, ok = s.auth.Authenticate(token)
		}
	}
	if !ok {
		w.Header().Set("WWW-Authenticate", "Bearer")
		fail(w, 401, "unauthenticated", "valid bearer token required")
		return
	}
	if (ingest && principal.Role != "source") || (query && principal.Role != "owner" && principal.Role != "readonly") {
		fail(w, 403, "forbidden", "token role does not permit this operation")
		return
	}
	if query {
		s.query(w, r)
		return
	}
	contentType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || (params["charset"] != "" && !strings.EqualFold(params["charset"], "utf-8")) ||
		(r.Header.Get("Content-Encoding") != "" && r.Header.Get("Content-Encoding") != "identity") ||
		(path == "/v1/events" && contentType != "application/cloudevents+json" && contentType != "application/cloudevents-batch+json") ||
		(path != "/v1/events" && contentType != "application/json") {
		fail(w, 415, "unsupported_media_type", "unsupported request media type")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			fail(w, 413, "payload_too_large", "request body exceeds 4 MiB")
		} else {
			fail(w, 400, "invalid_json", "request body could not be read")
		}
		return
	}
	var members [][]byte
	if path == "/v1/adapters/alertmanager" {
		members, err = adapter.Parse(body)
		if err != nil {
			var e *event.Error
			if errors.As(err, &e) {
				fail(w, e.Status, e.Code, e.Message)
			} else {
				fail(w, 400, "invalid_event", "invalid Alertmanager envelope")
			}
			return
		}
	} else if contentType == "application/cloudevents-batch+json" {
		value, decodeErr := event.Decode(body)
		if decodeErr != nil {
			fail(w, 400, "invalid_json", "invalid JSON")
			return
		}
		items, valid := value.([]any)
		if !valid || len(items) < 1 || len(items) > 100 {
			fail(w, 400, "invalid_batch", "batch must contain 1 to 100 items")
			return
		}
		members = make([][]byte, len(items))
		for i, item := range items {
			members[i], _ = json.Marshal(item)
		}
	} else {
		result := s.ingest(ctx, principal, body)
		if result.Error != nil {
			fail(w, result.Status, result.Error.Code, result.Error.Message)
		} else if result.Duplicate {
			writeJSON(w, result.Status, map[string]any{"seq": result.Seq, "duplicate": true})
		} else {
			writeJSON(w, result.Status, map[string]any{"seq": result.Seq})
		}
		return
	}
	results := make([]ingestResult, len(members))
	for i, body := range members {
		results[i] = s.ingest(ctx, principal, body)
		results[i].Index = i
	}
	writeJSON(w, 200, map[string]any{"results": results})
}

func (s *Server) ingest(ctx context.Context, principal auth.Principal, body []byte) ingestResult {
	e, err := event.Parse(body)
	if err != nil {
		var validation *event.Error
		if errors.As(err, &validation) {
			return ingestResult{Status: validation.Status, Error: &errorDetail{validation.Code, validation.Message}}
		}
		return ingestResult{Status: 400, Error: &errorDetail{"invalid_event", "invalid event"}}
	}
	if !auth.Authorize(principal, e) {
		return ingestResult{Status: 403, Error: &errorDetail{"forbidden", "source or type is not permitted"}}
	}
	result, err := s.db.IngestSource(ctx, e, s.now().UTC(), principal.Source.Name)
	if errors.Is(err, store.ErrConflict) {
		return ingestResult{Status: 409, Error: &errorDetail{"event_conflict", "source and id already have different content"}}
	}
	if err != nil {
		return ingestResult{Status: 503, Error: &errorDetail{"unavailable", "event store unavailable; retry later"}}
	}
	status := 202
	if result.Duplicate {
		status = 200
	}
	return ingestResult{Status: status, Seq: result.Seq, Duplicate: result.Duplicate}
}

func (s *Server) query(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v1/sources" {
		s.sources(w, r)
		return
	}
	if r.URL.Path != "/v1/events" {
		if r.URL.RawQuery != "" {
			fail(w, 400, "invalid_query", "detail takes no query parameters")
			return
		}
		raw := strings.TrimPrefix(r.URL.Path, "/v1/events/")
		seq, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || seq <= 0 || raw != strconv.FormatInt(seq, 10) {
			fail(w, 400, "invalid_query", "seq must be a positive integer")
			return
		}
		detail, err := s.db.Detail(r.Context(), seq)
		if errors.Is(err, store.ErrNotFound) {
			fail(w, 404, "not_found", "event not found")
			return
		}
		if err != nil {
			fail(w, 503, "unavailable", "event store unavailable")
			return
		}
		writeJSON(w, 200, detail)
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		fail(w, 400, "invalid_query", "invalid query encoding")
		return
	}
	allowed := map[string]bool{"from": true, "to": true, "source": true, "type": true, "severity_min": true, "subject_prefix": true, "correlationid": true, "q": true, "cursor": true, "limit": true}
	for key, entries := range values {
		if !allowed[key] || len(entries) != 1 || (entries[0] == "" && (key == "from" || key == "to" || key == "cursor" || key == "limit" || key == "type" || key == "severity_min")) {
			fail(w, 400, "invalid_query", "invalid or repeated query parameter")
			return
		}
	}
	q := store.Query{From: values.Get("from"), To: values.Get("to"), Source: values.Get("source"), Type: values.Get("type"), SeverityMin: values.Get("severity_min"), SubjectPrefix: values.Get("subject_prefix"), CorrelationID: values.Get("correlationid"), Q: values.Get("q"), Cursor: values.Get("cursor")}
	if limit := values.Get("limit"); limit != "" {
		q.Limit, err = strconv.Atoi(limit)
		if err != nil || q.Limit < 1 || q.Limit > 200 {
			fail(w, 400, "invalid_query", "limit must be 1 to 200")
			return
		}
	}
	page, err := s.db.List(r.Context(), q)
	if errors.Is(err, store.ErrInvalidQuery) {
		fail(w, 400, "invalid_query", "invalid filters or cursor")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable", "event store unavailable")
		return
	}
	writeJSON(w, 200, page)
}

func (s *Server) sources(w http.ResponseWriter, r *http.Request) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		fail(w, 400, "invalid_query", "invalid query encoding")
		return
	}
	for key, entries := range values {
		if (key != "cursor" && key != "limit") || len(entries) != 1 || entries[0] == "" {
			fail(w, 400, "invalid_query", "invalid or repeated query parameter")
			return
		}
	}
	q := store.SourceQuery{Cursor: values.Get("cursor")}
	if raw := values.Get("limit"); raw != "" {
		q.Limit, err = strconv.Atoi(raw)
		if err != nil || q.Limit < 1 || q.Limit > 200 {
			fail(w, 400, "invalid_query", "limit must be 1 to 200")
			return
		}
	}
	page, err := s.db.ListSources(r.Context(), q, s.now().UTC())
	if errors.Is(err, store.ErrInvalidQuery) {
		fail(w, 400, "invalid_query", "invalid cursor")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable", "source store unavailable")
		return
	}
	writeJSON(w, 200, page)
}
