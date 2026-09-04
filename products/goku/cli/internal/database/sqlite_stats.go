package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/fallrising/goku-cli/pkg/models"
)

// SQLiteStats provides statistics functionality using SQLite instead of DuckDB
type SQLiteStats struct {
	db *Database
}

// NewSQLiteStats creates a new SQLite-based statistics provider
func NewSQLiteStats(db *Database) *SQLiteStats {
	return &SQLiteStats{db: db}
}

// GetStatistics returns comprehensive statistics using SQLite queries
func (s *SQLiteStats) GetStatistics(ctx context.Context) (*models.Statistics, error) {
	stats := &models.Statistics{
		HostnameCounts:      make(map[string]int),
		TagCounts:           make(map[string]int),
		AccessibilityCounts: make(map[string]int),
		CreatedLastWeek:     make(map[string]int),
	}

	var err error

	// Top Hostnames
	stats.TopHostnames, err = s.getTopHostnames(ctx, 3)
	if err != nil {
		return nil, err
	}

	// Hostname Counts
	stats.HostnameCounts, err = s.getHostnameCounts(ctx)
	if err != nil {
		return nil, err
	}

	// Tag Counts
	stats.TagCounts, err = s.getTagCounts(ctx)
	if err != nil {
		return nil, err
	}

	// Latest Bookmarks
	stats.LatestBookmarks, err = s.getLatestBookmarks(ctx, 10)
	if err != nil {
		return nil, err
	}

	// Accessibility Counts
	stats.AccessibilityCounts, err = s.getAccessibilityCounts(ctx)
	if err != nil {
		return nil, err
	}

	// Unique Hostnames
	stats.UniqueHostnames, err = s.getUniqueHostnames(ctx)
	if err != nil {
		return nil, err
	}

	// Created Last Week
	stats.CreatedLastWeek, err = s.getCreatedLastWeek(ctx)
	if err != nil {
		return nil, err
	}

	return stats, nil
}

func (s *SQLiteStats) getTopHostnames(ctx context.Context, limit int) ([]models.HostnameCount, error) {
	// Get all URLs first, then process in Go
	query := `SELECT url FROM bookmarks`
	rows, err := s.db.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query URLs: %w", err)
	}
	defer rows.Close()

	hostnameCounts := make(map[string]int)
	for rows.Next() {
		var rawURL string
		if err := rows.Scan(&rawURL); err != nil {
			return nil, fmt.Errorf("failed to scan URL: %w", err)
		}
		hostname := extractHostname(rawURL)
		if hostname != "" {
			hostnameCounts[hostname]++
		}
	}

	// Convert to slice and sort
	var topHostnames []models.HostnameCount
	for hostname, count := range hostnameCounts {
		topHostnames = append(topHostnames, models.HostnameCount{
			Hostname: hostname,
			Count:    count,
		})
	}

	// Sort by count descending
	for i := 0; i < len(topHostnames)-1; i++ {
		for j := i + 1; j < len(topHostnames); j++ {
			if topHostnames[j].Count > topHostnames[i].Count {
				topHostnames[i], topHostnames[j] = topHostnames[j], topHostnames[i]
			}
		}
	}

	// Limit results
	if limit > 0 && limit < len(topHostnames) {
		topHostnames = topHostnames[:limit]
	}

	return topHostnames, nil
}

func (s *SQLiteStats) getHostnameCounts(ctx context.Context) (map[string]int, error) {
	// Reuse the logic from getTopHostnames but return all results
	query := `SELECT url FROM bookmarks`
	rows, err := s.db.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query URLs: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var rawURL string
		if err := rows.Scan(&rawURL); err != nil {
			return nil, fmt.Errorf("failed to scan URL: %w", err)
		}
		hostname := extractHostname(rawURL)
		if hostname != "" {
			counts[hostname]++
		}
	}

	return counts, nil
}

func (s *SQLiteStats) getTagCounts(ctx context.Context) (map[string]int, error) {
	// First get all bookmarks with tags
	query := `SELECT tags FROM bookmarks WHERE tags IS NOT NULL AND tags != ''`
	rows, err := s.db.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query tags: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var tagsStr string
		if err := rows.Scan(&tagsStr); err != nil {
			return nil, fmt.Errorf("failed to scan tags: %w", err)
		}
		
		// Split tags by comma and count them
		tags := strings.Split(tagsStr, ",")
		for _, tag := range tags {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				counts[tag]++
			}
		}
	}

	return counts, nil
}

func (s *SQLiteStats) getLatestBookmarks(ctx context.Context, limit int) ([]*models.Bookmark, error) {
	query := `
		SELECT id, url, title, description, tags, created_at, updated_at
		FROM bookmarks
		ORDER BY created_at DESC
		LIMIT ?
	`
	rows, err := s.db.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query latest bookmarks: %w", err)
	}
	defer rows.Close()

	var bookmarks []*models.Bookmark
	for rows.Next() {
		var b models.Bookmark
		var tags sql.NullString
		if err := rows.Scan(&b.ID, &b.URL, &b.Title, &b.Description, &tags, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan bookmark: %w", err)
		}
		if tags.Valid && tags.String != "" {
			b.Tags = strings.Split(tags.String, ",")
		}
		bookmarks = append(bookmarks, &b)
	}

	return bookmarks, nil
}

func (s *SQLiteStats) getAccessibilityCounts(ctx context.Context) (map[string]int, error) {
	query := `
		SELECT 
			CASE 
				WHEN description LIKE 'Metadata fetch failed:%' THEN 'inaccessible'
				ELSE 'accessible'
			END as status, 
			COUNT(*) as count 
		FROM bookmarks 
		GROUP BY status
	`
	rows, err := s.db.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query accessibility counts: %w", err)
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

func (s *SQLiteStats) getUniqueHostnames(ctx context.Context) ([]string, error) {
	// Get hostname counts and extract unique hostnames
	hostnameCounts, err := s.getHostnameCounts(ctx)
	if err != nil {
		return nil, err
	}

	var hostnames []string
	for hostname := range hostnameCounts {
		hostnames = append(hostnames, hostname)
	}

	// Sort alphabetically
	for i := 0; i < len(hostnames)-1; i++ {
		for j := i + 1; j < len(hostnames); j++ {
			if hostnames[j] < hostnames[i] {
				hostnames[i], hostnames[j] = hostnames[j], hostnames[i]
			}
		}
	}

	return hostnames, nil
}

func (s *SQLiteStats) getCreatedLastWeek(ctx context.Context) (map[string]int, error) {
	query := `
		SELECT 
			date(created_at) as day, 
			COUNT(*) as count 
		FROM bookmarks 
		WHERE created_at >= date('now', '-7 days')
		GROUP BY day 
		ORDER BY day DESC
	`
	rows, err := s.db.db.QueryContext(ctx, query)
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

// extractHostname extracts hostname from URL using Go's net/url package as fallback
func extractHostname(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		// Fallback to regex if URL parsing fails
		re := regexp.MustCompile(`^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)`)
		matches := re.FindStringSubmatch(rawURL)
		if len(matches) > 1 {
			return matches[1]
		}
		return rawURL
	}
	
	hostname := u.Hostname()
	if strings.HasPrefix(hostname, "www.") {
		hostname = hostname[4:]
	}
	return hostname
}