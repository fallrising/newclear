//go:build integration

package clickhouse

import (
	"context"
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestClickHouseCoreLabelsString(t *testing.T) {
	opts := testCoreLocalClickHouseOptions(t)
	conn, err := clickhouse.Open(opts)
	if err != nil {
		t.Fatal("cannot open test ClickHouse")
	}
	defer func() { _ = conn.Close() }()
	db := fmt.Sprintf("prism_test_t801_labels_%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if err := conn.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		t.Fatal("cannot create isolated test database:", err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if err := conn.Exec(cleanupCtx, "DROP DATABASE "+db+" SYNC"); err != nil {
			t.Error("cannot drop isolated test database:", err)
		}
	}()
	bound := *opts
	bound.Auth.Database = db
	dbConn, err := clickhouse.Open(&bound)
	if err != nil {
		t.Fatal("cannot open isolated test database")
	}
	defer func() { _ = dbConn.Close() }()
	if err := dbConn.Exec(ctx, "CREATE TABLE metric_series (fingerprint UInt64, labels Map(LowCardinality(String), String)) ENGINE = MergeTree ORDER BY fingerprint"); err != nil {
		t.Fatal("cannot create test metric series:", err)
	}
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range splitStatements(ms[7].source) {
		if err := dbConn.Exec(ctx, statement); err != nil {
			t.Fatal("cannot apply labels migration:", err)
		}
	}
	labels := map[string]string{"z": "last", "a": "quoted'\\value", "empty": "", "__tenant__": "audit", "__name__": "audit_metric"}
	if err := dbConn.Exec(ctx, "INSERT INTO metric_series (fingerprint, labels) VALUES (?, ?)", uint64(1), labels); err != nil {
		t.Fatal("cannot insert labels fixture:", err)
	}
	var actual string
	if err := dbConn.QueryRow(ctx, "SELECT labels_str FROM metric_series WHERE fingerprint = 1").Scan(&actual); err != nil {
		t.Fatal("cannot read labels_str:", err)
	}
	want := "__name__\x00audit_metric\x01__tenant__\x00audit\x01a\x00quoted'\\value\x01empty\x00\x01z\x00last"
	if actual != want {
		t.Fatalf("canonical labels bytes=%q, want %q", actual, want)
	}
}

func TestClickHouseCoreTTLPreflight(t *testing.T) {
	opts := testCoreLocalClickHouseOptions(t)
	conn, err := clickhouse.Open(opts)
	if err != nil {
		t.Fatal("cannot open test ClickHouse")
	}
	defer func() { _ = conn.Close() }()
	db := fmt.Sprintf("prism_test_t801_ttl_%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if err := conn.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		t.Fatal("cannot create isolated test database:", err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if err := conn.Exec(cleanupCtx, "DROP DATABASE "+db+" SYNC"); err != nil {
			t.Error("cannot drop isolated test database:", err)
		}
	}()
	bound := *opts
	bound.Auth.Database = db
	dbConn, err := clickhouse.Open(&bound)
	if err != nil {
		t.Fatal("cannot open isolated test database")
	}
	b := newBackend(dbConn, options{metricDays: 30, logDays: 14, traceDays: 7, redDays: 90, maxOpen: 1, timeout: 30 * time.Second})
	defer func() { _ = b.Close() }()
	if err := b.Migrate(ctx); err != nil {
		t.Fatal("cannot migrate isolated test database:", err)
	}
	if err := dbConn.Exec(ctx, "ALTER TABLE service_ops REMOVE TTL"); err != nil {
		t.Fatal("cannot remove test TTL:", err)
	}
	late := time.Unix(1<<32-1, 0).UTC()
	if err := dbConn.Exec(ctx, "INSERT INTO service_ops (day, tenant, service, name, kind, cnt) VALUES (?, ?, ?, ?, ?, ?)", late, "test", "test", "test", "server", uint64(1)); err != nil {
		t.Fatal("cannot insert unsafe TTL source:", err)
	}
	var count uint64
	if err := dbConn.QueryRow(ctx, "SELECT count() FROM service_ops").Scan(&count); err != nil || count != 1 {
		t.Fatalf("unsafe fixture was not persisted: count=%d, err=%v", count, err)
	}
	b.opts.redDays = 91
	if err := b.Migrate(ctx); spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("unsafe retained row class=%s, want BadRequest; err=%v", spi.Classify(err), err)
	}
	if err := dbConn.Exec(ctx, "TRUNCATE TABLE service_ops"); err != nil {
		t.Fatal("cannot clear aggregate TTL source:", err)
	}
	if err := dbConn.Exec(ctx, "ALTER TABLE metric_samples REMOVE TTL"); err != nil {
		t.Fatal("cannot remove sample TTL for test:", err)
	}
	if err := dbConn.Exec(ctx, "INSERT INTO metric_samples (ts, fingerprint, tenant, metric, value) VALUES (?, ?, ?, ?, ?)", late, uint64(1), "test", "test", 1.5); err != nil {
		t.Fatal("cannot insert unsafe DateTime64 TTL source:", err)
	}
	b.opts.metricDays = 31
	if err := b.Migrate(ctx); spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("unsafe DateTime64 row class=%s, want BadRequest; err=%v", spi.Classify(err), err)
	}
}

func TestClickHouseCoreBoundedNativeBatch(t *testing.T) {
	opts := testCoreLocalClickHouseOptions(t)
	admin, err := clickhouse.Open(opts)
	if err != nil {
		t.Fatal("cannot open test ClickHouse")
	}
	defer func() { _ = admin.Close() }()
	db := fmt.Sprintf("prism_test_t801_batch_%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if err := admin.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		t.Fatal("cannot create isolated test database:", err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if err := admin.Exec(cleanupCtx, "DROP DATABASE "+db+" SYNC"); err != nil {
			t.Error("cannot drop isolated test database:", err)
		}
	}()
	bound := *opts
	bound.Auth.Database = db
	native, err := clickhouse.Open(&bound)
	if err != nil {
		t.Fatal("cannot open isolated test database")
	}
	adapter := boundedNativeConnection{connection: native, maxExec: 7}
	defer func() { _ = adapter.Close() }()
	if err := adapter.Exec(ctx, "CREATE TABLE metric_samples (ts DateTime64(3), fingerprint UInt64, tenant String, metric String, value Float64) ENGINE = MergeTree ORDER BY fingerprint"); err != nil {
		t.Fatal("cannot create native batch table:", err)
	}
	batch, err := adapter.PrepareBatch(ctx, "INSERT INTO metric_samples (ts,fingerprint,tenant,metric,value)")
	if err != nil {
		t.Fatal("cannot prepare bounded native batch:", err)
	}
	defer func() { _ = batch.Close() }()
	if err := batch.Append(time.Unix(10, 0).UTC(), uint64(1), "tenant", "metric", 1.5); err != nil {
		t.Fatal("cannot append bounded native batch:", err)
	}
	if err := batch.Send(); err != nil {
		t.Fatal("cannot send bounded native batch:", err)
	}
	var value float64
	if err := native.QueryRow(ctx, "SELECT value FROM metric_samples WHERE fingerprint = 1").Scan(&value); err != nil || value != 1.5 {
		t.Fatalf("native batch readback value=%v, err=%v", value, err)
	}
}

func testCoreLocalClickHouseOptions(t *testing.T) *clickhouse.Options {
	t.Helper()
	dsn := os.Getenv("PRISM_CLICKHOUSE_TEST_DSN")
	if dsn == "" {
		t.Fatal("PRISM_CLICKHOUSE_TEST_DSN is required for integration tests")
	}
	opts, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		t.Fatal("invalid test DSN")
	}
	if opts.Protocol != clickhouse.Native {
		t.Fatal("test ClickHouse must use native protocol")
	}
	if len(opts.Addr) != 1 {
		t.Fatal("test ClickHouse must have exactly one native loopback address")
	}
	host, _, err := net.SplitHostPort(opts.Addr[0])
	if err != nil {
		t.Fatal("invalid native test address")
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		t.Fatal("test ClickHouse must use native loopback")
	}
	return opts
}
