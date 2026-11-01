package limits

import (
	"slices"
	"strings"
)

// Alarm is a bounded observation for future pipeline telemetry/alert routing.
// Kind is either series_per_metric or high_cardinality_label.
type Alarm struct{ Kind, Metric, Label string }

// Report describes every rejection or mutation. Normalized and Rejected keys
// use the registered telemetry domains; warning keys are diagnostic only.
// TruncatedTraces reports IDs to downstream metadata handling; this package
// cannot modify spans that were previously persisted.
// EventOverflow reports observations omitted at the configured report bound.
type Report struct {
	Normalized      map[string]uint64
	Rejected        map[string]uint64
	Warnings        map[string]uint64
	Alarms          []Alarm
	TruncatedTraces []string
	EventOverflow   uint64
	maxEvents       int
}

func newReport(max int) Report {
	return Report{Normalized: map[string]uint64{}, Rejected: map[string]uint64{}, Warnings: map[string]uint64{}, maxEvents: max}
}
func (r *Report) normalized(action string, n uint64) { r.Normalized[action] += n }
func (r *Report) reject(reason string)               { r.Rejected[reason]++ }
func (r *Report) warn(reason string)                 { r.Warnings[reason]++ }
func (r *Report) alarm(alarm Alarm) {
	if slices.Contains(r.Alarms, alarm) {
		return
	}
	if len(r.Alarms)+len(r.TruncatedTraces) >= r.maxEvents {
		r.EventOverflow++
		return
	}
	alarm.Metric = strings.Clone(alarm.Metric)
	alarm.Label = strings.Clone(alarm.Label)
	r.Alarms = append(r.Alarms, alarm)
}
func (r *Report) trace(trace string) {
	if slices.Contains(r.TruncatedTraces, trace) {
		return
	}
	if len(r.Alarms)+len(r.TruncatedTraces) >= r.maxEvents {
		r.EventOverflow++
		return
	}
	r.TruncatedTraces = append(r.TruncatedTraces, strings.Clone(trace))
}
