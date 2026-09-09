// Package conformance provides the reusable Prism storage driver test suite.
package conformance

import (
	"fmt"
	"hash/fnv"
	"strconv"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

const (
	fixtureSeed   int64 = 20260905
	fixtureTenant       = "conformance-tenant"
)

// Fixtures produces deterministic telemetry shared by all storage drivers.
type Fixtures struct{ Seed int64 }

// NewFixtures returns a generator with the required fixed seed.
func NewFixtures() *Fixtures {
	return &Fixtures{Seed: fixtureSeed}
}

// Metrics returns deterministic metric points using millisecond timestamps.
func (f *Fixtures) Metrics(nSeries, nPoints int, start int64, step time.Duration) []utm.MetricPoint {
	if nSeries <= 0 || nPoints <= 0 {
		return nil
	}
	stepMillis := utm.NanoToMilli(int64(step))
	points := make([]utm.MetricPoint, 0, nSeries*nPoints)
	for series := range nSeries {
		seriesID := strconv.Itoa(series)
		seriesLabels := labels.FromStrings(
			utm.LabelName, "fixture_metric",
			utm.LabelTenant, fixtureTenant,
			"group", fmt.Sprintf("group-%d", series%4),
			"series", seriesID,
		)
		for point := range nPoints {
			value := float64(deterministic(f.Seed, series*nPoints+point)%1_000_000) / 1000
			points = append(points, utm.MetricPoint{
				Name:   "fixture_metric",
				Labels: seriesLabels,
				TS:     start + int64(point)*stepMillis,
				Value:  value,
				Type:   utm.TypeGauge,
			})
		}
	}
	return points
}

// Logs returns deterministic log records using nanosecond timestamps.
func (f *Fixtures) Logs(nStreams, nPerStream int, start int64, step time.Duration) []utm.LogRecord {
	if nStreams <= 0 || nPerStream <= 0 {
		return nil
	}
	logs := make([]utm.LogRecord, 0, nStreams*nPerStream)
	for stream := range nStreams {
		streamID := strconv.Itoa(stream)
		streamLabels := labels.FromStrings("job", "fixture", "stream", streamID)
		for entry := range nPerStream {
			value := deterministic(f.Seed, stream*nPerStream+entry)
			logs = append(logs, utm.LogRecord{
				Resource: &utm.Resource{Tenant: fixtureTenant, Service: "service-" + streamID},
				TS:       start + int64(entry)*int64(step),
				Severity: utm.SevInfo,
				Body:     fmt.Sprintf("fixture stream=%d entry=%d value=%d", stream, entry, value),
				TraceID:  fmt.Sprintf("%032x", value),
				SpanID:   fmt.Sprintf("%016x", value),
				Labels:   streamLabels,
				Attrs:    map[string]string{"entry": strconv.Itoa(entry)},
			})
		}
	}
	return logs
}

// Trace returns one deterministic trace spanning the requested services.
func (f *Fixtures) Trace(nServices, nSpansPerService int, start int64) []utm.Span {
	if nServices <= 0 || nSpansPerService <= 0 {
		return nil
	}
	traceID := fmt.Sprintf("%032x", deterministic(f.Seed, 0))
	spanKinds := [...]utm.SpanKind{utm.KindInternal, utm.KindServer, utm.KindClient, utm.KindProducer, utm.KindConsumer}
	spans := make([]utm.Span, 0, nServices*nSpansPerService)
	parentID := ""
	for service := range nServices {
		serviceName := fmt.Sprintf("service-%d", service)
		for index := range nSpansPerService {
			offset := service*nSpansPerService + index
			spanID := fmt.Sprintf("%016x", deterministic(f.Seed, offset+1))
			span := utm.Span{
				Resource:     &utm.Resource{Tenant: fixtureTenant, Service: serviceName},
				TraceID:      traceID,
				SpanID:       spanID,
				ParentSpanID: parentID,
				Name:         fmt.Sprintf("operation-%d", index),
				Kind:         spanKinds[offset%len(spanKinds)],
				StartNano:    start + int64(offset)*int64(time.Millisecond),
				EndNano:      start + int64(offset)*int64(time.Millisecond) + int64((index+1)*100_000),
				Attrs:        map[string]string{"service.index": strconv.Itoa(service), "span.index": strconv.Itoa(index)},
			}
			spans = append(spans, span)
			parentID = spanID
		}
	}
	return spans
}

// HighCardinality returns one point for each distinct metric series.
func (f *Fixtures) HighCardinality(nSeries int, start int64) []utm.MetricPoint {
	return f.Metrics(nSeries, 1, start, time.Millisecond)
}

func deterministic(seed int64, index int) uint64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(strconv.FormatInt(seed, 10)))
	_, _ = hash.Write([]byte{':'})
	_, _ = hash.Write([]byte(strconv.Itoa(index)))
	return hash.Sum64()
}
