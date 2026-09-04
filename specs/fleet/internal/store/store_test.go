package store

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/fallrising/fleet-catalog/internal/db"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	sqldb, err := db.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqldb.Close() })
	st := New(sqldb)
	st.Now = func() time.Time { return time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC) }
	return st
}

func mustNode(t *testing.T, st *Store, id string) {
	t.Helper()
	if err := st.CreateNode(&model.Node{ID: id, DisplayName: id}); err != nil {
		t.Fatal(err)
	}
}

func helloDoc(node string) string {
	d := map[string]any{
		"apiVersion": "fleet.catalog/v1",
		"kind":       "Service",
		"metadata":   map[string]any{"name": "hello"},
		"spec": map[string]any{
			"node": node,
			"image": "ghcr.io/fallrising/hello-healthz:aaa",
			"expose": map[string]any{"mode": "public", "hostname": "hello.example.com", "port": 8080, "healthPath": "/healthz"},
		},
	}
	b, _ := json.Marshal(d)
	return string(b)
}

func mustHello(t *testing.T, st *Store, node string) *model.Service {
	t.Helper()
	svc := &model.Service{
		Name:          "hello",
		NodeID:        node,
		FleetJSON:     helloDoc(node),
		Image:         "ghcr.io/fallrising/hello-healthz:aaa",
		DesiredState:  "running",
		ExposeMode:    "public",
		Hostname:      "hello.example.com",
		ContainerPort: 8080,
		HealthPath:    "/healthz",
		ComposeYAML:   "name: fleet-hello\n",
		EnvFile:       "LOG_LEVEL=info\n",
	}
	if err := st.InsertService(svc); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetService("hello")
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestMoveHelloDoesNotFreeOldPortUntilAck(t *testing.T) {
	st := testStore(t)
	mustNode(t, st, "vps-a")
	mustNode(t, st, "vps-b")
	svc := mustHello(t, st, "vps-a")
	oldPort := svc.HostPort
	if oldPort == 0 {
		t.Fatal("no port")
	}

	if err := st.MoveService("hello", "vps-b"); err != nil {
		t.Fatal(err)
	}

	desA, err := st.DesiredForNode("vps-a")
	if err != nil {
		t.Fatal(err)
	}
	desB, err := st.DesiredForNode("vps-b")
	if err != nil {
		t.Fatal(err)
	}

	var a, b *DesiredService
	for i := range desA.Services {
		if desA.Services[i].Name == "hello" {
			a = &desA.Services[i]
		}
	}
	for i := range desB.Services {
		if desB.Services[i].Name == "hello" {
			b = &desB.Services[i]
		}
	}
	if a == nil || a.DesiredState != "absent" || a.HostPort != oldPort {
		t.Fatalf("desired A: %+v", a)
	}
	if b == nil || b.DesiredState != "running" || b.HostPort == 0 {
		t.Fatalf("desired B: %+v", b)
	}

	inUse, err := st.PortInUse("vps-a", oldPort)
	if err != nil || !inUse {
		t.Fatalf("old port should be held by tombstone: inUse=%v err=%v", inUse, err)
	}

	// Allocator on A must not reuse old port.
	p, err := st.AllocatePort("vps-a")
	if err != nil {
		t.Fatal(err)
	}
	if p == oldPort {
		t.Fatal("allocator reused tombstoned port")
	}

	live, err := st.GetService("hello")
	if err != nil {
		t.Fatal(err)
	}
	if live.NodeID != "vps-b" || live.HostPort != b.HostPort {
		t.Fatalf("live %+v", live)
	}

	if err := st.ApplyActual("vps-a", []ActualReport{{
		Name: "hello", AppliedGeneration: a.Generation, ActualState: "absent",
	}}); err != nil {
		t.Fatal(err)
	}

	inUse, err = st.PortInUse("vps-a", oldPort)
	if err != nil || inUse {
		t.Fatalf("port should be free after ack: inUse=%v err=%v", inUse, err)
	}
	desA, _ = st.DesiredForNode("vps-a")
	for _, d := range desA.Services {
		if d.Name == "hello" {
			t.Fatal("tombstone still in desired A")
		}
	}
}

func TestUninstallKeepsRowUntilAck(t *testing.T) {
	st := testStore(t)
	mustNode(t, st, "vps-a")
	svc := mustHello(t, st, "vps-a")
	if err := st.UninstallService("hello", false); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetService("hello")
	if err != nil {
		t.Fatal(err)
	}
	if got.DesiredState != "absent" {
		t.Fatal(got.DesiredState)
	}
	pending, _ := st.TombstonePending("hello")
	if !pending {
		t.Fatal("expected tombstone_pending")
	}
	if err := st.InsertService(&model.Service{
		Name: "hello", NodeID: "vps-a", Hostname: "hello2.example.com",
		ExposeMode: "public", ContainerPort: 8080, FleetJSON: "{}",
	}); err != ErrTombstonePending {
		t.Fatalf("got %v", err)
	}
	if err := st.ApplyActual("vps-a", []ActualReport{{
		Name: "hello", AppliedGeneration: got.Generation, ActualState: "absent",
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetService("hello"); err != ErrNotFound {
		t.Fatalf("row should be gone, got %v", err)
	}
	_ = svc
}

func TestTokenHashNotStoredPlain(t *testing.T) {
	st := testStore(t)
	iss, err := st.CreateToken(token.KindCI, "gha", "")
	if err != nil {
		t.Fatal(err)
	}
	row, err := st.GetToken(iss.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Hash == iss.Plain {
		t.Fatal("stored plaintext")
	}
	if row.Hash != token.Hash(iss.Plain) {
		t.Fatal("hash mismatch")
	}
	got, err := st.Authenticate(iss.Plain)
	if err != nil || got.ID != iss.ID {
		t.Fatalf("%v %+v", err, got)
	}
	list, _ := st.ListTokens()
	for _, tok := range list {
		if tok.Hash != "" {
			t.Fatal("list leaked hash")
		}
	}
}

func TestBootstrapTTL(t *testing.T) {
	st := testStore(t)
	iss, err := st.CreateToken(token.KindBootstrap, "bs", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Authenticate(iss.Plain); err != nil {
		t.Fatal(err)
	}
	st.Now = func() time.Time { return time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC) }
	if _, err := st.Authenticate(iss.Plain); err != ErrTokenExpired {
		t.Fatalf("got %v", err)
	}
}

func TestReleasePrune(t *testing.T) {
	st := testStore(t)
	mustNode(t, st, "vps-a")
	mustHello(t, st, "vps-a")
	var keep string
	for i := 0; i < 25; i++ {
		r := &model.Release{Service: "hello", Image: "img", GitSHA: "x"}
		r.CreatedAt = st.Now().Add(time.Duration(i) * time.Second).Format(time.RFC3339)
		if err := st.InsertRelease(r); err != nil {
			t.Fatal(err)
		}
		keep = r.ID
	}
	all, err := st.ListReleases("hello")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 20 {
		t.Fatalf("got %d", len(all))
	}
	if all[0].ID != keep {
		t.Fatal("newest dropped")
	}
}

func TestHeartbeatLease(t *testing.T) {
	st := testStore(t)
	mustNode(t, st, "vps-a")
	if _, err := st.Heartbeat("vps-a", "inst-1", "0.1.0", `{"ncpu":1}`); err != nil {
		t.Fatal(err)
	}
	_, err := st.Heartbeat("vps-a", "inst-2", "0.1.0", `{"ncpu":1}`)
	if err != ErrAgentLeaseHeld {
		t.Fatalf("got %v", err)
	}
	if err := st.ForceLease("vps-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Heartbeat("vps-a", "inst-2", "0.1.0", `{"ncpu":1}`); err != nil {
		t.Fatal(err)
	}
}

func TestReservedNode(t *testing.T) {
	st := testStore(t)
	if err := st.CreateNode(&model.Node{ID: "control"}); err != ErrReserved {
		t.Fatalf("got %v", err)
	}
}

func TestSweepTimeout(t *testing.T) {
	st := testStore(t)
	mustNode(t, st, "vps-a")
	mustHello(t, st, "vps-a")
	if err := st.UninstallService("hello", true); err != nil {
		t.Fatal(err)
	}
	st.Now = func() time.Time { return time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC) }
	n, err := st.SweepTimeouts()
	if err != nil || n == 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if _, err := st.GetService("hello"); err != ErrNotFound {
		t.Fatal(err)
	}
}

func TestEnsureBootstrapOperatorOnce(t *testing.T) {
	st := testStore(t)
	iss, err := token.Generate(token.KindOperator)
	if err != nil {
		t.Fatal(err)
	}
	ins, err := st.EnsureBootstrapTokens(iss.Plain, "")
	if err != nil || !ins {
		t.Fatalf("ins=%v err=%v", ins, err)
	}
	ins, err = st.EnsureBootstrapTokens(iss.Plain, "")
	if err != nil || ins {
		t.Fatalf("second insert ins=%v err=%v", ins, err)
	}
}
