package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed sql/*.sql
var SQLFiles embed.FS

func Open(path string) (*sql.DB, error) {
	dsn := path
	if path != ":memory:" && !strings.HasPrefix(path, "file:") {
		dsn = "file:" + path
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	dsn += sep + "_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	sqldb.SetMaxOpenConns(1)
	if _, err := sqldb.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		_ = sqldb.Close()
		return nil, err
	}
	if err := Migrate(sqldb, SQLFiles); err != nil {
		_ = sqldb.Close()
		return nil, err
	}
	return sqldb, nil
}

var memSeq atomic.Int64

func OpenMemory() (*sql.DB, error) {
	name := fmt.Sprintf("file:memdb-%d?mode=memory&cache=shared", memSeq.Add(1))
	return Open(name)
}

func Migrate(sqldb *sql.DB, fsys fs.FS) error {
	if _, err := sqldb.Exec(`
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`); err != nil {
		return err
	}
	entries, err := fs.ReadDir(fsys, "sql")
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		var n int
		if err := sqldb.QueryRow(`SELECT COUNT(1) FROM _migrations WHERE name = ?`, name).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		body, err := fs.ReadFile(fsys, "sql/"+name)
		if err != nil {
			return err
		}
		tx, err := sqldb.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.Exec(`INSERT INTO _migrations(name, applied_at) VALUES (?, ?)`, name, time.Now().UTC().Format(time.RFC3339)); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func Ping(sqldb *sql.DB) error {
	return sqldb.Ping()
}
