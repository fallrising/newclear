package bookmarks

import (
	"context"
	"fmt"
	"log"
)

func (s *BookmarkService) PurgeBookmarks(ctx context.Context) error {
	log.Println("Starting PurgeBookmarks process")

	// Get the total count of bookmarks before purging
	initialCount, err := s.CountBookmarks(ctx)
	if err != nil {
		log.Printf("Error getting initial bookmark count: %v", err)
		return fmt.Errorf("failed to get initial bookmark count: %w", err)
	}

	// Perform the purge operation
	err = s.repo.Purge(ctx)
	if err != nil {
		log.Printf("Error purging bookmarks: %v", err)
		return fmt.Errorf("failed to purge bookmarks: %w", err)
	}

	// Get the count after purging to confirm
	finalCount, err := s.CountBookmarks(ctx)
	if err != nil {
		log.Printf("Error getting final bookmark count: %v", err)
		return fmt.Errorf("failed to get final bookmark count: %w", err)
	}

	if finalCount != 0 {
		log.Printf("Warning: After purge, %d bookmarks still remain", finalCount)
		return fmt.Errorf("purge operation did not remove all bookmarks")
	}

	log.Printf("Successfully purged %d bookmarks", initialCount)
	return nil
}
