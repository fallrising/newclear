package partition

import (
	"context"
	"fmt"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// ReadBarrier describes one linearizable read. Begin starts a Raft read
// barrier under the given context name; Confirmed runs on the actor once the
// barrier's read index has applied on this leader; Cancel releases a barrier
// the caller stopped waiting for.
type ReadBarrier struct {
	Begin     func(readContext string) (raft.Ready, error)
	Confirmed func(readContext string) error
	Cancel    func(readContext string)
}

// Read waits for a current-term majority to confirm this leader before
// reading. A deposed or isolated leader never runs Confirmed: it fails with
// raft.ErrNotLeader when it learns of a newer term, or ErrReadTimeout.
func (a *Actor) Read(ctx context.Context, barrier ReadBarrier) error {
	done := make(chan error, 1)
	var readContext string
	err := a.Do(ctx, func() error {
		if len(a.reads) >= a.maxReads {
			return ErrReadCapacity
		}
		a.readSeq++
		readContext = fmt.Sprintf("read-%d", a.readSeq)
		ready, err := barrier.Begin(readContext)
		if err != nil {
			return err
		}
		a.reads[readContext] = func(err error) {
			if err == nil {
				err = barrier.Confirmed(readContext)
			}
			done <- err
		}
		return a.Process(ready, nil)
	})
	if err != nil {
		return err
	}
	select {
	case err := <-done:
		return err
	case <-a.done:
		return ErrClosed
	case <-ctx.Done():
	}
	_ = a.Do(context.Background(), func() error {
		if _, waiting := a.reads[readContext]; waiting {
			delete(a.reads, readContext)
			barrier.Cancel(readContext)
		}
		return nil
	})
	select {
	case err := <-done:
		return err
	default:
		return fmt.Errorf("%w: %v", ErrReadTimeout, ctx.Err())
	}
}

// PendingReads counts read barriers waiting for a majority.
func (a *Actor) PendingReads(ctx context.Context) (int, error) {
	var pending int
	err := a.Do(ctx, func() error {
		pending = len(a.reads)
		return nil
	})
	return pending, err
}

// resolveReads settles barriers after the handler has seen the Ready: a
// leadership loss fails every pending read; a read state confirms its read
// once the read index has applied.
func (a *Actor) resolveReads(ready raft.Ready) {
	for _, change := range ready.RoleChanges {
		if change.To == raft.Leader {
			continue
		}
		for readContext, resolve := range a.reads {
			delete(a.reads, readContext)
			resolve(raft.ErrNotLeader)
		}
	}
	applied := a.node.Snapshot().LastApplied
	for _, state := range ready.ReadStates {
		resolve, waiting := a.reads[state.Context]
		if !waiting {
			continue
		}
		delete(a.reads, state.Context)
		if applied < state.Index {
			resolve(fmt.Errorf("read index %d is not applied (%d)", state.Index, applied))
			continue
		}
		resolve(nil)
	}
}
