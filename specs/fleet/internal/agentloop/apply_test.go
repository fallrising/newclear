package agentloop

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/fleet-catalog/internal/agentclient"
	"github.com/fallrising/fleet-catalog/internal/composeclient"
	"github.com/fallrising/fleet-catalog/internal/config"
)

type memAPI struct {
	mu       sync.Mutex
	desired  *agentclient.Desired
	actuals  []agentclient.Actual
	hb       int
	lease    bool
	agToken  string
	tunToken string
}

func (m *memAPI) Register(context.Context, string, string, string, string) (string, string, error) {
	return m.agToken, m.tunToken, nil
}
func (m *memAPI) Heartbeat(context.Context, string, string, agentclient.Heartbeat) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hb++
	if m.lease {
		return ErrLeaseHeld
	}
	return nil
}
func (m *memAPI) GetDesired(context.Context, string, string) (*agentclient.Desired, error) {
	return m.desired, nil
}
func (m *memAPI) PostActual(_ context.Context, _, _ string, act agentclient.Actual) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.actuals = append(m.actuals, act)
	return nil
}

func testLoop(t *testing.T, api *memAPI, fake *composeclient.Fake) *Loop {
	t.Helper()
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "agent.token"), []byte("flt_ag_test\n"), 0o600)
	_ = os.WriteFile(filepath.Join(dir, "agent_instance_id"), []byte("inst-1\n"), 0o600)
	l := New(config.Agent{
		URL:       "https://fleet-api.example.com",
		NodeID:    "vps-a",
		TokenFile: filepath.Join(dir, "agent.token"),
		StateDir:  dir,
		Interval:  time.Hour,
	}, api, fake, nil)
	l.Probe = func(context.Context, string) (int, time.Duration, error) { return 200, time.Millisecond, nil }
	return l
}

func TestEmptyDesiredDoesNotDownProtected(t *testing.T) {
	fake := composeclient.NewFake()
	fake.Projects["fleet-agent"] = composeclient.PsInfo{Running: true, ContainerID: "ag"}
	fake.Projects["fleet-control"] = composeclient.PsInfo{Running: true, ContainerID: "cp"}
	fake.Projects["fleet-hello"] = composeclient.PsInfo{Running: true, ContainerID: "h"}
	api := &memAPI{desired: &agentclient.Desired{NodeID: "vps-a", Services: []agentclient.DesiredService{}}}
	l := testLoop(t, api, fake)
	if _, err := l.Apply(context.Background(), api.desired); err != nil {
		t.Fatal(err)
	}
	if !fake.Running("fleet-hello") {
		t.Fatal("hello should be untouched")
	}
	if len(fake.Downs) != 0 {
		t.Fatalf("downs %v", fake.Downs)
	}
	// Protected projects cannot be Ps'd; they stay as seeded.
	if !fake.Projects["fleet-agent"].Running || !fake.Projects["fleet-control"].Running {
		t.Fatal("protected projects changed")
	}

	api.desired.Services = []agentclient.DesiredService{{
		Name: "hello", DesiredState: "absent", Generation: 2,
		ComposeProject: "fleet-hello", HostPort: 20001,
		ComposeYAML: "name: fleet-hello\n",
	}}
	if _, err := l.Apply(context.Background(), api.desired); err != nil {
		t.Fatal(err)
	}
	if fake.Running("fleet-hello") {
		t.Fatal("hello should be down")
	}
	if len(fake.Downs) != 1 || fake.Downs[0] != "fleet-hello" {
		t.Fatalf("downs %v", fake.Downs)
	}
	if !fake.Projects["fleet-agent"].Running || !fake.Projects["fleet-control"].Running {
		t.Fatal("protected downed")
	}
}

func TestUpSidecarDoesNotDownAgent(t *testing.T) {
	fake := composeclient.NewFake()
	fake.Projects["fleet-agent"] = composeclient.PsInfo{Running: true}
	api := &memAPI{agToken: "flt_ag_x", tunToken: "eyJ"}
	dir := t.TempDir()
	l := New(config.Agent{
		URL:            "https://fleet-api.example.com",
		NodeID:         "vps-a",
		TokenFile:      filepath.Join(dir, "agent.token"),
		StateDir:       dir,
		BootstrapToken: "flt_bs_x",
	}, api, fake, nil)
	if err := l.Bootstrap(context.Background()); err != nil {
		t.Fatal(err)
	}
	if fake.Sidecars != 1 {
		t.Fatalf("sidecar %d", fake.Sidecars)
	}
	if len(fake.Downs) != 0 {
		t.Fatalf("downs %v", fake.Downs)
	}
	if !fake.Projects["fleet-agent"].Running {
		t.Fatal("agent downed")
	}
	env, err := os.ReadFile(filepath.Join(dir, "cloudflared.env"))
	if err != nil || string(env) != "TUNNEL_TOKEN=eyJ\n" {
		t.Fatalf("env %q %v", env, err)
	}
}

func TestPostActualBeforePull(t *testing.T) {
	fake := composeclient.NewFake()
	api := &memAPI{desired: &agentclient.Desired{
		NodeID: "vps-a",
		Registry: &agentclient.Registry{URL: "ghcr.io", Username: "x-access-token", Password: "p"},
		Services: []agentclient.DesiredService{{
			Name: "hello", DesiredState: "running", Generation: 3, ForceRecreate: true,
			ComposeProject: "fleet-hello", HostPort: 20001,
			ComposeYAML: "name: fleet-hello\nservices:\n  app:\n    image: x\n    ports: [\"127.0.0.1:20001:8080\"]\n",
			Health:      agentclient.Health{URL: "http://127.0.0.1:20001/healthz", TimeoutMS: 2000},
		}},
	}}
	l := testLoop(t, api, fake)
	if _, err := l.Apply(context.Background(), api.desired); err != nil {
		t.Fatal(err)
	}
	if len(api.actuals) == 0 {
		t.Fatal("no mid-tick actual")
	}
	first := api.actuals[0]
	if len(first.Services) == 0 || first.Services[0].Error != "pull_in_progress" {
		t.Fatalf("first actual %+v", first)
	}
	if len(fake.Pulls) != 1 {
		t.Fatal("expected pull")
	}
	if fake.Logins != 1 {
		t.Fatal("expected ghcr login")
	}
}

func TestHeartbeatIndependentOfApplyMu(t *testing.T) {
	fake := composeclient.NewFake()
	api := &memAPI{}
	l := testLoop(t, api, fake)
	l.applyMu.Lock()
	done := make(chan struct{})
	go func() {
		l.tickHeartbeat(context.Background())
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		l.applyMu.Unlock()
		t.Fatal("heartbeat blocked on applyMu")
	}
	l.applyMu.Unlock()
	if api.hb != 1 {
		t.Fatal(api.hb)
	}
}

func TestHealthzLoopbackOnly(t *testing.T) {
	l := testLoop(t, &memAPI{}, composeclient.NewFake())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := l.ServeHealthz(ctx, "127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
}

func TestCrashCacheJSON(t *testing.T) {
	api := &memAPI{}
	l := testLoop(t, api, composeclient.NewFake())
	d := agentclient.Desired{NodeID: "vps-a", Services: []agentclient.DesiredService{}}
	b, _ := json.Marshal(d)
	if err := os.WriteFile(filepath.Join(l.StateDir(), "desired.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
