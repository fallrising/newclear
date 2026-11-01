package agentloop

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/newclear/specs/fleet/internal/agentclient"
	"github.com/fallrising/newclear/specs/fleet/internal/composeclient"
)

func recoveryDesired() *agentclient.Desired {
	return &agentclient.Desired{NodeID: "vps-a", Generation: 1, Services: []agentclient.DesiredService{{
		Name: "hello", ComposeProject: "fleet-hello", Generation: 1, ForceRecreate: true,
		DesiredState: "running", ComposeYAML: "name: fleet-hello\nservices:\n  app:\n    image: example:one\n", EnvFile: "", HostPort: 20001,
	}}}
}

func cacheDesired(t *testing.T, l *Loop, d *agentclient.Desired) {
	t.Helper()
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(l.StateDir(), "desired.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRedeployRecreatesOncePerGenerationAcrossRestart(t *testing.T) {
	fake := composeclient.NewFake()
	api := &memAPI{}
	l := testLoop(t, api, fake)
	d := recoveryDesired()
	for range 3 {
		if _, err := l.Apply(context.Background(), d); err != nil {
			t.Fatal(err)
		}
	}
	if len(fake.Ups) != 1 || len(fake.Pulls) != 1 {
		t.Fatalf("same generation repeatedly recreated: ups=%d pulls=%d", len(fake.Ups), len(fake.Pulls))
	}
	restarted := New(l.Cfg, api, fake, nil)
	restarted.Probe = l.Probe
	restarted.loadApplied()
	if _, err := restarted.Apply(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	if len(fake.Ups) != 1 {
		t.Fatal("restart recreated already applied generation")
	}
	d.Services[0].Generation++
	if _, err := restarted.Apply(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	if len(fake.Ups) != 2 {
		t.Fatal("new generation did not recreate")
	}
}

type offlineAPI struct{ *memAPI }

func (*offlineAPI) GetDesired(context.Context, string, string) (*agentclient.Desired, error) {
	return nil, errors.New("control plane offline")
}

func TestOutageReconcilesCachedStateEveryTick(t *testing.T) {
	for _, state := range []string{"running", "stopped", "absent"} {
		t.Run(state, func(t *testing.T) {
			fake := composeclient.NewFake()
			l := testLoop(t, &memAPI{}, fake)
			l.API = &offlineAPI{&memAPI{}}
			d := recoveryDesired()
			d.Services[0].DesiredState = state
			cacheDesired(t, l, d)
			for range 2 {
				fake.Projects["fleet-hello"] = composeclient.PsInfo{Running: state != "running"}
				l.tickApply(context.Background())
				if fake.Running("fleet-hello") != (state == "running") {
					t.Fatalf("cached %s was not reconciled", state)
				}
			}
		})
	}
}

func TestWrongNodeCacheDoesNotApply(t *testing.T) {
	fake := composeclient.NewFake()
	l := testLoop(t, &memAPI{}, fake)
	l.API = &offlineAPI{&memAPI{}}
	d := recoveryDesired()
	d.NodeID = "other-node"
	cacheDesired(t, l, d)
	l.tickApply(context.Background())
	if len(fake.Ups) != 0 {
		t.Fatal("applied cache belonging to another node")
	}
}

type filesCompose struct {
	*composeclient.Fake
	t *testing.T
}

func (f filesCompose) Down(ctx context.Context, p composeclient.Project, path string, o composeclient.DownOpts) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(path), ".env")); err != nil {
		return err
	}
	return f.Fake.Down(ctx, p, path, o)
}
func TestAbsentRestoresComposeBeforeDown(t *testing.T) {
	fake := composeclient.NewFake()
	l := testLoop(t, &memAPI{}, fake)
	l.Compose = filesCompose{fake, t}
	d := recoveryDesired()
	d.Services[0].DesiredState = "absent"
	d.Services[0].SecretKeys = []string{"TOKEN"}
	act, err := l.Apply(context.Background(), d)
	if err != nil || act.Services[0].ActualState != "absent" {
		t.Fatalf("missing files prevent tombstone recovery: %+v %v", act, err)
	}
}
func TestMissingAppliedFilesAreRestored(t *testing.T) {
	fake := composeclient.NewFake()
	l := testLoop(t, &memAPI{}, fake)
	d := recoveryDesired()
	d.Services[0].ForceRecreate = false
	if _, err := l.Apply(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(l.StateDir(), "services", "hello", "docker-compose.yml")
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Apply(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("applied hash suppressed missing file recovery: %v", err)
	}
}

type blockingPull struct {
	*composeclient.Fake
	started chan struct{}
}

func (b *blockingPull) Pull(ctx context.Context, _ composeclient.Project, _ string) error {
	close(b.started)
	<-ctx.Done()
	return ctx.Err()
}
func TestHeartbeatStartsBeforeCachedRecoveryPull(t *testing.T) {
	fake := composeclient.NewFake()
	api := &memAPI{}
	l := testLoop(t, api, fake)
	l.API = &offlineAPI{api}
	b := &blockingPull{fake, make(chan struct{})}
	l.Compose = b
	cacheDesired(t, l, recoveryDesired())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- l.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("run did not stop")
		}
	}()
	select {
	case <-b.started:
	case <-time.After(time.Second):
		t.Fatal("cached recovery did not pull")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		api.mu.Lock()
		n := api.hb
		api.mu.Unlock()
		if n > 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("startup cached pull blocked heartbeat")
}
