package delivery

import (
	"testing"
	"time"
)

func parseTime(t *testing.T, value string) time.Time {
	t.Helper()
	v, e := time.Parse(time.RFC3339, value)
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func TestDigestDSTBoundaries(t *testing.T) {
	cases := []struct{ name, zone, at, now, start, end string }{
		{"spring-gap", "America/New_York", "02:30", "2026-03-08T07:05:00Z", "2026-03-08T07:00:00Z", "2026-03-09T06:30:00Z"},
		{"before-spring-gap", "America/New_York", "02:30", "2026-03-08T06:59:00Z", "2026-03-07T07:30:00Z", "2026-03-08T07:00:00Z"},
		{"fall-first", "America/New_York", "01:30", "2026-11-01T05:30:00Z", "2026-11-01T05:30:00Z", "2026-11-02T06:30:00Z"},
		{"fall-second", "America/New_York", "01:30", "2026-11-01T06:20:00Z", "2026-11-01T05:30:00Z", "2026-11-02T06:30:00Z"},
		{"half-hour-gap", "Australia/Lord_Howe", "02:15", "2026-10-03T15:35:00Z", "2026-10-03T15:30:00Z", "2026-10-04T15:15:00Z"},
		{"taipei", "Asia/Taipei", "08:30", "2026-10-13T00:30:00Z", "2026-10-13T00:30:00Z", "2026-10-14T00:30:00Z"},
		{"utc-before", "UTC", "08:30", "2026-10-13T08:29:59Z", "2026-10-12T08:30:00Z", "2026-10-13T08:30:00Z"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := Digest{Every: "24h", At: tc.at, Timezone: tc.zone}
			start, end := Window(d, parseTime(t, tc.now))
			if !start.Equal(parseTime(t, tc.start)) || !end.Equal(parseTime(t, tc.end)) {
				t.Fatalf("got [%s,%s)", start, end)
			}
			if next := NextBoundary(d, start); !next.Equal(end) {
				t.Fatalf("next %s", next)
			}
		})
	}
}
func TestRetryDelayBounds(t *testing.T) {
	for attempt := 1; attempt <= 15; attempt++ {
		base := min(30*time.Second*time.Duration(1<<min(attempt-1, 7)), time.Hour)
		for range 40 {
			delay := RetryDelay(attempt, 0)
			if delay < base || delay > min(base+base/5, time.Hour) {
				t.Fatalf("attempt %d: %s", attempt, delay)
			}
		}
	}
	if got := RetryDelay(1, 4*time.Hour); got != time.Hour {
		t.Fatal(got)
	}
	if got := RetryDelay(1, 10*time.Minute); got != 10*time.Minute {
		t.Fatal(got)
	}
	now := time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)
	for raw, want := range map[string]time.Duration{"30": 30 * time.Second, "99999": time.Hour, "invalid": 0, "-1": 0, "Tue, 13 Oct 2026 00:02:00 GMT": 2 * time.Minute, "Mon, 12 Oct 2026 00:00:00 GMT": 0} {
		if got := parseRetryAfter(raw, now); got != want {
			t.Errorf("%q: %s", raw, got)
		}
	}
}
