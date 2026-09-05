package deltaconv

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.uber.org/goleak"
)

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

func TestConverterStateMachine(t *testing.T) {
	t.Parallel()

	now := time.Date(2025, time.January, 2, 3, 4, 5, 0, time.UTC)
	converter := New(context.Background(), Options{
		TTL:           time.Minute,
		SweepInterval: time.Hour,
		MaxSeries:     1,
		Now:           func() time.Time { return now },
	})
	t.Cleanup(converter.Close)

	if value, status := converter.Convert("series-a", 2); value != 0 || status != Baseline {
		t.Fatalf("first Convert() = (%v, %v), want (0, baseline)", value, status)
	}
	if value, status := converter.Convert("series-a", 3); value != 5 || status != Converted {
		t.Fatalf("second Convert() = (%v, %v), want (5, converted)", value, status)
	}
	if _, status := converter.Convert("series-b", 1); status != Capacity {
		t.Fatalf("capacity Convert() status = %v, want capacity", status)
	}

	now = now.Add(time.Minute + time.Nanosecond)
	if value, status := converter.Convert("series-a", 7); value != 0 || status != Baseline {
		t.Fatalf("expired Convert() = (%v, %v), want new baseline", value, status)
	}
	now = now.Add(time.Minute + time.Nanosecond)
	if removed := converter.Sweep(); removed != 1 || converter.Len() != 0 {
		t.Fatalf("Sweep() removed=%d len=%d, want 1/0", removed, converter.Len())
	}
}

func TestConverterConcurrentSeries(t *testing.T) {
	t.Parallel()

	converter := New(context.Background(), Options{MaxSeries: 1, SweepInterval: time.Hour})
	t.Cleanup(converter.Close)

	const calls = 100
	results := make(chan float64, calls)
	statuses := make(chan Status, calls)
	var wait sync.WaitGroup
	wait.Add(calls)
	for range calls {
		go func() {
			defer wait.Done()
			value, status := converter.Convert("one-series", 1)
			results <- value
			statuses <- status
		}()
	}
	wait.Wait()
	close(results)
	close(statuses)

	baseline := 0
	converted := 0
	for status := range statuses {
		switch status {
		case Baseline:
			baseline++
		case Converted:
			converted++
		case Capacity:
			t.Fatal("same-series update hit capacity")
		}
	}
	if baseline != 1 || converted != calls-1 {
		t.Fatalf("baseline=%d converted=%d, want 1/%d", baseline, converted, calls-1)
	}
	maximum := 0.0
	for value := range results {
		maximum = max(maximum, value)
	}
	if maximum != calls {
		t.Fatalf("maximum cumulative value = %v, want %d", maximum, calls)
	}
}

func TestConverterCleanupLoop(t *testing.T) {
	t.Parallel()

	var now atomic.Int64
	now.Store(time.Now().UnixNano())
	converter := New(context.Background(), Options{
		TTL:           time.Millisecond,
		SweepInterval: time.Millisecond,
		MaxSeries:     1,
		Now:           func() time.Time { return time.Unix(0, now.Load()) },
	})
	t.Cleanup(converter.Close)
	if _, status := converter.Convert("series", 1); status != Baseline {
		t.Fatalf("Convert() status = %v, want baseline", status)
	}
	now.Add(int64(2 * time.Millisecond))
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	poll := time.NewTicker(time.Millisecond)
	defer poll.Stop()
	for converter.Len() != 0 {
		select {
		case <-deadline.C:
			t.Fatal("cleanup loop did not remove expired state")
		case <-poll.C:
		}
	}
}
