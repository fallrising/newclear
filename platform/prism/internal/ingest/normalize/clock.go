package normalize

import (
	"math"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
)

func otelTimestampNano(timestamp pcommon.Timestamp) int64 {
	if timestamp > pcommon.Timestamp(math.MaxInt64) {
		return math.MaxInt64
	}
	return int64(timestamp) //nolint:gosec // The upper-bound check makes the conversion safe.
}

func (n *Normalizer) normalizeNanoTimestamp(timestamp int64, attrs map[string]string, now time.Time, report *Report) (int64, map[string]string, bool) {
	oldest := utm.TimeToNano(now.Add(-n.options.MaxPast))
	newest := utm.TimeToNano(now.Add(n.options.MaxFuture))
	if timestamp >= oldest && timestamp <= newest {
		return timestamp, attrs, true
	}
	if n.options.ClockSkewPolicy == ClockSkewDrop {
		report.normalized("drop")
		report.rejected("clock_skew")
		return 0, attrs, false
	}
	if attrs == nil {
		attrs = make(map[string]string)
	}
	attrs["prism.clock_adjusted"] = "true"
	report.normalized("clamp")
	report.warning("clock_adjusted")
	return min(max(timestamp, oldest), newest), attrs, true
}

func (n *Normalizer) normalizeMetricTimestamp(timestamp int64, now time.Time, report *Report) (int64, bool) {
	oldest := utm.TimeToMilli(now.Add(-n.options.MaxPast))
	newest := utm.TimeToMilli(now.Add(n.options.MaxFuture))
	if timestamp >= oldest && timestamp <= newest {
		return timestamp, true
	}
	if n.options.ClockSkewPolicy == ClockSkewDrop {
		report.normalized("drop")
		report.rejected("clock_skew")
		return 0, false
	}
	report.normalized("clamp")
	report.warning("clock_adjusted")
	return min(max(timestamp, oldest), newest), true
}
