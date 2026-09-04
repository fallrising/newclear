package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/clarkQ/internal/config"
	"github.com/golang-jwt/jwt/v5"
)

func mustSignHS256(t *testing.T, secret, issuer, audience string) string {
	t.Helper()
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	if issuer != "" {
		claims.Issuer = issuer
	}
	if audience != "" {
		claims.Audience = []string{audience}
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func testServer(t *testing.T) *Server {
	t.Helper()
	s, err := New(config.Config{
		Addr:            ":8080",
		MaxQueues:       100,
		MaxDepth:        1000,
		MaxMessageBytes: 1024,
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func testServerWithAuth(t *testing.T) *Server {
	t.Helper()
	s, err := New(config.Config{
		Addr:            ":8080",
		MaxQueues:       100,
		MaxDepth:        1000,
		MaxMessageBytes: 1024,
		APIKeys:         []string{"secret-key"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func withAPIKey(req *http.Request, key string) {
	req.Header.Set("X-API-Key", key)
}

func TestHealth(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "version") {
		t.Fatalf("health missing version: %s", rec.Body.String())
	}
}

func TestVersion(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodGet, "/version", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var info struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil || info.Version == "" {
		t.Fatalf("body=%s err=%v", rec.Body.String(), err)
	}
}

func TestAdminUI(t *testing.T) {
	s := testServer(t)
	for _, path := range []string{"/ui/", "/ui"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		// /ui redirects to /ui/
		if path == "/ui" {
			if rec.Code != http.StatusFound && rec.Code != http.StatusOK {
				t.Fatalf("%s status=%d", path, rec.Code)
			}
			continue
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "clarkQ") {
			t.Fatalf("ui missing title")
		}
	}
}

func TestEnqueueDequeueJSON(t *testing.T) {
	s := testServer(t)

	payload := `{"body":"hello","metadata":{"source":"test"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("post status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var msg struct {
		Body     string            `json:"body"`
		Metadata map[string]string `json:"metadata"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Body != "hello" || msg.Metadata["source"] != "test" {
		t.Fatalf("unexpected message: %#v", msg)
	}
}

func TestDequeueEmptyQueue(t *testing.T) {
	s := testServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/empty-q", bytes.NewBufferString(`{"body":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/empty-q", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first get status = %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/empty-q", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("empty get status = %d, want 204", rec.Code)
	}
}

func TestDequeueMissingQueue(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/queue/never-created", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPeekDoesNotConsume(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"hello"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders?peek=true", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("peek status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var peeked struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &peeked); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	var consumed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &consumed); err != nil {
		t.Fatal(err)
	}
	if consumed.ID != peeked.ID {
		t.Fatalf("consumed ID = %q, peeked ID = %q", consumed.ID, peeked.ID)
	}
}

func TestClearQueue(t *testing.T) {
	s := testServer(t)
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"hello"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/queue/orders", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"cleared\":2}\n" {
		t.Fatalf("delete status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("get status = %d, want 204", rec.Code)
	}
}

func TestLongPollReceivesMessage(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"first"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders?timeout=1", nil)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		done <- rec
	}()

	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"second"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	select {
	case result := <-done:
		if result.Code != http.StatusOK {
			t.Fatalf("long poll status = %d, body = %s", result.Code, result.Body.String())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("long poll did not return")
	}
}

func TestInvalidReadOptions(t *testing.T) {
	s := testServer(t)
	for _, path := range []string{
		"/api/v1/queue/orders?timeout=31",
		"/api/v1/queue/orders?timeout=soon",
		"/api/v1/queue/orders?peek=maybe",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400", path, rec.Code)
		}
	}
}

func TestEnqueuePlainText(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/plain", bytes.NewBufferString("raw message"))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/plain", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	var msg struct {
		Body string `json:"body"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &msg)
	if msg.Body != "raw message" {
		t.Fatalf("body = %q", msg.Body)
	}
}

func TestListQueues(t *testing.T) {
	s := testServer(t)

	for _, q := range []string{"a", "b"} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/"+q, bytes.NewBufferString(`{"body":"1"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/queues", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestAPIKeyRequired(t *testing.T) {
	s := testServerWithAuth(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/queues", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queues", nil)
	withAPIKey(req, "secret-key")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestHealthBypassesAPIKey(t *testing.T) {
	s := testServerWithAuth(t)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestJWTAuthHS256(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 1024,
		JWTHSSecret:     "test-hs-secret",
		OIDCIssuer:      "https://issuer.example",
		OIDCAudience:    "clarkq",
	})
	if err != nil {
		t.Fatal(err)
	}

	// No auth → 401
	req := httptest.NewRequest(http.MethodGet, "/api/v1/queues", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d want 401", rec.Code)
	}

	token := mustSignHS256(t, "test-hs-secret", "https://issuer.example", "clarkq")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queues", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	// Health still open
	req = httptest.NewRequest(http.MethodGet, "/health", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d", rec.Code)
	}
}

func TestAPIKeyOrJWT(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 1024,
		APIKeys:         []string{"static-key"},
		JWTHSSecret:     "test-hs-secret",
		OIDCAudience:    "clarkq",
	})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/queues", nil)
	req.Header.Set("X-API-Key", "static-key")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("api key status = %d", rec.Code)
	}

	token := mustSignHS256(t, "test-hs-secret", "", "clarkq")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queues", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("jwt status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestJWTACLQueueScopes(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 1024,
		JWTHSSecret:     "acl-secret",
		OIDCAudience:    "clarkq",
		JWTACL:          true,
		JWTAdminRole:    "admin",
	})
	if err != nil {
		t.Fatal(err)
	}

	writeOnly := mustSignHS256WithScope(t, "acl-secret", "clarkq", "queue:orders:write")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+writeOnly)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("write allowed status=%d body=%s", rec.Code, rec.Body.String())
	}

	// same token cannot read
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	req.Header.Set("Authorization", "Bearer "+writeOnly)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("read forbidden status=%d want 403 body=%s", rec.Code, rec.Body.String())
	}

	// wrong queue
	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/other", bytes.NewBufferString(`{"body":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+writeOnly)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("other queue status=%d want 403", rec.Code)
	}

	// admin role bypass
	adminTok := mustSignHS256WithRole(t, "acl-secret", "clarkq", "admin")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	req.Header.Set("Authorization", "Bearer "+adminTok)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin read status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func mustSignHS256WithScope(t *testing.T, secret, audience, scope string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"exp":   time.Now().Add(time.Hour).Unix(),
		"aud":   audience,
		"scope": scope,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func mustSignHS256WithRole(t *testing.T, secret, audience, role string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"exp":  time.Now().Add(time.Hour).Unix(),
		"aud":  audience,
		"role": role,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestInternalReplicateAndRemove(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:           10,
		MaxDepth:            100,
		MaxMessageBytes:     1024,
		ClusterAdvertiseURL: "http://n1:8080",
		ClusterNodes:        []string{"http://n1:8080", "http://n2:8080"},
		ClusterSecret:       "s3cret",
		ReplicationFactor:   2,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Missing token → 401
	req := httptest.NewRequest(http.MethodGet, "/api/v1/internal/queues", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}

	payload := `{"id":"mid-1","queue":"orders","body":"hello","created_at":"2026-01-01T00:00:00Z"}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/internal/replicate/enqueue", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", "s3cret")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("replicate enqueue status=%d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/internal/queues", nil)
	req.Header.Set("X-ClarkQ-Cluster-Token", "s3cret")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "orders") {
		t.Fatalf("internal list=%s", rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/internal/replicate/dequeue", bytes.NewBufferString(`{"queue":"orders","id":"mid-1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", "s3cret")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("replicate dequeue status=%d", rec.Code)
	}
}

func TestListQueuesLocalQuery(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/a", bytes.NewBufferString(`{"body":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queues?local=1", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
}

func TestInternalQueueMessagesAndMergePath(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:           10,
		MaxDepth:            100,
		MaxMessageBytes:     1024,
		ClusterAdvertiseURL: "http://n1:8080",
		ClusterNodes:        []string{"http://n1:8080", "http://n2:8080"},
		ClusterSecret:       "tok",
		ReplicationFactor:   2,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Seed local queue
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/replicate/enqueue", bytes.NewBufferString(
		`{"id":"x1","queue":"jobs","body":"one","created_at":"2026-01-01T00:00:00Z"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", "tok")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/internal/queue/jobs/messages", nil)
	req.Header.Set("X-ClarkQ-Cluster-Token", "tok")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "x1") {
		t.Fatalf("messages=%s", rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/internal/queue/jobs/ids", nil)
	req.Header.Set("X-ClarkQ-Cluster-Token", "tok")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "x1") {
		t.Fatalf("ids=%s", rec.Body.String())
	}
}

func TestEpochFenceRejectsStale(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:           10,
		MaxDepth:            100,
		MaxMessageBytes:     1024,
		ClusterAdvertiseURL: "http://n1:8080",
		ClusterNodes:        []string{"http://n1:8080", "http://n2:8080"},
		ClusterSecret:       "tok",
		ReplicationFactor:   2,
		EpochFencing:        true,
		EpochFencingStrict:  false,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Force membership change so local epoch differs from a forged header.
	s.cluster.Membership.SetAlive("http://n2:8080", false)
	localEpoch := s.cluster.Epoch()
	if localEpoch == 0 {
		t.Fatal("expected epoch")
	}

	// Stale epoch (0) with a wrong value
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/replicate/enqueue", bytes.NewBufferString(
		`{"id":"e1","queue":"q","body":"x","created_at":"2026-01-01T00:00:00Z"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", "tok")
	req.Header.Set("X-ClarkQ-Epoch", "1") // almost certainly wrong vs fnv epoch
	// Ensure mismatch
	if fmt.Sprintf("%d", localEpoch) == "1" {
		req.Header.Set("X-ClarkQ-Epoch", "999")
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		// If by chance epoch is 1, try again with local+1
		if rec.Code == http.StatusCreated {
			req.Header.Set("X-ClarkQ-Epoch", fmt.Sprintf("%d", localEpoch+1))
			rec = httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
		}
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s want 409", rec.Code, rec.Body.String())
	}
	if ra := rec.Header().Get("Retry-After"); ra == "" {
		t.Fatalf("expected Retry-After on STALE_EPOCH, body=%s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"retryable":true`) {
		t.Fatalf("expected retryable true in body: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "retry_after_ms") {
		t.Fatalf("expected retry_after_ms in body: %s", rec.Body.String())
	}

	// Matching epoch succeeds
	req = httptest.NewRequest(http.MethodPost, "/api/v1/internal/replicate/enqueue", bytes.NewBufferString(
		`{"id":"e2","queue":"q","body":"y","created_at":"2026-01-01T00:00:00Z"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", "tok")
	req.Header.Set("X-ClarkQ-Epoch", fmt.Sprintf("%d", s.cluster.Epoch()))
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("matching epoch status=%d %s", rec.Code, rec.Body.String())
	}

	// Catch-up bypass
	req = httptest.NewRequest(http.MethodPost, "/api/v1/internal/replicate/enqueue", bytes.NewBufferString(
		`{"id":"e3","queue":"q","body":"z","created_at":"2026-01-01T00:00:00Z"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", "tok")
	req.Header.Set("X-ClarkQ-Epoch", "1")
	req.Header.Set("X-ClarkQ-CatchUp", "1")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("catchup bypass status=%d %s", rec.Code, rec.Body.String())
	}
}

func TestWriteQuorumHelper(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:           10,
		MaxDepth:            100,
		MaxMessageBytes:     1024,
		ClusterAdvertiseURL: "http://n1:8080",
		ClusterNodes:        []string{"http://n1:8080", "http://n2:8080", "http://n3:8080"},
		ReplicationFactor:   3,
		WriteQuorum:         0, // majority = 2
	})
	if err != nil {
		t.Fatal(err)
	}
	if s.writeQuorum() != 2 {
		t.Fatalf("majority quorum=%d", s.writeQuorum())
	}
	s.cfg.WriteQuorum = 3
	if s.writeQuorum() != 3 {
		t.Fatalf("full quorum=%d", s.writeQuorum())
	}
	if s.readQuorum() != 2 {
		t.Fatalf("default read majority=%d", s.readQuorum())
	}
	s.cfg.ReadQuorum = 1
	if s.readQuorum() != 1 {
		t.Fatalf("read quorum=%d", s.readQuorum())
	}
}

func TestLinearizableConsumeSingleNodeNoCluster(t *testing.T) {
	// Without multi-node RF, linearizable path is not used; normal dequeue works.
	s, err := New(config.Config{
		MaxQueues:            10,
		MaxDepth:             100,
		MaxMessageBytes:      1024,
		LinearizableConsume:  true,
		ReplicationFactor:    1,
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/jobs", bytes.NewBufferString(`{"body":"task"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("post=%d", rec.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/jobs", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "task") {
		t.Fatalf("get=%d %s", rec.Code, rec.Body.String())
	}
}

func TestClusterStatusEndpoint(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:            10,
		MaxDepth:             100,
		MaxMessageBytes:      1024,
		ClusterAdvertiseURL:  "http://n1:8080",
		ClusterNodes:         []string{"http://n1:8080", "http://n2:8080"},
		ClusterSecret:        "tok",
		ReplicationFactor:    2,
		ReplicationMode:      "async",
		ClusterFailThreshold: 1,
		OutboxMaxAttempts:    3,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Don't StartBackground (would probe real network); force membership state.
	if s.cluster == nil || s.cluster.Membership == nil {
		t.Fatal("expected membership")
	}
	s.cluster.Membership.SetAlive("http://n2:8080", false)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cluster", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "generation") || !strings.Contains(rec.Body.String(), "n1") {
		t.Fatalf("body=%s", rec.Body.String())
	}
	// Health embeds cluster summary without auth.
	req = httptest.NewRequest(http.MethodGet, "/health", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "alive") {
		t.Fatalf("health=%s", rec.Body.String())
	}
}

func TestServerRSAEncryption(t *testing.T) {
	dir := t.TempDir()
	s, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 4096,
		EncryptionMode:  "server_rsa",
		RSAKeyDir:       dir,
	})
	if err != nil {
		t.Fatal(err)
	}

	payload := `{"body":"top secret"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/secure", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("post status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/secure", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var msg struct {
		Body       string `json:"body"`
		Encryption struct {
			Mode         string `json:"mode"`
			EncryptedKey string `json:"encrypted_key"`
		} `json:"encryption"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Body == "top secret" {
		t.Fatal("expected encrypted body, got plaintext")
	}
	if msg.Encryption.Mode != "server_rsa" || msg.Encryption.EncryptedKey == "" {
		t.Fatalf("unexpected encryption metadata: %#v", msg.Encryption)
	}
}

func TestClientEncryptionPassthrough(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 4096,
		EncryptionMode:  "client",
	})
	if err != nil {
		t.Fatal(err)
	}

	payload := `{"body":"ciphertext-here","encryption":{"mode":"client","algorithm":"aes-256-gcm","key_id":"k1","nonce":"abc"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/client-q", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("post status = %d, body = %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/client-q", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	var msg struct {
		Body       string `json:"body"`
		Encryption struct {
			Mode      string `json:"mode"`
			Algorithm string `json:"algorithm"`
		} `json:"encryption"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Body != "ciphertext-here" || msg.Encryption.Mode != "client" {
		t.Fatalf("unexpected message: %#v", msg)
	}
}

func TestMetricsEndpoints(t *testing.T) {
	s := testServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"a"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/metrics", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("json metrics status = %d body=%s", rec.Code, rec.Body.String())
	}
	var metrics struct {
		EnqueuedTotal int64 `json:"enqueued_total"`
		DequeuedTotal int64 `json:"dequeued_total"`
		Queues        int   `json:"queues"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &metrics); err != nil {
		t.Fatal(err)
	}
	if metrics.EnqueuedTotal != 1 || metrics.DequeuedTotal != 1 {
		t.Fatalf("metrics counters = %+v", metrics)
	}

	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("prom metrics status = %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "clarkq_enqueued_total 1") {
		t.Fatalf("prometheus body missing counter: %s", body)
	}
	for _, name := range []string{
		"clarkq_replication_errors_total",
		"clarkq_quorum_errors_total",
		"clarkq_lease_errors_total",
		"clarkq_outbox_depth",
		"clarkq_cluster_enabled",
	} {
		if !strings.Contains(body, name) {
			t.Fatalf("prometheus body missing %s: %s", name, body)
		}
	}
}

func TestClusterErrorMetrics(t *testing.T) {
	s := testServer(t)
	// Drive typed counters through writeError.
	rec := httptest.NewRecorder()
	s.writeError(rec, errReplication)
	rec = httptest.NewRecorder()
	s.writeError(rec, errQuorum)
	rec = httptest.NewRecorder()
	s.writeError(rec, errLease)
	rec = httptest.NewRecorder()
	s.writeError(rec, errStaleEpoch)
	rec = httptest.NewRecorder()
	s.writeError(rec, errNotOwner)
	rec = httptest.NewRecorder()
	s.writeError(rec, errOwnerGrace)

	m := s.collectMetrics()
	if m.ReplicationErrorsTotal != 1 || m.QuorumErrorsTotal != 1 || m.LeaseErrorsTotal != 1 {
		t.Fatalf("typed cluster counters: rep=%d quorum=%d lease=%d",
			m.ReplicationErrorsTotal, m.QuorumErrorsTotal, m.LeaseErrorsTotal)
	}
	if m.StaleEpochErrorsTotal != 1 || m.NotOwnerErrorsTotal != 1 || m.OwnerGraceErrorsTotal != 1 {
		t.Fatalf("membership counters: stale=%d not_owner=%d grace=%d",
			m.StaleEpochErrorsTotal, m.NotOwnerErrorsTotal, m.OwnerGraceErrorsTotal)
	}
	if m.ErrorsTotal < 6 {
		t.Fatalf("errors_total=%d want ≥6", m.ErrorsTotal)
	}

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, "clarkq_replication_errors_total 1") {
		t.Fatalf("prom missing replication_errors: %s", body)
	}
	if !strings.Contains(body, "clarkq_quorum_errors_total 1") {
		t.Fatalf("prom missing quorum_errors: %s", body)
	}
}

func TestSnapshotRestoreOnStartup(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/snap.json"

	s1, err := New(config.Config{
		MaxQueues:        10,
		MaxDepth:         100,
		MaxMessageBytes:  1024,
		SnapshotPath:     path,
		SnapshotInterval: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"persist-me"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s1.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("enqueue status = %d", rec.Code)
	}
	if err := s1.Shutdown(); err != nil {
		t.Fatal(err)
	}

	s2, err := New(config.Config{
		MaxQueues:        10,
		MaxDepth:         100,
		MaxMessageBytes:  1024,
		SnapshotPath:     path,
		SnapshotInterval: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s2.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dequeue after restore status = %d body=%s", rec.Code, rec.Body.String())
	}
	var msg struct {
		Body string `json:"body"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Body != "persist-me" {
		t.Fatalf("body = %q", msg.Body)
	}
}

func TestWALSurvivesWithoutShutdownCompact(t *testing.T) {
	dir := t.TempDir()
	walPath := dir + "/clarkq.wal"

	s1, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 1024,
		WALPath:         walPath,
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"from-wal"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s1.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("enqueue status = %d %s", rec.Code, rec.Body.String())
	}
	// Simulate hard stop without graceful compact: close WAL only via Shutdown still
	// truncates nothing when no snapshot — Stop keeps WAL content.
	if err := s1.Shutdown(); err != nil {
		t.Fatal(err)
	}

	s2, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 1024,
		WALPath:         walPath,
	})
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s2.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var msg struct {
		Body string `json:"body"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &msg)
	if msg.Body != "from-wal" {
		t.Fatalf("body = %q", msg.Body)
	}
}

func TestPerQueueEncryptionModes(t *testing.T) {
	dir := t.TempDir()
	s, err := New(config.Config{
		MaxQueues:       10,
		MaxDepth:        100,
		MaxMessageBytes: 4096,
		EncryptionMode:  "none",
		EncryptionQueues: map[string]string{
			"secure": "server_rsa",
			"e2e":    "client",
		},
		RSAKeyDir: dir,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Default queue stays plaintext.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/orders", bytes.NewBufferString(`{"body":"plain"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("orders post = %d %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/orders", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	var plain struct {
		Body       string `json:"body"`
		Encryption any    `json:"encryption"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &plain); err != nil {
		t.Fatal(err)
	}
	if plain.Body != "plain" || plain.Encryption != nil {
		t.Fatalf("expected plaintext message, got %#v", plain)
	}

	// server_rsa override encrypts at rest.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/secure", bytes.NewBufferString(`{"body":"secret"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("secure post = %d %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/queue/secure", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	var secure struct {
		Body       string `json:"body"`
		Encryption struct {
			Mode string `json:"mode"`
		} `json:"encryption"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &secure); err != nil {
		t.Fatal(err)
	}
	if secure.Body == "secret" || secure.Encryption.Mode != "server_rsa" {
		t.Fatalf("expected server_rsa ciphertext, got %#v", secure)
	}

	// client override requires encryption metadata.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/e2e", bytes.NewBufferString(`{"body":"no-meta"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("e2e without meta status = %d, want 400", rec.Code)
	}

	payload := `{"body":"ct","encryption":{"mode":"client","algorithm":"aes-256-gcm","key_id":"k1","nonce":"n1"}}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/e2e", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("e2e post = %d %s", rec.Code, rec.Body.String())
	}

	// Crypto config exposes overrides.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/crypto/config", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("crypto config status = %d", rec.Code)
	}
	var cfg struct {
		Mode   string            `json:"mode"`
		Queues map[string]string `json:"queues"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Mode != "none" || cfg.Queues["secure"] != "server_rsa" || cfg.Queues["e2e"] != "client" {
		t.Fatalf("unexpected crypto config: %#v", cfg)
	}

	// Public key available because server_rsa is used by a queue override.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/crypto/public-key", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("public-key status = %d %s", rec.Code, rec.Body.String())
	}
}
