package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/db"
	"github.com/fallrising/fleet-catalog/internal/ingress"
	"github.com/fallrising/fleet-catalog/internal/store"
	"github.com/fallrising/fleet-catalog/internal/token"
	"github.com/fallrising/fleet-catalog/internal/ui"
)

type testEnv struct {
	s      *Server
	op     string
	bs     string
	st     *store.Store
	now    time.Time
}

func newTest(t *testing.T) *testEnv {
	t.Helper()
	sqldb, err := db.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqldb.Close() })
	st := store.New(sqldb)
	st.Now = func() time.Time { return time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC) }
	op, err := token.Generate(token.KindOperator)
	if err != nil {
		t.Fatal(err)
	}
	bs, err := token.Generate(token.KindBootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.EnsureBootstrapTokens(op.Plain, bs.Plain); err != nil {
		t.Fatal(err)
	}
	cfg := config.Fleetd{
		Listen:             "127.0.0.1:18765",
		UIHostname:         "fleet.example.com",
		APIHostname:        "fleet-api.example.com",
		BaseDomain:         "example.com",
		AllowedSuffixes:    []string{"example.com"},
		ProtectedHostnames: []string{"fleet.example.com", "fleet-api.example.com"},
	}
	s := New(cfg, st, ingress.Noop{}, nil)
	s.now = st.Now
	return &testEnv{s: s, op: op.Plain, bs: bs.Plain, st: st, now: st.Now()}
}

func (e *testEnv) do(t *testing.T, method, path, host, bearer string, cookie string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		switch b := body.(type) {
		case string:
			rdr = strings.NewReader(b)
		case []byte:
			rdr = bytes.NewReader(b)
		default:
			buf, err := json.Marshal(b)
			if err != nil {
				t.Fatal(err)
			}
			rdr = bytes.NewReader(buf)
		}
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Host = host
	req.Header.Set("Host", host)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: config.CookieName, Value: cookie})
	}
	rr := httptest.NewRecorder()
	e.s.ServeHTTP(rr, req)
	return rr
}

func (e *testEnv) register(t *testing.T, id string) string {
	t.Helper()
	rr := e.do(t, http.MethodPost, "/api/v1/nodes/register", "fleet-api.example.com", e.bs, "", map[string]any{
		"id": id, "display_name": id, "agent_instance_id": "inst-" + id,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("register %s: %d %s", id, rr.Code, rr.Body.String())
	}
	var out struct {
		AgentToken string `json:"agent_token"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.AgentToken
}

func TestHealthzUnauth(t *testing.T) {
	e := newTest(t)
	rr := e.do(t, http.MethodGet, "/healthz", "fleet-api.example.com", "", "", nil)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"role":"fleetd"`) {
		t.Fatal(rr.Body.String())
	}
}

func TestNoHTMLOnAPIHost(t *testing.T) {
	e := newTest(t)
	rr := e.do(t, http.MethodGet, "/", "fleet-api.example.com", e.op, "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("ct %s", ct)
	}
	if strings.Contains(rr.Body.String(), "<html") || strings.Contains(rr.Body.String(), "<!doctype") {
		t.Fatal("leaked HTML")
	}
	rr = e.do(t, http.MethodGet, "/login", "fleet-api.example.com", "", "", nil)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("login api host %d", rr.Code)
	}
}

func TestCookieLoginAndCatalog(t *testing.T) {
	e := newTest(t)
	rr := e.do(t, http.MethodGet, "/", "fleet.example.com", "", "", nil)
	if rr.Code != 401 || !strings.Contains(rr.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("%d %s %s", rr.Code, rr.Header().Get("Content-Type"), rr.Body.String())
	}
	rr = e.do(t, http.MethodPost, "/login", "fleet.example.com", "", "", map[string]string{"token": e.op})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	got := rr.Result().Cookies()
	if len(got) == 0 || got[0].Name != config.CookieName {
		t.Fatalf("cookies %v", got)
	}
	rr = e.do(t, http.MethodGet, "/", "fleet.example.com", "", got[0].Value, nil)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), "catalog") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}

func TestHostnameProtected(t *testing.T) {
	e := newTest(t)
	_ = e.register(t, "vps-hel-1")
	doc := map[string]any{
		"apiVersion": "fleet.catalog/v1", "kind": "Service",
		"metadata": map[string]any{"name": "takeover"},
		"spec": map[string]any{
			"node": "vps-hel-1", "image": "ghcr.io/fallrising/hello:1",
			"expose": map[string]any{"mode": "public", "hostname": "fleet.example.com", "port": 8080},
		},
	}
	rr := e.do(t, http.MethodPost, "/api/v1/services", "fleet-api.example.com", e.op, "", doc)
	if rr.Code != 400 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "hostname_protected") {
		t.Fatal(rr.Body.String())
	}
}

func TestRegisterHeartbeatCreateDeployDesiredMoveAck(t *testing.T) {
	e := newTest(t)
	agA := e.register(t, "vps-a")
	agB := e.register(t, "vps-b")

	rr := e.do(t, http.MethodPost, "/api/v1/nodes/vps-a/heartbeat", "fleet-api.example.com", agA, "", map[string]any{
		"agent_instance_id": "inst-vps-a", "agent_version": "0.1.0",
		"facts": map[string]any{"ncpu": 2, "load1": 0.1, "mem_total_mb": 1000, "mem_used_mb": 100, "mem_used_pct": 10, "disk_root_used_pct": 20, "docker_ok": true},
	})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}

	hello, err := os.ReadFile("../../examples/hello-healthz/fleet.yaml")
	if err != nil {
		t.Fatal(err)
	}
	// convert yaml via deploy JSON
	fleet := map[string]any{
		"apiVersion": "fleet.catalog/v1", "kind": "Service",
		"metadata": map[string]any{"name": "hello", "description": "hi"},
		"spec": map[string]any{
			"node": "vps-a",
			"expose": map[string]any{"mode": "public", "hostname": "hello.example.com", "port": 8080, "healthPath": "/healthz"},
			"env": map[string]string{"LOG_LEVEL": "info"},
			"resources": map[string]string{"memory": "64M", "cpus": "0.10"},
		},
	}
	rr = e.do(t, http.MethodPost, "/api/v1/deploy", "fleet-api.example.com", e.op, "", map[string]any{
		"fleet": fleet, "image": "ghcr.io/fallrising/hello-healthz:aaa", "git_sha": "aaa", "git_repo": "fallrising/hello-healthz",
	})
	if rr.Code != 201 {
		t.Fatalf("deploy create %d %s", rr.Code, rr.Body.String())
	}
	_ = hello

	rr = e.do(t, http.MethodGet, "/api/v1/agent/desired", "fleet-api.example.com", agA, "", nil)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var des struct {
		Services []struct {
			Name         string `json:"name"`
			DesiredState string `json:"desired_state"`
			HostPort     int    `json:"host_port"`
			Generation   int64  `json:"generation"`
		} `json:"services"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &des); err != nil {
		t.Fatal(err)
	}
	if len(des.Services) != 1 || des.Services[0].Name != "hello" || des.Services[0].DesiredState != "running" {
		t.Fatalf("%+v", des)
	}
	oldPort := des.Services[0].HostPort
	oldGen := des.Services[0].Generation

	// uninstall absent
	rr = e.do(t, http.MethodDelete, "/api/v1/services/hello", "fleet-api.example.com", e.op, "", nil)
	if rr.Code != 202 {
		t.Fatal(rr.Body.String())
	}
	rr = e.do(t, http.MethodGet, "/api/v1/agent/desired", "fleet-api.example.com", agA, "", nil)
	_ = json.Unmarshal(rr.Body.Bytes(), &des)
	if des.Services[0].DesiredState != "absent" {
		t.Fatalf("%+v", des)
	}
	rr = e.do(t, http.MethodPost, "/api/v1/deploy", "fleet-api.example.com", e.op, "", map[string]any{
		"fleet": fleet, "image": "ghcr.io/fallrising/hello-healthz:bbb",
	})
	if rr.Code != 409 || !strings.Contains(rr.Body.String(), "tombstone_pending") {
		t.Fatalf("want 409 tombstone_pending got %d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodPost, "/api/v1/agent/actual", "fleet-api.example.com", agA, "", map[string]any{
		"node_id": "vps-a", "agent_instance_id": "inst-vps-a",
		"services": []map[string]any{{"name": "hello", "applied_generation": oldGen + 1, "actual_state": "absent"}},
	})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}

	// recreate then move
	fleet["spec"].(map[string]any)["node"] = "vps-a"
	rr = e.do(t, http.MethodPost, "/api/v1/deploy", "fleet-api.example.com", e.op, "", map[string]any{
		"fleet": fleet, "image": "ghcr.io/fallrising/hello-healthz:ccc",
	})
	if rr.Code != 201 {
		t.Fatalf("recreate %d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodGet, "/api/v1/agent/desired", "fleet-api.example.com", agA, "", nil)
	_ = json.Unmarshal(rr.Body.Bytes(), &des)
	oldPort = des.Services[0].HostPort

	put := map[string]any{
		"apiVersion": "fleet.catalog/v1", "kind": "Service",
		"metadata": map[string]any{"name": "hello", "description": "hi"},
		"spec": map[string]any{
			"node":  "vps-b",
			"image": "ghcr.io/fallrising/hello-healthz:ccc",
			"expose": map[string]any{"mode": "public", "hostname": "hello.example.com", "port": 8080, "healthPath": "/healthz"},
		},
	}
	rr = e.do(t, http.MethodPut, "/api/v1/services/hello", "fleet-api.example.com", e.op, "", put)
	if rr.Code != 200 {
		t.Fatalf("move %d %s", rr.Code, rr.Body.String())
	}

	rr = e.do(t, http.MethodGet, "/api/v1/agent/desired", "fleet-api.example.com", agA, "", nil)
	var desA struct {
		Services []struct {
			Name         string `json:"name"`
			DesiredState string `json:"desired_state"`
			HostPort     int    `json:"host_port"`
			Generation   int64  `json:"generation"`
		} `json:"services"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &desA)
	if len(desA.Services) != 1 || desA.Services[0].DesiredState != "absent" || desA.Services[0].HostPort != oldPort {
		t.Fatalf("desired A %+v", desA)
	}
	rr = e.do(t, http.MethodGet, "/api/v1/agent/desired", "fleet-api.example.com", agB, "", nil)
	var desB struct {
		Services []struct {
			Name         string `json:"name"`
			DesiredState string `json:"desired_state"`
			HostPort     int    `json:"host_port"`
		} `json:"services"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &desB)
	if len(desB.Services) != 1 || desB.Services[0].DesiredState != "running" {
		t.Fatalf("desired B %+v body=%s", desB, rr.Body.String())
	}

	rr = e.do(t, http.MethodPost, "/api/v1/agent/actual", "fleet-api.example.com", agA, "", map[string]any{
		"node_id": "vps-a", "agent_instance_id": "inst-vps-a",
		"services": []map[string]any{{"name": "hello", "applied_generation": desA.Services[0].Generation, "actual_state": "absent"}},
	})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	rr = e.do(t, http.MethodGet, "/api/v1/agent/desired", "fleet-api.example.com", agA, "", nil)
	_ = json.Unmarshal(rr.Body.Bytes(), &desA)
	if len(desA.Services) != 0 {
		t.Fatalf("A still has services %+v", desA)
	}
}

func TestCIDeployUpsertAndForbiddenCreate(t *testing.T) {
	e := newTest(t)
	_ = e.register(t, "vps-hel-1")
	rr := e.do(t, http.MethodPost, "/api/v1/tokens", "fleet-api.example.com", e.op, "", map[string]string{"kind": "ci", "name": "gha"})
	if rr.Code != 201 {
		t.Fatal(rr.Body.String())
	}
	var tok struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &tok)
	doc := map[string]any{
		"apiVersion": "fleet.catalog/v1", "kind": "Service",
		"metadata": map[string]any{"name": "hello"},
		"spec": map[string]any{
			"node": "vps-hel-1",
			"expose": map[string]any{"mode": "public", "hostname": "hello.example.com", "port": 8080},
		},
	}
	rr = e.do(t, http.MethodPost, "/api/v1/services", "fleet-api.example.com", tok.Token, "", doc)
	if rr.Code != 403 {
		t.Fatalf("ci create %d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodPost, "/api/v1/deploy", "fleet-api.example.com", tok.Token, "", map[string]any{
		"fleet": doc, "image": "ghcr.io/fallrising/hello-healthz:ddd",
	})
	if rr.Code != 201 {
		t.Fatalf("ci deploy %d %s", rr.Code, rr.Body.String())
	}
}

func TestUIPagesNoHTMLOnAPIHost(t *testing.T) {
	e := newTest(t)
	p, err := ui.New(e.st)
	if err != nil {
		t.Fatal(err)
	}
	e.s.html = p
	e.s.mux = http.NewServeMux()
	e.s.routes()
	rr := e.do(t, http.MethodGet, "/", "fleet-api.example.com", e.op, "", nil)
	if rr.Code != 401 || strings.Contains(rr.Body.String(), "<table") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	rr = e.do(t, http.MethodGet, "/", "fleet.example.com", "", e.op, nil)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), "Catalog") {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}

func TestNoopTunnelEmpty(t *testing.T) {
	e := newTest(t)
	rr := e.do(t, http.MethodPost, "/api/v1/nodes/register", "fleet-api.example.com", e.bs, "", map[string]any{
		"id": "vps-x", "display_name": "x", "agent_instance_id": "i",
	})
	var out struct {
		Node struct {
			TunnelID string `json:"tunnel_id"`
		} `json:"node"`
		TunnelToken string `json:"tunnel_token"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if out.Node.TunnelID != "" || out.TunnelToken != "" {
		t.Fatalf("%+v", out)
	}
}
