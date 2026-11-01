// Package web serves the compiled read-only board from the Go binary.
package web

import (
	"bytes"
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed dist
var assets embed.FS

// Handler serves only the board shell and compiled assets. API requests always
// reach the authenticated API handler; unknown paths never become HTML.
func Handler(api http.Handler) http.Handler {
	files, err := fs.Sub(assets, "dist")
	if err != nil {
		panic("embedded board assets missing")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			api.ServeHTTP(w, r)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if r.URL.Path == "/" {
			name = "index.html"
		} else if !strings.HasPrefix(r.URL.Path, "/assets/") || !fs.ValidPath(name) {
			api.ServeHTTP(w, r)
			return
		}
		body, err := fs.ReadFile(files, name)
		if err != nil {
			api.ServeHTTP(w, r)
			return
		}
		contentType := mime.TypeByExtension(path.Ext(name))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		if name == "index.html" {
			w.Header().Set("Cache-Control", "no-store")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(body))
	})
}
