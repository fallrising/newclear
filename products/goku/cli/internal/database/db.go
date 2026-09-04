// internal/database/db.go

package database

import (
	"database/sql"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	db    *sql.DB
	cache *CacheDB
}

func NewDatabase(dbPath string, cacheDBPath string) (*Database, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	cacheDB, err := NewCacheDB(cacheDBPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create cache database: %w", err)
	}

	return &Database{db: db, cache: cacheDB}, nil
}

func (d *Database) Init() error {
	query := `CREATE TABLE IF NOT EXISTS bookmarks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		url TEXT NOT NULL,
		title TEXT,
		description TEXT,
		tags TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`

	_, err := d.db.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create bookmarks table: %w", err)
	}

	return nil
}
