package commands

import (
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/urfave/cli/v2"
)

func PurgeCommand() *cli.Command {
	return &cli.Command{
		Name: "purge",
		Usage: "Delete all bookmarks from the database\n\n" +
			"Examples:\n" +
			"  goku purge\n" +
			"  goku purge --force",
		Flags: []cli.Flag{
			&cli.BoolFlag{
				Name:  "force",
				Usage: "Force purge without confirmation",
			},
		},
		Action: func(c *cli.Context) error {
			if !c.Bool("force") {
				fmt.Print("Are you sure you want to purge all bookmarks? This action cannot be undone. (y/N): ")
				var response string
				fmt.Scanln(&response)
				if response != "y" && response != "Y" {
					fmt.Println("Purge operation cancelled.")
					return nil
				}
			}

			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
			err := bookmarkService.PurgeBookmarks(c.Context)
			if err != nil {
				return fmt.Errorf("failed to purge bookmarks: %w", err)
			}

			fmt.Println("All bookmarks have been purged successfully.")
			return nil
		},
	}
}
