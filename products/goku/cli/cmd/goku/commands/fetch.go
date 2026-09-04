package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/fallrising/goku-cli/internal/fetcher"
	"github.com/fallrising/goku-cli/pkg/models"
	"github.com/urfave/cli/v2"
)

func FetchCommand() *cli.Command {
	return &cli.Command{
		Name: "fetch",
		Usage: "Fetch or update metadata for bookmarks\n\n" +
			"Examples:\n" +
			"  goku fetch --id 123\n" +
			"  goku fetch --all\n" +
			"  goku fetch --all --limit 20 --skip-internal",
		Flags: []cli.Flag{
			&cli.IntFlag{
				Name:  "id",
				Usage: "Fetch metadata for a specific bookmark ID",
			},
			&cli.BoolFlag{
				Name:  "all",
				Usage: "Fetch metadata for all bookmarks",
			},
			&cli.IntFlag{
				Name:  "limit",
				Usage: "Number of bookmarks to process per batch (default: 10)",
				Value: 10,
			},
			&cli.BoolFlag{
				Name:  "skip-internal",
				Usage: "Skip URLs with internal IP addresses",
			},
		},
		Action: func(c *cli.Context) error {
			id := c.Int("id")
			all := c.Bool("all")
			limit := c.Int("limit")
			skipInternal := c.Bool("skip-internal")
			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)

			if !all && id == 0 {
				return fmt.Errorf("please specify either --all or --id")
			}

			ctx := context.WithValue(context.Background(), "fetchData", true)
			if all {
				return fetchAllBookmarks(ctx, bookmarkService, limit, skipInternal)
			} else {
				return fetchSingleBookmark(ctx, bookmarkService, int64(id), skipInternal)
			}
		},
	}
}

func fetchAllBookmarks(ctx context.Context, bookmarkService *bookmarks.BookmarkService, limit int, skipInternal bool) error {
	offset := 0
	for {
		listBookmarks, err := bookmarkService.ListBookmarks(ctx, limit, offset)
		if err != nil {
			return fmt.Errorf("failed to fetch listBookmarks: %w", err)
		}

		if len(listBookmarks) == 0 {
			break // No more listBookmarks to process
		}

		for _, bookmark := range listBookmarks {
			processBookmark(ctx, bookmarkService, bookmark, skipInternal)
		}

		offset += len(listBookmarks)
		fmt.Printf("Processed %d listBookmarks so far...\n", offset)
	}

	fmt.Println("Finished processing all bookmarks.")
	return nil
}

func fetchSingleBookmark(ctx context.Context, bookmarkService *bookmarks.BookmarkService, id int64, skipInternal bool) error {
	bookmark, err := bookmarkService.GetBookmark(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get bookmark: %w", err)
	}
	processBookmark(ctx, bookmarkService, bookmark, skipInternal)
	return nil
}

func processBookmark(ctx context.Context, bookmarkService *bookmarks.BookmarkService, bookmark *models.Bookmark, skipInternal bool) {
	if skipInternal && fetcher.ValidateIfInternalIP(bookmark.URL) {
		fmt.Printf("Skipping internal URL: %s\n", bookmark.URL)
		return
	}
	err := bookmarkService.UpdateBookmark(ctx, bookmark)
	if err != nil {
		fmt.Printf("Error updating bookmark %s: %v\n", bookmark.URL, err)
	} else {
		fmt.Printf("Updated metadata for %s\n", bookmark.URL)
	}
}
