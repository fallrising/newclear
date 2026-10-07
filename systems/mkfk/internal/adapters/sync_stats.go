package adapters

import (
	"os"
	"sync/atomic"
	"time"
)

// SyncStats summarizes every file and directory sync this process made
// through OSFileSystem. It is observability only; nothing decides on it.
type SyncStats struct {
	Count int64
	Total time.Duration
	Max   time.Duration
}

var syncCount, syncNanos, syncMaxNanos atomic.Int64

func ReadSyncStats() SyncStats {
	return SyncStats{Count: syncCount.Load(), Total: time.Duration(syncNanos.Load()), Max: time.Duration(syncMaxNanos.Load())}
}

func recordSync(started time.Time) {
	elapsed := int64(time.Since(started))
	syncCount.Add(1)
	syncNanos.Add(elapsed)
	for {
		current := syncMaxNanos.Load()
		if elapsed <= current || syncMaxNanos.CompareAndSwap(current, elapsed) {
			return
		}
	}
}

// timedFile is an *os.File whose Sync is measured.
type timedFile struct{ *os.File }

func (f timedFile) Sync() error {
	defer recordSync(time.Now())
	return f.File.Sync()
}
