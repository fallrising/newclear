package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fallrising/goku-cli/pkg/models"
)

func (d *Database) Create(ctx context.Context, bookmark *models.Bookmark) error {
	exists, err := d.cache.HasURL(ctx, bookmark.URL)
	if err != nil {
		return fmt.Errorf("failed to check URL existence in cache: %w", err)
	}
	if exists {
		return fmt.Errorf("bookmark with this URL already exists")
	}

	query := `INSERT INTO bookmarks (url, title, description, tags) VALUES (?, ?, ?, ?)`
	tags := strings.Join(bookmark.Tags, ",")

	result, err := d.db.ExecContext(ctx, query, bookmark.URL, bookmark.Title, bookmark.Description, tags)
	if err != nil {
		return fmt.Errorf("failed to insert bookmark: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("failed to get last insert ID: %w", err)
	}

	bookmark.ID = id

	err = d.cache.AddURL(ctx, bookmark.URL)
	if err != nil {
		return fmt.Errorf("failed to add URL to cache set: %w", err)
	}

	err = d.cache.Set(ctx, fmt.Sprintf("bookmark:%d", id), bookmark, 1*time.Hour)
	if err != nil {
		return fmt.Errorf("failed to cache bookmark: %w", err)
	}

	return nil
}

func (d *Database) GetByID(ctx context.Context, id int64) (*models.Bookmark, error) {
	cachedBookmark, err := d.cache.Get(ctx, fmt.Sprintf("bookmark:%d", id))
	if err == nil && cachedBookmark != nil {
		return cachedBookmark, nil
	}

	query := `SELECT id, url, title, description, tags, created_at, updated_at FROM bookmarks WHERE id = ?`

	var bookmark models.Bookmark
	var tags string

	err = d.db.QueryRowContext(ctx, query, id).Scan(
		&bookmark.ID, &bookmark.URL, &bookmark.Title, &bookmark.Description,
		&tags, &bookmark.CreatedAt, &bookmark.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("bookmark not found")
		}
		return nil, fmt.Errorf("failed to get bookmark: %w", err)
	}

	bookmark.Tags = strings.Split(tags, ",")

	err = d.cache.Set(ctx, fmt.Sprintf("bookmark:%d", id), &bookmark, 1*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("failed to cache bookmark: %w", err)
	}

	return &bookmark, nil
}

func (d *Database) GetByURL(ctx context.Context, url string) (*models.Bookmark, error) {
	exists, err := d.cache.HasURL(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("failed to check URL existence in cache: %w", err)
	}
	if !exists {
		return nil, nil
	}

	query := `SELECT id, url, title, description, tags, created_at, updated_at FROM bookmarks WHERE url = ?`

	var bookmark models.Bookmark
	var tags string

	err = d.db.QueryRowContext(ctx, query, url).Scan(
		&bookmark.ID, &bookmark.URL, &bookmark.Title, &bookmark.Description,
		&tags, &bookmark.CreatedAt, &bookmark.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get bookmark by URL: %w", err)
	}

	bookmark.Tags = strings.Split(tags, ",")

	err = d.cache.Set(ctx, fmt.Sprintf("bookmark:%d", bookmark.ID), &bookmark, 1*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("failed to cache bookmark: %w", err)
	}

	return &bookmark, nil
}

func (d *Database) Update(ctx context.Context, bookmark *models.Bookmark) error {
	query := `UPDATE bookmarks SET url = ?, title = ?, description = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
	tags := strings.Join(bookmark.Tags, ",")

	_, err := d.db.ExecContext(ctx, query, bookmark.URL, bookmark.Title, bookmark.Description, tags, bookmark.ID)
	if err != nil {
		return fmt.Errorf("failed to update bookmark: %w", err)
	}

	err = d.cache.Set(ctx, fmt.Sprintf("bookmark:%d", bookmark.ID), bookmark, 1*time.Hour)
	if err != nil {
		return fmt.Errorf("failed to update cached bookmark: %w", err)
	}

	return nil
}

func (d *Database) Delete(ctx context.Context, id int64) error {
	bookmark, err := d.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get bookmark for deletion: %w", err)
	}

	query := `DELETE FROM bookmarks WHERE id = ?`

	_, err = d.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete bookmark: %w", err)
	}

	err = d.cache.Delete(ctx, fmt.Sprintf("bookmark:%d", id))
	if err != nil {
		return fmt.Errorf("failed to delete cached bookmark: %w", err)
	}

	err = d.cache.RemoveURL(ctx, bookmark.URL)
	if err != nil {
		return fmt.Errorf("failed to remove URL from cache set: %w", err)
	}

	return nil
}

func (d *Database) List(ctx context.Context, limit, offset int) ([]*models.Bookmark, error) {
	query := `SELECT id, url, title, description, tags, created_at, updated_at FROM bookmarks LIMIT ? OFFSET ?`
	rows, err := d.db.QueryContext(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query bookmarks: %w", err)
	}
	defer rows.Close()

	var bookmarks []*models.Bookmark
	for rows.Next() {
		var bookmark models.Bookmark
		var tags string
		err := rows.Scan(
			&bookmark.ID, &bookmark.URL, &bookmark.Title, &bookmark.Description,
			&tags, &bookmark.CreatedAt, &bookmark.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan bookmark row: %w", err)
		}
		bookmark.Tags = strings.Split(tags, ",")
		bookmarks = append(bookmarks, &bookmark)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating bookmark rows: %w", err)
	}

	return bookmarks, nil
}

func (d *Database) Count(ctx context.Context) (int, error) {
	var count int
	err := d.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM bookmarks").Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count bookmarks: %w", err)
	}
	return count, nil
}

func (d *Database) Purge(ctx context.Context) error {
	// Start a transaction
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Defer a rollback in case anything fails
	defer tx.Rollback()

	// Delete all bookmarks
	_, err = tx.ExecContext(ctx, "DELETE FROM bookmarks")
	if err != nil {
		return fmt.Errorf("failed to delete all bookmarks: %w", err)
	}

	// Reset the autoincrement counter
	_, err = tx.ExecContext(ctx, "DELETE FROM sqlite_sequence WHERE name='bookmarks'")
	if err != nil {
		return fmt.Errorf("failed to reset autoincrement: %w", err)
	}

	// Clear the cache
	err = d.cache.Clear(ctx)
	if err != nil {
		return fmt.Errorf("failed to clear cache: %w", err)
	}

	// Commit the transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
