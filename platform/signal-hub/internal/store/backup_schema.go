package store

import (
	"context"
	"database/sql"
	"sync"
)

type backupSchemaObject struct {
	Kind  string
	Name  string
	Table string
	SQL   string
}

// Derive each complete supported schema using the same SQLite engine and exact
// embedded migrations as normal startup. This includes constraints, generated
// unique indexes, required indexes/triggers and SQLite's sequence table, without
// maintaining a second handwritten fingerprint that can silently omit fields.
var backupExpectedSchemas = sync.OnceValues(func() ([][]backupSchemaObject, error) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	var versions [][]backupSchemaObject
	for _, migration := range []string{migration1, migration2, migration3, migration4, migration5} {
		if _, err := db.Exec(migration); err != nil {
			return nil, err
		}
		rows, err := db.Query("SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_schema ORDER BY type,name")
		if err != nil {
			return nil, err
		}
		var objects []backupSchemaObject
		for rows.Next() {
			var object backupSchemaObject
			if err := rows.Scan(&object.Kind, &object.Name, &object.Table, &object.SQL); err != nil {
				_ = rows.Close()
				return nil, err
			}
			objects = append(objects, object)
		}
		rowErr := rows.Err()
		closeErr := rows.Close()
		if rowErr != nil {
			return nil, rowErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		versions = append(versions, objects)
	}
	return versions, nil
})

// backupSchema validates every required application object within one database
// read snapshot. Extra diagnostic tables/indexes/triggers may coexist; they do
// not replace any required definition. This establishes schema correctness,
// not database provenance or trust in caller-controlled extension objects.
func backupSchema(ctx context.Context, db *sql.DB) error {
	versions, err := backupExpectedSchemas()
	if err != nil {
		return ErrInvalidBackup
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ErrInvalidBackup
	}
	defer tx.Rollback()
	var version int
	if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil || version < 1 || version > len(versions) {
		return ErrInvalidBackup
	}
	for _, expected := range versions[version-1] {
		var table, definition string
		if err := tx.QueryRowContext(ctx, "SELECT tbl_name,coalesce(sql,'') FROM sqlite_schema WHERE type=? AND name=?", expected.Kind, expected.Name).Scan(&table, &definition); err != nil {
			return ErrInvalidBackup
		}
		if table != expected.Table || definition != expected.SQL {
			return ErrInvalidBackup
		}
	}
	return nil
}
