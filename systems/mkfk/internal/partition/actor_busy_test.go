package partition_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
)

// A call the actor never accepted before its deadline was not applied; it
// reports ErrBusy, which the API answers as typed backpressure.
func TestM7CallNotAcceptedBeforeDeadlineIsBusy(t *testing.T) {
	t.Parallel()
	cluster := newDataCluster(t)
	actor := cluster.data[1].Actor()
	release := make(chan struct{})
	occupied := make(chan struct{})
	go func() {
		_ = actor.Do(context.Background(), func() error {
			close(occupied)
			<-release
			return nil
		})
	}()
	<-occupied
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	ran := false
	err := actor.Do(ctx, func() error { ran = true; return nil })
	close(release)
	if !errors.Is(err, partition.ErrBusy) || ran {
		t.Fatalf("call during a busy actor = %v (ran=%v), want ErrBusy without running", err, ran)
	}
}
