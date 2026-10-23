package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

func TestBrowserSession_BootstrapInspectLogout(t *testing.T) {
	runtime, cancel, client, base, config := startTestRuntime(t, privateTestRoot(t))
	t.Cleanup(func() { client.CloseIdleConnections(); cancel(); waitRuntime(t, runtime) })
	request, _ := http.NewRequestWithContext(t.Context(), "POST", base+"/api/v1/session", strings.NewReader(`{"token":"`+config.SessionToken+`"}`))
	request.Header.Set("Origin", config.Origin)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("bootstrap status=%d body=%s", response.StatusCode, body)
	}
	if strings.Contains(string(body), config.SessionToken) || !strings.Contains(string(body), `"actor":"local-operator"`) {
		t.Fatalf("unexpected session response: %s", body)
	}
	cookies := response.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies=%d", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != httpapi.SessionCookieName || !cookie.Secure || !cookie.HttpOnly || cookie.Path != "/" || cookie.Domain != "" || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("insecure session cookie attributes")
	}
	for _, method := range []string{"GET", "DELETE"} {
		request, _ := http.NewRequestWithContext(t.Context(), method, base+"/api/v1/session", nil)
		request.Header.Set("Origin", config.Origin)
		request.AddCookie(cookie)
		result, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		result.Body.Close()
		if result.StatusCode != 200 {
			t.Fatalf("%s status=%d", method, result.StatusCode)
		}
		if method == "DELETE" && (len(result.Cookies()) != 1 || result.Cookies()[0].MaxAge >= 0 || !result.Cookies()[0].Secure) {
			t.Fatal("logout must expire matching Secure cookie")
		}
	}
}

func TestBrowserStatic_ExplicitEntryAssets(t *testing.T) {
	root := privateTestRoot(t)
	web := filepath.Join(root, "web")
	if err := os.MkdirAll(filepath.Join(web, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	for path, body := range map[string]string{"index.html": `<!doctype html><script type="module" src="/assets/main-123.js"></script><link rel="stylesheet" href="/assets/main-123.css">`, "assets/main-123.js": "console.log('shell')", "assets/main-123.css": "body{}", "secret.txt": "private"} {
		if err := os.WriteFile(filepath.Join(web, path), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	env := map[string]string{"HAI_TASKBOARD_DATA_ROOT": filepath.Join(root, "data"), "HAI_TASKBOARD_ORIGIN": "http://" + address, "HAI_TASKBOARD_LISTEN_ADDR": address, "HAI_TASKBOARD_SESSION_TOKEN": testSessionToken, "HAI_TASKBOARD_WEB_ROOT": web}
	config, err := loadRuntimeConfig(func(k string) string { return env[k] }, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	runtime, err := startRuntime(ctx, config, listener)
	if err != nil {
		cancel()
		listener.Close()
		t.Fatal(err)
	}
	client := &http.Client{Transport: &http.Transport{Proxy: nil}}
	t.Cleanup(func() { client.CloseIdleConnections(); cancel(); waitRuntime(t, runtime) })
	for _, path := range []string{"/", "/index.html", "/assets/main-123.js", "/assets/main-123.css"} {
		request, _ := http.NewRequestWithContext(t.Context(), "GET", "http://"+address+path, nil)
		requireHTTPBody(t, client, request, 200)
	}
	for _, path := range []string{"/secret.txt", "/assets/", "/assets/missing.js", "/api/v1/missing", "/other"} {
		request, _ := http.NewRequestWithContext(t.Context(), "GET", "http://"+address+path, nil)
		requireHTTPBody(t, client, request, 404)
	}
}

func TestBrowserSession_RejectsUntrustedRequests(t *testing.T) {
	authority, err := newLocalSessionAuthority(testSessionToken, "local-operator")
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://127.0.0.1:18080"
	handler := runtimeHTTPHandler{host: "127.0.0.1:18080", origin: origin, authority: authority}
	validBody := `{"token":"` + testSessionToken + `"}`
	cases := []struct {
		name, method, body string
		status             int
		mutate             func(*http.Request)
	}{
		{"missing origin", "POST", validBody, 403, func(r *http.Request) { r.Header.Del("Origin") }},
		{"wrong origin", "POST", validBody, 403, func(r *http.Request) { r.Header.Set("Origin", "http://attacker.invalid") }},
		{"duplicate origin", "POST", validBody, 403, func(r *http.Request) { r.Header.Add("Origin", origin) }},
		{"wrong host", "POST", validBody, 403, func(r *http.Request) { r.Host = "attacker.invalid" }},
		{"host alias", "POST", validBody, 403, func(r *http.Request) { r.Host = "localhost:18080" }},
		{"duplicate content type", "POST", validBody, 400, func(r *http.Request) { r.Header.Add("Content-Type", "application/json") }},
		{"encoding", "POST", validBody, 400, func(r *http.Request) { r.Header.Set("Content-Encoding", "gzip") }},
		{"wrong type", "POST", validBody, 400, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }},
		{"unknown member", "POST", `{"token":"` + testSessionToken + `","actor":"admin"}`, 400, nil},
		{"duplicate member", "POST", `{"token":"` + testSessionToken + `","token":"` + testSessionToken + `"}`, 400, nil},
		{"case member", "POST", `{"Token":"` + testSessionToken + `"}`, 400, nil},
		{"trailing object", "POST", validBody + `{}`, 400, nil},
		{"null", "POST", `null`, 400, nil},
		{"weak token", "POST", `{"token":"bad"}`, 400, nil},
		{"wrong strong token", "POST", `{"token":"wrRMiu6-SwxUHrSDR2y1g7OVqiinGSbIg4u-KjMT0YY"}`, 401, nil},
		{"oversized", "POST", strings.Repeat(" ", 2049), 413, nil},
		{"absent cookie", "GET", "", 401, nil},
		{"duplicate cookie", "GET", "", 401, func(r *http.Request) {
			r.Header.Set("Cookie", httpapi.SessionCookieName+"="+testSessionToken+"; "+httpapi.SessionCookieName+"="+testSessionToken)
		}},
		{"duplicate cookie headers", "GET", "", 401, func(r *http.Request) {
			r.Header.Add("Cookie", httpapi.SessionCookieName+"="+testSessionToken)
			r.Header.Add("Cookie", httpapi.SessionCookieName+"="+testSessionToken)
		}},
		{"logout origin", "DELETE", "", 403, func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: testSessionToken})
			r.Header.Del("Origin")
		}},
		{"query", "POST", validBody, 400, func(r *http.Request) { r.URL.RawQuery = "token=untrusted" }},
		{"encoded path", "POST", validBody, 400, func(r *http.Request) { r.URL.RawPath = "/api/v1/%73ession" }},
		{"method", "PUT", validBody, 405, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, origin+"/api/v1/session", strings.NewReader(tc.body))
			request.Header.Set("Origin", origin)
			request.Header.Set("Content-Type", "application/json")
			if tc.mutate != nil {
				tc.mutate(request)
			}
			result := httptest.NewRecorder()
			handler.ServeHTTP(result, request)
			if result.Code != tc.status {
				t.Fatalf("status=%d want%d body=%s", result.Code, tc.status, result.Body)
			}
			if result.Header().Get("Set-Cookie") != "" || strings.Contains(result.Body.String(), testSessionToken) || result.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("rejection leaked a credential or omitted no-store")
			}
		})
	}
	for _, path := range []string{"/healthz", "/api/v1/projects", "/"} {
		request := httptest.NewRequest("GET", origin+path, nil)
		request.Host = "attacker.invalid"
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, request)
		if result.Code != 403 {
			t.Fatalf("Host guard failed for %s", path)
		}
	}
}

func TestBrowserStatic_RejectsUnsafeBuildsAndFreezesBytes(t *testing.T) {
	for _, mode := range []string{"root symlink", "asset symlink", "asset hardlink", "asset parent symlink", "untrusted mode", "traversal reference", "oversized index", "private runtime overlap"} {
		t.Run(mode, func(t *testing.T) {
			parent := privateTestRoot(t)
			web := filepath.Join(parent, "web")
			data := filepath.Join(parent, "data")
			if err := os.MkdirAll(filepath.Join(web, "assets"), 0700); err != nil {
				t.Fatal(err)
			}
			index := `<script src="/assets/main.js"></script>`
			if mode == "traversal reference" {
				index = `<script src="/assets/../secret.js"></script>`
			}
			if mode == "oversized index" {
				index = strings.Repeat("x", maximumIndexBytes+1)
			}
			if err := os.WriteFile(filepath.Join(web, "index.html"), []byte(index), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(web, "assets/main.js"), []byte("safe"), 0600); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "root symlink":
				if err := os.Symlink(web, filepath.Join(parent, "link")); err != nil {
					t.Fatal(err)
				}
				web = filepath.Join(parent, "link")
			case "asset symlink":
				os.Remove(filepath.Join(web, "assets/main.js"))
				if err := os.Symlink(filepath.Join(web, "index.html"), filepath.Join(web, "assets/main.js")); err != nil {
					t.Fatal(err)
				}
			case "asset hardlink":
				if err := os.Link(filepath.Join(web, "assets/main.js"), filepath.Join(parent, "linked-private")); err != nil {
					t.Fatal(err)
				}
			case "asset parent symlink":
				os.Rename(filepath.Join(web, "assets"), filepath.Join(web, "real-assets"))
				if err := os.Symlink("real-assets", filepath.Join(web, "assets")); err != nil {
					t.Fatal(err)
				}
			case "untrusted mode":
				if err := os.Chmod(filepath.Join(web, "assets/main.js"), 0666); err != nil {
					t.Fatal(err)
				}
			case "private runtime overlap":
				data = web
			}
			if _, err := loadBrowserAssets(web, data); err == nil {
				t.Fatal("unsafe build accepted")
			}
		})
	}
	parent := privateTestRoot(t)
	web := filepath.Join(parent, "web")
	os.MkdirAll(filepath.Join(web, "assets"), 0700)
	os.WriteFile(filepath.Join(web, "index.html"), []byte(`<script src="/assets/main.js"></script>`), 0600)
	os.WriteFile(filepath.Join(web, "assets/main.js"), []byte("original"), 0600)
	assets, err := loadBrowserAssets(web, filepath.Join(parent, "data"))
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(web, "assets/main.js"), []byte("mutated"), 0600)
	request := httptest.NewRequest("GET", "http://127.0.0.1:18080/assets/main.js", nil)
	result := httptest.NewRecorder()
	assets.serve(result, request)
	if result.Body.String() != "original" {
		t.Fatal("runtime re-read mutable asset bytes")
	}
	if result.Header().Get("X-Content-Type-Options") != "nosniff" || result.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("missing static security headers")
	}
}
