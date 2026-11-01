package partition_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition/partitiontest"
	"github.com/fallrising/newclear/systems/mkfk/internal/producer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
)

// A batch whose acknowledgement timed out stays pending in the producer,
// but its replication history entry may be evicted by later writes. The
// identical retry must still find the entry in the WAL and succeed once
// the followers answer, instead of failing for good.
func TestM7RetryOfTimedOutBatchSurvivesHistoryEviction(t *testing.T) {
	t.Parallel()
	cluster := newDataClusterWith(t, replication.Config{MaxPendingOperations: 1, MaxOperationHistory: 1, MaxGateHistory: 1})
	cluster.elect(t, 1)
	first := cluster.produce(t, 1, "a", "warm-a")
	other := cluster.produce(t, 1, "b", "warm-b")
	partitiontest.Converged(t, cluster.data[1].Actor(), cluster.data[2].Actor(), cluster.data[3].Actor())
	cluster.network.Isolate(1)
	request := batch(producerID("a"), first, "timed-out")
	if result, err := cluster.data[1].Produce(context.Background(), "attempt-1", request); err != nil || result.Status != producer.OperationOutcomeUnknown {
		t.Fatalf("produce without followers = %+v, %v; want outcome unknown", result, err)
	}
	// A second producer's write takes the only history slot, evicting the
	// timed-out batch's operation.
	if result, err := cluster.data[1].Produce(context.Background(), "evict", batch(producerID("b"), other, "evicts-history")); err != nil || result.Status != producer.OperationOutcomeUnknown {
		t.Fatalf("second produce = %+v, %v; want outcome unknown", result, err)
	}
	cluster.network.Heal()
	// Ticks are off in this cluster; a new write carries the pending entries
	// to the followers, as a heartbeat would.
	cluster.produce(t, 1, "c", "after-heal")
	partitiontest.Eventually(t, "the identical retry to succeed", func() bool {
		result, err := cluster.data[1].Produce(context.Background(), "attempt-2", request)
		return err == nil && result.Status == producer.OperationSucceeded
	})
}

func batch(producerID string, previous producer.ProduceResult, value string) protocol.ProduceRequest {
	encoded := base64.StdEncoding.EncodeToString([]byte(value))
	return protocol.ProduceRequest{
		Topic: "events", ProducerID: producerID, Epoch: protocol.DecimalUint64(previous.Epoch),
		FirstSequence: protocol.DecimalUint64(previous.NextSequence), Acks: "all",
		Records: []protocol.WireRecord{{KeyBase64: json.RawMessage("null"), ValueBase64: &encoded}},
	}
}
