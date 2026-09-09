package spi

import (
	"context"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// LogStore provides the mandatory log storage primitives. Log time ranges use
// Unix nanoseconds and are half-open.
type LogStore interface {
	Write(ctx context.Context, batch []utm.LogRecord) error
	Search(ctx context.Context, q LogQuery) (LogIterator, error)
	LabelNames(ctx context.Context, q LabelQuery) ([]string, error)
	LabelValues(ctx context.Context, name string, q LabelQuery) ([]string, error)
}

// NativeLogQuerier optionally evaluates a complete LogQuery.
type NativeLogQuerier interface {
	SearchNative(ctx context.Context, q LogQuery) (LogResult, error)
}

// LogTailer optionally provides live log streaming.
type LogTailer interface {
	Tail(ctx context.Context, q LogQuery) (LogStream, error)
}

// LogStatser optionally reports log query scan statistics.
type LogStatser interface {
	Stats(ctx context.Context, q LogQuery) (LogStats, error)
}
