package sqlite

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Registry entries are trusted, compiled SQL, never database or caller input.
// Keep V1's frozen checksum independent of the embedded bytes being verified.
type migrationStep struct {
	version  int
	sql      string
	checksum string
}

//go:embed migrations/0002_acceptance.sql
var v2Migration string

func migrate(conn *sql.Conn, ctx context.Context, appliedAtNS int64) error {
	return runMigrations(conn, ctx, compiledMigrations(), appliedAtNS)
}

func compiledMigrations() []migrationStep {
	return []migrationStep{
		{1, v1Migration, "57d96955d3351de47b1a81696398cf9ddb843394eb5c004c6f79841117c7745c"},
		{2, v2Migration, "5fbac05b24ba8bccedafb2857ff45934c88612e1ee6f550d12e4576fd2ea0b48"},
	}
}

func validateMigrationRegistry(registry []migrationStep) error {
	if len(registry) == 0 {
		return fmt.Errorf("empty migration registry")
	}
	checksums := make(map[string]bool, len(registry))
	for index, step := range registry {
		sum := sha256.Sum256([]byte(step.sql))
		if step.version != index+1 || strings.TrimSpace(step.sql) == "" || step.checksum != fmt.Sprintf("%x", sum) || checksums[step.checksum] {
			return fmt.Errorf("invalid migration registry entry %d", index+1)
		}
		checksums[step.checksum] = true
	}
	return nil
}

// The lock covers the history decision and the entire pending batch. Ledger
// creation is transactional too, so a failed first startup leaves no history.
func runMigrations(conn *sql.Conn, ctx context.Context, registry []migrationStep, appliedAtNS int64) (resultErr error) {
	if err := validateMigrationRegistry(registry); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return normalizeError(err)
	}
	committed := false
	defer func() {
		if !committed {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := conn.ExecContext(cleanup, "ROLLBACK"); err != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("migration rollback: %w", normalizeError(err)))
			}
		}
	}()
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
version INTEGER PRIMARY KEY CHECK(version > 0), checksum TEXT NOT NULL UNIQUE, applied_at_ns INTEGER NOT NULL)`); err != nil {
		return normalizeError(err)
	}
	applied, err := readMigrationPrefix(conn, ctx, registry)
	if err != nil {
		return err
	}
	if applied == 0 {
		var objects int
		if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name <> 'schema_migrations'`).Scan(&objects); err != nil {
			return normalizeError(err)
		}
		if objects != 0 {
			return fmt.Errorf("application schema without migration history")
		}
	} else if err := checkMigrationState(conn, ctx, applied); err != nil {
		return err
	}
	for _, step := range registry[applied:] {
		if _, err := conn.ExecContext(ctx, step.sql); err != nil {
			return errors.Join(normalizeError(err), ctx.Err())
		}
		if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations (version, checksum, applied_at_ns) VALUES (?, ?, ?)", step.version, step.checksum, appliedAtNS); err != nil {
			return normalizeError(err)
		}
		update, err := conn.ExecContext(ctx, "UPDATE instance_state SET schema_version = ? WHERE id = 1", step.version)
		if err != nil {
			return normalizeError(err)
		}
		changed, err := update.RowsAffected()
		if err != nil {
			return normalizeError(err)
		}
		if changed != 1 {
			return fmt.Errorf("missing migration instance state")
		}
		if err := checkMigrationState(conn, ctx, step.version); err != nil {
			return err
		}
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return normalizeError(err)
	}
	committed = true
	return nil
}

func readMigrationPrefix(conn *sql.Conn, ctx context.Context, registry []migrationStep) (int, error) {
	rows, err := conn.QueryContext(ctx, "SELECT version, checksum, applied_at_ns, typeof(version), typeof(checksum), typeof(applied_at_ns) FROM schema_migrations ORDER BY version LIMIT ?", len(registry)+1)
	if err != nil {
		return 0, normalizeError(err)
	}
	count := 0
	var scanErr error
	for rows.Next() {
		var version int
		var checksum string
		var appliedAtNS int64
		var versionType, checksumType, timeType string
		if scanErr = rows.Scan(&version, &checksum, &appliedAtNS, &versionType, &checksumType, &timeType); scanErr != nil {
			break
		}
		if count >= len(registry) || versionType != "integer" || checksumType != "text" || timeType != "integer" || version != count+1 || checksum != registry[count].checksum {
			scanErr = fmt.Errorf("incompatible migration history at version %d", version)
			break
		}
		count++
	}
	return count, errors.Join(normalizeError(scanErr), normalizeError(rows.Err()), normalizeError(rows.Close()))
}

func checkMigrationState(conn *sql.Conn, ctx context.Context, version int) error {
	rows, err := conn.QueryContext(ctx, "SELECT id, schema_version, typeof(id), typeof(schema_version) FROM instance_state ORDER BY id LIMIT 2")
	if err != nil {
		return normalizeError(err)
	}
	count := 0
	var scanErr error
	for rows.Next() {
		var id, actual int
		var idType, versionType string
		if scanErr = rows.Scan(&id, &actual, &idType, &versionType); scanErr != nil {
			break
		}
		if idType != "integer" || versionType != "integer" || id != 1 || actual != version || count != 0 {
			scanErr = fmt.Errorf("migration instance state disagrees with history")
			break
		}
		count++
	}
	if scanErr == nil && count != 1 {
		scanErr = fmt.Errorf("missing migration instance state")
	}
	return errors.Join(normalizeError(scanErr), normalizeError(rows.Err()), normalizeError(rows.Close()))
}
