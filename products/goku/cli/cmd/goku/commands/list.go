package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/urfave/cli/v2"
)

func ListCommand() *cli.Command {
	return &cli.Command{
		Name: "list",
		Usage: "List all bookmarks with pagination\n\n" +
			"Examples:\n" +
			"  goku list\n" +
			"  goku list --limit 20 --offset 40",
		Flags: []cli.Flag{
			&cli.IntFlag{Name: "limit", Value: 10, Usage: "Number of bookmarks to display per page"},
			&cli.IntFlag{Name: "offset", Value: 0, Usage: "Offset to start listing bookmarks from"},
		},
		Action: func(c *cli.Context) error {
			limit := c.Int("limit")
			offset := c.Int("offset")

			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
			listBookmarks, err := bookmarkService.ListBookmarks(context.Background(), limit, offset)
			if err != nil {
				return fmt.Errorf("failed to list listBookmarks: %w", err)
			}
			if len(listBookmarks) == 0 {
				fmt.Println("No listBookmarks found.")
				return nil
			}
			fmt.Printf("Displaying %d bookmark(s):\n", len(listBookmarks))
			for _, b := range listBookmarks {
				fmt.Printf("ID: %d, URL: %s, Title: %s, Tags: %v, Description: %v\n", b.ID, b.URL, b.Title, b.Tags, b.Description)
			}
			return nil
		},
	}
}
