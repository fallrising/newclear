//go:build integration

package clickhouse_test

import (
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/spi/conformance"
)

func TestClickHouseConformance(t *testing.T) {
	conformance.Run(t, func(t *testing.T) (spi.Backend, func()) {
		t.Helper()
		f := newFixture(t)
		backend := f.migrated(map[string]string{
			"async_insert":           "0",
			"retention_metrics_days": "36500",
			"retention_logs_days":    "36500",
			"retention_traces_days":  "36500",
			"retention_red_days":     "36500",
		})
		return backend, nil // fixture and backend cleanups are registered with t.
	}, conformance.Options{})
}
