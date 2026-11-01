package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/signal-hub/internal/auth"
	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

const sourceToken = "source-test-token-01234567890123456789"
const ownerToken = "owner-test-token-012345678901234567890"
const readerToken = "reader-test-token-01234567890123456789"
const validEvent = `{"specversion":"1.0","source":"urn:example:tests","id":"one","type":"test.event.created","time":"2026-10-03T12:00:00Z","data":{"ok":true}}`

func setup(t *testing.T) (http.Handler, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	ref := func(name, token string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(token), 0600); err != nil {
			t.Fatal(err)
		}
		return "file:" + p
	}
	credentials, err := auth.New([]config.Source{
		{Name: "test", SourcePrefix: "urn:example:", AllowedTypes: []string{"test.event.*"}, TokenRef: ref("source", sourceToken)},
		{Name: "alert", SourcePrefix: "urn:signalhub:alertmanager:", AllowedTypes: []string{"alertmanager.alert.*"}, TokenRef: ref("alert", strings.Repeat("a", 32))},
	}, ref("owner", ownerToken), ref("reader", readerToken))
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(filepath.Join(dir, "events.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return New(db, credentials), db
}

func request(t *testing.T, h http.Handler, method, path, token, media, body string) (int, map[string]any) {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if media != "" {
		r.Header.Set("Content-Type", media)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("non-JSON response: %s", w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("response must not be cached")
	}
	return w.Code, result
}

func TestDurableHTTPAcceptance(t *testing.T) {
	h, _ := setup(t)
	post := func(body string) (int, map[string]any) {
		return request(t, h, "POST", "/v1/events", sourceToken, "application/cloudevents+json", body)
	}
	status, first := post(validEvent)
	if status != 202 || first["seq"] != float64(1) {
		t.Fatalf("create %d %v", status, first)
	}
	status, dup := post(validEvent)
	if status != 200 || dup["seq"] != first["seq"] || dup["duplicate"] != true {
		t.Fatalf("duplicate %d %v", status, dup)
	}
	status, _ = post(strings.Replace(validEvent, `"ok":true`, `"ok":false`, 1))
	if status != 409 {
		t.Fatalf("conflict %d", status)
	}
	status, detail := request(t, h, "GET", "/v1/events/1", readerToken, "", "")
	if status != 200 || detail["item"].(map[string]any)["event"].(map[string]any)["data"].(map[string]any)["ok"] != true {
		t.Fatalf("original changed: %v", detail)
	}
	status, page := request(t, h, "GET", "/v1/events?limit=1&type=test*&q=created", ownerToken, "", "")
	if status != 200 || len(page["items"].([]any)) != 1 || page["next_cursor"] != nil {
		t.Fatalf("page %d %v", status, page)
	}
	status, batch := request(t, h, "POST", "/v1/events", sourceToken, "application/cloudevents-batch+json", "["+validEvent+",{},"+
		strings.Replace(validEvent, `"one"`, `"two"`, 1)+"]")
	results := batch["results"].([]any)
	if status != 200 || len(results) != 3 {
		t.Fatalf("batch %d %v", status, batch)
	}
	for i, want := range []float64{200, 400, 202} {
		item := results[i].(map[string]any)
		if item["index"] != float64(i) || item["status"] != want {
			t.Errorf("batch member %d: %v", i, item)
		}
	}
}

func TestHTTPAuthorizationAndFailures(t *testing.T) {
	h, db := setup(t)
	tests := []struct {
		method, path, token, media, body string
		want                             int
		code                             string
	}{
		{"POST", "/v1/events", "", "application/cloudevents+json", validEvent, 401, "unauthenticated"},
		{"POST", "/v1/events", ownerToken, "application/cloudevents+json", validEvent, 403, "forbidden"},
		{"POST", "/v1/events", readerToken, "application/cloudevents+json", validEvent, 403, "forbidden"},
		{"GET", "/v1/events", sourceToken, "", "", 403, "forbidden"},
		{"POST", "/v1/events", sourceToken, "application/json", validEvent, 415, "unsupported_media_type"},
		{"POST", "/v1/events", sourceToken, "application/cloudevents+json", strings.Replace(validEvent, "urn:example:tests", "urn:other:tests", 1), 403, "forbidden"},
		{"POST", "/v1/events", sourceToken, "application/cloudevents+json", strings.Replace(validEvent, "test.event.created", "signalhub.rule.test", 1), 403, "forbidden"},
		{"POST", "/v1/events", sourceToken, "application/cloudevents+json", `{"id":"one","id":"two"}`, 400, "invalid_json"},
		{"POST", "/v1/events", sourceToken, "application/cloudevents-batch+json", "[]", 400, "invalid_batch"},
		{"POST", "/v1/events", sourceToken, "application/cloudevents+json", strings.Replace(validEvent, `{"ok":true}`, `{"x":"`+strings.Repeat("x", 16384)+`"}`, 1), 413, "payload_too_large"},
		{"POST", "/v1/events", sourceToken, "application/cloudevents+json", strings.Repeat(" ", MaxBodyBytes+1), 413, "payload_too_large"},
		{"GET", "/v1/events?limit=0", ownerToken, "", "", 400, "invalid_query"},
		{"GET", "/v1/events?limit=2&limit=3", ownerToken, "", "", 400, "invalid_query"},
		{"GET", "/v1/events?data=secret", ownerToken, "", "", 400, "invalid_query"},
		{"GET", "/v1/events?from=bad", ownerToken, "", "", 400, "invalid_query"},
		{"GET", "/v1/events?cursor=nope", ownerToken, "", "", 400, "invalid_query"},
		{"GET", "/v1/events/999", ownerToken, "", "", 404, "not_found"},
		{"GET", "/v1/events/0", ownerToken, "", "", 400, "invalid_query"},
	}
	for i, tc := range tests {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			status, res := request(t, h, tc.method, tc.path, tc.token, tc.media, tc.body)
			if status != tc.want || res["error"].(map[string]any)["code"] != tc.code {
				t.Fatalf("%d %v", status, res)
			}
			raw, _ := json.Marshal(res)
			for _, secret := range []string{ownerToken, readerToken, sourceToken} {
				if bytes.Contains(raw, []byte(secret)) {
					t.Fatal("secret in response")
				}
			}
		})
	}
	for _, path := range []string{"/healthz", "/readyz"} {
		if status, _ := request(t, h, "GET", path, "", "", ""); status != 200 {
			t.Fatalf("probe %s %d", path, status)
		}
	}
	db.Close()
	if status, res := request(t, h, "GET", "/readyz", "", "", ""); status != 503 || res["status"] != "not_ready" || len(res) != 1 {
		t.Fatalf("readiness %d %v", status, res)
	}
	if status, res := request(t, h, "POST", "/v1/events", sourceToken, "application/cloudevents+json", validEvent); status != 503 || res["error"].(map[string]any)["code"] != "unavailable" {
		t.Fatalf("closed store %d %v", status, res)
	}
}

func TestAlertmanagerHTTP(t *testing.T) {
	h, _ := setup(t)
	payload := `{"version":"4","receiver":"demo","status":"firing","groupKey":"group","alerts":[{"status":"firing","labels":{"alertname":"Demo"},"annotations":{},"startsAt":"2026-10-03T10:00:00Z","endsAt":"0001-01-01T00:00:00Z","generatorURL":"https://example.invalid/alert","fingerprint":"abc"}]}`
	for i, want := range []float64{202, 200} {
		status, res := request(t, h, "POST", "/v1/adapters/alertmanager", strings.Repeat("a", 32), "application/json", payload)
		if status != 200 || res["results"].([]any)[0].(map[string]any)["status"] != want {
			t.Fatalf("attempt %d: %d %v", i, status, res)
		}
	}
	resolved := strings.ReplaceAll(payload, "firing", "resolved")
	resolved = strings.Replace(resolved, "0001-01-01T00:00:00Z", "2026-10-03T11:00:00Z", 1)
	status, res := request(t, h, "POST", "/v1/adapters/alertmanager", strings.Repeat("a", 32), "application/json", resolved)
	if status != 200 || res["results"].([]any)[0].(map[string]any)["status"] != float64(202) {
		t.Fatalf("resolved %d %v", status, res)
	}
}
