package spi

import (
	"context"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// MetricStore provides the mandatory metric storage primitives.
type MetricStore interface {
	Write(ctx context.Context, batch []utm.MetricPoint) error
	Select(ctx context.Context, q SeriesQuery) (SeriesSet, error)
	LabelNames(ctx context.Context, q LabelQuery) ([]string, error)
	LabelValues(ctx context.Context, name string, q LabelQuery) ([]string, error)
}

// NativeMetricQuerier optionally evaluates complete PromQL expressions.
type NativeMetricQuerier interface {
	QueryInstant(ctx context.Context, tenant, expr string, ts time.Time, timeout time.Duration) (*PromResult, error)
	QueryRange(ctx context.Context, tenant, expr string, start, end time.Time, step time.Duration, timeout time.Duration) (*PromResult, error)
}

// SeriesDeleter optionally deletes metric series in an inclusive millisecond
// range.
type SeriesDeleter interface {
	DeleteSeries(ctx context.Context, tenant string, matchers []Matcher, tr TimeRange) error
}

// ExemplarQuerier optionally reads exemplars in an inclusive millisecond range.
type ExemplarQuerier interface {
	QueryExemplars(ctx context.Context, tenant string, matchers [][]Matcher, tr TimeRange) ([]ExemplarSet, error)
}

// MetadataStore optionally persists and reads metric metadata.
type MetadataStore interface {
	UpsertMetadata(ctx context.Context, tenant string, md []utm.MetricMetadata) error
	Metadata(ctx context.Context, tenant, metric string, limit int) ([]utm.MetricMetadata, error)
}
