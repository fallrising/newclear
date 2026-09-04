package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/urfave/cli/v2"
)

func SearchCommand() *cli.Command {
	return &cli.Command{
		Name: "search",
		Usage: "Search bookmarks with pagination\n\n" +
			"Examples:\n" +
			"  goku search --query \"example\"\n" +
			"  goku search -q \"tag:programming\" --limit 20\n" +
			"  goku search --query \"important\" --offset 10 --limit 5",
		Flags: []cli.Flag{
			&cli.StringFlag{Name: "query", Aliases: []string{"q"}, Required: true, Usage: "Search query"},
			&cli.IntFlag{Name: "limit", Value: 10, Usage: "Number of bookmarks to display per page"},
			&cli.IntFlag{Name: "offset", Value: 0, Usage: "Offset to start search results from"},
		},
		Action: func(c *cli.Context) error {
			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
			query := c.String("query")
			limit := c.Int("limit")
			offset := c.Int("offset")

			searchBookmarks, err := bookmarkService.SearchBookmarks(context.Background(), query, limit, offset)
			if err != nil {
				return fmt.Errorf("failed to search bookmarks: %w", err)
			}
			if len(searchBookmarks) == 0 {
				fmt.Println("No bookmarks found matching the query.")
				return nil
			}
			fmt.Printf("Found %d bookmark(s):\n", len(searchBookmarks))
			for _, b := range searchBookmarks {
				fmt.Printf("ID: %d, URL: %s, Title: %s, Tags: %v, Description: %v\n", b.ID, b.URL, b.Title, b.Tags, b.Description)
			}
			return nil
		},
	}
}
