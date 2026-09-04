package bookmarks

import (
	"context"
	"github.com/fallrising/goku-cli/pkg/models"
)

func (s *BookmarkService) GetStatistics(ctx context.Context) (*models.Statistics, error) {
	// Use SQLite for statistics
	return s.sqliteStats.GetStatistics(ctx)
}
