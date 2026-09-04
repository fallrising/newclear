package bookmarks

import (
	"context"
	"fmt"
	"golang.org/x/net/html"
	"strings"
)

func (s *BookmarkService) ExportToHTML(ctx context.Context) (string, error) {
	const pageSize = 100 // Number of bookmarks to fetch per page

	// Get total count of bookmarks
	totalCount, err := s.CountBookmarks(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to count bookmarks: %w", err)
	}

	fmt.Printf("Exporting %d bookmarks to HTML...\n", totalCount)
	exported := 0

	var sb strings.Builder

	// Write HTML header
	sb.WriteString("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n")
	sb.WriteString("<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n")
	sb.WriteString("<TITLE>Bookmarks</TITLE>\n")
	sb.WriteString("<H1>Bookmarks</H1>\n")
	sb.WriteString("<DL><p>\n")

	// Fetch and write bookmarks in batches
	for offset := 0; offset < totalCount; offset += pageSize {
		bookmarks, err := s.ListBookmarks(ctx, pageSize, offset)
		if err != nil {
			return "", fmt.Errorf("failed to fetch bookmarks at offset %d: %w", offset, err)
		}

		for _, bookmark := range bookmarks {
			sb.WriteString(fmt.Sprintf("    <DT><A HREF=\"%s\" ADD_DATE=\"%d\">%s</A>\n",
				html.EscapeString(bookmark.URL),
				bookmark.CreatedAt.Unix(),
				html.EscapeString(bookmark.Title)))

			if bookmark.Description != "" {
				sb.WriteString(fmt.Sprintf("    <DD>%s\n", html.EscapeString(bookmark.Description)))
			}
			exported++
			if exported%50 == 0 || exported == totalCount {
				fmt.Printf("Progress: %d/%d bookmarks exported\n", exported, totalCount)
			}
		}
	}

	// Close HTML
	sb.WriteString("</DL><p>")

	fmt.Printf("Export completed: %d bookmarks exported\n", exported)
	return sb.String(), nil
}
