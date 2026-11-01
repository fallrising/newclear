package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"strings"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// queryBudget bounds decoded logical payload as well as the server's read and
// result limits. It deliberately makes no claim about Go allocator/RSS use.
type queryBudget struct {
	rows, bytes       int
	maxRows, maxBytes int
}

func (b *queryBudget) add(size int) error {
	if b.rows >= b.maxRows || size < 0 || size > b.maxBytes-b.bytes {
		return spi.Wrap(spi.ErrTooLarge, driverName, "query", errors.New("query result exceeds limit"))
	}
	b.rows++
	b.bytes += size
	return nil
}

func (b *backend) read(ctx context.Context, op, sql string, args []any, scan func(chdriver.Rows, *queryBudget) error) error {
	return b.run(ctx, op, func(ctx context.Context) (result error) {
		rows, err := b.conn.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer func() { result = errors.Join(result, rows.Close()) }()
		budget := &queryBudget{maxRows: b.opts.maxRowsRead, maxBytes: b.opts.maxResultBytes}
		if budget.maxRows == 0 {
			budget.maxRows = 5_000_000
		}
		if b.opts.maxResultRows > 0 {
			budget.maxRows = min(budget.maxRows, b.opts.maxResultRows)
		}
		if budget.maxBytes == 0 {
			budget.maxBytes = 64 << 20
		}
		if err := scan(rows, budget); err != nil {
			return err
		}
		return rows.Err()
	})
}

func queryBackend(ctx context.Context, host writeHost, op string) (*backend, error) {
	if err := ctx.Err(); err != nil {
		return nil, classifiedError(op, err)
	}
	b, ok := host.(*backend)
	if !ok {
		return nil, unsupported(ctx, host, op)
	}
	b.mu.Lock()
	closed := b.closed
	b.mu.Unlock()
	if closed {
		return nil, closedError(op)
	}
	return b, nil
}

func validateMatchers(matchers []spi.Matcher, tenant, op string) error {
	if tenant == "" {
		return inputError(op, "tenant is required")
	}
	for _, m := range matchers {
		if m.Name == "" || m.Type > spi.MatchNotRegexp || m.Type >= spi.MatchRegexp && m.Compiled == nil {
			return inputError(op, "invalid matcher")
		}
		if m.Name == utm.LabelTenant && !m.Matches(tenant) {
			return inputError(op, "contradictory tenant matcher")
		}
	}
	return nil
}

func matchesMap(values map[string]string, matchers []spi.Matcher) bool {
	for _, m := range matchers {
		if !m.Matches(values[m.Name]) {
			return false
		}
	}
	return true
}

func mapSize(values map[string]string) int {
	size := 0
	for k, v := range values {
		size += len(k) + len(v)
	}
	return size
}

// The written tables use UInt32-backed DateTime64. Intersect reads with that
// representable interval so negative offsets and @ queries return empty data.
func metricRange(start, end int64) (int64, int64, bool) {
	const upper = maxTimestampSeconds*1000 - 1
	if end < 0 || start > upper || start > end {
		return 0, 0, false
	}
	return max(start, 0), min(end, upper), true
}

func nanoRange(start, end int64) (int64, int64, bool) {
	// Writer TTL and native DateTime64 storage use the UInt32 second range.
	const upper = maxTimestampSeconds * 1_000_000_000
	if end <= 0 || start >= end || start >= upper {
		return 0, 0, false
	}
	return max(start, 0), min(end, upper), true
}

func querySettings(opts options) string {
	rows, bytes, exec, memory := opts.maxRowsRead, opts.maxResultBytes, opts.maxExec, opts.maxMem
	resultRows := opts.maxResultRows
	if rows <= 0 {
		rows = 5_000_000
	}
	if bytes <= 0 {
		bytes = 64 << 20
	}
	if exec <= 0 {
		exec = 55
	}
	if resultRows <= 0 {
		resultRows = 5_000_000
	}
	if memory <= 0 {
		memory = 1_000_000_000
	}
	return fmt.Sprintf(" SETTINGS max_execution_time = %d, max_memory_usage = %d, max_rows_to_read = %d, max_result_rows = %d, max_result_bytes = %d, read_overflow_mode = 'throw', result_overflow_mode = 'throw'", exec, memory, rows, resultRows, bytes)
}

func safeMap(values map[string]string) bool {
	if len(values) > maxFields {
		return false
	}
	for k, v := range values {
		if len(k) > 64<<10 || len(v) > 16<<20 {
			return false
		}
	}
	return true
}

func validateLabelName(name, op string) error {
	if strings.TrimSpace(name) == "" {
		return inputError(op, "label name is required")
	}
	return nil
}
