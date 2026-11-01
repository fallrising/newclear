package adapters

import (
	"testing"
	"time"
)

func TestSlowSyncIsCountedAndObserved(t *testing.T) {
	var observed time.Duration
	ObserveSlowSyncs(func(took time.Duration) { observed = took })
	t.Cleanup(func() { ObserveSlowSyncs(nil) })
	before := ReadSyncStats().Slow

	recordSync(time.Now().Add(-SlowSyncThreshold))

	if got := ReadSyncStats().Slow - before; got != 1 || observed < SlowSyncThreshold {
		t.Fatalf("slow syncs counted = %d, observed = %v; want 1 and >= %v", got, observed, SlowSyncThreshold)
	}
}

func TestFastSyncIsNotSlow(t *testing.T) {
	called := false
	ObserveSlowSyncs(func(time.Duration) { called = true })
	t.Cleanup(func() { ObserveSlowSyncs(nil) })
	before := ReadSyncStats().Slow

	recordSync(time.Now())

	if got := ReadSyncStats().Slow - before; got != 0 || called {
		t.Fatalf("fast sync counted as slow (delta %d, observer called %v)", got, called)
	}
}
