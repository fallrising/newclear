package partition_test

import (
	"context"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
)

// A call that holds the actor for StallThreshold delays every tick and peer
// step behind it; the actor counts it so an operator can see it.
func TestActorCountsCallHoldingItPastStallThreshold(t *testing.T) {
	t.Parallel()
	cluster := newDataCluster(t)
	actor := cluster.data[1].Actor()

	if err := actor.Do(context.Background(), func() error {
		cluster.clock.Advance(partition.StallThreshold)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	metrics, err := cluster.data[1].Metrics(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Stalls != 1 || metrics.StallMax != partition.StallThreshold {
		t.Fatalf("stalls = %d, max = %v; want 1 and %v", metrics.Stalls, metrics.StallMax, partition.StallThreshold)
	}
}

func TestActorDoesNotCountShortCallAsStall(t *testing.T) {
	t.Parallel()
	cluster := newDataCluster(t)
	actor := cluster.data[1].Actor()

	if err := actor.Do(context.Background(), func() error {
		cluster.clock.Advance(partition.StallThreshold / 2)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	metrics, err := cluster.data[1].Metrics(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Stalls != 0 {
		t.Fatalf("stalls = %d after a short call, want 0", metrics.Stalls)
	}
}
