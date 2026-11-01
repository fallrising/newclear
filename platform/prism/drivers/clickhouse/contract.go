package clickhouse

import (
	"context"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// connection is the subset of the native client needed by this milestone.
type connection interface {
	PrepareBatch(context.Context, string, ...chdriver.PrepareBatchOption) (chdriver.Batch, error)
	Exec(context.Context, string, ...any) error
	Query(context.Context, string, ...any) (chdriver.Rows, error)
	Ping(context.Context) error
	Close() error
}

type writeHost interface {
	run(context.Context, string, func(context.Context) error) error
	connection() connection
	retentionDays(spi.Signal) int
}

// retentionSafe guards DateTime TTL arithmetic; raw timestamp validation is separate.
func retentionSafe(t time.Time, days int) bool {
	return days > 0 && t.UTC().AddDate(0, 0, days).Unix() < 1<<32
}

const (
	maxBatchRecords = 10_000
	maxBatchBytes   = 16 << 20
	maxFields       = 128
	maxNested       = 256
	maxCacheEntries = 100_000
	maxCacheBytes   = 32 << 20
)
