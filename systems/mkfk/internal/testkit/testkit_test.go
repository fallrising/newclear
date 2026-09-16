package testkit

import (
	"context"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

func TestManualClock(t *testing.T) {
	t.Parallel()
	clock := NewManualClock(time.Unix(100, 0))
	timer := clock.NewTimer(time.Second)
	clock.Advance(999 * time.Millisecond)
	select {
	case <-timer.C():
		t.Fatal("timer fired early")
	default:
	}
	clock.Advance(time.Millisecond)
	select {
	case fired := <-timer.C():
		if !fired.Equal(time.Unix(101, 0)) {
			t.Fatalf("timer fired at %s", fired)
		}
	default:
		t.Fatal("timer did not fire")
	}
}

func TestScriptedRandomAndFaultTransport(t *testing.T) {
	t.Parallel()
	random := NewScriptedRandom(7)
	value, err := InclusiveRange(random, 600, 1200)
	if err != nil || value != 607 {
		t.Fatalf("range = %d, %v", value, err)
	}
	transport := NewFaultTransport(
		TransportAction{Drop: true},
		TransportAction{Duplicates: 2},
	)
	message := adapters.PeerMessage{Destination: 2, Group: "events/0", Term: 3, RPCID: 9, Body: []byte("rpc")}
	if err := transport.Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	if err := transport.Send(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	if len(transport.Dropped()) != 1 || len(transport.Delivered()) != 2 {
		t.Fatalf("dropped=%d delivered=%d", len(transport.Dropped()), len(transport.Delivered()))
	}
}

func TestCleanChildPath(t *testing.T) {
	t.Parallel()
	if _, ok := adapters.CleanChildPath("/tmp/mkfk", "events", "0"); !ok {
		t.Fatal("safe path rejected")
	}
	for _, unsafe := range []string{"../escape", "/absolute", "a/b", ""} {
		if _, ok := adapters.CleanChildPath("/tmp/mkfk", unsafe); ok {
			t.Fatalf("unsafe element %q accepted", unsafe)
		}
	}
}
