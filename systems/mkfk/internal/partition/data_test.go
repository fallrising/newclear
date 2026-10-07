package partition_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/partition/partitiontest"
	"github.com/fallrising/newclear/systems/mkfk/internal/producer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
	"github.com/fallrising/newclear/systems/mkfk/internal/testkit"
)

const rf3Topology = `{
  "version": 1,
  "cluster_id": "mkfk-m7-actor",
  "brokers": [
    {"id": 1, "client_addr": "127.0.0.1:41091", "peer_addr": "127.0.0.1:41191", "admin_addr": "127.0.0.1:41291"},
    {"id": 2, "client_addr": "127.0.0.1:41092", "peer_addr": "127.0.0.1:41192", "admin_addr": "127.0.0.1:41292"},
    {"id": 3, "client_addr": "127.0.0.1:41093", "peer_addr": "127.0.0.1:41193", "admin_addr": "127.0.0.1:41293"}
  ],
  "topics": [
    {"name": "events", "internal": false, "partitions": [{"id": 0, "replicas": [1, 2, 3], "min_isr": 2}]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1, 2, 3], "min_isr": 2}]}
  ]
}
`

// producerID returns a distinct valid producer ID per one-letter hex label.
func producerID(label string) string { return "6b1f3c5e-2a4d-4e8f-9b0a-1c2d3e4f5a6" + label }

var voters = []uint32{1, 2, 3}

type dataCluster struct {
	network *partitiontest.Network
	data    map[uint32]*partition.Data
}

// newDataCluster runs events/0 on three real WALs. Ticks never fire: the
// test drives elections explicitly and every other step is message-driven.
func newDataCluster(t *testing.T) *dataCluster {
	t.Helper()
	clock := testkit.NewManualClock(time.Unix(1700000000, 0))
	cluster := &dataCluster{network: partitiontest.NewNetwork(t, voters...), data: map[uint32]*partition.Data{}}
	for _, id := range voters {
		root := filepath.Join(t.TempDir(), fmt.Sprintf("node-%d", id))
		if err := storage.FormatDataDir(root, id, []byte(rf3Topology)); err != nil {
			t.Fatal(err)
		}
		dataDir, err := storage.OpenDataDir(root, id, []byte(rf3Topology))
		if err != nil {
			t.Fatal(err)
		}
		log, err := dataDir.OpenPartition("events", 0)
		if err != nil {
			t.Fatal(err)
		}
		node, err := raft.NewNode(raft.Config{
			Identity: raft.Identity{ClusterID: "mkfk-m7-actor", ConfigHash: "topology", GroupID: "events/0"},
			NodeID:   id, Voters: voters, ElectionTimeoutTicks: 6, HeartbeatTicks: 1,
		}, log)
		if err != nil {
			t.Fatal(err)
		}
		data, err := partition.NewData(partition.DataConfig{
			Topic: "events", Partition: 0, Node: node, Log: log,
			Replication: replication.Config{NodeID: id, Voters: voters, MinISR: 2},
			Clock:       clock, TickClock: testkit.NewManualClock(time.Unix(0, 0)),
			Sender: cluster.network.Sender(id), ProduceTimeout: 300 * time.Millisecond,
		})
		if err != nil {
			t.Fatal(err)
		}
		cluster.network.Registry(id).Add("events/0", data.Actor())
		cluster.data[id] = data
		t.Cleanup(func() {
			data.Close()
			_ = log.Close()
			_ = dataDir.Close()
		})
	}
	return cluster
}

func (c *dataCluster) elect(t *testing.T, id uint32) {
	t.Helper()
	if err := c.data[id].Actor().Campaign(context.Background()); err != nil {
		t.Fatal(err)
	}
	partitiontest.Eventually(t, fmt.Sprintf("node %d to lead", id), func() bool {
		snapshot, err := c.data[id].Actor().Snapshot(context.Background())
		return err == nil && snapshot.Role == raft.Leader && snapshot.LeaderReady
	})
}

// produce opens a new producer and appends values; it retries while the
// followers are still joining the ISR after an election.
func (c *dataCluster) produce(t *testing.T, id uint32, label string, values ...string) producer.ProduceResult {
	t.Helper()
	ctx := context.Background()
	var opened producer.OpenResult
	partitiontest.Eventually(t, "producer to open", func() bool {
		var err error
		opened, err = c.data[id].OpenProducer(ctx, protocol.OpenProducerRequest{
			Topic: "events", ProducerID: producerID(label), ExpectedEpoch: -1, RequestID: "open-" + label,
		})
		return err == nil && opened.Status == producer.OperationSucceeded
	})
	records := make([]protocol.WireRecord, len(values))
	for index, value := range values {
		encoded := base64.StdEncoding.EncodeToString([]byte(value))
		records[index] = protocol.WireRecord{KeyBase64: json.RawMessage("null"), ValueBase64: &encoded}
	}
	var result producer.ProduceResult
	partitiontest.Eventually(t, "produce to succeed", func() bool {
		var err error
		result, err = c.data[id].Produce(ctx, "produce-"+label, protocol.ProduceRequest{
			Topic: "events", ProducerID: producerID(label), Epoch: protocol.DecimalUint64(opened.Epoch),
			Acks: "all", Records: records,
		})
		return err == nil && result.Status == producer.OperationSucceeded
	})
	return result
}

func TestM7RF3DataLeaderProducesFetchesAndProvesHighWatermark(t *testing.T) {
	t.Parallel()
	cluster := newDataCluster(t)
	cluster.elect(t, 1)
	result := cluster.produce(t, 1, "a", "v0", "v1", "v2")
	if result.BaseOffset != 0 || result.LastOffset != 2 {
		t.Fatalf("produce offsets = %d..%d", result.BaseOffset, result.LastOffset)
	}
	ctx := context.Background()
	fetched, err := cluster.data[1].Fetch(ctx, protocol.FetchRequest{Topic: "events", Offset: 0, MaxBytes: 1 << 20})
	if err != nil || len(fetched.Records) != 3 || fetched.HighWatermark != 3 {
		t.Fatalf("leader fetch = %+v, %v", fetched, err)
	}
	if hw, err := cluster.data[1].HighWatermark(ctx); err != nil || hw != 3 {
		t.Fatalf("leader HW proof = %d, %v", hw, err)
	}
	if _, err := cluster.data[2].HighWatermark(ctx); !errors.Is(err, raft.ErrNotLeader) {
		t.Fatalf("follower HW proof error = %v, want ErrNotLeader", err)
	}
	if _, err := cluster.data[3].Fetch(ctx, protocol.FetchRequest{Topic: "events", MaxBytes: 1024}); !errors.Is(err, raft.ErrNotLeader) {
		t.Fatalf("follower fetch error = %v, want ErrNotLeader", err)
	}
}

// A leader cut off from its peers still believes it leads. It must not hand
// out a high-watermark proof or serve a fetch: the majority has moved on.
func TestM7DeposedDataLeaderCannotProveHighWatermarkOrFetch(t *testing.T) {
	t.Parallel()
	cluster := newDataCluster(t)
	cluster.elect(t, 1)
	first := cluster.produce(t, 1, "a", "v0")
	cluster.network.Isolate(1)
	cluster.elect(t, 2)
	cluster.produce(t, 2, "b", "v1", "v2")
	ctx := context.Background()
	if hw, err := cluster.data[2].HighWatermark(ctx); err != nil || hw != 3 {
		t.Fatalf("new leader HW proof = %d, %v", hw, err)
	}
	if snapshot, _ := cluster.data[1].Actor().Snapshot(ctx); snapshot.Role != raft.Leader {
		t.Fatalf("isolated node should still believe it leads: %+v", snapshot)
	}
	if hw, err := cluster.data[1].HighWatermark(shortContext(t)); !errors.Is(err, replication.ErrReadBarrier) {
		t.Fatalf("deposed leader HW proof = %d, %v; want ErrReadBarrier", hw, err)
	}
	if fetched, err := cluster.data[1].Fetch(shortContext(t), protocol.FetchRequest{Topic: "events", MaxBytes: 1024}); !errors.Is(err, replication.ErrReadBarrier) {
		t.Fatalf("deposed leader fetch = %+v, %v; want ErrReadBarrier", fetched, err)
	}
	result, err := cluster.data[1].Produce(ctx, "stale", protocol.ProduceRequest{
		Topic: "events", ProducerID: producerID("a"), Epoch: protocol.DecimalUint64(first.Epoch),
		FirstSequence: protocol.DecimalUint64(first.NextSequence), Acks: "all",
		Records: []protocol.WireRecord{{KeyBase64: json.RawMessage("null"), ValueBase64: new(string)}},
	})
	if err != nil || result.Status != producer.OperationOutcomeUnknown {
		t.Fatalf("deposed leader produce = %+v, %v; want outcome unknown, never success or not-applied", result, err)
	}

	// A read still waiting when the old leader learns the new term fails at
	// once with ErrNotLeader instead of waiting for its deadline.
	pending := make(chan error, 1)
	go func() {
		_, err := cluster.data[1].HighWatermark(ctx)
		pending <- err
	}()
	partitiontest.Eventually(t, "read to wait on the isolated leader", func() bool {
		count, err := cluster.data[1].Actor().PendingReads(ctx)
		return err == nil && count == 1
	})
	cluster.network.Heal()
	cluster.produce(t, 2, "c", "v3")
	select {
	case err := <-pending:
		if !errors.Is(err, raft.ErrNotLeader) {
			t.Fatalf("pending read on the deposed leader = %v, want ErrNotLeader", err)
		}
	case <-time.After(partition.DefaultReadTimeout / 2):
		t.Fatal("pending read was not failed when the leader stepped down")
	}
}

func shortContext(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	t.Cleanup(cancel)
	return ctx
}
