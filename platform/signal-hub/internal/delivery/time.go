package delivery

import "time"

// BoundaryTime renders a derived window edge within the event API's finite
// RFC3339 year domain. At the extremes an offset preserves the actual instant.
// false means the edge lies outside all representable event instants and the
// text was clipped; callers omit an unrepresentable upper query bound.
func BoundaryTime(t time.Time) (string, bool) {
	east := time.FixedZone("", (23*60+59)*60)
	west := time.FixedZone("", -(23*60+59)*60)
	minimum := time.Date(1, 1, 1, 0, 0, 0, 0, east)
	maximumExclusive := time.Date(10000, 1, 1, 0, 0, 0, 0, west)
	if t.Before(minimum) {
		return minimum.Format(time.RFC3339Nano), false
	}
	if !t.Before(maximumExclusive) {
		return maximumExclusive.Add(-time.Nanosecond).Format(time.RFC3339Nano), false
	}
	u := t.UTC()
	if u.Year() < 1 {
		u = t.In(east)
	} else if u.Year() > 9999 {
		u = t.In(west)
	}
	return u.Format(time.RFC3339Nano), true
}
