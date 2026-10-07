package replication

import (
	"errors"
	"fmt"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// Completed operations and gates must not fill the history for good: a
// long-lived partition keeps admitting writes, its history stays bounded,
// and an evicted operation can still be awaited from the WAL.
func TestM7CompletedHistoryIsEvictedSoWritesNeverStop(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{MaxPendingOperations: 1, MaxOperationHistory: 2, MaxGateHistory: 2})
	leader := cluster.elect(t, 1)
	var first GateResult
	for index := 0; index < 20; index++ {
		id := fmt.Sprintf("op-%d", index)
		_, ready, _, err := leader.ProposeData(id, id, 1, []storage.DataRecord{{Value: []byte("data")}}, cluster.now)
		if errors.Is(err, ErrBackpressure) {
			t.Fatalf("write %d refused after %d completed writes: history never released", index, index)
		}
		if err != nil {
			t.Fatal(err)
		}
		cluster.enqueue(ready.Messages)
		cluster.drainMatching(t, func(raft.Message) bool { return true }, 200)
		gate, ok := leader.Gate(id)
		if !ok || gate.Status != GateSucceeded {
			t.Fatalf("write %d gate = %+v", index, gate)
		}
		if index == 0 {
			first = gate
		}
	}
	if len(leader.operations) > 2 || len(leader.gates) > 2 {
		t.Fatalf("history holds %d operations and %d gates; caps are 2", len(leader.operations), len(leader.gates))
	}
	results, err := leader.AwaitExistingData("op-0", "await-op-0", first.Index, first.BaseOffset, first.LastOffset, first.Term, 4)
	if err != nil || len(results) != 1 || results[0].Status != GateSucceeded {
		t.Fatalf("awaiting an evicted operation = %+v, %v", results, err)
	}
}

// A pending operation is never evicted to make room: its gate still needs
// the operation to release its reservation when the entry commits.
func TestM7PendingOperationIsNeverEvictedFromHistory(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{MaxPendingOperations: 1, MaxOperationHistory: 1, MaxGateHistory: 1})
	leader := cluster.elect(t, 1)
	_, ready, _, err := leader.ProposeData("done", "done", 1, []storage.DataRecord{{Value: []byte("data")}}, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drainMatching(t, func(raft.Message) bool { return true }, 200)
	done, _ := leader.Gate("done")
	if _, _, _, err := leader.ProposeData("pending", "pending", 1, []storage.DataRecord{{Value: []byte("data")}}, cluster.now); err != nil {
		t.Fatal(err)
	}
	if _, err := leader.AwaitExistingData("done", "await-done", done.Index, done.BaseOffset, done.LastOffset, done.Term, 4); !errors.Is(err, ErrBackpressure) {
		t.Fatalf("history full of pending work admitted another operation: %v", err)
	}
	if leader.operations["pending"] == nil {
		t.Fatal("a pending operation was evicted from history")
	}
}
