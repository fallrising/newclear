package delivery

import (
	"bytes"
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

type Message struct {
	Body        []byte            `json:"body"`
	ContentType string            `json:"content_type"`
	Headers     map[string]string `json:"headers"`
}

// Immediate preserves webhook bytes verbatim and maps ntfy fields to headers.
func Immediate(sub Subscription, seq int64, raw []byte, boardURL string) (Message, error) {
	if sub.Channel.Kind == "webhook" {
		return Message{Body: bytes.Clone(raw), ContentType: "application/cloudevents+json", Headers: map[string]string{}}, nil
	}
	e, err := event.Parse(raw)
	if err != nil || sub.Channel.Kind != "ntfy" {
		return Message{}, errors.New("cannot build notification")
	}
	str := func(k string) string { v, _ := e.Fields[k].(string); return v }
	severity := cmp.Or(str("severity"), "info")
	priority := "2"
	switch severity {
	case "critical":
		priority = "5"
	case "error":
		priority = "4"
	case "warning":
		priority = "3"
	}
	source := strings.TrimRight(str("source"), "/:")
	if i := strings.LastIndexAny(source, "/:"); i >= 0 {
		source = source[i+1:]
	}
	click := str("originurl")
	if !safeClick(click) {
		click = boardLink(boardURL, url.Values{"event": {fmt.Sprint(seq)}})
	}
	return Message{Body: []byte(cmp.Or(str("summary"), str("subject"))), ContentType: "text/plain; charset=utf-8", Headers: map[string]string{
		"X-Title": singleLine("[" + severity + "] " + str("type")), "X-Priority": priority, "X-Tags": singleLine(source), "X-Click": singleLine(click),
	}}, nil
}
func DigestMessage(sub Subscription, events []json.RawMessage, total int64, start, end time.Time, boardURL string) (Message, error) {
	if sub.Channel.Kind != "ntfy" || sub.Mode != "digest" || total < 0 || !end.After(start) {
		return Message{}, errors.New("cannot build digest")
	}
	startText, _ := BoundaryTime(start)
	endText, endExact := BoundaryTime(end)
	query := url.Values{"from": {startText}}
	if endExact {
		query.Set("to", endText)
	}
	var body strings.Builder
	fmt.Fprintf(&body, "%d events\n%s — %s\n", total, startText, endText)
	for _, raw := range events[:min(len(events), 20)] {
		e, err := event.Parse(raw)
		if err != nil {
			return Message{}, errors.New("cannot build digest")
		}
		summary, _ := e.Fields["summary"].(string)
		subject, _ := e.Fields["subject"].(string)
		typ, _ := e.Fields["type"].(string)
		fmt.Fprintf(&body, "- %s: %s\n", typ, singleLine(cmp.Or(summary, subject)))
	}
	return Message{Body: []byte(body.String()), ContentType: "text/plain; charset=utf-8", Headers: map[string]string{
		"X-Title": fmt.Sprintf("Signal Hub digest: %d events", total), "X-Priority": "2", "X-Tags": "signalhub",
		"X-Click": boardLink(boardURL, query),
	}}, nil
}
func singleLine(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return ' '
		}
		return r
	}, value)
}
func boardLink(origin string, query url.Values) string {
	return strings.TrimRight(origin, "/") + "/?" + query.Encode()
}

// Event origin URIs may use any scheme; notification clicks are navigation.
// Keep the same HTTP(S) boundary as the board's event links.
func safeClick(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && !strings.ContainsAny(raw, "\r\n")
}
