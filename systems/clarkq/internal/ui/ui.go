// Package ui serves the embedded admin console.
package ui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed index.html
var content embed.FS

// Handler returns an http.Handler for /ui and /ui/.
// The page is public; API calls from the browser use the user's API key.
func Handler() http.Handler {
	file, err := content.ReadFile("index.html")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "ui not available", http.StatusInternalServerError)
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Normalize: only GET
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		path := r.URL.Path
		if path == "/ui" {
			http.Redirect(w, r, "/ui/", http.StatusFound)
			return
		}
		if path != "/ui/" && !strings.HasPrefix(path, "/ui/") {
			http.NotFound(w, r)
			return
		}
		// SPA single file
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(file)
	})
}

// FS exposes the embedded filesystem (for tests).
func FS() fs.FS { return content }
