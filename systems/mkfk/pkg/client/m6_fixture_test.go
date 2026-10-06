package client

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/group"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
	"github.com/fallrising/newclear/systems/mkfk/internal/testkit"
	"github.com/fallrising/newclear/systems/mkfk/internal/transport"
)

const m6Topology = `{
  "version": 1,
  "cluster_id": "mkfk-m6-rf1",
  "brokers": [
    {"id": 1, "client_addr": "127.0.0.1:59092", "peer_addr": "127.0.0.1:59093", "admin_addr": "127.0.0.1:59094"}
  ],
  "topics": [
    {"name": "events", "internal": false, "partitions": [
      {"id": 0, "replicas": [1], "min_isr": 1}, {"id": 1, "replicas": [1], "min_isr": 1}, {"id": 2, "replicas": [1], "min_isr": 1}
    ]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]}
  ]
}
`

const m6Partitions = 3

// dataPartition is one RF1 data partition on the real WAL. Its mutex only
// serializes this partition's actor calls; it is not shared across partitions.
type dataPartition struct {
	mu         sync.Mutex
	log        *storage.PartitionLog
	node       *raft.Node
	controller *replication.Controller
	reads      uint64
}

// m6Broker wires one RF1 node's data partitions and group coordinator, on a
// real formatted data directory, behind the public HTTP handlers.
type m6Broker struct {
	t       *testing.T
	root    string
	clock   *testkit.ManualClock
	dataDir *storage.DataDir
	groups  *storage.PartitionLog
	service atomic.Pointer[group.Service]
	data    atomic.Pointer[[m6Partitions]*dataPartition]
	server  *httptest.Server
}

func newM6Broker(t *testing.T) *m6Broker {
	t.Helper()
	broker := &m6Broker{t: t, root: filepath.Join(t.TempDir(), "node-1"), clock: testkit.NewManualClock(time.Unix(1700000000, 0))}
	if err := storage.FormatDataDir(broker.root, 1, []byte(m6Topology)); err != nil {
		t.Fatal(err)
	}
	broker.open()
	groupHandler, err := transport.NewGroupHandler(swappableGroups{broker})
	if err != nil {
		t.Fatal(err)
	}
	fetchHandler, err := transport.NewFetchHandler(broker)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/groups/", groupHandler)
	mux.Handle("/v1/fetch", fetchHandler)
	broker.server = httptest.NewServer(mux)
	t.Cleanup(func() {
		broker.server.Close()
		broker.close()
	})
	return broker
}

// open recovers every partition from the WAL and elects the RF1 leaders.
func (broker *m6Broker) open() {
	t := broker.t
	t.Helper()
	dataDir, err := storage.OpenDataDir(broker.root, 1, []byte(m6Topology))
	if err != nil {
		t.Fatal(err)
	}
	broker.dataDir = dataDir
	var data [m6Partitions]*dataPartition
	for id := range data {
		data[id] = broker.openData(uint32(id))
	}
	broker.data.Store(&data)
	broker.groups, err = dataDir.OpenPartition("__mkfk_groups", 0)
	if err != nil {
		t.Fatal(err)
	}
	node := broker.newNode("__mkfk_groups/0", broker.groups)
	service, err := group.NewService(node, group.CoordinatorConfig{
		State:          group.Config{Partitions: func(topic string) (uint32, bool) { return m6Partitions, topic == "events" }},
		HighWatermarks: broker,
	}, broker.clock)
	if err != nil {
		t.Fatal(err)
	}
	broker.service.Store(service)
}

func (broker *m6Broker) openData(id uint32) *dataPartition {
	t := broker.t
	log, err := broker.dataDir.OpenPartition("events", id)
	if err != nil {
		t.Fatal(err)
	}
	node := broker.newNode(fmt.Sprintf("events/%d", id), log)
	controller, err := replication.NewController(node, log, replication.Config{NodeID: 1, Voters: []uint32{1}, MinISR: 1}, broker.clock.Now())
	if err != nil {
		t.Fatal(err)
	}
	ready, err := node.Campaign()
	if err == nil {
		_, err = controller.HandleReady(ready, broker.clock.Now())
	}
	if err != nil {
		t.Fatal(err)
	}
	return &dataPartition{log: log, node: node, controller: controller}
}

func (broker *m6Broker) newNode(raftGroup string, log raft.DurableLog) *raft.Node {
	node, err := raft.NewNode(raft.Config{
		Identity: raft.Identity{ClusterID: "mkfk-m6-rf1", ConfigHash: "m6-fixture", GroupID: raftGroup},
		NodeID:   1, Voters: []uint32{1}, ElectionTimeoutTicks: 6, HeartbeatTicks: 1,
	}, log)
	if err != nil {
		broker.t.Fatal(err)
	}
	return node
}

// restart kills the RF1 broker, including the group coordinator, and
// recovers every partition from its WAL in a new leader term.
func (broker *m6Broker) restart() {
	broker.t.Helper()
	broker.close()
	broker.open()
}

func (broker *m6Broker) close() {
	broker.service.Load().Close()
	for _, partition := range broker.data.Load() {
		if err := partition.log.Close(); err != nil {
			broker.t.Fatal(err)
		}
	}
	if err := broker.groups.Close(); err != nil {
		broker.t.Fatal(err)
	}
	if err := broker.dataDir.Close(); err != nil {
		broker.t.Fatal(err)
	}
}

func (broker *m6Broker) produce(partition uint32, values ...string) {
	t := broker.t
	t.Helper()
	data := broker.data.Load()[partition]
	data.mu.Lock()
	defer data.mu.Unlock()
	records := make([]storage.DataRecord, 0, len(values))
	for _, value := range values {
		records = append(records, storage.DataRecord{Value: []byte(value)})
	}
	id := fmt.Sprintf("produce-%d-%d", partition, data.log.LEO())
	_, _, results, err := data.controller.ProposeData(id, id, uint64(broker.clock.Now().UnixMilli()), records, broker.clock.Now())
	if err != nil || len(results) != 1 || results[0].Status != replication.GateSucceeded {
		t.Fatalf("produce to events/%d: %#v %v", partition, results, err)
	}
}

// HighWatermark is the coordinator's quorum-confirmed HW proof (RF1 leader).
func (broker *m6Broker) HighWatermark(topic string, partition uint32) (uint64, error) {
	if topic != "events" || partition >= m6Partitions {
		return 0, transport.ErrUnknownPartition
	}
	data := broker.data.Load()[partition]
	data.mu.Lock()
	defer data.mu.Unlock()
	return data.controller.HighWatermark(), nil
}

// Fetch reads committed records after the data leader's read barrier.
func (broker *m6Broker) Fetch(_ context.Context, request protocol.FetchRequest) (protocol.FetchResponseData, error) {
	if request.Topic != "events" || request.Partition >= m6Partitions {
		return protocol.FetchResponseData{}, transport.ErrUnknownPartition
	}
	data := broker.data.Load()[request.Partition]
	data.mu.Lock()
	defer data.mu.Unlock()
	data.reads++
	readContext := fmt.Sprintf("fetch-%d", data.reads)
	ready, err := data.controller.BeginFetch(readContext)
	if err == nil {
		_, err = data.controller.HandleReady(ready, broker.clock.Now())
	}
	if err != nil {
		return protocol.FetchResponseData{}, err
	}
	records, next, hw, _, err := data.controller.Fetch(readContext, uint64(request.Offset), int(request.MaxBytes))
	if err != nil {
		return protocol.FetchResponseData{}, err
	}
	response := protocol.FetchResponseData{
		Records: []protocol.FetchedRecord{}, NextOffset: protocol.DecimalUint64(next), HighWatermark: protocol.DecimalUint64(hw),
		LogEndOffset: protocol.DecimalUint64(data.log.LEO()), LeaderTerm: protocol.DecimalUint64(data.node.Snapshot().Term),
	}
	for _, record := range records {
		fetched := protocol.FetchedRecord{
			Offset: protocol.DecimalUint64(record.Offset), ValueBase64: base64.StdEncoding.EncodeToString(record.Value),
			AppendTimestampMS: protocol.DecimalUint64(record.AppendTimestamp),
		}
		if record.Key != nil {
			key := base64.StdEncoding.EncodeToString(record.Key)
			fetched.KeyBase64 = &key
		}
		response.Records = append(response.Records, fetched)
	}
	return response, nil
}

func (broker *m6Broker) checkTimers() {
	broker.t.Helper()
	if err := broker.service.Load().CheckTimers(context.Background()); err != nil {
		broker.t.Fatal(err)
	}
}

func (broker *m6Broker) view(groupID string) group.View {
	view, _, err := broker.service.Load().View(context.Background(), groupID)
	if err != nil {
		broker.t.Fatal(err)
	}
	return view
}

func (broker *m6Broker) transport() *HTTPTransport {
	transport, err := NewHTTPTransport(broker.server.Client(), map[uint32]string{1: broker.server.URL}, 1)
	if err != nil {
		broker.t.Fatal(err)
	}
	return transport
}

// swappableGroups routes to the current coordinator across restarts.
type swappableGroups struct{ broker *m6Broker }

func (s swappableGroups) JoinGroup(ctx context.Context, g string, r protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error) {
	return s.broker.service.Load().JoinGroup(ctx, g, r)
}

func (s swappableGroups) SyncGroup(ctx context.Context, g string, r protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error) {
	return s.broker.service.Load().SyncGroup(ctx, g, r)
}

func (s swappableGroups) Heartbeat(ctx context.Context, g string, r protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error) {
	return s.broker.service.Load().Heartbeat(ctx, g, r)
}

func (s swappableGroups) LeaveGroup(ctx context.Context, g string, r protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error) {
	return s.broker.service.Load().LeaveGroup(ctx, g, r)
}

func (s swappableGroups) CommitOffsets(ctx context.Context, g string, r protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	return s.broker.service.Load().CommitOffsets(ctx, g, r)
}

func (s swappableGroups) CommittedOffsets(ctx context.Context, g string, p []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error) {
	return s.broker.service.Load().CommittedOffsets(ctx, g, p)
}

var errInjectedCrash = errors.New("injected crash")
