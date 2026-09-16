package producer

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

var producerRaftIdentity = raft.Identity{ClusterID: "m5-cluster", ConfigHash: "topology-v1", GroupID: "events/0"}

func TestM5PR03LeaderFailoverReplaysCommittedDedup(t *testing.T) {
	t.Parallel()
	cluster := newProducerCluster(t)
	leader := cluster.elect(t, 1)
	open := protocolOpenRequest(-1, "open-rf3")
	openResult, ready, _, err := leader.Open(open, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drain(t, 300)
	if openResult.Status == OperationPending {
		cluster.heartbeat(t, 1)
	}
	request := testProduceRequest(t, 0, 0, "survives-leader")
	result, ready, _, err := leader.Produce("produce-rf3", request, 1, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drain(t, 300)
	cluster.heartbeat(t, 1)
	if result.Status == OperationOutcomeUnknown {
		t.Fatalf("healthy produce unexpectedly unknown: %#v", result)
	}
	state, exists := cluster.partitions[2].State().Producer(testProducerID)
	if !exists || state.NextSequence != 1 || len(state.Batches) != 1 {
		t.Fatalf("future leader had no replayed producer state: %#v", state)
	}

	cluster.isolate(1)
	newLeader := cluster.elect(t, 2)
	before := cluster.nodes[2].Snapshot().LastLogIndex
	result, ready, _, err = newLeader.Produce("produce-after-failover", request, 2, cluster.now)
	if err != nil || result.Status != OperationSucceeded || !result.Duplicate || result.BaseOffset != 0 || result.LastOffset != 0 {
		t.Fatalf("failover retry = %#v, %v", result, err)
	}
	cluster.enqueue(ready.Messages)
	if cluster.nodes[2].Snapshot().LastLogIndex != before {
		t.Fatalf("new leader appended duplicate: index %d -> %d", before, cluster.nodes[2].Snapshot().LastLogIndex)
	}
}

func protocolOpenRequest(expected int64, requestID string) protocol.OpenProducerRequest {
	return protocol.OpenProducerRequest{
		Topic: "events", Partition: 0, ProducerID: testProducerID,
		ExpectedEpoch: protocol.DecimalInt64(expected), RequestID: requestID,
	}
}

type producerMemoryLog struct {
	frames []storage.Frame
	state  storage.HardState
}

func (log *producerMemoryLog) HardState() storage.HardState { return log.state }

func (log *producerMemoryLog) PersistHardState(state storage.HardState) error {
	if state.CurrentTerm < log.state.CurrentTerm || state.CommitIndex < log.state.CommitIndex || state.CommitIndex > uint64(len(log.frames)) {
		return errors.New("invalid hardstate transition")
	}
	log.state = state
	return nil
}

func (log *producerMemoryLog) LastLogIndex() uint64 { return uint64(len(log.frames)) }

func (log *producerMemoryLog) Term(index uint64) (uint64, error) {
	if index == 0 || index > uint64(len(log.frames)) {
		return 0, errors.New("missing index")
	}
	return log.frames[index-1].Term, nil
}

func (log *producerMemoryLog) ReadEntries(from uint64, maxBytes int) ([]storage.Frame, error) {
	if from == 0 || maxBytes <= 0 {
		return nil, errors.New("invalid read")
	}
	result := make([]storage.Frame, 0)
	used := 0
	for index := from; index <= uint64(len(log.frames)); index++ {
		frame := cloneProducerFrame(log.frames[index-1])
		encoded, err := storage.EncodeFrame(frame)
		if err != nil {
			return nil, err
		}
		if len(result) == 0 && len(encoded) > maxBytes {
			return nil, errors.New("budget too small")
		}
		if used+len(encoded) > maxBytes {
			break
		}
		result = append(result, frame)
		used += len(encoded)
	}
	return result, nil
}

func (log *producerMemoryLog) AppendEntries(entries []storage.Frame) error {
	for _, frame := range entries {
		if frame.LogIndex != uint64(len(log.frames)+1) {
			return errors.New("append gap")
		}
		if _, err := storage.EncodeFrame(frame); err != nil {
			return err
		}
		log.frames = append(log.frames, cloneProducerFrame(frame))
	}
	return nil
}

func (log *producerMemoryLog) TruncateSuffix(from uint64) error {
	if from <= log.state.CommitIndex {
		return storage.ErrCommittedTruncate
	}
	log.frames = log.frames[:from-1]
	return nil
}

func (log *producerMemoryLog) LEO() uint64 {
	var leo uint64
	for _, frame := range log.frames {
		end, data, err := storage.DataFrameEnd(frame)
		if err == nil && data {
			leo = end
		}
	}
	return leo
}

func (log *producerMemoryLog) ReadRecords(offset, highWatermark uint64, maxBytes int) ([]storage.LocalRecord, uint64, storage.ReadStats, error) {
	if offset > highWatermark {
		return nil, offset, storage.ReadStats{}, storage.ErrOffsetOutOfRange
	}
	result := make([]storage.LocalRecord, 0)
	next := offset
	used := 0
	for _, frame := range log.frames {
		if frame.Kind != storage.KindData {
			continue
		}
		var payload storage.DataPayload
		if err := json.Unmarshal(frame.Payload, &payload); err != nil {
			return nil, offset, storage.ReadStats{}, err
		}
		base, err := strconv.ParseUint(payload.BaseOffset, 10, 64)
		if err != nil {
			return nil, offset, storage.ReadStats{}, err
		}
		for index, record := range payload.Records {
			recordOffset := base + uint64(index)
			if recordOffset < offset || recordOffset >= highWatermark {
				continue
			}
			size := len(record.Key) + len(record.Value)
			if len(result) == 0 && size > maxBytes {
				return nil, offset, storage.ReadStats{}, &storage.ReadBudgetTooSmallError{RequiredBytes: size}
			}
			if used+size > maxBytes {
				return result, next, storage.ReadStats{}, nil
			}
			result = append(result, storage.LocalRecord{Offset: recordOffset, Key: record.Key, Value: record.Value})
			used += size
			next = recordOffset + 1
		}
	}
	return result, next, storage.ReadStats{}, nil
}

type producerCluster struct {
	nodes      map[uint32]*raft.Node
	logs       map[uint32]*producerMemoryLog
	partitions map[uint32]*Partition
	queue      []raft.Message
	blocked    map[[2]uint32]bool
	now        time.Time
}

func newProducerCluster(t *testing.T) *producerCluster {
	t.Helper()
	cluster := &producerCluster{
		nodes: make(map[uint32]*raft.Node), logs: make(map[uint32]*producerMemoryLog),
		partitions: make(map[uint32]*Partition), blocked: make(map[[2]uint32]bool),
		now: time.Unix(1700000000, 0),
	}
	for id := uint32(1); id <= 3; id++ {
		log := &producerMemoryLog{}
		node, err := raft.NewNode(raft.Config{
			Identity: producerRaftIdentity, NodeID: id, Voters: []uint32{1, 2, 3},
			ElectionTimeoutTicks: 6 + uint64(id), HeartbeatTicks: 1,
		}, log)
		if err != nil {
			t.Fatal(err)
		}
		controller, err := replication.NewController(node, log, replication.Config{
			NodeID: id, Voters: []uint32{1, 2, 3}, MinISR: 2,
		}, cluster.now)
		if err != nil {
			t.Fatal(err)
		}
		partition, err := NewPartition(node, controller, PartitionConfig{Topic: "events", PartitionID: 0})
		if err != nil {
			t.Fatal(err)
		}
		cluster.nodes[id], cluster.logs[id], cluster.partitions[id] = node, log, partition
	}
	return cluster
}

func (cluster *producerCluster) elect(t *testing.T, id uint32) *Partition {
	t.Helper()
	ready, err := cluster.nodes[id].Campaign()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cluster.partitions[id].HandleReady(ready, cluster.now); err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drain(t, 500)
	if snapshot := cluster.nodes[id].Snapshot(); snapshot.Role != raft.Leader || !snapshot.LeaderReady {
		t.Fatalf("node %d did not become ready leader: %#v", id, snapshot)
	}
	return cluster.partitions[id]
}

func (cluster *producerCluster) deliver(t *testing.T, message raft.Message) {
	t.Helper()
	if cluster.blocked[[2]uint32{message.From, message.To}] {
		return
	}
	ready, err := cluster.nodes[message.To].Step(message)
	if err != nil {
		t.Fatalf("deliver %s %d->%d: %v", message.Kind, message.From, message.To, err)
	}
	if _, err := cluster.partitions[message.To].HandleReady(ready, cluster.now); err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
}

func (cluster *producerCluster) drain(t *testing.T, limit int) {
	t.Helper()
	for len(cluster.queue) > 0 && limit > 0 {
		message := cluster.queue[0]
		cluster.queue = cluster.queue[1:]
		cluster.deliver(t, message)
		limit--
	}
	if len(cluster.queue) > 0 {
		t.Fatalf("producer cluster queue did not quiesce: %d", len(cluster.queue))
	}
}

func (cluster *producerCluster) heartbeat(t *testing.T, id uint32) {
	t.Helper()
	ready, err := cluster.nodes[id].Tick()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cluster.partitions[id].HandleReady(ready, cluster.now); err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drain(t, 300)
}

func (cluster *producerCluster) isolate(id uint32) {
	for peer := uint32(1); peer <= 3; peer++ {
		if peer != id {
			cluster.blocked[[2]uint32{id, peer}] = true
			cluster.blocked[[2]uint32{peer, id}] = true
		}
	}
}

func (cluster *producerCluster) enqueue(messages []raft.Message) {
	cluster.queue = append(cluster.queue, messages...)
}

func cloneProducerFrame(frame storage.Frame) storage.Frame {
	frame.Payload = append([]byte(nil), frame.Payload...)
	return frame
}

func (cluster *producerCluster) String() string {
	return fmt.Sprintf("queue=%d", len(cluster.queue))
}

var _ raft.DurableLog = (*producerMemoryLog)(nil)
var _ replication.RecordLog = (*producerMemoryLog)(nil)
