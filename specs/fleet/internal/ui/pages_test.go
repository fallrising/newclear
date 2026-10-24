package ui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/specs/fleet/internal/db"
	"github.com/fallrising/newclear/specs/fleet/internal/model"
	"github.com/fallrising/newclear/specs/fleet/internal/store"
)

func TestCatalogRenders(t *testing.T) {
	sqldb, err := db.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	st := store.New(sqldb)
	st.Now = func() time.Time { return time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC) }
	if err := st.CreateNode(&model.Node{ID: "vps-a"}); err != nil {
		t.Fatal(err)
	}
	if err := st.InsertService(&model.Service{
		Name: "hello", NodeID: "vps-a", Hostname: "hello.example.com", URL: "https://hello.example.com",
		ExposeMode: "public", DesiredState: "running", HostPort: 20001, ContainerPort: 8080,
		FleetJSON: "{}", IngressStatus: "na",
	}); err != nil {
		t.Fatal(err)
	}
	p, err := New(st)
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	p.Catalog(rr, httptest.NewRequest(http.MethodGet, "/", nil))
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "hello") || !strings.Contains(body, "htmx.min.js") {
		t.Fatal(body)
	}
	if !strings.Contains(body, "/api/v1/services/hello/stop") {
		t.Fatal("missing stop action")
	}
	rr = httptest.NewRecorder()
	p.ServiceRow(rr, httptest.NewRequest(http.MethodGet, "/", nil), "hello")
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `id="row-hello"`) {
		t.Fatal(rr.Body.String())
	}
}

func TestServiceRollbackButton(t *testing.T) {
	sqldb, err := db.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	st := store.New(sqldb)
	st.Now = func() time.Time { return time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC) }
	if err := st.CreateNode(&model.Node{ID: "vps-a"}); err != nil {
		t.Fatal(err)
	}
	if err := st.InsertService(&model.Service{
		Name: "hello", NodeID: "vps-a", Hostname: "hello.example.com",
		ExposeMode: "public", DesiredState: "running", HostPort: 20001, ContainerPort: 8080,
		FleetJSON: "{}", IngressStatus: "na", CurrentReleaseID: "rel_current",
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.InsertRelease(&model.Release{ID: "rel_old", Service: "hello", Image: "img:old", GitSHA: "aaa"}); err != nil {
		t.Fatal(err)
	}
	p, err := New(st)
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	p.Service(rr, httptest.NewRequest(http.MethodGet, "/services/hello", nil), "hello")
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Rollback") {
		t.Fatal(rr.Body.String())
	}
}

func TestStaticHTMX(t *testing.T) {
	sqldb, err := db.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	p, err := New(store.New(sqldb))
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	p.Static().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/static/htmx.min.js", nil))
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), "htmx") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String()[:min(80, rr.Body.Len())])
	}
}

// reviewPages exercises the real templates with both populated and empty state.
func reviewPages(t *testing.T) *Pages {
	t.Helper()
	database, err := db.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	st := store.New(database)
	for _, id := range []string{"vps-fe-1", "vps-empty"} {
		if err := st.CreateNode(&model.Node{ID: id}); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"hello", "empty"} {
		svc := &model.Service{Name: name, NodeID: "vps-fe-1", Hostname: name + ".fleet.invalid", ExposeMode: "public", DesiredState: "running", ContainerPort: 8080, FleetJSON: "{}", IngressStatus: "na"}
		if name == "hello" {
			svc.CurrentReleaseID = "rel_current"
		}
		if err := st.InsertService(svc); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.InsertRelease(&model.Release{ID: "rel_old", Service: "hello", Image: "review:old", GitSHA: "abc"}); err != nil {
		t.Fatal(err)
	}
	p, err := New(st)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func reviewRender(t *testing.T, render func(http.ResponseWriter, *http.Request)) string {
	t.Helper()
	rr := httptest.NewRecorder()
	render(rr, httptest.NewRequest(http.MethodGet, "/", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("render status %d", rr.Code)
	}
	return rr.Body.String()
}

func TestReviewResponsiveTableSemantics(t *testing.T) {
	p := reviewPages(t)
	pages := map[string]func(http.ResponseWriter, *http.Request){
		"catalog": p.Catalog,
		"node":    func(w http.ResponseWriter, r *http.Request) { p.Node(w, r, "vps-fe-1") },
		"service": func(w http.ResponseWriter, r *http.Request) { p.Service(w, r, "hello") },
		"login":   p.Login,
	}
	for name, render := range pages {
		t.Run(name, func(t *testing.T) {
			body := reviewRender(t, render)
			if !strings.Contains(body, `name="viewport" content="width=device-width, initial-scale=1"`) {
				t.Error("missing responsive viewport")
			}
			if name == "login" {
				return
			}
			for _, marker := range []string{`class="table-scroll"`, `<caption`, `scope="col"`} {
				if !strings.Contains(body, marker) {
					t.Errorf("missing table semantics %s", marker)
				}
			}
		})
	}
}

func TestReviewPollingAndActions(t *testing.T) {
	p := reviewPages(t)
	catalog := reviewRender(t, p.Catalog)
	if strings.Contains(catalog, `http-equiv="refresh"`) {
		t.Error("catalog must use htmx polling only")
	}
	for _, marker := range []string{`id="catalog"`, `hx-select="table"`, `hx-trigger="every 15s"`, `id="act-hello-toggle"`, `id="act-hello-redeploy"`, `aria-label="Stop hello"`, `hx-disabled-elt="this"`} {
		if !strings.Contains(catalog, marker) {
			t.Errorf("catalog lost required contract %s", marker)
		}
	}
	fragment := reviewRender(t, func(w http.ResponseWriter, r *http.Request) { p.ServiceRow(w, r, "hello") })
	if !strings.HasPrefix(strings.TrimSpace(fragment), `<tr id="row-hello" hx-select="#row-hello">`) {
		t.Error("row fragment root changed")
	}
	service := reviewRender(t, func(w http.ResponseWriter, r *http.Request) { p.Service(w, r, "hello") })
	if strings.Contains(service, `hx-refresh=`) || !strings.Contains(service, `hx-swap="none"`) {
		t.Error("service action must not swap response into the button")
	}
	if !strings.Contains(service, `aria-label="Rollback hello to rel_old"`) {
		t.Error("rollback has no object-specific accessible name")
	}
	node := reviewRender(t, func(w http.ResponseWriter, r *http.Request) { p.Node(w, r, "vps-fe-1") })
	for _, body := range []string{node, service} {
		if !strings.Contains(body, `http-equiv="refresh" content="15"`) {
			t.Error("nonpolling page lost its refresh")
		}
	}
	if !strings.Contains(node, `class="health-offline-node"`) {
		t.Error("node health lacks shared status class")
	}
}

func TestReviewEmptyStates(t *testing.T) {
	p := reviewPages(t)
	node := reviewRender(t, func(w http.ResponseWriter, r *http.Request) { p.Node(w, r, "vps-empty") })
	for _, text := range []string{"No services on this node.", "No facts reported yet."} {
		if !strings.Contains(node, text) {
			t.Errorf("missing %q", text)
		}
	}
	service := reviewRender(t, func(w http.ResponseWriter, r *http.Request) { p.Service(w, r, "empty") })
	for _, text := range []string{"No releases yet.", "No instance reported yet.", "No audit entries."} {
		if !strings.Contains(service, text) {
			t.Errorf("missing %q", text)
		}
	}
}

func TestReviewRollbackJSONAndErrorAlert(t *testing.T) {
	p := reviewPages(t)
	service := reviewRender(t, func(w http.ResponseWriter, r *http.Request) { p.Service(w, r, "hello") })
	for _, marker := range []string{`hx-ext="json-body"`, `id="flash" role="alert" hidden`, `encodeParameters`, `JSON.stringify`, `.textContent`} {
		if !strings.Contains(service, marker) {
			t.Errorf("missing browser contract %s", marker)
		}
	}
	if strings.Contains(service, `hx-headers=`) {
		t.Error("JSON content type alone must not masquerade as JSON encoding")
	}
}
