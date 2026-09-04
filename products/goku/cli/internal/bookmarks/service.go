// internal/bookmarks/service.go

package bookmarks

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/database"
	"log"
	"strings"

	"github.com/fallrising/goku-cli/internal/fetcher"
	"github.com/fallrising/goku-cli/pkg/interfaces"
	"github.com/fallrising/goku-cli/pkg/models"
)

type BookmarkService struct {
	repo      interfaces.BookmarkRepository
	sqliteStats *database.SQLiteStats
}

func NewBookmarkService(repo interfaces.BookmarkRepository, sqliteStats *database.SQLiteStats) *BookmarkService {
	return &BookmarkService{repo: repo, sqliteStats: sqliteStats}
}

func (s *BookmarkService) CreateBookmark(ctx context.Context, bookmark *models.Bookmark) error {
	log.Printf("CreateBookmark called with URL: %s", bookmark.URL)

	if bookmark.URL == "" {
		log.Println("Error: URL is required")
		return fmt.Errorf("URL is required")
	}

	// Check if URL already exists in the database
	existingBookmark, err := s.repo.GetByURL(ctx, bookmark.URL)
	if err != nil {
		log.Printf("Error checking for existing bookmark: %v", err)
		return fmt.Errorf("failed to check for existing bookmark: %w", err)
	}
	if existingBookmark != nil {
		log.Printf("Bookmark already exists with URL: %s", existingBookmark.URL)
		return fmt.Errorf("bookmark with this URL already exists: %s", existingBookmark.URL)
	}

	// Check if URL starts with "http://" or "https://"
	if !(strings.HasPrefix(bookmark.URL, "http://") || strings.HasPrefix(bookmark.URL, "https://")) {
		bookmark.URL = "https://" + bookmark.URL
		log.Printf("URL updated to: %s", bookmark.URL)
	}

	// Fetch page content if title, description, or tags are not provided
	if bookmark.Title == "" || bookmark.Description == "" || len(bookmark.Tags) == 0 {
		log.Println("Fetching page content for metadata")
		var content *fetcher.PageContent
		var retry bool
		fetchData := ctx.Value("fetchData").(bool)
		if fetchData {
			content, retry, err = fetcher.FetchPageContent(bookmark.URL)
			if err != nil && retry {
				log.Printf("Warning: failed to fetch page content: %v, will try Wayback Machine", err)
				content, err = fetcher.FetchMetadataFromWaybackMachine(bookmark.URL)
				if err != nil {
					log.Printf("Warning: failed to fetch metadata from Wayback Machine: %v", err)
				}
			}
		}
		// Update bookmark with fetched content
		if content != nil {
			if content.FetchError != "" {
				log.Printf("Warning: %s", content.FetchError)
				bookmark.Description = fmt.Sprintf("Metadata fetch failed: %s", content.FetchError)
			} else {
				if bookmark.Title == "" || strings.HasPrefix(bookmark.Title, "http://") || strings.HasPrefix(bookmark.Title, "https://") {
					bookmark.Title = content.Title
					log.Printf("Title set from fetched content: %s", bookmark.Title)
				}
				if bookmark.Description == "" {
					bookmark.Description = content.Description
					log.Printf("Description set from fetched content: %s", bookmark.Description)
				}
				if len(bookmark.Tags) == 0 {
					bookmark.Tags = content.Tags
					log.Printf("Tags set from fetched content: %v", bookmark.Tags)
				}
			}
		}
	}

	log.Printf("Attempting to create bookmark in repository: %+v", bookmark)
	err = s.repo.Create(ctx, bookmark)
	if err != nil {
		log.Printf("Error creating bookmark in repository: %v", err)
		return fmt.Errorf("failed to create bookmark in repository: %w", err)
	}

	log.Printf("Bookmark successfully created with ID: %d", bookmark.ID)
	return nil
}

func (s *BookmarkService) GetBookmark(ctx context.Context, id int64) (*models.Bookmark, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *BookmarkService) UpdateBookmark(ctx context.Context, updatedBookmark *models.Bookmark) error {
	if updatedBookmark.ID == 0 {
		return fmt.Errorf("bookmark ID is required")
	}

	// Fetch existing bookmark
	existingBookmark, err := s.repo.GetByID(ctx, updatedBookmark.ID)
	if err != nil {
		return fmt.Errorf("failed to fetch existing bookmark: %w", err)
	}
	if existingBookmark == nil {
		return fmt.Errorf("bookmark not found with ID: %d", updatedBookmark.ID)
	}

	// Check if the URL has changed
	if updatedBookmark.URL != existingBookmark.URL {
		// Check for duplicates
		duplicate, err := s.repo.GetByURL(ctx, updatedBookmark.URL)
		if err != nil {
			return fmt.Errorf("failed to check for duplicate URL: %w", err)
		}
		if duplicate != nil {
			return fmt.Errorf("another bookmark with URL '%s' already exists", updatedBookmark.URL)
		}

		fetchData := ctx.Value("fetchData").(bool)
		content := &fetcher.PageContent{}
		retry := false
		if fetchData {
			// Fetch new metadata for the new URL
			content, retry, err = fetcher.FetchPageContent(updatedBookmark.URL)
			if err != nil && retry {
				log.Printf("Warning: failed to fetch page content: %v, will try Wayback Machine", err)
				content, err = fetcher.FetchMetadataFromWaybackMachine(updatedBookmark.URL)
				if err != nil {
					log.Printf("Warning: failed to fetch metadata from Wayback Machine: %v", err)
				}
			}
			if content.FetchError != "" {
				fmt.Printf("Warning: %s\n", content.FetchError)
				updatedBookmark.Description = fmt.Sprintf("Metadata fetch failed: %s", content.FetchError)
			} else {
				// Update the metadata with fetched content
				updatedBookmark.Title = content.Title
				updatedBookmark.Description = content.Description
				updatedBookmark.Tags = content.Tags
			}
		}
	}

	// Track changes
	updated := false

	if updatedBookmark.URL != "" && updatedBookmark.URL != existingBookmark.URL {
		existingBookmark.URL = updatedBookmark.URL
		updated = true
	}
	if updatedBookmark.Title != "" && updatedBookmark.Title != existingBookmark.Title {
		existingBookmark.Title = updatedBookmark.Title
		updated = true
	}
	if updatedBookmark.Description != "" && updatedBookmark.Description != existingBookmark.Description {
		existingBookmark.Description = updatedBookmark.Description
		updated = true
	}
	if len(updatedBookmark.Tags) > 0 && !equalTags(updatedBookmark.Tags, existingBookmark.Tags) {
		existingBookmark.Tags = updatedBookmark.Tags
		updated = true
	}

	// Update only if necessary
	if updated {
		return s.repo.Update(ctx, existingBookmark)
	}

	fmt.Println("No changes detected, bookmark update skipped.")
	return nil
}

func (s *BookmarkService) DeleteBookmark(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

func (s *BookmarkService) ListBookmarks(ctx context.Context, limit, offset int) ([]*models.Bookmark, error) {
	return s.repo.List(ctx, limit, offset)
}

// Helper function to check if tags are equal
func equalTags(tags1, tags2 []string) bool {
	if len(tags1) != len(tags2) {
		return false
	}
	for i, tag := range tags1 {
		if tag != tags2[i] {
			return false
		}
	}
	return true
}
