package database

import (
	"context"
	"fmt"
	"strings"

	"github.com/fallrising/goku-cli/pkg/models"
)

func (d *Database) Search(ctx context.Context, query string, limit, offset int) ([]*models.Bookmark, error) {
	searchQuery := `
		SELECT id, url, title, description, tags, created_at, updated_at 
		FROM bookmarks 
		WHERE url LIKE ? OR title LIKE ? OR description LIKE ? OR tags LIKE ?
		LIMIT ? OFFSET ?
	`
	searchParam := "%" + query + "%"

	rows, err := d.db.QueryContext(ctx, searchQuery, searchParam, searchParam, searchParam, searchParam, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to search bookmarks: %w", err)
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

	return bookmarks, nil
}
