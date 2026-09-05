package utm

import (
	"fmt"
	"math"
	"strconv"

	"github.com/prometheus/prometheus/model/labels"
)

// MetricType identifies the semantic type of a metric point.
type MetricType uint8

const (
	// TypeUnknown indicates that no metric type is known.
	TypeUnknown MetricType = iota
	// TypeGauge identifies a gauge.
	TypeGauge
	// TypeCounter identifies a counter.
	TypeCounter
	// TypeHistogram identifies a histogram.
	TypeHistogram
	// TypeSummary identifies a summary.
	TypeSummary
)

// String returns the wire name of a metric type.
func (t MetricType) String() string {
	switch t {
	case TypeGauge:
		return "gauge"
	case TypeCounter:
		return "counter"
	case TypeHistogram:
		return "histogram"
	case TypeSummary:
		return "summary"
	default:
		return "unknown"
	}
}

// MetricPoint is a point in a metric time series.
type MetricPoint struct {
	Name      string
	Labels    Labels
	TS        int64
	Value     float64
	Type      MetricType
	Histogram *Histogram
	Exemplar  *Exemplar
}

// Histogram stores explicit upper bounds and per-bucket counts. The final
// count is the bucket above the last finite bound.
type Histogram struct {
	Count  uint64
	Sum    float64
	Bounds []float64
	Counts []uint64
}

// Validate checks that counts and bounds form a valid explicit histogram.
func (h *Histogram) Validate() error {
	if h == nil {
		return fmt.Errorf("nil histogram")
	}
	if len(h.Counts) != len(h.Bounds)+1 {
		return fmt.Errorf("histogram has %d bounds but %d counts", len(h.Bounds), len(h.Counts))
	}
	for i, bound := range h.Bounds {
		if math.IsNaN(bound) || math.IsInf(bound, 1) {
			return fmt.Errorf("histogram bound %d is not finite or -Inf", i)
		}
		if i > 0 && bound <= h.Bounds[i-1] {
			return fmt.Errorf("histogram bounds are not strictly increasing at index %d", i)
		}
	}
	return nil
}

// Expand converts a valid histogram into classic Prometheus bucket, sum, and
// count series. It returns nil for a nil or invalid histogram.
func (h *Histogram) Expand(name string, ls Labels, ts int64) []MetricPoint {
	if h.Validate() != nil {
		return nil
	}

	points := make([]MetricPoint, 0, len(h.Bounds)+3)
	var cumulative uint64
	for i, bound := range h.Bounds {
		cumulative += h.Counts[i]
		points = append(points, MetricPoint{
			Name:   name + "_bucket",
			Labels: withLabel(ls, "le", strconv.FormatFloat(bound, 'g', -1, 64)),
			TS:     ts,
			Value:  float64(cumulative),
			Type:   TypeHistogram,
		})
	}
	points = append(points,
		MetricPoint{
			Name:   name + "_bucket",
			Labels: withLabel(ls, "le", "+Inf"),
			TS:     ts,
			Value:  float64(h.Count),
			Type:   TypeHistogram,
		},
		MetricPoint{
			Name:   name + "_sum",
			Labels: ls,
			TS:     ts,
			Value:  h.Sum,
			Type:   TypeCounter,
		},
		MetricPoint{
			Name:   name + "_count",
			Labels: ls,
			TS:     ts,
			Value:  float64(h.Count),
			Type:   TypeCounter,
		},
	)
	return points
}

// Exemplar associates a metric sample with trace context.
type Exemplar struct {
	Labels Labels
	Value  float64
	TS     int64
}

// MetricMetadata describes a metric family.
type MetricMetadata struct {
	Metric string
	Type   MetricType
	Help   string
	Unit   string
}

func withLabel(base Labels, name, value string) Labels {
	builder := labels.NewBuilder(base)
	builder.Set(name, value)
	return builder.Labels()
}
