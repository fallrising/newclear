package delivery

import (
	"strconv"
	"time"
)

// boundary returns the first real instant on or after the requested civil time.
// Scanning in UTC selects the first occurrence of a repeated time, and the first
// valid local minute after a gap. It also handles skipped civil dates.
func boundary(d Digest, date time.Time) time.Time {
	location, err := time.LoadLocation(d.Timezone)
	if err != nil {
		return time.Time{}
	}
	hour, _ := strconv.Atoi(d.At[:2])
	minute, _ := strconv.Atoi(d.At[3:])
	y, m, day := date.Date()
	wall := time.Date(y, m, day, hour, minute, 0, 0, time.UTC)
	for instant := wall.Add(-36 * time.Hour); !instant.After(wall.Add(36 * time.Hour)); instant = instant.Add(time.Minute) {
		local := instant.In(location)
		ly, lm, ld := local.Date()
		civil := time.Date(ly, lm, ld, local.Hour(), local.Minute(), 0, 0, time.UTC)
		if !civil.Before(wall) {
			return instant
		}
	}
	return time.Time{}
}

// Window returns the half-open digest window containing t. Callers use a
// validated Digest; schedule boundaries are UTC instants, never fixed 24h spans.
func Window(d Digest, t time.Time) (start, end time.Time) {
	location, err := time.LoadLocation(d.Timezone)
	if err != nil || !digestAt.MatchString(d.At) {
		return time.Time{}, time.Time{}
	}
	local := t.In(location)
	today := time.Date(local.Year(), local.Month(), local.Day(), 12, 0, 0, 0, time.UTC)
	start = boundary(d, today)
	if t.Before(start) {
		start = boundary(d, today.AddDate(0, 0, -1))
		return start, boundary(d, today)
	}
	return start, boundary(d, today.AddDate(0, 0, 1))
}

// NextBoundary is strictly after t, including when t is itself a boundary.
func NextBoundary(d Digest, t time.Time) time.Time { _, end := Window(d, t); return end }
