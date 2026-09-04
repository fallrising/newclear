package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/urfave/cli/v2"
	"os"
)

func ExportCommand() *cli.Command {
	return &cli.Command{
		Name: "export",
		Usage: "Export bookmarks to HTML format\n\n" +
			"Examples:\n" +
			"  goku export\n" +
			"  goku export --output bookmarks.html",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:    "output",
				Aliases: []string{"o"},
				Usage:   "Output file path (default: stdout)",
			},
		},
		Action: func(c *cli.Context) error {
			fmt.Println("Exporting bookmarks...")
			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
			html, err := bookmarkService.ExportToHTML(context.Background())
			if err != nil {
				return fmt.Errorf("failed to export bookmarks: %w", err)
			}

			outputPath := c.String("output")
			if outputPath == "" {
				// Write to stdout if no output file specified
				fmt.Println(html)
			} else {
				// Write to file
				err = os.WriteFile(outputPath, []byte(html), 0644)
				if err != nil {
					return fmt.Errorf("failed to write to file: %w", err)
				}
				fmt.Printf("Bookmarks exported to %s\n", outputPath)
			}

			return nil
		},
	}
}
