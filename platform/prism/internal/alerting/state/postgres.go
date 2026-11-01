package state

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json/v2"
	"fmt"
	"net/url"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed migrations/001_alert_state.up.sql
var upSQL string

//go:embed migrations/001_alert_state.down.sql
var downSQL string

// DB is the alert_state connection for controlplane.postgres_dsn.
type DB struct {
	sql *sql.DB
}

// Open dials a PostgreSQL URL and checks the connection.
func Open(ctx context.Context, dsn string) (*DB, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	parsed, err := url.Parse(dsn)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		return nil, fmt.Errorf("controlplane.postgres_dsn must be a PostgreSQL URL")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &DB{sql: db}, nil
}

// Close closes the pool.
func (db *DB) Close() error {
	if db == nil || db.sql == nil {
		return nil
	}
	return db.sql.Close()
}

// Migrate applies 001_alert_state and records version 1.
// The statements use IF NOT EXISTS, so a second call leaves existing rows in place.
func (db *DB) Migrate(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := execScript(ctx, db.sql, upSQL); err != nil {
		return fmt.Errorf("apply alert_state migration: %w", err)
	}
	_, err := db.sql.ExecContext(ctx, `INSERT INTO alerting_schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING`)
	if err != nil {
		return fmt.Errorf("record alerting_schema_migrations: %w", err)
	}
	return nil
}

// Down drops alert_state and alerting_schema_migrations. for-timers are lost.
func (db *DB) Down(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := execScript(ctx, db.sql, downSQL); err != nil {
		return fmt.Errorf("drop alert_state: %w", err)
	}
	return nil
}

// Load reads one tenant's rows.
func (db *DB) Load(ctx context.Context, tenant string) ([]Row, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	rows, err := db.sql.QueryContext(ctx, `SELECT fingerprint, labels, state, active_at, fired_at FROM alert_state WHERE tenant_id = $1`, tenant)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []Row
	for rows.Next() {
		var (
			row    Row
			raw    []byte
			fired  sql.NullTime
			active sql.NullTime
		)
		if err := rows.Scan(&row.Fingerprint, &raw, &row.State, &active, &fired); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &row.Labels); err != nil {
			return nil, fmt.Errorf("decode alert_state labels: %w", err)
		}
		if active.Valid {
			row.ActiveAt = active.Time.UTC()
		}
		if fired.Valid {
			t := fired.Time.UTC()
			row.FiredAt = &t
		}
		out = append(out, row)
		if len(out) > maxRows {
			return nil, fmt.Errorf("alert_state row count exceeds %d", maxRows)
		}
	}
	return out, rows.Err()
}

// Save replaces the tenant's rows in one transaction. rule_id stays NULL.
func (db *DB) Save(ctx context.Context, tenant string, rows []Row) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate(rows); err != nil {
		return err
	}
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM alert_state WHERE tenant_id = $1`, tenant); err != nil {
		return err
	}
	for _, row := range rows {
		encoded, err := json.Marshal(row.Labels)
		if err != nil {
			return err
		}
		var fired any
		if row.FiredAt != nil {
			fired = row.FiredAt.UTC()
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO alert_state (tenant_id, fingerprint, rule_id, labels, state, active_at, fired_at, updated_at)
VALUES ($1, $2, NULL, $3::jsonb, $4, $5, $6, now())`,
			tenant, row.Fingerprint, string(encoded), row.State, row.ActiveAt.UTC(), fired); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func execScript(ctx context.Context, db *sql.DB, script string) error {
	for stmt := range strings.SplitSeq(script, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}
