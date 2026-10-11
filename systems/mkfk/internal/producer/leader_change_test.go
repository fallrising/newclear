package producer

import (
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// Records current behaviour, not the intended one. A batch is acknowledged
// by the old leader, which dies before the followers learn the commit. The
// producer's next batch then reaches a broker whose applied producer state
// is one batch behind: first a follower, then the new leader before its
// current-term barrier. Both answer OUT_OF_ORDER_SEQUENCE, a non-retryable
// error that tells a correct client it has a bug, where NOT_LEADER and
// NOT_READY apply. Once the barrier completes the same batch is accepted.
func TestM7ProduceAfterLeaderChangeAnswersOutOfOrderSequenceBeforeTheBarrier(t *testing.T) {
	t.Parallel()
	cluster := newProducerCluster(t)
	oldLeader := cluster.elect(t, 1)
	_, ready, _, err := oldLeader.Open(protocolOpenRequest(-1, "open"), cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drain(t, 300)
	cluster.heartbeat(t, 1)

	first := testProduceRequest(t, 0, 0, "acknowledged-by-old-leader")
	_, ready, _, err = oldLeader.Produce("first", first, 1, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.deliverQueued(t) // the append reaches both followers
	cluster.deliverQueued(t) // their acks reach the leader, which commits
	cluster.queue = nil      // the leader dies before it tells them
	if result, _, _, err := oldLeader.Produce("first-again", first, 1, cluster.now); err != nil || result.Status != OperationSucceeded {
		t.Fatalf("old leader did not acknowledge the first batch: %#v, %v", result, err)
	}
	if state, _ := cluster.partitions[2].State().Producer(testProducerID); state.NextSequence != 0 {
		t.Fatalf("follower already applied the first batch: %#v", state)
	}

	second := testProduceRequest(t, 0, 1, "next-batch")
	if _, _, _, err := cluster.partitions[2].Produce("second-at-follower", second, 2, cluster.now); !IsCode(err, CodeOutOfOrderSequence) {
		t.Fatalf("follower answered %v", err)
	}

	cluster.isolate(1)
	ready, err = cluster.nodes[2].Campaign()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cluster.partitions[2].HandleReady(ready, cluster.now); err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.deliverQueued(t) // the vote request reaches node 3
	cluster.deliverQueued(t) // its vote makes node 2 leader; the NOOP is not committed yet
	if snapshot := cluster.nodes[2].Snapshot(); snapshot.Role != raft.Leader || snapshot.LeaderReady {
		t.Fatalf("node 2 should lead without a completed barrier: %#v", snapshot)
	}
	if _, _, _, err := cluster.partitions[2].Produce("second-before-barrier", second, 2, cluster.now); !IsCode(err, CodeOutOfOrderSequence) {
		t.Fatalf("new leader before its barrier answered %v", err)
	}

	cluster.drain(t, 300)
	result, ready, _, err := cluster.partitions[2].Produce("second-after-barrier", second, 2, cluster.now)
	if err != nil {
		t.Fatalf("new leader after its barrier answered %v", err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drain(t, 300)
	if result, _, _, err = cluster.partitions[2].Produce("second-again", second, 2, cluster.now); err != nil || result.Status != OperationSucceeded || result.BaseOffset != 1 {
		t.Fatalf("second batch after the barrier = %#v, %v", result, err)
	}
}

// deliverQueued delivers the messages queued now, not the ones they cause.
func (cluster *producerCluster) deliverQueued(t *testing.T) {
	t.Helper()
	queued := cluster.queue
	cluster.queue = nil
	for _, message := range queued {
		cluster.deliver(t, message)
	}
}
