//go:build integration

package promqltest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	_ "github.com/fallrising/newclear/platform/prism/drivers/clickhouse"
	"github.com/fallrising/newclear/platform/prism/internal/query/promqladapter"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func init() { openClickHouseFixture = newClickHouseFixture }

func newClickHouseFixture(t *testing.T) *fixtureStorage {
	t.Helper()
	dsn := os.Getenv("PRISM_CLICKHOUSE_TEST_DSN")
	if dsn == "" {
		t.Fatal("PRISM_CLICKHOUSE_TEST_DSN is required for clickhouse corpus")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || parsed.Scheme != "clickhouse" || parsed.Host == "" || parsed.Path == "" {
		t.Fatal("fixture DSN must be a ClickHouse URL")
	}
	host, _, err := net.SplitHostPort(parsed.Host)
	if err != nil || host != "localhost" && (net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback()) {
		t.Fatal("fixture DSN must be native loopback")
	}
	options, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		t.Fatal("invalid fixture DSN")
	}
	admin, err := clickhouse.Open(options)
	if err != nil {
		t.Fatal("open fixture admin failed")
	}
	var random [12]byte
	if _, err := rand.Read(random[:]); err != nil {
		_ = admin.Close()
		t.Fatal(err)
	}
	db := "prism_corpus_" + hex.EncodeToString(random[:])
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	if err := admin.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		_ = admin.Close()
		t.Fatal("create isolated corpus database failed")
	}
	var once sync.Once
	var cleanupErr error
	cleanup := func() error {
		once.Do(func() {
			cleanupCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
			defer stop()
			cleanupErr = errors.Join(admin.Exec(cleanupCtx, "DROP DATABASE IF EXISTS "+db+" SYNC"), admin.Close())
		})
		return cleanupErr
	}
	t.Cleanup(func() {
		if err := cleanup(); err != nil {
			t.Errorf("clean up isolated corpus database: %v", err)
		}
	})
	parsed.Path = "/" + db
	backend, err := spi.Open(t.Context(), "clickhouse", spi.Config{
		DSN: parsed.String(),
		Options: map[string]string{
			"async_insert":           "0",
			"retention_metrics_days": "36500",
			"retention_logs_days":    "36500",
			"retention_traces_days":  "36500",
			"retention_red_days":     "36500",
		},
	})
	if err != nil {
		t.Fatal(fmt.Errorf("open corpus backend: %w", err))
	}
	if err := backend.Migrate(t.Context()); err != nil {
		_ = backend.Close()
		t.Fatal(fmt.Errorf("migrate corpus backend: %w", err))
	}
	fixture := &fixtureStorage{backend: backend, cleanup: cleanup}
	fixture.queryable = promqladapter.New(&countingStore{MetricStore: backend.Metrics(), fixture: fixture}, corpusTenant, promqladapter.Limits{})
	return fixture
}
