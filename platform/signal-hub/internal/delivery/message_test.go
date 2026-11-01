package delivery

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

const sampleEvent = `{"specversion":"1.0","id":"synthetic-1","source":"urn:example:release","type":"release.deploy.succeeded","time":"2026-10-13T00:00:00Z","severity":"critical","summary":"synthetic summary","subject":"service"}`

func TestImmediateMessages(t *testing.T) {
	raw := []byte(sampleEvent + "\n ")
	msg, err := Immediate(Subscription{Channel: Channel{Kind: "webhook"}}, 7, raw, "http://board.example.invalid")
	if err != nil || string(msg.Body) != string(raw) || msg.ContentType != "application/cloudevents+json" {
		t.Fatalf("raw webhook changed: %v", err)
	}
	raw[0] = 'X'
	if msg.Body[0] != '{' {
		t.Fatal("message aliases input")
	}
	msg, err = Immediate(Subscription{Channel: Channel{Kind: "ntfy"}}, 7, []byte(sampleEvent), "http://board.example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	if string(msg.Body) != "synthetic summary" || msg.Headers["X-Title"] != "[critical] release.deploy.succeeded" || msg.Headers["X-Priority"] != "5" || msg.Headers["X-Tags"] != "release" || msg.Headers["X-Click"] != "http://board.example.invalid/?event=7" {
		t.Fatalf("ntfy mapping %#v", msg)
	}
	for severity, priority := range map[string]string{"error": "4", "warning": "3", "notice": "2", "info": "2", "debug": "2"} {
		raw := strings.Replace(sampleEvent, "critical", severity, 1)
		raw = strings.Replace(raw, `"summary":"synthetic summary",`, "", 1)
		raw = strings.TrimSuffix(raw, "}") + `,"originurl":"https://origin.example.invalid/build"}`
		msg, err := Immediate(Subscription{Channel: Channel{Kind: "ntfy"}}, 7, []byte(raw), "http://board.example.invalid")
		if err != nil || string(msg.Body) != "service" || msg.Headers["X-Priority"] != priority || msg.Headers["X-Click"] != "https://origin.example.invalid/build" {
			t.Fatalf("mapping %s: %v", severity, err)
		}
	}
	if got := singleLine("a\r\nX: b\x00\u2028c"); strings.ContainsAny(got, "\r\n\x00\u2028") {
		t.Fatal("unsafe header")
	}
}
func TestDigestMessageBoundsAndWindowLink(t *testing.T) {
	events := []json.RawMessage{}
	for i := range 25 {
		events = append(events, json.RawMessage(strings.Replace(sampleEvent, "synthetic summary", fmt.Sprintf("entry-%02d", i), 1)))
	}
	start := parseTime(t, "2026-10-12T00:00:00Z")
	end := parseTime(t, "2026-10-13T00:00:00Z")
	msg, err := DigestMessage(Subscription{Channel: Channel{Kind: "ntfy"}, Mode: "digest"}, events, 42, start, end, "http://board.example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(msg.Body), "42 events") || !strings.Contains(string(msg.Body), "entry-19") || strings.Contains(string(msg.Body), "entry-20") {
		t.Fatal("digest count/limit")
	}
	link, err := url.Parse(msg.Headers["X-Click"])
	if err != nil || link.Query().Get("from") != "2026-10-12T00:00:00Z" || link.Query().Get("to") != "2026-10-13T00:00:00Z" {
		t.Fatal("invalid window link")
	}
}

func TestNtfyUnsafeOriginFallsBack(t *testing.T) {
	for _, origin := range []string{"javascript:alert(1)", "data:text/plain,unsafe", "https://user:secret@origin.example.invalid/"} {
		raw := strings.TrimSuffix(sampleEvent, "}") + `,"originurl":` + strconv.Quote(origin) + `}`
		msg, err := Immediate(Subscription{Channel: Channel{Kind: "ntfy"}}, 7, []byte(raw), "http://board.example.invalid")
		if err != nil {
			t.Fatal(err)
		}
		if msg.Headers["X-Click"] != "http://board.example.invalid/?event=7" {
			t.Fatal("unsafe notification link")
		}
	}
}
