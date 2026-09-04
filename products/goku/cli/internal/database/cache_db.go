// internal/database/cache_db.go

package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/fallrising/goku-cli/pkg/models"
	_ "github.com/mattn/go-sqlite3"
)

type CacheDB struct {
	db *sql.DB
	mu sync.RWMutex
}

func NewCacheDB(dbPath string) (*CacheDB, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open cache database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping cache database: %w", err)
	}

	cacheDB := &CacheDB{db: db}
	if err := cacheDB.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize cache schema: %w", err)
	}

	return cacheDB, nil
}

func (c *CacheDB) initSchema() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS bookmark_cache (
            key TEXT PRIMARY KEY,
            data BLOB,
            expiry TIMESTAMP
        )`,
		`CREATE TABLE IF NOT EXISTS url_set (
			url TEXT PRIMARY KEY
		)`,
	}

	for _, query := range queries {
		_, err := c.db.Exec(query)
		if err != nil {
			return fmt.Errorf("failed to execute schema query: %w", err)
		}
	}

	return nil
}

func (c *CacheDB) Set(ctx context.Context, key string, bookmark *models.Bookmark, expiry time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := json.Marshal(bookmark)
	if err != nil {
		return fmt.Errorf("failed to marshal bookmark: %w", err)
	}

	query := `INSERT OR REPLACE INTO bookmark_cache (key, data, expiry) VALUES (?, ?, ?)`
	_, err = c.db.ExecContext(ctx, query, key, data, time.Now().Add(expiry))
	if err != nil {
		return fmt.Errorf("failed to set cache entry: %w", err)
	}

	return nil
}

func (c *CacheDB) Get(ctx context.Context, key string) (*models.Bookmark, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	query := `SELECT data, expiry FROM bookmark_cache WHERE key = ?`
	var data []byte
	var expiry time.Time

	err := c.db.QueryRowContext(ctx, query, key).Scan(&data, &expiry)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // Cache miss
		}
		return nil, fmt.Errorf("failed to get cache entry: %w", err)
	}

	if time.Now().After(expiry) {
		// Entry has expired, delete it
		c.Delete(ctx, key)
		return nil, nil
	}

	var bookmark models.Bookmark
	err = json.Unmarshal(data, &bookmark)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal bookmark: %w", err)
	}

	return &bookmark, nil
}

func (c *CacheDB) Delete(ctx context.Context, key string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	query := `DELETE FROM bookmark_cache WHERE key = ?`
	_, err := c.db.ExecContext(ctx, query, key)
	if err != nil {
		return fmt.Errorf("failed to delete cache entry: %w", err)
	}

	return nil
}

func (c *CacheDB) AddURL(ctx context.Context, url string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	query := `INSERT OR IGNORE INTO url_set (url) VALUES (?)`
	_, err := c.db.ExecContext(ctx, query, url)
	if err != nil {
		return fmt.Errorf("failed to add URL to set: %w", err)
	}

	return nil
}

func (c *CacheDB) HasURL(ctx context.Context, url string) (bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	query := `SELECT 1 FROM url_set WHERE url = ?`
	var exists int
	err := c.db.QueryRowContext(ctx, query, url).Scan(&exists)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("failed to check URL existence: %w", err)
	}

	return exists == 1, nil
}

func (c *CacheDB) RemoveURL(ctx context.Context, url string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	query := `DELETE FROM url_set WHERE url = ?`
	_, err := c.db.ExecContext(ctx, query, url)
	if err != nil {
		return fmt.Errorf("failed to remove URL from set: %w", err)
	}

	return nil
}

func (c *CacheDB) Clear(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	_, err := c.db.ExecContext(ctx, "DELETE FROM bookmark_cache")
	if err != nil {
		return fmt.Errorf("failed to clear bookmark cache: %w", err)
	}

	_, err = c.db.ExecContext(ctx, "DELETE FROM url_set")
	if err != nil {
		return fmt.Errorf("failed to clear URL set: %w", err)
	}

	return nil
}
