package cf

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fallrising/newclear/specs/fleet/internal/ingress"
	"github.com/fallrising/newclear/specs/fleet/internal/model"
)

func TestWebAccessPolicyBeforeExposure(t *testing.T) {
	for _, failPolicy := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "policy_failure"}[failPolicy], func(t *testing.T) {
			policyReady := false
			published := false
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if r.Body != nil {
					_ = json.NewDecoder(r.Body).Decode(&body)
				}
				if strings.Contains(r.URL.Path, "/routes/") {
					t.Error("unexpected network route API")
				}
				if r.Method != http.MethodGet && (strings.Contains(r.URL.Path, "/configurations") || strings.Contains(r.URL.Path, "/dns_records")) {
					if !policyReady {
						t.Error("published entrance before Access policy")
					}
					published = true
					if cfg, ok := body["config"].(map[string]any); ok {
						if _, ok := cfg["warp-routing"]; ok {
							t.Error("unexpected network routing configuration")
						}
					}
				}
				result := any([]any{})
				if strings.HasSuffix(r.URL.Path, "/policies") && r.Method == http.MethodPost {
					if failPolicy {
						w.WriteHeader(http.StatusForbidden)
						return
					}
					encoded, _ := json.Marshal(body)
					if !strings.Contains(string(encoded), "owner@example.com") || strings.Contains(string(encoded), "everyone") {
						t.Errorf("unexpected policy: %s", encoded)
					}
					policyReady = true
				}
				if r.Method != http.MethodGet {
					result = map[string]string{"id": "created-id"}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": result})
			}))
			defer srv.Close()
			c, st := testClient(t, srv)
			c.cfg.CFAccessAllowedEmails = []string{"owner@example.com"}
			if err := st.CreateNode(&model.Node{ID: "vps-a", TunnelID: "tun-node"}); err != nil {
				t.Fatal(err)
			}
			if err := st.InsertService(&model.Service{Name: "dashboard", NodeID: "vps-a", Hostname: "dashboard.example.com", ExposeMode: "access", DesiredState: "running", HostPort: 20001, ContainerPort: 8080, FleetJSON: "{}"}); err != nil {
				t.Fatal(err)
			}
			// A drift pass must not publish an Access row before its policy exists.
			for _, rule := range c.catalogRules("tun-node", "") {
				if rule.Hostname == "dashboard.example.com" {
					t.Error("pending Access included in ingress")
				}
			}
			err := c.ReconcileService(context.Background(), ingress.ServiceView{Name: "dashboard", NodeID: "vps-a", TunnelID: "tun-node", Hostname: "dashboard.example.com", ExposeMode: "access", DesiredState: "running", HostPort: 20001})
			if failPolicy {
				if err == nil || published {
					t.Fatalf("policy failure must prevent publishing: err=%v published=%v", err, published)
				}
			} else if err != nil || !published {
				t.Fatalf("expected published Access entrance: err=%v published=%v", err, published)
			}
		})
	}
}

func TestRejectUnconfiguredOrUnsupportedExposureBeforeCF(t *testing.T) {
	for _, mode := range []string{"access", "private", "unknown"} {
		t.Run(mode, func(t *testing.T) {
			srv, fake := newFake(t)
			c, _ := testClient(t, srv)
			err := c.ReconcileService(context.Background(), ingress.ServiceView{Name: "missing", ExposeMode: mode, TunnelID: "tun-node", DesiredState: "running"})
			if err == nil {
				t.Fatal("expected explicit rejection")
			}
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if len(fake.reqs) != 0 {
				t.Fatalf("unexpected CF mutation/read: %v", fake.reqs)
			}
		})
	}
}

func TestEmptyAccessAllowlistCannotCreatePolicy(t *testing.T) {
	srv, fake := newFake(t)
	c, _ := testClient(t, srv)
	if _, err := c.ensurePolicy(context.Background(), "app-id"); err == nil {
		t.Fatal("empty allowlist accepted")
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.reqs) != 0 {
		t.Fatalf("empty allowlist made CF calls: %v", fake.reqs)
	}
}

func TestAccessPolicyReconcilesAllowlistAndRejectsUnmanaged(t *testing.T) {
	for _, name := range []string{"fleet-operator", "unmanaged"} {
		t.Run(name, func(t *testing.T) {
			updated := false
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": []any{map[string]any{"id": "policy-id", "name": name, "decision": "allow", "include": []any{map[string]any{"everyone": map[string]any{}}}}}})
					return
				}
				if r.Method != http.MethodPut || !strings.HasSuffix(r.URL.Path, "/policy-id") {
					t.Errorf("unexpected mutation: %s %s", r.Method, r.URL.Path)
				}
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				b, _ := json.Marshal(body)
				if strings.Contains(string(b), "everyone") || !strings.Contains(string(b), "owner@example.com") {
					t.Errorf("bad policy: %s", b)
				}
				updated = true
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "result": map[string]string{"id": "policy-id"}})
			}))
			defer srv.Close()
			c, _ := testClient(t, srv)
			c.cfg.CFAccessAllowedEmails = []string{"owner@example.com"}
			id, err := c.ensurePolicy(context.Background(), "app-id")
			if name == "fleet-operator" {
				if err != nil || id != "policy-id" || !updated {
					t.Fatalf("allowlist not reconciled: %s %v", id, err)
				}
			} else if err == nil || updated {
				t.Fatalf("unmanaged policy accepted or mutated: %v", err)
			}
		})
	}
}
