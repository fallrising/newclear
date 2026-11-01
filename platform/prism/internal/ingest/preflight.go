package ingest

import (
	"context"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest/limits"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func freezeLimits(input limits.Options, maxElements int, now func() time.Time) (limits.Options, error) {
	// Resolve and detach every pointer before any goroutine/admission can see it.
	s, err := limits.Resolve(input.Global, input.Tenant)
	if err != nil {
		return input, err
	}
	input.Global = limits.Overrides{MaxLabelNameLength: &s.MaxLabelNameLength, MaxLabelValueLength: &s.MaxLabelValueLength, MaxLabelsPerSeries: &s.MaxLabelsPerSeries, MaxActiveSeriesPerTenant: &s.MaxActiveSeriesPerTenant, MaxSeriesPerMetricName: &s.MaxSeriesPerMetricName, MaxLogLineBytes: &s.MaxLogLineBytes, MaxAttrsPerRecord: &s.MaxAttrsPerRecord, MaxSpansPerTrace: &s.MaxSpansPerTrace, IngestRateBytesPerSec: &s.IngestRateBytesPerSec, IngestBurstBytes: &s.IngestBurstBytes, CardinalityAlarmThreshold: &s.CardinalityAlarmThreshold, AutoDropHighCardinality: &s.AutoDropHighCardinality, DeniedLabelPattern: &s.DeniedLabelPattern}
	input.Tenant = limits.Overrides{}
	input.Now = now
	input.MaxRecords = maxElements
	input.MaxRecordElements = maxElements
	// Constructor validation is complete before successful byte admission.
	_, err = limits.New("validation", input)
	return input, err
}

// rawCheck validates decoded pdata before normalization allocations. It counts
// all hierarchy/attribute/numeric elements and potential metric expansion.
// Depth is capped because AnyValue serialization traverses nested values.
type rawCheck struct {
	ctx context.Context
	f   footprint
	ok  bool
}

func (p *Pipeline) raw(ctx context.Context) *rawCheck {
	return &rawCheck{ctx: ctx, f: footprint{maxBytes: p.options.MaxInputBytes, maxElements: p.options.MaxElements}, ok: true}
}
func (r *rawCheck) add(bytes, elements int) {
	r.ok = r.ok && r.ctx.Err() == nil && r.f.add(bytes, elements)
}
func (r *rawCheck) text(values ...string) {
	for _, value := range values {
		r.add(len(value), 1)
	}
}
func (r *rawCheck) attrs(attrs pcommon.Map, depth int) {
	r.add(0, attrs.Len())
	if !r.ok {
		return
	}
	attrs.Range(func(k string, v pcommon.Value) bool { r.text(k); r.value(v, depth); return r.ok })
}
func (r *rawCheck) value(value pcommon.Value, depth int) {
	r.add(0, 1)
	if depth > 16 {
		r.ok = false
	}
	if !r.ok {
		return
	}
	switch value.Type() {
	case pcommon.ValueTypeStr:
		r.text(value.Str())
	case pcommon.ValueTypeBytes:
		r.add(value.Bytes().Len(), value.Bytes().Len())
	case pcommon.ValueTypeMap:
		r.attrs(value.Map(), depth+1)
	case pcommon.ValueTypeSlice:
		values := value.Slice()
		r.add(0, values.Len())
		for i := 0; i < values.Len() && r.ok; i++ {
			r.value(values.At(i), depth+1)
		}
	}
}
func (r *rawCheck) resource(resource pcommon.Resource) {
	r.add(0, 1)
	r.attrs(resource.Attributes(), 0)
}
func (r *rawCheck) scope(scope pcommon.InstrumentationScope) {
	r.add(0, 1)
	r.text(scope.Name(), scope.Version())
	r.attrs(scope.Attributes(), 0)
}
func (r *rawCheck) exemplars(exemplars pmetric.ExemplarSlice) {
	r.add(0, exemplars.Len())
	for i := 0; i < exemplars.Len() && r.ok; i++ {
		r.attrs(exemplars.At(i).FilteredAttributes(), 0)
	}
}
func (r *rawCheck) finish() error {
	if err := r.ctx.Err(); err != nil {
		return spi.Wrap(spi.ErrTimeout, "", "ingest.preflight", err)
	}
	if !r.ok {
		return ingestError(spi.ErrTooLarge, "decoded request exceeds byte, element or depth capacity")
	}
	return nil
}
func (p *Pipeline) checkMetrics(ctx context.Context, input pmetric.Metrics) error {
	r := p.raw(ctx)
	resources := input.ResourceMetrics()
	r.add(0, resources.Len())
	for i := 0; i < resources.Len() && r.ok; i++ {
		resource := resources.At(i)
		beforeResource, beforeResourceBytes := r.f.elements, r.f.bytes
		r.resource(resource.Resource())
		resourceElements, resourceBytes := r.f.elements-beforeResource, r.f.bytes-beforeResourceBytes
		r.text(resource.SchemaUrl())
		scopes := resource.ScopeMetrics()
		r.add(0, scopes.Len())
		for j := 0; j < scopes.Len() && r.ok; j++ {
			scope := scopes.At(j)
			r.scope(scope.Scope())
			r.text(scope.SchemaUrl())
			metrics := scope.Metrics()
			r.add(0, metrics.Len())
			for k := 0; k < metrics.Len() && r.ok; k++ {
				metric := metrics.At(k)
				beforeMetric, beforeMetricBytes := r.f.elements, r.f.bytes
				r.text(metric.Name(), metric.Description(), metric.Unit())
				identityBytes := r.f.bytes - beforeMetricBytes
				switch metric.Type() {
				case pmetric.MetricTypeGauge:
					r.numbers(metric.Gauge().DataPoints())
				case pmetric.MetricTypeSum:
					r.numbers(metric.Sum().DataPoints())
				case pmetric.MetricTypeHistogram:
					points := metric.Histogram().DataPoints()
					r.add(0, points.Len())
					for z := 0; z < points.Len() && r.ok; z++ {
						point := points.At(z)
						r.attrs(point.Attributes(), 0)
						r.exemplars(point.Exemplars())
						r.add(0, point.ExplicitBounds().Len())
						r.add(0, point.BucketCounts().Len())
						r.add(0, 4+point.ExplicitBounds().Len())
					}
				case pmetric.MetricTypeExponentialHistogram:
					points := metric.ExponentialHistogram().DataPoints()
					r.add(0, points.Len())
					for z := 0; z < points.Len() && r.ok; z++ {
						point := points.At(z)
						r.attrs(point.Attributes(), 0)
						r.exemplars(point.Exemplars())
						r.add(0, point.Positive().BucketCounts().Len())
						r.add(0, point.Negative().BucketCounts().Len())
						r.add(0, 5+point.Positive().BucketCounts().Len()+point.Negative().BucketCounts().Len())
					}
				case pmetric.MetricTypeSummary:
					points := metric.Summary().DataPoints()
					r.add(0, points.Len())
					for z := 0; z < points.Len() && r.ok; z++ {
						point := points.At(z)
						r.attrs(point.Attributes(), 0)
						r.add(0, 2+point.QuantileValues().Len())
					}
				}
				candidates := 0
				if r.ok {
					candidates = metricCandidates(metric)
				}
				if r.ok {
					r.repeat(r.f.bytes-beforeMetricBytes, r.f.elements-beforeMetric, metricExpansion(metric)-1)
				}
				r.repeat(identityBytes, 3, candidates-1)
				r.repeat(resourceBytes, resourceElements, candidates)
			}
		}
	}
	return r.finish()
}
func (r *rawCheck) numbers(points pmetric.NumberDataPointSlice) {
	r.add(0, points.Len())
	for i := 0; i < points.Len() && r.ok; i++ {
		point := points.At(i)
		r.attrs(point.Attributes(), 0)
		r.exemplars(point.Exemplars())
	}
}
func (p *Pipeline) checkLogs(ctx context.Context, input plog.Logs) error {
	r := p.raw(ctx)
	resources := input.ResourceLogs()
	r.add(0, resources.Len())
	for i := 0; i < resources.Len() && r.ok; i++ {
		resource := resources.At(i)
		beforeResource, beforeResourceBytes := r.f.elements, r.f.bytes
		r.resource(resource.Resource())
		resourceElements, resourceBytes := r.f.elements-beforeResource, r.f.bytes-beforeResourceBytes
		r.text(resource.SchemaUrl())
		scopes := resource.ScopeLogs()
		r.add(0, scopes.Len())
		for j := 0; j < scopes.Len() && r.ok; j++ {
			scope := scopes.At(j)
			r.scope(scope.Scope())
			r.text(scope.SchemaUrl())
			records := scope.LogRecords()
			r.repeat(resourceBytes, resourceElements, records.Len())
			r.add(0, records.Len())
			for k := 0; k < records.Len() && r.ok; k++ {
				record := records.At(k)
				r.text(record.SeverityText(), record.EventName())
				r.attrs(record.Attributes(), 0)
				r.value(record.Body(), 0)
			}
		}
	}
	return r.finish()
}
func (p *Pipeline) checkTraces(ctx context.Context, input ptrace.Traces) error {
	r := p.raw(ctx)
	resources := input.ResourceSpans()
	r.add(0, resources.Len())
	for i := 0; i < resources.Len() && r.ok; i++ {
		resource := resources.At(i)
		beforeResource, beforeResourceBytes := r.f.elements, r.f.bytes
		r.resource(resource.Resource())
		resourceElements, resourceBytes := r.f.elements-beforeResource, r.f.bytes-beforeResourceBytes
		r.text(resource.SchemaUrl())
		scopes := resource.ScopeSpans()
		r.add(0, scopes.Len())
		for j := 0; j < scopes.Len() && r.ok; j++ {
			scope := scopes.At(j)
			beforeScope, beforeScopeBytes := r.f.elements, r.f.bytes
			r.scope(scope.Scope())
			scopeElements, scopeBytes := r.f.elements-beforeScope, r.f.bytes-beforeScopeBytes
			r.text(scope.SchemaUrl())
			spans := scope.Spans()
			r.repeat(resourceBytes+scopeBytes, resourceElements+scopeElements, spans.Len())
			r.add(0, spans.Len())
			for k := 0; k < spans.Len() && r.ok; k++ {
				span := spans.At(k)
				r.text(span.Name(), span.TraceState().AsRaw(), span.Status().Message())
				r.attrs(span.Attributes(), 0)
				events := span.Events()
				r.add(0, events.Len())
				for z := 0; z < events.Len() && r.ok; z++ {
					event := events.At(z)
					r.text(event.Name())
					r.attrs(event.Attributes(), 0)
				}
				links := span.Links()
				r.add(0, links.Len())
				for z := 0; z < links.Len() && r.ok; z++ {
					r.text(links.At(z).TraceState().AsRaw())
					r.attrs(links.At(z).Attributes(), 0)
				}
			}
		}
	}
	return r.finish()
}

// repeat prevents resource/attribute expansion from multiplying raw work beyond
// byte/element bounds. Conservative refusal is allowed before mutation.
func (r *rawCheck) repeat(bytes, elements, candidates int) {
	if !r.ok || candidates <= 0 {
		return
	}
	if elements > (r.f.maxElements-r.f.elements)/candidates || bytes > (r.f.maxBytes-r.f.bytes)/candidates {
		r.ok = false
		return
	}
	r.add(bytes*candidates, elements*candidates)
}
func metricCandidates(metric pmetric.Metric) int {
	switch metric.Type() {
	case pmetric.MetricTypeGauge:
		return metric.Gauge().DataPoints().Len()
	case pmetric.MetricTypeSum:
		return metric.Sum().DataPoints().Len()
	case pmetric.MetricTypeHistogram:
		points := metric.Histogram().DataPoints()
		n := 0
		for i := range points.Len() {
			n += 4 + points.At(i).ExplicitBounds().Len()
		}
		return n
	case pmetric.MetricTypeExponentialHistogram:
		points := metric.ExponentialHistogram().DataPoints()
		n := 0
		for i := range points.Len() {
			n += 5 + points.At(i).Positive().BucketCounts().Len() + points.At(i).Negative().BucketCounts().Len()
		}
		return n
	case pmetric.MetricTypeSummary:
		points := metric.Summary().DataPoints()
		n := 0
		for i := range points.Len() {
			n += 2 + points.At(i).QuantileValues().Len()
		}
		return n
	default:
		return 0
	}
}

func metricExpansion(metric pmetric.Metric) int {
	maximum := 1
	switch metric.Type() {
	case pmetric.MetricTypeHistogram:
		points := metric.Histogram().DataPoints()
		for i := range points.Len() {
			maximum = max(maximum, 4+points.At(i).ExplicitBounds().Len())
		}
	case pmetric.MetricTypeExponentialHistogram:
		points := metric.ExponentialHistogram().DataPoints()
		for i := range points.Len() {
			maximum = max(maximum, 5+points.At(i).Positive().BucketCounts().Len()+points.At(i).Negative().BucketCounts().Len())
		}
	case pmetric.MetricTypeSummary:
		points := metric.Summary().DataPoints()
		for i := range points.Len() {
			maximum = max(maximum, 2+points.At(i).QuantileValues().Len())
		}
	}
	return maximum
}
