package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/urfave/cli/v2"
)

func TagsCommand() *cli.Command {
	return &cli.Command{
		Name: "tags",
		Usage: "Manage tags for bookmarks\n\n" +
			"Examples:\n" +
			"  goku tags list\n" +
			"  goku tags remove --id 123 --tag oldtag",
		Subcommands: []*cli.Command{
			{
				Name:  "remove",
				Usage: "Remove a tag from a bookmark",
				Flags: []cli.Flag{
					&cli.Int64Flag{Name: "id", Required: true, Usage: "Bookmark ID"},
					&cli.StringFlag{Name: "tag", Required: true, Usage: "Tag to remove"},
				},
				Action: func(c *cli.Context) error {
					bookmarkID := c.Int64("id")
					tag := c.String("tag")
					bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)

					err := bookmarkService.RemoveTagFromBookmark(context.Background(), bookmarkID, tag)
					if err != nil {
						return fmt.Errorf("failed to remove tag: %w", err)
					}
					fmt.Println("Tag removed successfully")
					return nil
				},
			},
			{
				Name:  "list",
				Usage: "List all unique tags",
				Action: func(c *cli.Context) error {
					bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
					tags, err := bookmarkService.ListAllTags(context.Background())
					if err != nil {
						return fmt.Errorf("failed to list tags: %w", err)
					}
					if len(tags) == 0 {
						fmt.Println("No tags found.")
						return nil
					}
					fmt.Println("Tags:")
					for _, tag := range tags {
						fmt.Println(" -", tag)
					}
					return nil
				},
			},
		},
	}
}
