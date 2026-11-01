package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/auth"
	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

func TestSourceHTTPFlowAndAttribution(t *testing.T) {
	dir := t.TempDir()
	ref := func(name, token string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(token), 0600); err != nil {
			t.Fatal(err)
		}
		return "file:" + p
	}
	overlapToken := strings.Repeat("o", 32)
	sources := []config.Source{
		{Name: "first", SourcePrefix: "urn:example:", AllowedTypes: []string{"test.event.*"}, TokenRef: ref("first", sourceToken), ExpectedInterval: "1s"},
		{Name: "overlap", SourcePrefix: "urn:example:", AllowedTypes: []string{"test.event.*"}, TokenRef: ref("overlap", overlapToken), ExpectedInterval: "1s"},
	}
	credentials, err := auth.New(sources, ref("owner", ownerToken), ref("reader", readerToken))
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(filepath.Join(dir, "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	if err = db.ConfigureSources(context.Background(), sources, now); err != nil {
		t.Fatal(err)
	}
	h := New(db, credentials).(*Server)
	h.now = func() time.Time { return now }
	get := func() []any {
		status, body := request(t, h, "GET", "/v1/sources", readerToken, "", "")
		if status != 200 {
			t.Fatalf("query %d %+v", status, body)
		}
		return body["items"].([]any)
	}
	state := func(index int, status string) map[string]any {
		t.Helper()
		item := get()[index].(map[string]any)
		if item["status"] != status {
			t.Fatalf("source=%+v wanted %s", item, status)
		}
		if len(item) != 6 {
			t.Fatalf("extra fields %+v", item)
		}
		return item
	}
	for _, token := range []string{"", sourceToken} {
		want := 401
		if token != "" {
			want = 403
		}
		status, _ := request(t, h, "GET", "/v1/sources", token, "", "")
		if status != want {
			t.Fatalf("role status=%d want=%d", status, want)
		}
	}
	if state(0, "never")["last_received_at"] != nil {
		t.Fatal("never has time")
	}
	state(1, "never")
	status, first := request(t, h, "POST", "/v1/events", sourceToken, "application/cloudevents+json", validEvent)
	if status != 202 {
		t.Fatal(status, first)
	}
	state(0, "fresh")
	state(1, "never")
	now = now.Add(3 * time.Second)
	// Role rejection must not trigger evaluator writes.
	request(t, h, "GET", "/v1/sources", sourceToken, "", "")
	page, err := db.List(context.Background(), store.Query{Type: "signalhub.source.*"})
	if err != nil || len(page.Items) != 0 {
		t.Fatal("unauthorized query evaluated sources")
	}
	state(0, "silent")
	state(1, "never")
	status, duplicate := request(t, h, "POST", "/v1/events", overlapToken, "application/cloudevents+json", validEvent)
	if status != 200 || duplicate["seq"] != first["seq"] {
		t.Fatalf("overlap duplicate %d %+v", status, duplicate)
	}
	state(0, "silent")
	state(1, "fresh")
	// Invalid/conflicting attempts cannot refresh or recover first.
	for _, tc := range []struct {
		body string
		want int
	}{{"{}", 400}, {strings.Replace(validEvent, `"ok":true`, `"ok":false`, 1), 409}, {strings.Replace(validEvent, "test.event.created", "signalhub.source.recovered", 1), 403}} {
		status, _ := request(t, h, "POST", "/v1/events", sourceToken, "application/cloudevents+json", tc.body)
		if status != tc.want {
			t.Fatalf("status=%d want=%d", status, tc.want)
		}
		state(0, "silent")
	}
	status, duplicate = request(t, h, "POST", "/v1/events", sourceToken, "application/cloudevents+json", validEvent)
	if status != 200 || duplicate["seq"] != first["seq"] {
		t.Fatalf("recovery duplicate %d %+v", status, duplicate)
	}
	state(0, "fresh")
	page, err = db.List(context.Background(), store.Query{Type: "signalhub.source.*"})
	if err != nil || len(page.Items) != 2 {
		t.Fatalf("transition count=%d %v", len(page.Items), err)
	}
	for _, item := range page.Items {
		var event map[string]any
		json.Unmarshal(item.Event, &event)
		if event["source"] != "urn:signalhub:sources:first" || event["subject"] != "first" {
			t.Fatalf("transition %+v", event)
		}
	}
	status, body := request(t, h, "GET", "/v1/sources?limit=1", ownerToken, "", "")
	if status != 200 || body["next_cursor"] == nil {
		t.Fatal(status, body)
	}
	cursor := body["next_cursor"].(string)
	status, body = request(t, h, "GET", "/v1/sources?cursor="+cursor, ownerToken, "", "")
	if status != 200 || body["next_cursor"] != nil || len(body["items"].([]any)) != 1 {
		t.Fatal(status, body)
	}
	for _, query := range []string{"limit=0", "limit=201", "cursor=", "limit=1&limit=2", "source=x", "cursor=bad", "%xx=1"} {
		status, _ := request(t, h, "GET", "/v1/sources?"+query, readerToken, "", "")
		if status != 400 {
			t.Errorf("%s=%d", query, status)
		}
	}
	status, detail := request(t, h, "GET", fmt.Sprintf("/v1/events/%.0f", first["seq"]), readerToken, "", "")
	if status != 200 || detail["item"].(map[string]any)["received_at"] != "2026-10-03T12:00:00Z" {
		t.Fatal("event changed", detail)
	}
	db.Close()
	status, _ = request(t, h, "GET", "/v1/sources", readerToken, "", "")
	if status != 503 {
		t.Fatalf("closed=%d", status)
	}
}

func TestReservedTransitionIdentityCannotBeOccupied(t *testing.T) {
	h, _ := setup(t)
	server := h.(*Server)
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "source")
	ownerPath := filepath.Join(dir, "owner")
	if err := os.WriteFile(sourcePath, []byte(sourceToken), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ownerPath, []byte(ownerToken), 0600); err != nil {
		t.Fatal(err)
	}
	credentials, err := auth.New([]config.Source{{Name: "broad", SourcePrefix: "urn:", AllowedTypes: []string{"test.event.*"}, TokenRef: "file:" + sourcePath}}, "file:"+ownerPath, "")
	if err != nil {
		t.Fatal(err)
	}
	server.auth = credentials
	body := strings.Replace(validEvent, "urn:example:tests", "urn:signalhub:sources:broad", 1)
	body = strings.Replace(body, `"id":"one"`, `"id":"source:1:1"`, 1)
	status, _ := request(t, h, "POST", "/v1/events", sourceToken, "application/cloudevents+json", body)
	if status != 403 {
		t.Fatalf("reserved identity accepted: %d", status)
	}
}
