package composeclient

import (
	"context"
	"errors"
	"testing"
)

func TestProtected(t *testing.T) {
	f := NewFake()
	ctx := context.Background()
	f.Projects["fleet-agent"] = PsInfo{Running: true}
	f.Projects["fleet-control"] = PsInfo{Running: true}
	for _, p := range []Project{"fleet-agent", "fleet-control"} {
		if err := f.Up(ctx, p, "x.yml", UpOpts{}); !errors.Is(err, ErrProtectedProject) {
			t.Fatalf("Up %s: %v", p, err)
		}
		if err := f.Down(ctx, p, "x.yml", DownOpts{}); !errors.Is(err, ErrProtectedProject) {
			t.Fatalf("Down %s: %v", p, err)
		}
		if err := f.Stop(ctx, p, "x.yml"); !errors.Is(err, ErrProtectedProject) {
			t.Fatalf("Stop %s: %v", p, err)
		}
		if _, err := f.Ps(ctx, p, "x.yml"); !errors.Is(err, ErrProtectedProject) {
			t.Fatalf("Ps %s: %v", p, err)
		}
	}
	if err := f.UpSidecar(ctx); err != nil {
		t.Fatal(err)
	}
	if f.Sidecars != 1 {
		t.Fatal(f.Sidecars)
	}
	if len(f.Downs) != 0 {
		t.Fatalf("sidecar downed %v", f.Downs)
	}
	if !f.Running("fleet-agent") {
		t.Fatal("agent project downed")
	}
}

func TestCLIHasNoLs(t *testing.T) {
	var _ ComposeClient = (*CLI)(nil)
	var _ ComposeClient = (*Fake)(nil)
}
