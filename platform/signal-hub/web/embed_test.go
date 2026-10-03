package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBoardDoesNotReplaceAuthenticatedAPI(t *testing.T) {
	handler := Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	for _, url := range []string{"/v1/events", "/v1/sources", "/assets/missing.js", "/assets/../index.html", "/src/App.tsx", "/unimplemented"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
		if w.Code != 401 {
			t.Errorf("%s bypassed API: %d", url, w.Code)
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/?q=example", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "<html") || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("board unavailable: %d", w.Code)
	}
	if w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("missing browser boundary headers")
	}
}
