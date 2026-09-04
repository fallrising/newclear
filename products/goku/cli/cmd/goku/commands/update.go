package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/fallrising/goku-cli/pkg/models"
	"github.com/urfave/cli/v2"
)

func UpdateCommand() *cli.Command {
	return &cli.Command{
		Name: "update",
		Usage: "Search bookmarks with pagination\n\n" +
			"Examples:\n" +
			"  goku search --query \"example\"\n" +
			"  goku search -q \"tag:programming\" --limit 20\n" +
			"  goku search --query \"important\" --offset 10 --limit 5",
		Flags: []cli.Flag{
			&cli.Int64Flag{Name: "id", Required: true},
			&cli.StringFlag{Name: "url"},
			&cli.StringFlag{Name: "title"},
			&cli.StringFlag{Name: "description"},
			&cli.StringSliceFlag{Name: "tags"},
			&cli.BoolFlag{
				Name:    "fetch",
				Aliases: []string{"F"},
				Usage:   "Enable fetching additional data for each bookmark",
				Value:   false, // Disabled by default
			},
		},
		Action: func(c *cli.Context) error {
			bookmark := &models.Bookmark{
				ID:          c.Int64("id"),
				URL:         c.String("url"),
				Title:       c.String("title"),
				Description: c.String("description"),
				Tags:        c.StringSlice("tags"),
			}
			fetchData := c.Bool("fetch")
			ctx := context.WithValue(context.Background(), "fetchData", fetchData)
			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
			err := bookmarkService.UpdateBookmark(ctx, bookmark)
			if err != nil {
				return fmt.Errorf("failed to update bookmark: %w", err)
			}
			fmt.Println("Bookmark updated successfully")
			return nil
		},
	}
}
