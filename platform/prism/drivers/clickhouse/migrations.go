package clickhouse

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"strings"
	"text/template"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

type migration struct {
	version                uint32
	name, source, checksum string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return nil, err
	}
	if len(entries) != 8 {
		return nil, errDrift
	}
	result := make([]migration, 0, len(entries))
	for i, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") || !strings.HasPrefix(e.Name(), fmt.Sprintf("%03d_", i+1)) {
			return nil, errDrift
		}
		data, err := migrationFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		result = append(result, migration{uint32(i + 1), e.Name(), string(data), hex.EncodeToString(sum[:])})
	}
	return result, nil
}

func (b *backend) Migrate(ctx context.Context) error {
	return b.run(ctx, "Migrate", func(ctx context.Context) error {
		select {
		case b.migrateSem <- struct{}{}:
			defer func() { <-b.migrateSem }()
		case <-ctx.Done():
			return ctx.Err()
		}
		return b.migrate(ctx)
	})
}

func (b *backend) migrate(ctx context.Context) error {
	migrations, err := loadMigrations()
	if err != nil {
		return err
	}
	ddlCtx := clickhouse.Context(ctx, clickhouse.WithSettings(clickhouse.Settings{"async_insert": 0, "wait_for_async_insert": 1}))
	maxExec := b.maxExecutionTime()
	if err := b.conn.Exec(ddlCtx, "CREATE TABLE IF NOT EXISTS prism_schema_migrations (version UInt32, name String, applied_at DateTime DEFAULT now(), checksum String) ENGINE = MergeTree ORDER BY version"); err != nil {
		return err
	}
	rows, err := b.conn.Query(ddlCtx, fmt.Sprintf("SELECT version, name, checksum FROM prism_schema_migrations ORDER BY version LIMIT 9 SETTINGS max_execution_time = %d, max_result_rows = 9", maxExec))
	if err != nil {
		return err
	}
	seen := make(map[uint32]bool, 8)
	for rows.Next() {
		var version uint32
		var name, checksum string
		if err := rows.Scan(&version, &name, &checksum); err != nil {
			_ = rows.Close()
			return err
		}
		if version == 0 || version > 8 || seen[version] {
			_ = rows.Close()
			return errDrift
		}
		want := migrations[version-1]
		if name != want.name || checksum != want.checksum {
			_ = rows.Close()
			return errDrift
		}
		seen[version] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(seen) > 8 {
		return errDrift
	}
	var gap bool
	for v := uint32(1); v <= 8; v++ {
		if !seen[v] {
			gap = true
		} else if gap {
			return errDrift
		}
	}
	for _, m := range migrations {
		if seen[m.version] {
			continue
		}
		sql, err := renderMigration(m.source, b.opts)
		if err != nil {
			return err
		}
		for _, stmt := range splitStatements(sql) {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := b.conn.Exec(ddlCtx, stmt); err != nil {
				return err
			}
		}
		receiptSQL := fmt.Sprintf("INSERT INTO prism_schema_migrations (version, name, checksum) SETTINGS max_execution_time = %d VALUES (?, ?, ?)", maxExec)
		if err := b.conn.Exec(ddlCtx, receiptSQL, m.version, m.name, m.checksum); err != nil {
			return err
		}
	}
	if err := b.preflightTTL(ddlCtx); err != nil {
		return err
	}
	return b.reconcileTTL(ddlCtx)
}

// Check every TTL source before any ALTER. DateTime arithmetic wraps at 2^32 seconds.
func (b *backend) preflightTTL(ctx context.Context) error {
	sources := []struct {
		table, column string
		days          int
	}{
		{"logs", "ts", b.opts.logDays},
		{"spans", "ts", b.opts.traceDays},
		{"metric_samples", "ts", b.opts.metricDays},
		{"trace_index", "start_ts", b.opts.traceDays},
		{"service_red_1m", "minute", b.opts.redDays},
		{"service_deps_1h", "hour", b.opts.redDays},
		{"service_ops", "day", b.opts.redDays},
		{"pending_links", "ts", 1},
	}
	unsafe := false
	maxExec := b.maxExecutionTime()
	for _, source := range sources {
		if err := ctx.Err(); err != nil {
			return err
		}
		query := fmt.Sprintf("SELECT count(), max(%s) FROM %s LIMIT 1 SETTINGS max_execution_time = %d, max_result_rows = 1", source.column, source.table, maxExec)
		rows, err := b.conn.Query(ctx, query)
		if err != nil {
			return err
		}
		if !rows.Next() {
			err = rows.Err()
			_ = rows.Close()
			if err != nil {
				return err
			}
			return errDrift
		}
		var count uint64
		var maximum time.Time
		if err := rows.Scan(&count, &maximum); err != nil {
			_ = rows.Close()
			return err
		}
		if rows.Next() {
			_ = rows.Close()
			return errDrift
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if count > 0 && !retentionSafe(maximum, source.days) {
			unsafe = true
		}
	}
	if unsafe {
		return inputError("Migrate", "existing timestamps exceed retention-safe range")
	}
	return nil
}

func (b *backend) maxExecutionTime() int {
	if b.opts.maxExec > 0 {
		return b.opts.maxExec
	}
	return 55 // zero-valued options are used only by focused in-package tests.
}

func renderMigration(source string, opts options) (string, error) {
	vars := struct{ LogRetentionDays, TraceRetentionDays, MetricRetentionDays, REDRetentionDays int }{opts.logDays, opts.traceDays, opts.metricDays, opts.redDays}
	tpl, err := template.New("migration").Option("missingkey=error").Parse(source)
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	if err := tpl.Execute(&out, vars); err != nil {
		return "", err
	}
	return out.String(), nil
}

// The embedded templates contain only DDL and no semicolons inside string literals.
func splitStatements(sql string) []string {
	var out []string
	for part := range strings.SplitSeq(sql, ";") {
		part = strings.TrimSpace(part)
		if part == "" || strings.HasPrefix(part, "--") && !strings.Contains(part, "\n") {
			continue
		}
		if strings.HasPrefix(part, "--") {
			_, part, _ = strings.Cut(part, "\n")
			part = strings.TrimSpace(part)
		}
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func (b *backend) reconcileTTL(ctx context.Context) error {
	statements := []string{
		fmt.Sprintf("ALTER TABLE logs MODIFY TTL toDateTime(ts, 'UTC') + INTERVAL %d DAY", b.opts.logDays),
		fmt.Sprintf("ALTER TABLE spans MODIFY TTL toDateTime(ts, 'UTC') + INTERVAL %d DAY", b.opts.traceDays),
		fmt.Sprintf("ALTER TABLE metric_samples MODIFY TTL toDateTime(ts, 'UTC') + INTERVAL %d DAY", b.opts.metricDays),
		fmt.Sprintf("ALTER TABLE trace_index MODIFY TTL toDateTime(start_ts, 'UTC') + INTERVAL %d DAY", b.opts.traceDays),
		fmt.Sprintf("ALTER TABLE service_red_1m MODIFY TTL toDateTime(minute, 'UTC') + INTERVAL %d DAY", b.opts.redDays),
		fmt.Sprintf("ALTER TABLE service_deps_1h MODIFY TTL toDateTime(hour, 'UTC') + INTERVAL %d DAY", b.opts.redDays),
		fmt.Sprintf("ALTER TABLE service_ops MODIFY TTL toDateTime(day, 'UTC') + INTERVAL %d DAY", b.opts.redDays),
		"ALTER TABLE pending_links MODIFY TTL toDateTime(ts, 'UTC') + INTERVAL 1 DAY",
	}
	for _, sql := range statements {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := b.conn.Exec(ctx, sql); err != nil {
			return err
		}
	}
	return nil
}
