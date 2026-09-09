package utm

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

const (
	// MetricTimeUnit is the timestamp unit used by metric samples.
	MetricTimeUnit = time.Millisecond
	// EventTimeUnit is the timestamp unit used by logs and spans.
	EventTimeUnit = time.Nanosecond

	maxFloat = math.MaxFloat64
)

// MilliToSecFloat converts Unix milliseconds to Prometheus API seconds.
func MilliToSecFloat(ms int64) float64 { return float64(ms) / 1e3 }

// SecFloatToMilli converts Prometheus API seconds to milliseconds, rounded to
// the nearest millisecond as required by the compatibility contract.
func SecFloatToMilli(s float64) int64 { return int64(s*1e3 + 0.5) }

// NanoToMicro converts nanoseconds to microseconds.
func NanoToMicro(ns int64) int64 { return ns / 1e3 }

// MicroToNano converts microseconds to nanoseconds.
func MicroToNano(us int64) int64 { return us * 1e3 }

// NanoToMilli converts nanoseconds to milliseconds.
func NanoToMilli(ns int64) int64 { return ns / 1e6 }

// MilliToNano converts milliseconds to nanoseconds.
func MilliToNano(ms int64) int64 { return ms * 1e6 }

// TimeToMilli converts a time to Unix milliseconds.
func TimeToMilli(t time.Time) int64 { return t.UnixMilli() }

// TimeToNano converts a time to Unix nanoseconds.
func TimeToNano(t time.Time) int64 { return t.UnixNano() }

// MilliToTime converts Unix milliseconds to a UTC time.
func MilliToTime(ms int64) time.Time { return time.UnixMilli(ms).UTC() }

// NanoToTime converts Unix nanoseconds to a UTC time.
func NanoToTime(ns int64) time.Time { return time.Unix(0, ns).UTC() }

// ParsePromTime parses an RFC3339 timestamp or Unix seconds, including a
// fractional component.
func ParsePromTime(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("empty timestamp")
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return MilliToTime(SecFloatToMilli(f)), nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("cannot parse %q to a valid timestamp", s)
}

// ParseLokiTime parses a Unix nanosecond string, an RFC3339 timestamp, or a
// duration relative to now and returns Unix nanoseconds.
func ParseLokiTime(s string, now time.Time) (int64, error) {
	if s == "" {
		return 0, fmt.Errorf("empty timestamp")
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n, nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UnixNano(), nil
	}
	if d, err := time.ParseDuration(s); err == nil {
		return now.Add(-d).UnixNano(), nil
	}
	return 0, fmt.Errorf("cannot parse %q to a valid timestamp", s)
}

// ParseJaegerTime parses Unix microseconds and returns Unix nanoseconds.
func ParseJaegerTime(s string) (int64, error) {
	us, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("cannot parse %q as microseconds: %w", s, err)
	}
	return MicroToNano(us), nil
}

// ParseJaegerDuration parses a Jaeger duration such as "100ms" or "1.5s".
func ParseJaegerDuration(s string) (time.Duration, error) {
	if s == "" {
		return 0, nil
	}
	return time.ParseDuration(strings.TrimSpace(s))
}

// FormatPromValue formats a floating-point value according to the Prometheus
// HTTP API contract.
func FormatPromValue(v float64) string {
	switch {
	case v != v:
		return "NaN"
	case v > maxFloat:
		return "+Inf"
	case v < -maxFloat:
		return "-Inf"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}
