package database

import (
	"context"
	"fmt"
	"strings"
)

func (d *Database) ListAllTags(ctx context.Context) ([]string, error) {
	query := `SELECT tags FROM bookmarks`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query bookmarks for tags: %w", err)
	}
	defer rows.Close()

	tagSet := make(map[string]struct{}) // Use a set to deduplicate tags
	for rows.Next() {
		var tags string
		err := rows.Scan(&tags)
		if err != nil {
			return nil, fmt.Errorf("failed to scan tags: %w", err)
		}

		// Split the comma-separated tags and add them to the set
		for _, tag := range strings.Split(tags, ",") {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				tagSet[tag] = struct{}{}
			}
		}
	}

	// Convert the set back to a slice
	var uniqueTags []string
	for tag := range tagSet {
		uniqueTags = append(uniqueTags, tag)
	}

	return uniqueTags, nil
}

func (d *Database) CountByTag(ctx context.Context) (map[string]int, error) {
	query := `SELECT tag, COUNT(*) as count 
	FROM (
		SELECT trim(value) as tag
		FROM bookmarks
		CROSS JOIN json_each('["' || replace(replace(tags, ' ', ''), ',', '","') || '"]')
	)
	GROUP BY tag`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query tags: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var tag string
		var count int
		if err := rows.Scan(&tag, &count); err != nil {
			return nil, fmt.Errorf("failed to scan tag count: %w", err)
		}
		counts[tag] = count
	}

	return counts, nil
}
