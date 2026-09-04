package database

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/pkg/models"
	"strings"
)

func (d *Database) CountByHostname(ctx context.Context) (map[string]int, error) {
	query := `SELECT 
		substr(url, instr(url, '://') + 3, 
			case 
				when instr(substr(url, instr(url, '://') + 3), '/') = 0 
				then length(substr(url, instr(url, '://') + 3)) 
				else instr(substr(url, instr(url, '://') + 3), '/') - 1 
			end
		) as hostname, 
		COUNT(*) as count 
	FROM bookmarks 
	GROUP BY hostname`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query hostnames: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var hostname string
		var count int
		if err := rows.Scan(&hostname, &count); err != nil {
			return nil, fmt.Errorf("failed to scan hostname count: %w", err)
		}
		counts[hostname] = count
	}

	return counts, nil
}

func (d *Database) GetLatest(ctx context.Context, limit int) ([]*models.Bookmark, error) {
	query := `SELECT id, url, title, description, tags, created_at, updated_at 
	FROM bookmarks 
	ORDER BY created_at DESC 
	LIMIT ?`

	rows, err := d.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query latest bookmarks: %w", err)
	}
	defer rows.Close()

	var bookmarks []*models.Bookmark
	for rows.Next() {
		var b models.Bookmark
		var tags string
		if err := rows.Scan(&b.ID, &b.URL, &b.Title, &b.Description, &tags, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan bookmark: %w", err)
		}
		b.Tags = strings.Split(tags, ",")
		bookmarks = append(bookmarks, &b)
	}

	return bookmarks, nil
}

func (d *Database) CountAccessibility(ctx context.Context) (map[string]int, error) {
	query := `SELECT 
		CASE 
			WHEN description LIKE 'Metadata fetch failed:%' THEN 'inaccessible'
			ELSE 'accessible'
		END as status, 
		COUNT(*) as count 
	FROM bookmarks 
	GROUP BY status`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query accessibility: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, fmt.Errorf("failed to scan accessibility count: %w", err)
		}
		counts[status] = count
	}

	return counts, nil
}

func (d *Database) TopHostnames(ctx context.Context, limit int) ([]models.HostnameCount, error) {
	query := `SELECT 
		substr(url, instr(url, '://') + 3, 
			case 
				when instr(substr(url, instr(url, '://') + 3), '/') = 0 
				then length(substr(url, instr(url, '://') + 3)) 
				else instr(substr(url, instr(url, '://') + 3), '/') - 1 
			end
		) as hostname, 
		COUNT(*) as count 
	FROM bookmarks 
	GROUP BY hostname 
	ORDER BY count DESC 
	LIMIT ?`

	rows, err := d.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query top hostnames: %w", err)
	}
	defer rows.Close()

	var topHostnames []models.HostnameCount
	for rows.Next() {
		var hc models.HostnameCount
		if err := rows.Scan(&hc.Hostname, &hc.Count); err != nil {
			return nil, fmt.Errorf("failed to scan hostname count: %w", err)
		}
		topHostnames = append(topHostnames, hc)
	}

	return topHostnames, nil
}

func (d *Database) ListUniqueHostnames(ctx context.Context) ([]string, error) {
	query := `SELECT DISTINCT
		substr(url, instr(url, '://') + 3, 
			case 
				when instr(substr(url, instr(url, '://') + 3), '/') = 0 
				then length(substr(url, instr(url, '://') + 3)) 
				else instr(substr(url, instr(url, '://') + 3), '/') - 1 
			end
		) as hostname
	FROM bookmarks 
	ORDER BY hostname`

	rows, err := d.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query unique hostnames: %w", err)
	}
	defer rows.Close()

	var hostnames []string
	for rows.Next() {
		var hostname string
		if err := rows.Scan(&hostname); err != nil {
			return nil, fmt.Errorf("failed to scan hostname: %w", err)
		}
		hostnames = append(hostnames, hostname)
	}

	return hostnames, nil
}

func (d *Database) CountCreatedLastNDays(ctx context.Context, days int) (map[string]int, error) {
	query := `SELECT 
		date(created_at) as day, 
		COUNT(*) as count 
	FROM bookmarks 
	WHERE created_at >= date('now', ?)
	GROUP BY day 
	ORDER BY day DESC`

	rows, err := d.db.QueryContext(ctx, query, fmt.Sprintf("-%d days", days))
	if err != nil {
		return nil, fmt.Errorf("failed to query created counts: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var day string
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			return nil, fmt.Errorf("failed to scan day count: %w", err)
		}
		counts[day] = count
	}

	return counts, nil
}
