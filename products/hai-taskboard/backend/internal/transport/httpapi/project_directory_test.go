package httpapi

import (
	json "encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
)

func TestConnectedProjects_DurableDirectory(t *testing.T) {
	root := t.TempDir()
	store, err := sqlite.OpenAtRootWithClock(t.Context(), root, filepath.Join(root, "state.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	authority := &authorityStub{}
	server, err := NewServer(&commandStub{}, &resultStub{}, PersistedProjections{Store: store}, authority, NewHub(), Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	get := func(path string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if authenticated {
			addSession(r)
		}
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		return w
	}
	if w := get("/api/v1/projects", true); w.Code != 200 {
		t.Fatalf("durable project directory unavailable: %d %s", w.Code, w.Body.String())
	}
	ids := []domain.ProjectID{"prj_0000000002", "prj_0000000001"}
	for _, id := range ids {
		if err := store.Within(t.Context(), func(tx port.Transaction) error {
			return tx.CreateProject(t.Context(), port.Project{ID: id, Name: string(id), Repository: "display hint", Ref: "main", Version: 1})
		}); err != nil {
			t.Fatal(err)
		}
	}
	var list struct {
		APIVersion string `json:"api_version"`
		Items      []struct {
			ID         domain.ProjectID `json:"project_id"`
			Repository struct {
				Binding *string `json:"binding_id"`
			} `json:"repository"`
		} `json:"items"`
		Cursor projectionCursor `json:"cursor"`
	}
	w := get("/api/v1/projects", true)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil || len(list.Items) != 2 || list.Items[0].ID != ids[1] || list.Items[0].Repository.Binding != nil || list.Cursor.StreamEpoch == 0 {
		t.Fatalf("directory %d %s", w.Code, w.Body.String())
	}
	if get("/api/v1/projects", false).Code != 401 {
		t.Fatal("unauthenticated directory")
	}
	if get("/api/v1/projects/"+string(ids[0]), true).Code != 200 {
		t.Fatal("project open unavailable")
	}
	authority.projectErr = ErrPermissionDenied
	if get("/api/v1/projects/"+string(ids[0]), true).Code != 404 {
		t.Fatal("project denial leaked")
	}
	w = get("/api/v1/projects", true)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil || len(list.Items) != 0 {
		t.Fatal("denied project listed")
	}
}
