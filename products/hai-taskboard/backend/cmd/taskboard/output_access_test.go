package main

import (
	"bytes"
	"database/sql"
	json "encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

func runtimeOutputSnapshot(t *testing.T, f *workerFixture) []byte {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(f.root, "state", "taskboard.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		t.Fatal(err)
	}
	tables := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	snapshot := map[string][][]any{}
	for _, table := range tables {
		rows, err := db.Query(`SELECT * FROM "` + table + `" ORDER BY rowid`)
		if err != nil {
			t.Fatal(err)
		}
		columns, err := rows.Columns()
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				t.Fatal(err)
			}
			snapshot[table] = append(snapshot[table], values)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if err := rows.Close(); err != nil {
			t.Fatal(err)
		}
	}
	data, err := json.Marshal(snapshot, json.Deterministic(true))
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func runtimeOutputGET(t *testing.T, f *workerFixture, path string) *httptest.ResponseRecorder {
	t.Helper()
	authority, err := newLocalSessionAuthority(testSessionToken, "operator")
	if err != nil {
		t.Fatal(err)
	}
	server, err := httpapi.NewServer(f.worker.commands, httpapi.UnitCommandResults{Unit: f.worker.store}, httpapi.PersistedProjections{Store: f.worker.store}, authority, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: testSessionToken})
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	return w
}
func TestOutputAccessRuntime_ConfinedStoreActualHTTP(t *testing.T) {
	for _, kind := range []string{"valid", "missing", "symlink", "tampered", "empty"} {
		t.Run(kind, func(t *testing.T) {
			f := newWorkerFixture(t)
			if err := f.worker.scan(t.Context()); err != nil {
				t.Fatal(err)
			}
			digest := domain.HashString("local fake result\n")
			path := "/api/v1/projects/" + string(testProjectID) + "/artifacts/sha256:" + digest.String()
			object := filepath.Join(f.root, "artifacts", "sha256", digest.String())
			switch kind {
			case "missing":
				if err := os.Remove(object); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				outside := filepath.Join(privateTestRoot(t), "outside")
				if err := os.WriteFile(outside, []byte("local fake result\n"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(object); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, object); err != nil {
					t.Fatal(err)
				}
			case "tampered":
				if err := os.WriteFile(object, []byte("private tampered data"), 0600); err != nil {
					t.Fatal(err)
				}
			case "empty":
				if err := os.WriteFile(object, nil, 0600); err != nil {
					t.Fatal(err)
				}
			}
			before := runtimeOutputSnapshot(t, f)
			entriesBefore, err := os.ReadDir(filepath.Dir(object))
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				w := runtimeOutputGET(t, f, path)
				if kind == "valid" {
					if w.Code != 200 || w.Body.String() != "local fake result\n" {
						t.Fatal(w.Code, w.Body)
					}
					for name, want := range map[string]string{
						"Content-Type":                 "application/octet-stream",
						"Content-Disposition":          `attachment; filename="` + digest.String() + `.bin"`,
						"ETag":                         `"sha256:` + digest.String() + `"`,
						"Cache-Control":                "no-store",
						"X-Content-Type-Options":       "nosniff",
						"Content-Security-Policy":      "sandbox; default-src 'none'",
						"Cross-Origin-Resource-Policy": "same-origin",
						"Accept-Ranges":                "none",
						"Content-Length":               "18",
					} {
						if got := w.Header().Get(name); got != want {
							t.Fatalf("%s = %q, want %q", name, got, want)
						}
					}
				} else if w.Code != 503 || !strings.Contains(w.Body.String(), "projection_unavailable") || strings.Contains(w.Body.String(), "private") {
					t.Fatal(w.Code, w.Body)
				}
				w = runtimeOutputGET(t, f, "/api/v1/projects/"+string(testProjectID)+"/work-items/wi_0000000001/runs/"+string(f.run)+"/outputs")
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body)
				}
			}
			f.reopen(t)
			w := runtimeOutputGET(t, f, path)
			want := 503
			if kind == "valid" {
				want = 200
			}
			if w.Code != want {
				t.Fatal(w.Code, w.Body)
			}
			if !bytes.Equal(before, runtimeOutputSnapshot(t, f)) {
				t.Fatal("read changed persisted tables")
			}
			entriesAfter, err := os.ReadDir(filepath.Dir(object))
			if err != nil || len(entriesBefore) != len(entriesAfter) {
				t.Fatal("read changed artifact directory", err)
			}
			for i := range entriesBefore {
				if entriesBefore[i].Name() != entriesAfter[i].Name() {
					t.Fatal("read changed artifact names")
				}
			}
		})
	}
}
func TestOutputAccessRuntime_ZeroByteStoreRefusal(t *testing.T) {
	root := privateTestRoot(t)
	store, err := newLocalArtifactStore(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	digest := domain.HashBytes(nil)
	if err := os.WriteFile(filepath.Join(root, digest.String()), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if reader, err := store.Open(t.Context(), digest); err == nil {
		reader.Close()
		t.Fatal("existing confined store unexpectedly permits empty objects")
	}
}
