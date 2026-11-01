package limits

import (
	"container/list"
	"context"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

type seriesState struct {
	fingerprint uint64
	metric      string
	seen        time.Time
}
type labelKey struct{ metric, label string }
type labelTracker struct {
	values  map[uint64]*list.Element
	alarmed bool
}
type valueState struct {
	key  labelKey
	hash uint64
	seen time.Time
}
type traceState struct {
	id        string
	spans     map[string]struct{}
	seen      time.Time
	truncated bool
}
type labelObservation struct {
	key  labelKey
	hash uint64
	drop bool
}

func (l *Limiter) expire(ctx context.Context, now time.Time) error {
	for element := l.seriesLRU.Back(); element != nil; element = l.seriesLRU.Back() {
		if err := ctx.Err(); err != nil {
			return err
		}
		state := element.Value.(*seriesState)
		if now.Sub(state.seen) < activeWindow {
			break
		}
		delete(l.series, state.fingerprint)
		l.seriesLRU.Remove(element)
		l.sketch.remove(state.fingerprint)
		l.metricCounts[state.metric]--
		if l.metricCounts[state.metric] == 0 {
			delete(l.metricCounts, state.metric)
		}
	}
	for element := l.valuesLRU.Back(); element != nil; element = l.valuesLRU.Back() {
		if err := ctx.Err(); err != nil {
			return err
		}
		state := element.Value.(*valueState)
		if now.Sub(state.seen) < cardinalityWindow {
			break
		}
		tracker := l.trackers[state.key]
		delete(tracker.values, state.hash)
		l.valuesLRU.Remove(element)
		if len(tracker.values) <= l.settings.CardinalityAlarmThreshold {
			tracker.alarmed = false
		}
		if len(tracker.values) == 0 {
			delete(l.trackers, state.key)
		}
	}
	for element := l.traceLRU.Back(); element != nil; element = l.traceLRU.Back() {
		if err := ctx.Err(); err != nil {
			return err
		}
		state := element.Value.(*traceState)
		if now.Sub(state.seen) < l.options.TraceTTL {
			break
		}
		l.trackedSpans -= len(state.spans)
		delete(l.traces, state.id)
		l.traceLRU.Remove(element)
	}
	return ctx.Err()
}

// prepareLabels checks all tracker additions without mutating state. Commit is
// performed only after canonical series identity passes both admission caps.
func (l *Limiter) prepareLabels(ctx context.Context, metric string, input utm.Labels) ([]labelObservation, bool, error) {
	observations := make([]labelObservation, 0, len(input))
	newLabels, newValues := 0, 0
	for _, label := range input {
		if err := ctx.Err(); err != nil {
			return nil, false, err
		}
		if utm.IsReserved(label.Name) {
			continue
		}
		key := labelKey{metric: strings.Clone(metric), label: strings.Clone(label.Name)}
		hash := utm.Fingerprint(labels.FromStrings("value", label.Value))
		tracker := l.trackers[key]
		count := 0
		if tracker == nil {
			newLabels++
			newValues++
			count = 1
		} else {
			count = len(tracker.values)
			if _, found := tracker.values[hash]; !found {
				newValues++
				count++
			}
		}
		observations = append(observations, labelObservation{key: key, hash: hash, drop: l.settings.AutoDropHighCardinality && count > l.settings.CardinalityAlarmThreshold})
	}
	if len(l.trackers)+newLabels > l.options.MaxCardinalityLabels || l.valuesLRU.Len()+newValues > l.options.MaxCardinalityValues {
		return nil, false, nil
	}
	return observations, true, nil
}
func (l *Limiter) commitLabels(observations []labelObservation, now time.Time, report *Report) {
	for _, observation := range observations {
		tracker := l.trackers[observation.key]
		if tracker == nil {
			tracker = &labelTracker{values: map[uint64]*list.Element{}}
			l.trackers[observation.key] = tracker
		}
		if element, found := tracker.values[observation.hash]; found {
			element.Value.(*valueState).seen = now
			l.valuesLRU.MoveToFront(element)
		} else {
			element := l.valuesLRU.PushFront(&valueState{key: observation.key, hash: observation.hash, seen: now})
			tracker.values[observation.hash] = element
		}
		if len(tracker.values) > l.settings.CardinalityAlarmThreshold && !tracker.alarmed {
			tracker.alarmed = true
			report.alarm(Alarm{Kind: "high_cardinality_label", Metric: observation.key.metric, Label: observation.key.label})
		}
	}
}
func (l *Limiter) admitSeries(metric string, fingerprint uint64, now time.Time, report *Report) bool {
	if element, found := l.series[fingerprint]; found {
		element.Value.(*seriesState).seen = now
		l.seriesLRU.MoveToFront(element)
		return true
	}
	if l.metricCounts[metric] >= l.settings.MaxSeriesPerMetricName {
		report.reject("cardinality")
		report.alarm(Alarm{Kind: "series_per_metric", Metric: metric})
		return false
	}
	if len(l.series) >= l.settings.MaxActiveSeriesPerTenant {
		report.reject("cardinality")
		return false
	}
	element := l.seriesLRU.PushFront(&seriesState{fingerprint: fingerprint, metric: strings.Clone(metric), seen: now})
	l.series[fingerprint] = element
	l.metricCounts[strings.Clone(metric)]++
	l.sketch.add(fingerprint)
	return true
}
