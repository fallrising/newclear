package partition

import (
	"context"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// Metrics is one partition's observable state. It never holds payloads.
type Metrics struct {
	Snapshot        raft.Snapshot
	LogEndOffset    uint64
	HighWatermark   uint64
	ISRSize         int
	PendingOps      int
	PendingBytes    int64
	PendingReads    int
	InboxDropped    uint64
	RejectedPeerMsg uint64
	Failed          bool
	Fetches         uint64
	FetchSeek       uint64 // segment plus sparse-index comparisons
	FetchScanBytes  uint64 // WAL bytes scanned to serve fetches
}

func (a *Actor) metrics() Metrics {
	return Metrics{
		Snapshot: a.node.Snapshot(), PendingReads: len(a.reads),
		InboxDropped: a.dropped.Load(), RejectedPeerMsg: a.rejected.Load(), Failed: a.failed.Load(),
	}
}

// Metrics reads a data partition's counters on its actor. A failed actor
// still reports what it can.
func (d *Data) Metrics(ctx context.Context) (Metrics, error) {
	if d.actor.failed.Load() {
		return d.actor.Metrics(ctx)
	}
	var metrics Metrics
	err := d.actor.Do(ctx, func() error {
		metrics = d.actor.metrics()
		metrics.LogEndOffset = d.log.LEO()
		metrics.HighWatermark = d.controller.HighWatermark()
		metrics.ISRSize = len(d.controller.ISR())
		metrics.PendingOps, metrics.PendingBytes = d.controller.PendingUsage()
		metrics.Fetches, metrics.FetchSeek, metrics.FetchScanBytes = d.fetches, d.fetchSeek, d.fetchScanBytes
		return nil
	})
	return metrics, err
}

// Metrics reads the actor-level counters of any partition.
func (a *Actor) Metrics(ctx context.Context) (Metrics, error) {
	if a.failed.Load() {
		return Metrics{Failed: true, InboxDropped: a.dropped.Load(), RejectedPeerMsg: a.rejected.Load()}, nil
	}
	var metrics Metrics
	err := a.Do(ctx, func() error {
		metrics = a.metrics()
		return nil
	})
	return metrics, err
}
