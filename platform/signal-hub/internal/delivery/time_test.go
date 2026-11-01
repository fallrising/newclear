package delivery

import (
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"net/url"
	"testing"
	"time"
)

func TestDigestBoundaryTimeDomain(t *testing.T) {
	for _, raw := range []string{"0001-01-01T00:00:00+23:59", "0001-01-01T00:00:00+23:00", "9999-12-31T23:59:59-23:00", "2026-10-03T12:00:00Z"} {
		original, err := event.ParseTime(raw)
		if err != nil {
			t.Fatal(err)
		}
		formatted, exact := BoundaryTime(original)
		parsed, err := event.ParseTime(formatted)
		if !exact || err != nil || !parsed.Equal(original) {
			t.Fatalf("%s -> %s exact=%v err=%v", raw, formatted, exact, err)
		}
	}
	low := time.Date(0, 12, 31, 0, 0, 0, 0, time.UTC)
	formatted, exact := BoundaryTime(low)
	if exact || formatted != "0001-01-01T00:00:00+23:59" {
		t.Fatal(formatted, exact)
	}
	sub := Subscription{Channel: Channel{Kind: "ntfy"}, Mode: "digest"}
	for _, edges := range [][2]time.Time{{low, low.Add(24 * time.Hour)}, {time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC), time.Date(10000, 1, 3, 0, 0, 0, 0, time.UTC)}} {
		message, err := DigestMessage(sub, nil, 0, edges[0], edges[1], "https://board.example.invalid")
		if err != nil {
			t.Fatal(err)
		}
		link, err := url.Parse(message.Headers["X-Click"])
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"from", "to"} {
			if raw := link.Query().Get(key); raw != "" {
				if _, err := event.ParseTime(raw); err != nil {
					t.Fatalf("invalid %s bound %s", key, raw)
				}
			}
		}
	}
}
