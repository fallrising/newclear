package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/fallrising/goku-cli/pkg/models"
	"github.com/urfave/cli/v2"
)

func AddCommand() *cli.Command {
	return &cli.Command{
		Name:        "add",
		Usage:       "Add a new bookmark",
		Description: "Add a new bookmark to the database. If title, description, or tags are not provided, Goku will attempt to fetch this information from the webpage.",

		Flags: []cli.Flag{
			&cli.StringFlag{Name: "url", Required: true},
			&cli.StringFlag{Name: "title"},
			&cli.StringFlag{Name: "description"},
			&cli.StringSliceFlag{Name: "tags"},
			&cli.BoolFlag{
				Name:    "fetch",
				Aliases: []string{"F"},
				Usage: "Add a new bookmark\n\n" +
					"Examples:\n" +
					"  goku add --url https://example.com\n" +
					"  goku add --url https://example.com --title \"Example Site\" --tags tag1,tag2\n" +
					"  goku add --url https://example.com --fetch",
				Value: false, // Disabled by default
			},
		},
		ArgsUsage: "<url>",
		Action: func(c *cli.Context) error {
			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
			bookmark := &models.Bookmark{
				URL:         c.String("url"),
				Title:       c.String("title"),
				Description: c.String("description"),
				Tags:        c.StringSlice("tags"),
			}
			fetchData := c.Bool("fetch")
			ctx := context.WithValue(context.Background(), "fetchData", fetchData)
			err := bookmarkService.CreateBookmark(ctx, bookmark)
			if err != nil {
				return fmt.Errorf("failed to add bookmark: %w", err)
			}
			fmt.Printf("Bookmark added successfully with ID: %d\n", bookmark.ID)
			return nil
		},
	}
}
