package interfaces

import (
	"context"

	"github.com/fallrising/goku-cli/pkg/models"
)

type BookmarkRepository interface {
	Create(ctx context.Context, bookmark *models.Bookmark) error
	GetByID(ctx context.Context, id int64) (*models.Bookmark, error)
	GetByURL(ctx context.Context, url string) (*models.Bookmark, error) // New method
	Update(ctx context.Context, bookmark *models.Bookmark) error
	Delete(ctx context.Context, id int64) error
	List(ctx context.Context, limit, offset int) ([]*models.Bookmark, error)
	Search(ctx context.Context, query string, limit, offset int) ([]*models.Bookmark, error)
	ListAllTags(ctx context.Context) ([]string, error)
	// New methods for statistics
	CountByHostname(ctx context.Context) (map[string]int, error)
	CountByTag(ctx context.Context) (map[string]int, error)
	GetLatest(ctx context.Context, limit int) ([]*models.Bookmark, error)
	CountAccessibility(ctx context.Context) (map[string]int, error)
	TopHostnames(ctx context.Context, limit int) ([]models.HostnameCount, error)
	ListUniqueHostnames(ctx context.Context) ([]string, error)
	CountCreatedLastNDays(ctx context.Context, days int) (map[string]int, error)
	Count(ctx context.Context) (int, error)
	Purge(ctx context.Context) error
}
