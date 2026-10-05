package clickhouse

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestEmbeddedMigrationsAndRendering(t *testing.T) {
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 8 {
		t.Fatalf("count=%d", len(ms))
	}
	for _, m := range ms {
		sql, err := renderMigration(m.source, options{metricDays: 30, logDays: 14, traceDays: 7, redDays: 90})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(sql, "{{") {
			t.Fatalf("unrendered %s", m.name)
		}
		if len(splitStatements(sql)) == 0 {
			t.Fatalf("empty %s", m.name)
		}
	}
	if !strings.Contains(ms[2].source, "DateTime64(3)") {
		t.Fatal("series millisecond precision missing")
	}
	if strings.Contains(ms[2].source, "TTL toDateTime(first_seen)") {
		t.Fatal("series retention must not expire metadata")
	}
	if !strings.Contains(ms[3].source, "SimpleAggregateFunction(groupUniqArrayArray, Array(String))") {
		t.Fatal("trace services aggregate has incompatible LowCardinality element")
	}
}

func TestLabelsStringMigrationUsesCanonicalMaterializedExpression(t *testing.T) {
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	statements := splitStatements(ms[7].source)
	if len(statements) != 1 {
		t.Fatalf("labels migration statements=%d, want 1", len(statements))
	}
	want := `ALTER TABLE metric_series ADD COLUMN IF NOT EXISTS labels_str String MATERIALIZED
    arrayStringConcat(arraySort(arrayMap((k, v) -> concat(k, '\x00', v),
        mapKeys(labels), mapValues(labels))), '\x01')`
	if statements[0] != want {
		t.Fatalf("labels migration does not use the SDD17 canonical materialized expression:\n%s", statements[0])
	}
}

func TestAllTTLTemplatesUseUTCDateTime(t *testing.T) {
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []struct {
		version int
		clause  string
	}{
		{1, "TTL toDateTime(ts, 'UTC') + INTERVAL {{ .LogRetentionDays }} DAY"},
		{2, "TTL toDateTime(ts, 'UTC') + INTERVAL {{ .TraceRetentionDays }} DAY"},
		{3, "TTL toDateTime(ts, 'UTC') + INTERVAL {{ .MetricRetentionDays }} DAY"},
		{4, "TTL toDateTime(start_ts, 'UTC') + INTERVAL {{ .TraceRetentionDays }} DAY"},
		{5, "TTL toDateTime(minute, 'UTC') + INTERVAL {{ .REDRetentionDays }} DAY"},
		{6, "TTL toDateTime(hour, 'UTC') + INTERVAL {{ .REDRetentionDays }} DAY"},
		{6, "TTL toDateTime(ts, 'UTC') + INTERVAL 1 DAY"},
		{7, "TTL toDateTime(day, 'UTC') + INTERVAL {{ .REDRetentionDays }} DAY"},
	} {
		if !strings.Contains(ms[want.version-1].source, want.clause) {
			t.Errorf("migration %03d lacks %q", want.version, want.clause)
		}
	}
}

type fakeMigrationConn struct {
	connection
	queries    []string
	rows       []migrationRow
	maxByTable map[string]time.Time
	ttlRows    *fakeTTLRows
	queryErr   error
	execFail   string
}
type migrationRow struct {
	version        uint32
	name, checksum string
}
type fakeMigrationRows struct {
	chdriver.Rows
	rows []migrationRow
	at   int
}

func (r *fakeMigrationRows) Next() bool {
	if r.at < len(r.rows) {
		r.at++
		return true
	}
	return false
}
func (r *fakeMigrationRows) Scan(dest ...any) error {
	row := r.rows[r.at-1]
	*dest[0].(*uint32) = row.version
	*dest[1].(*string) = row.name
	*dest[2].(*string) = row.checksum
	return nil
}
func (*fakeMigrationRows) Close() error { return nil }
func (*fakeMigrationRows) Err() error   { return nil }

type fakeTTLRows struct {
	chdriver.Rows
	count     uint64
	max       time.Time
	next      bool
	scanErr   error
	rowsErr   error
	closeErr  error
	closeCall int
}

func (r *fakeTTLRows) Next() bool {
	if r.next {
		return false
	}
	r.next = true
	return true
}
func (r *fakeTTLRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	*dest[0].(*uint64) = r.count
	*dest[1].(*time.Time) = r.max
	return nil
}
func (r *fakeTTLRows) Close() error { r.closeCall++; return r.closeErr }
func (r *fakeTTLRows) Err() error   { return r.rowsErr }
func (f *fakeMigrationConn) Query(ctx context.Context, sql string, _ ...any) (chdriver.Rows, error) {
	f.queries = append(f.queries, sql)
	if strings.HasPrefix(sql, "SELECT count(), max(") {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if f.queryErr != nil {
			return nil, f.queryErr
		}
		if f.ttlRows != nil {
			return f.ttlRows, nil
		}
		for table, maxTS := range f.maxByTable {
			if strings.Contains(sql, " FROM "+table+" ") {
				return &fakeTTLRows{count: 1, max: maxTS}, nil
			}
		}
		return &fakeTTLRows{}, nil
	}
	return &fakeMigrationRows{rows: f.rows}, nil
}
func (f *fakeMigrationConn) Exec(_ context.Context, sql string, _ ...any) error {
	f.queries = append(f.queries, sql)
	if strings.Contains(sql, f.execFail) && f.execFail != "" {
		return errors.New("secret server text")
	}
	return nil
}

func TestMigrationReceiptsAndTTL(t *testing.T) {
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	conn := &fakeMigrationConn{}
	b := &backend{conn: conn, opts: options{metricDays: 30, logDays: 14, traceDays: 7, redDays: 90}}
	if err := b.migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	var receipts int
	var historyBounded bool
	for _, q := range conn.queries {
		if strings.HasPrefix(q, "INSERT INTO prism_schema_migrations") {
			receipts++
			if !strings.Contains(q, "SETTINGS max_execution_time = 55 VALUES") {
				t.Fatalf("receipt lacks server time cap: %s", q)
			}
		}
		if strings.HasPrefix(q, "SELECT version, name, checksum FROM prism_schema_migrations") {
			historyBounded = strings.Contains(q, "LIMIT 9 SETTINGS max_execution_time = 55, max_result_rows = 9")
		}
	}
	if !historyBounded {
		t.Fatal("migration history query lacks server time/row cap")
	}
	if receipts != 8 {
		t.Fatalf("receipts=%d", receipts)
	}
	conn.queries = nil
	for _, m := range ms {
		conn.rows = append(conn.rows, migrationRow{m.version, m.name, m.checksum})
	}
	b.opts.logDays = 21
	if err := b.migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	for _, q := range conn.queries {
		if strings.HasPrefix(q, "INSERT INTO prism_schema_migrations") {
			t.Fatal("repeat emitted receipt")
		}
	}
	found := false
	for _, q := range conn.queries {
		if strings.Contains(q, "ALTER TABLE logs MODIFY TTL") && strings.Contains(q, "21 DAY") {
			found = true
		}
	}
	if !found {
		t.Fatal("changed TTL not reconciled")
	}
	conn.rows[0].checksum = "wrong"
	if err := b.migrate(t.Context()); !errors.Is(err, errDrift) {
		t.Fatalf("checksum drift: %v", err)
	}
	conn.rows[0].checksum = ms[0].checksum
	conn.rows = append(conn.rows, migrationRow{9, "future", "checksum"})
	if err := b.migrate(t.Context()); !errors.Is(err, errDrift) {
		t.Fatalf("future version: %v", err)
	}
}

func TestMigrationStopsBeforeReceiptAfterDDLFailure(t *testing.T) {
	conn := &fakeMigrationConn{execFail: "CREATE TABLE IF NOT EXISTS logs"}
	b := &backend{conn: conn, opts: options{metricDays: 30, logDays: 14, traceDays: 7, redDays: 90}}
	if err := b.migrate(t.Context()); err == nil {
		t.Fatal("DDL failure ignored")
	}
	for _, q := range conn.queries {
		if strings.HasPrefix(q, "INSERT INTO prism_schema_migrations") {
			t.Fatal("receipt after failed DDL")
		}
	}
}

func TestTTLPreflightChecksAllEightTablesBeforeAnyAlter(t *testing.T) {
	conn := &fakeMigrationConn{maxByTable: map[string]time.Time{"service_ops": time.Unix(1<<32-1, 0).UTC()}}
	b := &backend{conn: conn, opts: options{metricDays: 30, logDays: 14, traceDays: 7, redDays: 90}}
	if err := b.migrate(t.Context()); err == nil {
		t.Fatal("unsafe existing service_ops day accepted")
	}
	var probes []string
	var alters []string
	for _, sql := range conn.queries {
		if strings.HasPrefix(sql, "SELECT count(), max(") {
			probes = append(probes, sql)
			if !strings.Contains(sql, "SETTINGS max_execution_time = 55, max_result_rows = 1") {
				t.Fatalf("unbounded TTL probe: %s", sql)
			}
		}
		if strings.Contains(sql, " MODIFY TTL ") {
			alters = append(alters, sql)
		}
	}
	want := []string{
		"SELECT count(), max(ts) FROM logs LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
		"SELECT count(), max(ts) FROM spans LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
		"SELECT count(), max(ts) FROM metric_samples LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
		"SELECT count(), max(start_ts) FROM trace_index LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
		"SELECT count(), max(minute) FROM service_red_1m LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
		"SELECT count(), max(hour) FROM service_deps_1h LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
		"SELECT count(), max(day) FROM service_ops LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
		"SELECT count(), max(ts) FROM pending_links LIMIT 1 SETTINGS max_execution_time = 55, max_result_rows = 1",
	}
	if !slices.Equal(probes, want) {
		t.Fatalf("TTL preflight probes=%q, want %q", probes, want)
	}
	if len(alters) != 0 {
		t.Fatalf("TTL changed before full preflight: %q", alters)
	}
}

func TestRetentionSafeBoundary(t *testing.T) {
	cutoff := time.Unix(1<<32, 0).UTC().AddDate(0, 0, -14)
	if !retentionSafe(cutoff.Add(-time.Second), 14) {
		t.Fatal("last safe second rejected")
	}
	if retentionSafe(cutoff, 14) || retentionSafe(cutoff.Add(time.Second), 14) {
		t.Fatal("overflowing TTL second accepted")
	}
	if retentionSafe(time.Unix(0, 0), 0) {
		t.Fatal("zero retention accepted")
	}
	longCutoff := time.Unix(1<<32, 0).UTC().AddDate(0, 0, -36500)
	if !retentionSafe(longCutoff.Add(-time.Second), 36500) || retentionSafe(longCutoff, 36500) {
		t.Fatal("long retention boundary is incorrect")
	}
}

func TestTTLPreflightRejectsUnsafeMaximumFromEachSource(t *testing.T) {
	for _, table := range []string{"logs", "spans", "metric_samples", "trace_index", "service_red_1m", "service_deps_1h", "service_ops", "pending_links"} {
		t.Run(table, func(t *testing.T) {
			conn := &fakeMigrationConn{maxByTable: map[string]time.Time{table: time.Unix(1<<32-1, 0).UTC()}}
			b := &backend{conn: conn, opts: options{metricDays: 30, logDays: 14, traceDays: 7, redDays: 90}}
			if err := b.preflightTTL(t.Context()); spi.Classify(err) != spi.ErrBadRequest {
				t.Fatalf("unsafe %s maximum class=%s, want BadRequest", table, spi.Classify(err))
			}
			if len(conn.queries) != 8 {
				t.Fatalf("checked %d tables, want 8", len(conn.queries))
			}
		})
	}
}

func TestTTLPreflightClosesRowsAndPropagatesFailures(t *testing.T) {
	sentinel := errors.New("preflight sentinel")
	for _, tc := range []struct {
		name      string
		rows      *fakeTTLRows
		queryErr  error
		wantClose int
	}{
		{"query", nil, sentinel, 0},
		{"scan", &fakeTTLRows{scanErr: sentinel}, nil, 1},
		{"rows", &fakeTTLRows{rowsErr: sentinel}, nil, 1},
		{"close", &fakeTTLRows{closeErr: sentinel}, nil, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn := &fakeMigrationConn{ttlRows: tc.rows, queryErr: tc.queryErr}
			b := &backend{conn: conn, opts: options{metricDays: 30, logDays: 14, traceDays: 7, redDays: 90}}
			if err := b.preflightTTL(t.Context()); !errors.Is(err, sentinel) {
				t.Fatalf("preflight error=%v, want sentinel", err)
			}
			if tc.rows != nil && tc.rows.closeCall != tc.wantClose {
				t.Fatalf("rows Close calls=%d, want %d", tc.rows.closeCall, tc.wantClose)
			}
		})
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	conn := &fakeMigrationConn{}
	b := &backend{conn: conn}
	if err := b.preflightTTL(ctx); !errors.Is(err, context.Canceled) || len(conn.queries) != 0 {
		t.Fatalf("cancellation did not stop before I/O: err=%v, queries=%d", err, len(conn.queries))
	}
}
