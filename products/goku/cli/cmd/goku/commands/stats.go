package commands

import (
	"context"
	"fmt"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/urfave/cli/v2"
	"sort"
)

func StatsCommand() *cli.Command {
	return &cli.Command{
		Name: "stats",
		Usage: "Display bookmark statistics\n\n" +
			"Example:\n" +
			"  goku stats",
		Action: func(c *cli.Context) error {
			bookmarkService := c.App.Metadata["bookmarkService"].(*bookmarks.BookmarkService)
			stats, err := bookmarkService.GetStatistics(context.Background())
			if err != nil {
				return fmt.Errorf("failed to get statistics: %w", err)
			}

			fmt.Println("Bookmark Statistics:")
			fmt.Println("--------------------")

			fmt.Println("\nTop 3 Hostnames:")
			for _, hc := range stats.TopHostnames {
				fmt.Printf("%s: %d\n", hc.Hostname, hc.Count)
			}

			fmt.Println("\nBookmarks by Accessibility:")
			fmt.Printf("Accessible: %d\n", stats.AccessibilityCounts["accessible"])
			fmt.Printf("Inaccessible: %d\n", stats.AccessibilityCounts["inaccessible"])

			fmt.Println("\nTop 5 Tags:")
			sortedTags := make([]string, 0, len(stats.TagCounts))
			for tag := range stats.TagCounts {
				sortedTags = append(sortedTags, tag)
			}
			sort.Slice(sortedTags, func(i, j int) bool {
				return stats.TagCounts[sortedTags[i]] > stats.TagCounts[sortedTags[j]]
			})
			for i := 0; i < 5 && i < len(sortedTags); i++ {
				fmt.Printf("%s: %d\n", sortedTags[i], stats.TagCounts[sortedTags[i]])
			}

			fmt.Println("\nLatest 10 Bookmarks:")
			for _, b := range stats.LatestBookmarks {
				fmt.Printf("%s - %s\n", b.CreatedAt.Format("2006-01-02"), b.Title)
			}

			fmt.Println("\nBookmarks Created in the Last 7 Days:")
			for day, count := range stats.CreatedLastWeek {
				fmt.Printf("%s: %d\n", day, count)
			}

			fmt.Printf("\nTotal Unique Hostnames: %d\n", len(stats.UniqueHostnames))

			return nil
		},
	}
}
