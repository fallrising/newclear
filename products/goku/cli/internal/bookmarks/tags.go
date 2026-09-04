package bookmarks

import (
	"context"
	"fmt"
)

func (s *BookmarkService) RemoveTagFromBookmark(ctx context.Context, bookmarkID int64, tagToRemove string) error {
	// Fetch the existing bookmark
	bookmark, err := s.repo.GetByID(ctx, bookmarkID)
	if err != nil {
		return fmt.Errorf("failed to fetch bookmark: %w", err)
	}

	// Remove the specified tag
	bookmark.RemoveTag(tagToRemove)

	// Save the updated bookmark
	err = s.repo.Update(ctx, bookmark)
	if err != nil {
		return fmt.Errorf("failed to update bookmark after removing tag: %w", err)
	}

	return nil
}

func (s *BookmarkService) ListAllTags(ctx context.Context) ([]string, error) {
	tags, err := s.repo.ListAllTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list tags: %w", err)
	}
	return tags, nil
}
