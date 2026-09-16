package producer

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

func TestM5PR01PR02PR03PersistentRetryDoesNotAppend(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "node-1")
	topology := m5RF1Topology()
	if err := storage.FormatDataDir(root, 1, topology); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1700000000, 0)
	identity := raft.Identity{ClusterID: "mkfk-m5-rf1", ConfigHash: "m5-fixture", GroupID: "events/0"}
	open := func() (*storage.DataDir, *storage.PartitionLog, *raft.Node, *replication.Controller, *Partition) {
		dataDir, err := storage.OpenDataDir(root, 1, topology)
		if err != nil {
			t.Fatal(err)
		}
		log, err := dataDir.OpenPartition("events", 0)
		if err != nil {
			t.Fatal(err)
		}
		node, err := raft.NewNode(raft.Config{
			Identity: identity, NodeID: 1, Voters: []uint32{1}, ElectionTimeoutTicks: 6, HeartbeatTicks: 1,
		}, log)
		if err != nil {
			t.Fatal(err)
		}
		controller, err := replication.NewController(node, log, replication.Config{NodeID: 1, Voters: []uint32{1}, MinISR: 1}, now)
		if err != nil {
			t.Fatal(err)
		}
		producerPartition, err := NewPartition(node, controller, PartitionConfig{Topic: "events", PartitionID: 0})
		if err != nil {
			t.Fatal(err)
		}
		return dataDir, log, node, controller, producerPartition
	}
	dataDir, log, node, _, producerPartition := open()
	campaign, err := node.Campaign()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := producerPartition.HandleReady(campaign, now); err != nil {
		t.Fatal(err)
	}
	openRequest := protocol.OpenProducerRequest{
		Topic: "events", ProducerID: testProducerID, ExpectedEpoch: -1, RequestID: "open-0",
	}
	openResult, _, _, err := producerPartition.Open(openRequest, now)
	if err != nil || openResult.Status != OperationSucceeded || openResult.Epoch != 0 {
		t.Fatalf("open = %#v, %v", openResult, err)
	}
	request := testProduceRequest(t, 0, 0, "one-copy")
	result, _, _, err := producerPartition.Produce("produce-original", request, 1, now)
	if err != nil || result.Status != OperationSucceeded || result.Duplicate || result.BaseOffset != 0 || result.LastOffset != 0 {
		t.Fatalf("first produce = %#v, %v", result, err)
	}
	dataIndex := node.Snapshot().LastLogIndex
	for retry := 0; retry < 100; retry++ {
		result, _, _, err = producerPartition.Produce(fmt.Sprintf("produce-retry-%d", retry), request, 2, now)
		if err != nil || result.Status != OperationSucceeded || !result.Duplicate || result.BaseOffset != 0 || result.LastOffset != 0 {
			t.Fatalf("retry %d = %#v, %v", retry, result, err)
		}
		if node.Snapshot().LastLogIndex != dataIndex {
			t.Fatalf("retry %d appended at index %d, want %d", retry, node.Snapshot().LastLogIndex, dataIndex)
		}
	}
	if err := log.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}

	dataDir, log, node, _, producerPartition = open()
	campaign, err = node.Campaign()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := producerPartition.HandleReady(campaign, now); err != nil {
		t.Fatal(err)
	}
	beforeRetry := node.Snapshot().LastLogIndex
	result, _, _, err = producerPartition.Produce("produce-after-restart", request, 3, now)
	if err != nil || result.Status != OperationSucceeded || !result.Duplicate || result.BaseOffset != 0 || node.Snapshot().LastLogIndex != beforeRetry {
		t.Fatalf("restart retry = %#v index=%d/%d, %v", result, node.Snapshot().LastLogIndex, beforeRetry, err)
	}
	openResult, _, _, err = producerPartition.Open(openRequest, now)
	if err != nil || openResult.Status != OperationSucceeded || openResult.Epoch != 0 {
		t.Fatalf("restart OpenProducer replay = %#v, %v", openResult, err)
	}
	openRequest.ExpectedEpoch = 0
	openRequest.RequestID = "open-1"
	openResult, _, _, err = producerPartition.Open(openRequest, now)
	if err != nil || openResult.Status != OperationSucceeded || openResult.Epoch != 1 {
		t.Fatalf("epoch increment = %#v, %v", openResult, err)
	}
	if _, _, _, err := producerPartition.Produce("old-epoch", request, 4, now); !IsCode(err, CodeFencedProducer) {
		t.Fatalf("old epoch produce error = %v", err)
	}
	if err := log.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestM5PR06UncommittedProducerStateDoesNotSurviveReplayOrTruncate(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "node-1")
	topology := m5RF3Topology()
	if err := storage.FormatDataDir(root, 1, topology); err != nil {
		t.Fatal(err)
	}
	dataDir, err := storage.OpenDataDir(root, 1, topology)
	if err != nil {
		t.Fatal(err)
	}
	log, err := dataDir.OpenPartition("events", 0)
	if err != nil {
		t.Fatal(err)
	}
	committedFence := testFenceFrame(t, 2, 1, -1, 0, "committed-open")
	digest := testDigest(t, "uncommitted")
	uncommittedData := testDataFrame(t, 3, 1, 0, 0, 0, digest, "uncommitted")
	uncommittedFence := testFenceFrame(t, 4, 1, 0, 1, "uncommitted-open")
	if err := log.AppendEntries([]storage.Frame{
		{Kind: storage.KindNOOP, LogIndex: 1, Term: 1, Payload: []byte("{}")},
		committedFence, uncommittedData, uncommittedFence,
	}); err != nil {
		t.Fatal(err)
	}
	if err := log.PersistHardState(storage.HardState{CurrentTerm: 1, CommitIndex: 2}); err != nil {
		t.Fatal(err)
	}
	if err := log.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}

	open := func() (*storage.DataDir, *storage.PartitionLog, *Partition) {
		dataDir, err := storage.OpenDataDir(root, 1, topology)
		if err != nil {
			t.Fatal(err)
		}
		log, err := dataDir.OpenPartition("events", 0)
		if err != nil {
			t.Fatal(err)
		}
		node, err := raft.NewNode(raft.Config{
			Identity: raft.Identity{ClusterID: "mkfk-m5-rf3", ConfigHash: "m5-rf3", GroupID: "events/0"},
			NodeID:   1, Voters: []uint32{1, 2, 3}, ElectionTimeoutTicks: 7, HeartbeatTicks: 1,
		}, log)
		if err != nil {
			t.Fatal(err)
		}
		controller, err := replication.NewController(node, log, replication.Config{
			NodeID: 1, Voters: []uint32{1, 2, 3}, MinISR: 2,
		}, time.Unix(1700000000, 0))
		if err != nil {
			t.Fatal(err)
		}
		partition, err := NewPartition(node, controller, PartitionConfig{Topic: "events", PartitionID: 0})
		if err != nil {
			t.Fatal(err)
		}
		return dataDir, log, partition
	}
	dataDir, log, producerPartition := open()
	producerState, exists := producerPartition.State().Producer(testProducerID)
	if !exists || producerState.Epoch != 0 || producerState.NextSequence != 0 || len(producerState.Batches) != 0 {
		t.Fatalf("uncommitted suffix polluted recovered state: %#v", producerState)
	}
	if log.LEO() != 1 {
		t.Fatalf("fixture did not retain the uncommitted DATA tail: LEO=%d", log.LEO())
	}
	if err := log.TruncateSuffix(3); err != nil {
		t.Fatal(err)
	}
	if log.LEO() != 0 {
		t.Fatalf("truncated producer DATA still affected LEO: %d", log.LEO())
	}
	if err := log.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}

	dataDir, log, producerPartition = open()
	producerState, exists = producerPartition.State().Producer(testProducerID)
	if !exists || producerState.Epoch != 0 || producerState.NextSequence != 0 || len(producerState.Batches) != 0 {
		t.Fatalf("post-truncate replay state = %#v", producerState)
	}
	if err := log.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}
}

func testProduceRequest(t *testing.T, epoch, sequence uint64, value string) protocol.ProduceRequest {
	t.Helper()
	encodedValue := base64.StdEncoding.EncodeToString([]byte(value))
	return protocol.ProduceRequest{
		Topic: "events", ProducerID: testProducerID,
		Epoch: protocol.DecimalUint64(epoch), FirstSequence: protocol.DecimalUint64(sequence), Acks: "all",
		Records: []protocol.WireRecord{{KeyBase64: json.RawMessage("null"), ValueBase64: &encodedValue}},
	}
}

func m5RF1Topology() []byte {
	return []byte(`{
  "version": 1,
  "cluster_id": "mkfk-m5-rf1",
  "brokers": [
    {"id": 1, "client_addr": "127.0.0.1:59092", "peer_addr": "127.0.0.1:59093", "admin_addr": "127.0.0.1:59094"}
  ],
  "topics": [
    {"name": "events", "internal": false, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]}
	  ]
	}
	`)
}

func m5RF3Topology() []byte {
	return []byte(`{
  "version": 1,
  "cluster_id": "mkfk-m5-rf3",
  "brokers": [
    {"id": 1, "client_addr": "127.0.0.1:59192", "peer_addr": "127.0.0.1:59193", "admin_addr": "127.0.0.1:59194"},
    {"id": 2, "client_addr": "127.0.0.1:59292", "peer_addr": "127.0.0.1:59293", "admin_addr": "127.0.0.1:59294"},
    {"id": 3, "client_addr": "127.0.0.1:59392", "peer_addr": "127.0.0.1:59393", "admin_addr": "127.0.0.1:59394"}
  ],
  "topics": [
    {"name": "events", "internal": false, "partitions": [{"id": 0, "replicas": [1, 2, 3], "min_isr": 2}]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1, 2, 3], "min_isr": 2}]}
  ]
}
`)
}
