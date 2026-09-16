package replication

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

func TestM4RF1PersistentHWRecoveryAndCommittedFetch(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "node-1")
	topology := []byte(`{
  "version": 1,
  "cluster_id": "mkfk-m4-rf1",
  "brokers": [
    {"id": 1, "client_addr": "127.0.0.1:59092", "peer_addr": "127.0.0.1:59093", "admin_addr": "127.0.0.1:59094"}
  ],
  "topics": [
    {"name": "events", "internal": false, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]}
  ]
}
`)
	if err := storage.FormatDataDir(root, 1, topology); err != nil {
		t.Fatal(err)
	}
	identity := raft.Identity{ClusterID: "mkfk-m4-rf1", ConfigHash: "exact-fixture", GroupID: "events/0"}
	now := time.Unix(1700000000, 0)
	open := func() (*storage.DataDir, *storage.PartitionLog, *raft.Node, *Controller) {
		dataDir, err := storage.OpenDataDir(root, 1, topology)
		if err != nil {
			t.Fatal(err)
		}
		partition, err := dataDir.OpenPartition("events", 0)
		if err != nil {
			t.Fatal(err)
		}
		node, err := raft.NewNode(raft.Config{
			Identity: identity, NodeID: 1, Voters: []uint32{1}, ElectionTimeoutTicks: 6, HeartbeatTicks: 1,
		}, partition)
		if err != nil {
			t.Fatal(err)
		}
		controller, err := NewController(node, partition, Config{NodeID: 1, Voters: []uint32{1}, MinISR: 1}, now)
		if err != nil {
			t.Fatal(err)
		}
		return dataDir, partition, node, controller
	}
	dataDir, partition, node, controller := open()
	ready, err := node.Campaign()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := controller.HandleReady(ready, now); err != nil {
		t.Fatal(err)
	}
	_, _, completions, err := controller.ProposeData("rf1-operation", "rf1-request", 1, []storage.DataRecord{{Value: []byte("durable-visible")}}, now)
	if err != nil || len(completions) != 1 || completions[0].Status != GateSucceeded || controller.HighWatermark() != 1 {
		t.Fatalf("RF1 completion=%#v HW=%d err=%v", completions, controller.HighWatermark(), err)
	}
	if err := partition.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}

	dataDir, partition, node, controller = open()
	if controller.HighWatermark() != 1 {
		t.Fatalf("recovered HW = %d, want 1", controller.HighWatermark())
	}
	ready, err = node.Campaign()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := controller.HandleReady(ready, now); err != nil {
		t.Fatal(err)
	}
	readReady, err := controller.BeginFetch("rf1-fetch")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := controller.HandleReady(readReady, now); err != nil {
		t.Fatal(err)
	}
	records, next, hw, _, err := controller.Fetch("rf1-fetch", 0, storage.MaxLocalReadBytes)
	if err != nil || len(records) != 1 || next != 1 || hw != 1 || string(records[0].Value) != "durable-visible" {
		t.Fatalf("recovered fetch = %#v next=%d HW=%d err=%v", records, next, hw, err)
	}
	if err := partition.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}
}

var _ RecordLog = (*storage.PartitionLog)(nil)
