package adapters

import (
	"os"
	"sync/atomic"
	"time"
)

// SlowSyncThreshold marks a sync as slow. A partition actor waits for its
// syncs, so one this long already approaches the Raft election timeout.
const SlowSyncThreshold = 500 * time.Millisecond

// SyncStats summarizes every file and directory sync this process made
// through OSFileSystem. It is observability only; nothing decides on it.
type SyncStats struct {
	Count int64
	Slow  int64 // syncs that took at least SlowSyncThreshold
	Total time.Duration
	Max   time.Duration
}

var syncCount, slowSyncCount, syncNanos, syncMaxNanos atomic.Int64

var slowSyncObserver atomic.Pointer[func(time.Duration)]

func ReadSyncStats() SyncStats {
	return SyncStats{Count: syncCount.Load(), Slow: slowSyncCount.Load(), Total: time.Duration(syncNanos.Load()), Max: time.Duration(syncMaxNanos.Load())}
}

// ObserveSlowSyncs registers the process-wide observer called after each
// slow sync, on the goroutine that synced. nil removes it.
func ObserveSlowSyncs(observer func(took time.Duration)) {
	if observer == nil {
		slowSyncObserver.Store(nil)
		return
	}
	slowSyncObserver.Store(&observer)
}

func recordSync(started time.Time) {
	elapsed := time.Since(started)
	syncCount.Add(1)
	syncNanos.Add(int64(elapsed))
	for {
		current := syncMaxNanos.Load()
		if int64(elapsed) <= current || syncMaxNanos.CompareAndSwap(current, int64(elapsed)) {
			break
		}
	}
	if elapsed < SlowSyncThreshold {
		return
	}
	slowSyncCount.Add(1)
	if observer := slowSyncObserver.Load(); observer != nil {
		(*observer)(elapsed)
	}
}

// timedFile is an *os.File whose Sync is measured.
type timedFile struct{ *os.File }

func (f timedFile) Sync() error {
	defer recordSync(time.Now())
	return f.File.Sync()
}
