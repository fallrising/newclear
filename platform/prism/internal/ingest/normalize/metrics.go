package normalize

import (
	"cmp"
	"context"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize/deltaconv"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

// NormalizeMetrics maps OTLP metrics to bounded UTM points and metadata.
func (n *Normalizer) NormalizeMetrics(ctx context.Context, metrics pmetric.Metrics, receivedAt time.Time) (MetricBatch, Report, error) {
	report := newReport()
	batch := MetricBatch{
		Points:   make([]utm.MetricPoint, 0, min(metrics.DataPointCount(), n.options.MaxRecords)),
		Metadata: make([]utm.MetricMetadata, 0),
	}
	resources := metrics.ResourceMetrics()
	for i := range resources.Len() {
		resourceMetrics := resources.At(i)
		resource := n.normalizeResource(resourceMetrics.Resource(), false, &report)
		scopes := resourceMetrics.ScopeMetrics()
		for j := range scopes.Len() {
			inputMetrics := scopes.At(j).Metrics()
			for k := range inputMetrics.Len() {
				if err := ctx.Err(); err != nil {
					return MetricBatch{}, report, fmt.Errorf("normalize metrics: %w", err)
				}
				n.normalizeMetric(inputMetrics.At(k), resource, receivedAt, &batch, &report)
			}
		}
	}
	return batch, report, nil
}

func (n *Normalizer) normalizeMetric(metric pmetric.Metric, resource *utm.Resource, receivedAt time.Time, batch *MetricBatch, report *Report) {
	baseName := utm.SanitizeMetricName(validUTF8(metric.Name()))
	if baseName != metric.Name() {
		report.normalized("rename")
	}
	if baseName == "" {
		report.normalized("drop")
		report.rejected("empty_metric_name")
		return
	}
	name, scale := normalizeUnit(baseName, metric.Unit(), report)

	var metricType utm.MetricType
	switch metric.Type() {
	case pmetric.MetricTypeGauge:
		metricType = utm.TypeGauge
		n.normalizeNumberPoints(metric.Gauge().DataPoints(), name, scale, metricType, false, resource, receivedAt, batch, report)
	case pmetric.MetricTypeSum:
		sum := metric.Sum()
		metricType = utm.TypeGauge
		if sum.IsMonotonic() {
			metricType = utm.TypeCounter
			name = ensureSuffix(name, "_total", report)
		}
		delta := sum.AggregationTemporality() == pmetric.AggregationTemporalityDelta
		n.normalizeNumberPoints(sum.DataPoints(), name, scale, metricType, delta, resource, receivedAt, batch, report)
	case pmetric.MetricTypeHistogram:
		metricType = utm.TypeHistogram
		n.normalizeHistogramPoints(metric.Histogram(), name, scale, resource, receivedAt, batch, report)
	case pmetric.MetricTypeExponentialHistogram:
		metricType = utm.TypeHistogram
		n.normalizeExponentialHistogramPoints(metric.ExponentialHistogram(), name, scale, resource, receivedAt, batch, report)
	case pmetric.MetricTypeSummary:
		metricType = utm.TypeSummary
		n.normalizeSummaryPoints(metric.Summary().DataPoints(), name, scale, resource, receivedAt, batch, report)
	default:
		report.normalized("drop")
		report.rejected("unsupported_metric_type")
		return
	}

	if len(batch.Metadata) >= n.options.MaxRecords {
		report.normalized("drop")
		report.rejected("output_limit")
		return
	}
	batch.Metadata = append(batch.Metadata, utm.MetricMetadata{
		Metric: name,
		Type:   metricType,
		Help:   validUTF8(metric.Description()),
		Unit:   validUTF8(metric.Unit()),
	})
}

func (n *Normalizer) normalizeNumberPoints(points pmetric.NumberDataPointSlice, name string, scale float64, metricType utm.MetricType, delta bool, resource *utm.Resource, receivedAt time.Time, batch *MetricBatch, report *Report) {
	for i := range points.Len() {
		point := points.At(i)
		timestamp, ok := n.normalizeMetricTimestamp(utm.NanoToMilli(int64(point.Timestamp())), receivedAt, report)
		if !ok {
			continue
		}
		value := numberDataPointValue(point) * scale
		if point.Flags().NoRecordedValue() {
			value = math.NaN()
		}
		pointLabels := n.metricLabels(point.Attributes(), resource, report)
		if delta && !math.IsNaN(value) {
			var status deltaconv.Status
			value, status = n.delta.Convert(deltaSeriesKey(name, pointLabels), value)
			switch status {
			case deltaconv.Baseline:
				report.normalized("drop")
				report.warning("delta_baseline")
				continue
			case deltaconv.Capacity:
				report.normalized("drop")
				report.rejected("delta_state_full")
				report.warning("delta_state_full")
				continue
			case deltaconv.Converted:
			}
		}
		n.appendPoint(batch, utm.MetricPoint{
			Name:     name,
			Labels:   pointLabels,
			TS:       timestamp,
			Value:    value,
			Type:     metricType,
			Exemplar: normalizeExemplar(point.Exemplars(), scale, report),
		}, report)
	}
}

func (n *Normalizer) normalizeHistogramPoints(histogram pmetric.Histogram, name string, scale float64, resource *utm.Resource, receivedAt time.Time, batch *MetricBatch, report *Report) {
	if histogram.AggregationTemporality() == pmetric.AggregationTemporalityDelta {
		report.normalized("drop")
		report.rejected("delta_histogram_unsupported")
		return
	}
	points := histogram.DataPoints()
	for i := range points.Len() {
		point := points.At(i)
		timestamp, ok := n.normalizeMetricTimestamp(utm.NanoToMilli(int64(point.Timestamp())), receivedAt, report)
		if !ok {
			continue
		}
		pointLabels := n.metricLabels(point.Attributes(), resource, report)
		if point.Flags().NoRecordedValue() {
			n.appendPoint(batch, utm.MetricPoint{Name: name, Labels: pointLabels, TS: timestamp, Value: math.NaN(), Type: utm.TypeHistogram}, report)
			continue
		}
		bounds := point.ExplicitBounds().AsRaw()
		for j := range bounds {
			bounds[j] *= scale
		}
		value := &utm.Histogram{
			Count:  point.Count(),
			Sum:    point.Sum() * scale,
			Bounds: bounds,
			Counts: point.BucketCounts().AsRaw(),
		}
		if err := value.Validate(); err != nil {
			report.normalized("drop")
			report.rejected("invalid_histogram")
			continue
		}
		if len(value.Bounds)+4 > n.options.MaxRecords-len(batch.Points) {
			report.normalized("drop")
			report.rejected("output_limit")
			continue
		}
		base := utm.MetricPoint{
			Name:      name,
			Labels:    pointLabels,
			TS:        timestamp,
			Type:      utm.TypeHistogram,
			Histogram: value,
			Exemplar:  normalizeExemplar(point.Exemplars(), scale, report),
		}
		n.appendHistogram(batch, base, report)
	}
}

func (n *Normalizer) normalizeExponentialHistogramPoints(histogram pmetric.ExponentialHistogram, name string, scale float64, resource *utm.Resource, receivedAt time.Time, batch *MetricBatch, report *Report) {
	if histogram.AggregationTemporality() == pmetric.AggregationTemporalityDelta {
		report.normalized("drop")
		report.rejected("delta_histogram_unsupported")
		return
	}
	points := histogram.DataPoints()
	for i := range points.Len() {
		point := points.At(i)
		timestamp, ok := n.normalizeMetricTimestamp(utm.NanoToMilli(int64(point.Timestamp())), receivedAt, report)
		if !ok {
			continue
		}
		pointLabels := n.metricLabels(point.Attributes(), resource, report)
		if point.Flags().NoRecordedValue() {
			n.appendPoint(batch, utm.MetricPoint{Name: name, Labels: pointLabels, TS: timestamp, Value: math.NaN(), Type: utm.TypeHistogram}, report)
			continue
		}
		bucketCount := point.Positive().BucketCounts().Len() + point.Negative().BucketCounts().Len()
		if bucketCount+5 > n.options.MaxRecords-len(batch.Points) {
			report.normalized("drop")
			report.rejected("output_limit")
			continue
		}
		value := approximateExponentialHistogram(point, scale)
		if err := value.Validate(); err != nil {
			report.normalized("drop")
			report.rejected("invalid_histogram")
			continue
		}
		report.warning("exponential_histogram_approximated")
		base := utm.MetricPoint{
			Name:      name,
			Labels:    pointLabels,
			TS:        timestamp,
			Type:      utm.TypeHistogram,
			Histogram: value,
			Exemplar:  normalizeExemplar(point.Exemplars(), scale, report),
		}
		n.appendHistogram(batch, base, report)
	}
}

func (n *Normalizer) normalizeSummaryPoints(points pmetric.SummaryDataPointSlice, name string, scale float64, resource *utm.Resource, receivedAt time.Time, batch *MetricBatch, report *Report) {
	for i := range points.Len() {
		point := points.At(i)
		timestamp, ok := n.normalizeMetricTimestamp(utm.NanoToMilli(int64(point.Timestamp())), receivedAt, report)
		if !ok {
			continue
		}
		pointLabels := n.metricLabels(point.Attributes(), resource, report)
		if point.Flags().NoRecordedValue() {
			n.appendPoint(batch, utm.MetricPoint{Name: name, Labels: pointLabels, TS: timestamp, Value: math.NaN(), Type: utm.TypeSummary}, report)
			continue
		}
		quantiles := point.QuantileValues()
		for j := range quantiles.Len() {
			quantile := quantiles.At(j)
			builder := labels.NewBuilder(pointLabels)
			builder.Set("quantile", strconv.FormatFloat(quantile.Quantile(), 'g', -1, 64))
			n.appendPoint(batch, utm.MetricPoint{
				Name:   name,
				Labels: builder.Labels(),
				TS:     timestamp,
				Value:  quantile.Value() * scale,
				Type:   utm.TypeSummary,
			}, report)
		}
		n.appendPoint(batch, utm.MetricPoint{Name: name + "_sum", Labels: pointLabels, TS: timestamp, Value: point.Sum() * scale, Type: utm.TypeCounter}, report)
		n.appendPoint(batch, utm.MetricPoint{Name: name + "_count", Labels: pointLabels, TS: timestamp, Value: float64(point.Count()), Type: utm.TypeCounter}, report)
	}
}

func (n *Normalizer) appendPoint(batch *MetricBatch, point utm.MetricPoint, report *Report) bool {
	if len(batch.Points) >= n.options.MaxRecords {
		report.normalized("drop")
		report.rejected("output_limit")
		return false
	}
	batch.Points = append(batch.Points, point)
	return true
}

func (n *Normalizer) appendHistogram(batch *MetricBatch, base utm.MetricPoint, report *Report) {
	n.appendPoint(batch, base, report)
	for _, expanded := range base.Histogram.Expand(base.Name, base.Labels, base.TS) {
		n.appendPoint(batch, expanded, report)
	}
}

func numberDataPointValue(point pmetric.NumberDataPoint) float64 {
	if point.ValueType() == pmetric.NumberDataPointValueTypeInt {
		return float64(point.IntValue())
	}
	return point.DoubleValue()
}

func normalizeExemplar(exemplars pmetric.ExemplarSlice, scale float64, report *Report) *utm.Exemplar {
	if exemplars.Len() == 0 {
		return nil
	}
	if exemplars.Len() > 1 {
		report.warning("extra_exemplars_dropped")
		for range exemplars.Len() - 1 {
			report.normalized("drop")
		}
	}
	input := exemplars.At(0)
	value := input.DoubleValue()
	if input.ValueType() == pmetric.ExemplarValueTypeInt {
		value = float64(input.IntValue())
	}
	attrs, dropped := flattenAttributes(input.FilteredAttributes(), defaultMaxAttrs)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}
	if !input.TraceID().IsEmpty() {
		attrs["trace_id"] = traceIDString(input.TraceID())
	}
	if !input.SpanID().IsEmpty() {
		attrs["span_id"] = spanIDString(input.SpanID())
	}
	return &utm.Exemplar{
		Labels: labels.FromMap(attrs),
		Value:  value * scale,
		TS:     utm.NanoToMilli(int64(input.Timestamp())),
	}
}

func normalizeUnit(name, unit string, report *Report) (string, float64) {
	suffix := ""
	scale := 1.0
	switch unit {
	case "s", "seconds":
		suffix = "_seconds"
	case "ms", "milliseconds":
		suffix = "_seconds"
		scale = 0.001
	case "By", "bytes":
		suffix = "_bytes"
	case "%":
		suffix = "_ratio"
		scale = 0.01
	case "1", "{ratio}":
	}
	return ensureSuffix(name, suffix, report), scale
}

func ensureSuffix(name, suffix string, report *Report) string {
	if suffix == "" || strings.HasSuffix(name, suffix) {
		return name
	}
	report.normalized("rename")
	return name + suffix
}

func deltaSeriesKey(name string, pointLabels utm.Labels) string {
	return name + ":" + strconv.FormatUint(utm.Fingerprint(pointLabels), 16)
}

type exponentialBucket struct {
	bound float64
	count uint64
}

func approximateExponentialHistogram(point pmetric.ExponentialHistogramDataPoint, scale float64) *utm.Histogram {
	base := math.Pow(2, math.Pow(2, -float64(point.Scale())))
	buckets := make([]exponentialBucket, 0, point.Positive().BucketCounts().Len()+point.Negative().BucketCounts().Len()+1)
	positive := point.Positive()
	for i, count := range positive.BucketCounts().AsRaw() {
		index := int(positive.Offset()) + i
		buckets = append(buckets, exponentialBucket{bound: math.Pow(base, float64(index+1)) * scale, count: count})
	}
	negative := point.Negative()
	for i, count := range negative.BucketCounts().AsRaw() {
		index := int(negative.Offset()) + i
		buckets = append(buckets, exponentialBucket{bound: -math.Pow(base, float64(index)) * scale, count: count})
	}
	if point.ZeroCount() > 0 {
		buckets = append(buckets, exponentialBucket{bound: point.ZeroThreshold() * scale, count: point.ZeroCount()})
	}
	slices.SortFunc(buckets, func(a, b exponentialBucket) int {
		return cmp.Compare(a.bound, b.bound)
	})

	merged := buckets[:0]
	for _, bucket := range buckets {
		if len(merged) > 0 && merged[len(merged)-1].bound == bucket.bound {
			merged[len(merged)-1].count += bucket.count
			continue
		}
		merged = append(merged, bucket)
	}
	bounds := make([]float64, 0, len(merged))
	counts := make([]uint64, 0, len(merged)+1)
	var accounted uint64
	for _, bucket := range merged {
		bounds = append(bounds, bucket.bound)
		counts = append(counts, bucket.count)
		accounted += bucket.count
	}
	tail := uint64(0)
	if point.Count() > accounted {
		tail = point.Count() - accounted
	}
	counts = append(counts, tail)
	return &utm.Histogram{
		Count:  point.Count(),
		Sum:    point.Sum() * scale,
		Bounds: bounds,
		Counts: counts,
	}
}
