package clickhouse

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

type traceFindRows struct{ chdriver.Rows }

func (*traceFindRows) Next() bool   { return false }
func (*traceFindRows) Err() error   { return nil }
func (*traceFindRows) Close() error { return nil }

type traceFindConn struct {
	connection
	query string
	args  []any
}

func (c *traceFindConn) Query(_ context.Context, query string, args ...any) (chdriver.Rows, error) {
	c.query, c.args = query, args
	return &traceFindRows{}, nil
}
func (*traceFindConn) Close() error { return nil }

func TestFindTraceIDsEmptyServiceAndRequestedLimit(t *testing.T) {
	for _, limit := range []int{0, -3, 2} {
		t.Run(strconv.Itoa(limit), func(t *testing.T) {
			conn := &traceFindConn{}
			b := newBackend(conn, options{maxOpen: 1, timeout: time.Second})
			defer func() { _ = b.Close() }()
			got, err := b.Traces().FindTraceIDs(t.Context(), spi.TraceQuery{Tenant: "tenant", Service: "", Start: 0, End: 10, Limit: limit})
			if err != nil || len(got) != 0 {
				t.Fatalf("empty-service query limit=%d result=%v err=%v", limit, got, err)
			}
			if !strings.Contains(conn.query, "service = ?") || len(conn.args) < 2 || conn.args[1] != "" {
				t.Fatalf("empty service was not an exact filter: sql=%q args=%v", conn.query, conn.args)
			}
			if strings.Contains(conn.query, " LIMIT ?") != (limit > 0) {
				t.Fatalf("requested limit=%d SQL=%q", limit, conn.query)
			}
			if limit > 0 && conn.args[len(conn.args)-1] != limit {
				t.Fatalf("positive limit omitted from arguments: %v", conn.args)
			}
		})
	}
}
