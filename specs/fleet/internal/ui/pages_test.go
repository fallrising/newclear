package ui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/fleet-catalog/internal/db"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/store"
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
