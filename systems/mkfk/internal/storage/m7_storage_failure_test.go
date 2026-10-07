package storage_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/producer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
	"github.com/fallrising/newclear/systems/mkfk/internal/testkit"
)

const failureTopology = `{
  "version": 1,
  "cluster_id": "mkfk-m7-disk",
  "brokers": [{"id": 1, "client_addr": "127.0.0.1:19092", "peer_addr": "127.0.0.1:19093", "admin_addr": "127.0.0.1:19094"}],
  "topics": [
    {"name": "events", "internal": false, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]}
  ]
}
`

const failureProducer = "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7"

func openFailingData(t *testing.T, directory string, faults *storage.Faults) (*partition.Data, *storage.PartitionLog) {
	t.Helper()
	log, err := storage.OpenPartitionLogWithFaults(directory, "events", 0, faults)
	if err != nil {
		t.Fatal(err)
	}
	node, err := raft.NewNode(raft.Config{
		Identity: raft.Identity{ClusterID: "mkfk-m7-disk", ConfigHash: "topology", GroupID: "events/0"},
		NodeID:   1, Voters: []uint32{1}, ElectionTimeoutTicks: 6, HeartbeatTicks: 1,
	}, log)
	if err != nil {
		t.Fatal(err)
	}
	data, err := partition.NewData(partition.DataConfig{
		Topic: "events", Node: node, Log: log, Replication: replication.Config{NodeID: 1, Voters: []uint32{1}, MinISR: 1},
		Clock: testkit.NewManualClock(time.Unix(1700000000, 0)), TickClock: testkit.NewManualClock(time.Unix(0, 0)),
		StorageFailed: log.RecoveryRequired,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := data.Actor().Campaign(context.Background()); err != nil {
		t.Fatal(err)
	}
	return data, log
}

func produceOne(data *partition.Data, epoch uint64, sequence uint64, value string) (producer.ProduceResult, error) {
	encoded := base64.StdEncoding.EncodeToString([]byte(value))
	return data.Produce(context.Background(), "produce-"+value, protocol.ProduceRequest{
		Topic: "events", ProducerID: failureProducer, Epoch: protocol.DecimalUint64(epoch), FirstSequence: protocol.DecimalUint64(sequence),
		Acks: "all", Records: []protocol.WireRecord{{KeyBase64: json.RawMessage("null"), ValueBase64: &encoded}},
	})
}

// OP-03 disk-full and sync failure: the write is never acknowledged, its
// outcome is reported unknown (it may survive recovery), the partition stops
// serving instead of retrying against a quarantined log, and a restart
// recovers every acknowledged record.
func TestM7OP03DiskFullAndSyncFailureFailClosedWithoutFalseAck(t *testing.T) {
	t.Parallel()
	for name, inject := range map[string]func(*storage.Faults){
		"disk full":    func(f *storage.Faults) { f.FailWrite.Store(true) },
		"sync failure": func(f *storage.Faults) { f.FailSync.Store(true) },
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			root := filepath.Join(t.TempDir(), "node-1")
			if err := storage.FormatDataDir(root, 1, []byte(failureTopology)); err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(root, "partitions", "events", "0")
			faults := &storage.Faults{}
			data, log := openFailingData(t, directory, faults)
			opened, err := data.OpenProducer(context.Background(), protocol.OpenProducerRequest{
				Topic: "events", ProducerID: failureProducer, ExpectedEpoch: -1, RequestID: "open",
			})
			if err != nil || opened.Status != producer.OperationSucceeded {
				t.Fatalf("open = %+v, %v", opened, err)
			}
			if result, err := produceOne(data, opened.Epoch, 0, "acknowledged"); err != nil || result.Status != producer.OperationSucceeded {
				t.Fatalf("healthy produce = %+v, %v", result, err)
			}
			inject(faults)
			result, err := produceOne(data, opened.Epoch, 1, "failed")
			if !errors.Is(err, partition.ErrStorage) || result.Status == producer.OperationSucceeded {
				t.Fatalf("produce on a failing disk = %+v, %v; want ErrStorage (outcome unknown)", result, err)
			}
			if !log.RecoveryRequired() || data.Actor().Err() == nil {
				t.Fatal("the partition kept serving a quarantined log")
			}
			if _, err := produceOne(data, opened.Epoch, 1, "failed"); !errors.Is(err, partition.ErrFailed) {
				t.Fatalf("produce after the failure = %v, want ErrFailed", err)
			}
			if _, err := data.HighWatermark(context.Background()); !errors.Is(err, partition.ErrFailed) {
				t.Fatalf("HW proof after the failure = %v, want ErrFailed", err)
			}
			data.Close()
			_ = log.Close()

			recovered, recoveredLog := openFailingData(t, directory, &storage.Faults{})
			defer func() {
				recovered.Close()
				_ = recoveredLog.Close()
			}()
			var fetched protocol.FetchResponseData
			partitiontestEventually(t, func() bool {
				fetched, err = recovered.Fetch(context.Background(), protocol.FetchRequest{Topic: "events", MaxBytes: 1 << 20})
				return err == nil
			})
			values := map[string]int{}
			for _, record := range fetched.Records {
				value, _ := base64.StdEncoding.DecodeString(record.ValueBase64)
				values[string(value)]++
			}
			if values["acknowledged"] != 1 || values["failed"] > 1 || len(fetched.Records) > 2 {
				t.Fatalf("records after recovery = %v", values)
			}
			t.Logf("after recovery: acknowledged=1 failed-write=%d (unknown outcome either way)", values["failed"])
		})
	}
}

func partitiontestEventually(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
