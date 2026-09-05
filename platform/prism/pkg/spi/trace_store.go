package spi

import (
	"context"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// TraceStore provides the mandatory trace storage primitives. Trace time
// ranges use Unix nanoseconds.
type TraceStore interface {
	Write(ctx context.Context, batch []utm.Span) error
	GetTrace(ctx context.Context, tenant, traceID string) (SpanIterator, error)
	FindTraceIDs(ctx context.Context, q TraceQuery) ([]TraceIDWithTime, error)
	Services(ctx context.Context, tenant string, tr TimeRange) ([]string, error)
	Operations(ctx context.Context, tenant, service, spanKind string, tr TimeRange) ([]Operation, error)
}

// DependencyQuerier optionally returns service dependency aggregates.
type DependencyQuerier interface {
	Dependencies(ctx context.Context, tenant string, tr TimeRange) ([]Dependency, error)
}

// SpanAggregator optionally returns pre-aggregated RED telemetry.
type SpanAggregator interface {
	ServiceRED(ctx context.Context, q REDQuery) ([]REDPoint, error)
}
