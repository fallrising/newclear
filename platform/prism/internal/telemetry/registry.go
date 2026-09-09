package telemetry

import (
	"fmt"
	"maps"
	"slices"

	"github.com/prometheus/client_golang/prometheus"
)

// Registry holds all registered Prism self-telemetry collectors. Metric
// vectors intentionally have no children until a subsystem records a value.
type Registry struct {
	collectors map[string]prometheus.Collector
}

// Register creates and registers every self-telemetry metric defined by the
// SDD. Registration is rolled back if any collector cannot be registered.
func Register(registerer prometheus.Registerer) (*Registry, error) {
	if registerer == nil {
		return nil, fmt.Errorf("telemetry registerer is required")
	}
	if err := validateDefinitions(); err != nil {
		return nil, err
	}

	result := &Registry{collectors: make(map[string]prometheus.Collector, len(metricDefinitions))}
	registered := make([]prometheus.Collector, 0, len(metricDefinitions))
	for _, definition := range metricDefinitions {
		collector, err := newCollector(definition)
		if err != nil {
			return nil, err
		}
		if err := registerer.Register(collector); err != nil {
			for _, previous := range registered {
				registerer.Unregister(previous)
			}
			return nil, fmt.Errorf("register self-telemetry metric %q: %w", definition.Name, err)
		}
		registered = append(registered, collector)
		result.collectors[definition.Name] = collector
	}
	return result, nil
}

// Names returns all registered metric family names in lexical order.
func (r *Registry) Names() []string {
	if r == nil {
		return nil
	}
	return slices.Sorted(maps.Keys(r.collectors))
}

// Collector returns a registered collector by metric family name.
func (r *Registry) Collector(name string) (prometheus.Collector, bool) {
	if r == nil {
		return nil, false
	}
	collector, ok := r.collectors[name]
	return collector, ok
}

// Counter returns a scalar counter by metric family name.
func (r *Registry) Counter(name string) (prometheus.Counter, bool) {
	collector, ok := r.Collector(name)
	if !ok {
		return nil, false
	}
	metric, ok := collector.(prometheus.Counter)
	return metric, ok
}

// CounterVec returns a counter vector by metric family name.
func (r *Registry) CounterVec(name string) (*prometheus.CounterVec, bool) {
	collector, ok := r.Collector(name)
	if !ok {
		return nil, false
	}
	metric, ok := collector.(*prometheus.CounterVec)
	return metric, ok
}

// Gauge returns a scalar gauge by metric family name.
func (r *Registry) Gauge(name string) (prometheus.Gauge, bool) {
	collector, ok := r.Collector(name)
	if !ok {
		return nil, false
	}
	metric, ok := collector.(prometheus.Gauge)
	return metric, ok
}

// GaugeVec returns a gauge vector by metric family name.
func (r *Registry) GaugeVec(name string) (*prometheus.GaugeVec, bool) {
	collector, ok := r.Collector(name)
	if !ok {
		return nil, false
	}
	metric, ok := collector.(*prometheus.GaugeVec)
	return metric, ok
}

// Histogram returns a scalar histogram by metric family name.
func (r *Registry) Histogram(name string) (prometheus.Histogram, bool) {
	collector, ok := r.Collector(name)
	if !ok {
		return nil, false
	}
	metric, ok := collector.(prometheus.Histogram)
	return metric, ok
}

// HistogramVec returns a histogram vector by metric family name.
func (r *Registry) HistogramVec(name string) (*prometheus.HistogramVec, bool) {
	collector, ok := r.Collector(name)
	if !ok {
		return nil, false
	}
	metric, ok := collector.(*prometheus.HistogramVec)
	return metric, ok
}

func newCollector(definition metricDefinition) (prometheus.Collector, error) {
	switch definition.Type {
	case MetricTypeCounter:
		options := prometheus.CounterOpts{Name: definition.Name, Help: definition.Help}
		if len(definition.Labels) == 0 {
			return prometheus.NewCounter(options), nil
		}
		return prometheus.NewCounterVec(options, definition.Labels), nil
	case MetricTypeGauge:
		options := prometheus.GaugeOpts{Name: definition.Name, Help: definition.Help}
		if len(definition.Labels) == 0 {
			return prometheus.NewGauge(options), nil
		}
		return prometheus.NewGaugeVec(options, definition.Labels), nil
	case MetricTypeHistogram:
		options := prometheus.HistogramOpts{Name: definition.Name, Help: definition.Help, Buckets: buckets(definition.buckets)}
		if len(definition.Labels) == 0 {
			return prometheus.NewHistogram(options), nil
		}
		return prometheus.NewHistogramVec(options, definition.Labels), nil
	default:
		return nil, fmt.Errorf("self-telemetry metric %q has invalid type %q", definition.Name, definition.Type)
	}
}

func buckets(profile bucketProfile) []float64 {
	switch profile {
	case durationBuckets:
		return prometheus.DefBuckets
	case countBuckets:
		return prometheus.ExponentialBuckets(1, 2, 15)
	case byteBuckets:
		return prometheus.ExponentialBuckets(1024, 4, 10)
	default:
		return nil
	}
}

func validateDefinitions() error {
	seen := make(map[string]struct{}, len(metricDefinitions))
	for _, definition := range metricDefinitions {
		if definition.Name == "" {
			return fmt.Errorf("self-telemetry metric name is required")
		}
		if definition.Help == "" {
			return fmt.Errorf("self-telemetry metric %q has no help text", definition.Name)
		}
		if _, duplicate := seen[definition.Name]; duplicate {
			return fmt.Errorf("duplicate self-telemetry metric %q", definition.Name)
		}
		seen[definition.Name] = struct{}{}
		if definition.Type != MetricTypeCounter && definition.Type != MetricTypeGauge && definition.Type != MetricTypeHistogram {
			return fmt.Errorf("self-telemetry metric %q has invalid type %q", definition.Name, definition.Type)
		}
		labels := make(map[string]struct{}, len(definition.Labels))
		for _, label := range definition.Labels {
			if label == "" {
				return fmt.Errorf("self-telemetry metric %q has an empty label name", definition.Name)
			}
			if _, duplicate := labels[label]; duplicate {
				return fmt.Errorf("self-telemetry metric %q repeats label %q", definition.Name, label)
			}
			labels[label] = struct{}{}
		}
	}
	return nil
}
