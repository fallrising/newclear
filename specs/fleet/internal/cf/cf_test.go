package cf

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/db"
	"github.com/fallrising/fleet-catalog/internal/ingress"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/store"
)

const bootstrapID = "11111111-1111-1111-1111-111111111111"

type fakeCF struct {
	mu       sync.Mutex
	puts     []string
	reqs     []string
	tunnels  map[string]string // name -> id
	configs  map[string]tunnelConfig
	dns      map[string]string
	routes   map[string]string
	teamnet  int
}

func newFake(t *testing.T) (*httptest.Server, *fakeCF) {
	t.Helper()
	f := &fakeCF{
		tunnels: map[string]string{},
		configs: map[string]tunnelConfig{},
		dns:     map[string]string{},
		routes:  map[string]string{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.reqs = append(f.reqs, r.Method+" "+r.URL.Path)
		if strings.Contains(r.URL.Path, "teamnet") {
			f.teamnet++
		}
		if r.Method == http.MethodPut {
			f.puts = append(f.puts, r.URL.Path)
		}
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/cfd_tunnel"):
			var req struct {
				Name string `json:"name"`
			}
			_ = json.Unmarshal(body, &req)
			id := "tun-" + req.Name
			f.mu.Lock()
			f.tunnels[req.Name] = id
			f.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{"id": id, "token": "tok-" + id, "name": req.Name}})
		case strings.Contains(r.URL.Path, "/cfd_tunnel/") && strings.HasSuffix(r.URL.Path, "/token"):
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": "reissued-token"})
		case strings.Contains(r.URL.Path, "/configurations"):
			parts := strings.Split(r.URL.Path, "/")
			var id string
			for i, p := range parts {
				if p == "cfd_tunnel" && i+1 < len(parts) {
					id = parts[i+1]
				}
			}
			if r.Method == http.MethodGet {
				f.mu.Lock()
				cfg := f.configs[id]
				f.mu.Unlock()
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{"config": cfg}})
				return
			}
			if r.Method == http.MethodPut {
				if id == bootstrapID {
					http.Error(w, "must not PUT bootstrap tunnel", 500)
					return
				}
				var wrap struct {
					Config tunnelConfig `json:"config"`
				}
				_ = json.Unmarshal(body, &wrap)
				f.mu.Lock()
				f.configs[id] = wrap.Config
				f.mu.Unlock()
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": wrap})
				return
			}
		case strings.Contains(r.URL.Path, "/dns_records"):
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": []any{}})
				return
			}
			if r.Method == http.MethodPost {
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{"id": "dns-1"}})
				return
			}
		case strings.Contains(r.URL.Path, "/zerotrust/routes/hostname"):
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": []any{}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{"id": "route-1"}})
		case strings.Contains(r.URL.Path, "/access/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{"id": "acc-1"}})
		default:
			if strings.Contains(r.URL.Path, "/cfd_tunnel") && r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": []any{}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{}})
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, f
}

func testClient(t *testing.T, srv *httptest.Server) (*Client, *store.Store) {
	t.Helper()
	sqldb, err := db.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqldb.Close() })
	st := store.New(sqldb)
	st.Now = func() time.Time { return time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC) }
	cfg := config.Fleetd{
		CFAPIToken:         "tok",
		CFAccountID:        "acct",
		CFZoneID:           "zone",
		BootstrapTunnelID:  bootstrapID,
		UIHostname:         "fleet.example.com",
		APIHostname:        "fleet-api.example.com",
		ProtectedHostnames: []string{"fleet.example.com", "fleet-api.example.com"},
		BaseDomain:         "example.com",
	}
	c := New(cfg, st, nil)
	c.SetBase(srv.URL)
	return c, st
}

func TestEnsureNodeTunnelDoesNotPut(t *testing.T) {
	srv, fake := newFake(t)
	c, st := testClient(t, srv)
	if err := st.CreateNode(&model.Node{ID: "vps-a"}); err != nil {
		t.Fatal(err)
	}
	id, tok, err := c.EnsureNodeTunnel(context.Background(), "vps-a")
	if err != nil {
		t.Fatal(err)
	}
	if id == "" || tok == "" {
		t.Fatal(id, tok)
	}
	if id == bootstrapID {
		t.Fatal("bootstrap id")
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, p := range fake.puts {
		if strings.Contains(p, "configurations") {
			t.Fatalf("register PUT ingress %v", fake.puts)
		}
		if strings.Contains(p, bootstrapID) {
			t.Fatal("put bootstrap")
		}
	}
	if fake.teamnet != 0 {
		t.Fatal("teamnet")
	}
}

func TestBootstrapTunnelNotPut(t *testing.T) {
	srv, fake := newFake(t)
	c, _ := testClient(t, srv)
	if err := c.ReconcileTunnel(context.Background(), bootstrapID); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, p := range fake.puts {
		if strings.Contains(p, bootstrapID) {
			t.Fatalf("PUT bootstrap %v", fake.puts)
		}
	}
}

func TestProtectedHostnameSurvivesCatalogRebuild(t *testing.T) {
	srv, fake := newFake(t)
	c, st := testClient(t, srv)
	if err := st.CreateNode(&model.Node{ID: "vps-a", TunnelID: "tun-node"}); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.configs["tun-node"] = tunnelConfig{
		WarpRouting: map[string]any{"enabled": true},
		Ingress: []ingressRule{
			{Hostname: "fleet.example.com", Service: "http://127.0.0.1:18765"},
			{Hostname: "fleet-api.example.com", Service: "http://127.0.0.1:18765"},
			{Service: "http_status:404"},
		},
	}
	fake.mu.Unlock()
	if err := st.InsertService(&model.Service{
		Name: "hello", NodeID: "vps-a", Hostname: "hello.example.com",
		ExposeMode: "public", DesiredState: "running", HostPort: 20001, ContainerPort: 8080,
		FleetJSON: "{}", IngressStatus: "pending",
	}); err != nil {
		t.Fatal(err)
	}
	if err := c.ReconcileTunnel(context.Background(), "tun-node"); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	cfg := fake.configs["tun-node"]
	fake.mu.Unlock()
	hosts := map[string]bool{}
	for _, r := range cfg.Ingress {
		if r.Hostname != "" {
			hosts[r.Hostname] = true
		}
	}
	if !hosts["fleet.example.com"] || !hosts["fleet-api.example.com"] {
		t.Fatalf("protected missing: %+v", cfg.Ingress)
	}
	if !hosts["hello.example.com"] {
		t.Fatalf("catalog missing: %+v", cfg.Ingress)
	}
	if cfg.WarpRouting["enabled"] != true {
		t.Fatalf("warp-routing %+v", cfg.WarpRouting)
	}
	last := cfg.Ingress[len(cfg.Ingress)-1]
	if last.Service != "http_status:404" {
		t.Fatal(last)
	}
}

func TestNoTeamnetCIDROnPrivate(t *testing.T) {
	srv, fake := newFake(t)
	c, st := testClient(t, srv)
	if err := st.CreateNode(&model.Node{ID: "vps-a", TunnelID: "tun-node"}); err != nil {
		t.Fatal(err)
	}
	if err := st.InsertService(&model.Service{
		Name: "files", NodeID: "vps-a", Hostname: "files.fleet.internal",
		ExposeMode: "private", DesiredState: "running", HostPort: 20014, ContainerPort: 8080,
		FleetJSON: "{}", IngressStatus: "pending",
	}); err != nil {
		t.Fatal(err)
	}
	if err := c.ReconcileService(context.Background(), ingress.ServiceView{
		Name: "files", NodeID: "vps-a", TunnelID: "tun-node", DesiredState: "running",
		ExposeMode: "private", Hostname: "files.fleet.internal", HostPort: 20014,
	}); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.teamnet != 0 {
		t.Fatal("teamnet CIDR called")
	}
	var sawRoute bool
	for _, r := range fake.reqs {
		if strings.Contains(r, "zerotrust/routes/hostname") && strings.HasPrefix(r, "POST") {
			sawRoute = true
		}
		if strings.Contains(r, "10.42") {
			t.Fatal(r)
		}
	}
	if !sawRoute {
		t.Fatalf("expected hostname route POST: %v", fake.reqs)
	}
}

func TestRetry429(t *testing.T) {
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		if n == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"success":false,"errors":[{"message":"rate"}]}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]any{"id": "ok"}})
	}))
	t.Cleanup(srv.Close)
	c, _ := testClient(t, srv)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	res, err := c.do(ctx, http.MethodGet, "/accounts/acct/cfd_tunnel", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if n < 2 {
		t.Fatalf("retries=%d", n)
	}
	if !strings.Contains(string(res), "ok") {
		t.Fatalf("%s", res)
	}
}
