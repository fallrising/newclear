package group

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

var groupRaftIdentity = raft.Identity{ClusterID: "m6-cluster", ConfigHash: "topology-v1", GroupID: "__mkfk_groups/0"}

// memoryLog is an in-memory raft.DurableLog. Keeping it while replacing the
// node models a process restart whose WAL survived.
type memoryLog struct {
	frames []storage.Frame
	state  storage.HardState
}

func (log *memoryLog) HardState() storage.HardState { return log.state }

func (log *memoryLog) PersistHardState(state storage.HardState) error {
	if state.CurrentTerm < log.state.CurrentTerm || state.CommitIndex < log.state.CommitIndex || state.CommitIndex > uint64(len(log.frames)) {
		return errors.New("invalid hardstate transition")
	}
	log.state = state
	return nil
}

func (log *memoryLog) LastLogIndex() uint64 { return uint64(len(log.frames)) }

func (log *memoryLog) Term(index uint64) (uint64, error) {
	if index == 0 || index > uint64(len(log.frames)) {
		return 0, errors.New("missing index")
	}
	return log.frames[index-1].Term, nil
}

func (log *memoryLog) ReadEntries(from uint64, maxBytes int) ([]storage.Frame, error) {
	if from == 0 || maxBytes <= 0 {
		return nil, errors.New("invalid read")
	}
	var result []storage.Frame
	used := 0
	for index := from; index <= uint64(len(log.frames)); index++ {
		frame := cloneFrame(log.frames[index-1])
		encoded, err := storage.EncodeFrame(frame)
		if err != nil {
			return nil, err
		}
		if used+len(encoded) > maxBytes && len(result) > 0 {
			break
		}
		result = append(result, frame)
		used += len(encoded)
	}
	return result, nil
}

func (log *memoryLog) AppendEntries(entries []storage.Frame) error {
	for _, frame := range entries {
		if frame.LogIndex != uint64(len(log.frames)+1) {
			return errors.New("append gap")
		}
		log.frames = append(log.frames, cloneFrame(frame))
	}
	return nil
}

func (log *memoryLog) TruncateSuffix(from uint64) error {
	if from <= log.state.CommitIndex {
		return storage.ErrCommittedTruncate
	}
	log.frames = log.frames[:from-1]
	return nil
}

// LEO is the end offset of the last DATA frame; the groups log has none.
func (log *memoryLog) LEO() uint64 {
	var leo uint64
	for _, frame := range log.frames {
		if end, data, err := storage.DataFrameEnd(frame); err == nil && data {
			leo = end
		}
	}
	return leo
}

func cloneFrame(frame storage.Frame) storage.Frame {
	frame.Payload = append([]byte(nil), frame.Payload...)
	return frame
}

// fakeHighWatermarks stands in for quorum-confirmed data-partition HW proofs.
type fakeHighWatermarks map[TopicPartition]uint64

func (hw fakeHighWatermarks) HighWatermark(topic string, partition uint32) (uint64, error) {
	value, ok := hw[TopicPartition{Topic: topic, Partition: partition}]
	if !ok {
		return 0, fmt.Errorf("%s/%d leader unavailable", topic, partition)
	}
	return value, nil
}

type groupCluster struct {
	voters      []uint32
	nodes       map[uint32]*raft.Node
	logs        map[uint32]*memoryLog
	coords      map[uint32]*Coordinator
	completions map[uint32][]Completion
	queue       []raft.Message
	blocked     map[[2]uint32]bool
	now         time.Time
	hw          fakeHighWatermarks
}

func newGroupCluster(t *testing.T, size int) *groupCluster {
	t.Helper()
	cluster := &groupCluster{
		nodes: map[uint32]*raft.Node{}, logs: map[uint32]*memoryLog{}, coords: map[uint32]*Coordinator{},
		completions: map[uint32][]Completion{}, blocked: map[[2]uint32]bool{},
		now: time.Unix(1700000000, 0), hw: fakeHighWatermarks{},
	}
	for id := uint32(1); id <= uint32(size); id++ {
		cluster.voters = append(cluster.voters, id)
	}
	for _, id := range cluster.voters {
		cluster.logs[id] = &memoryLog{}
		cluster.start(t, id)
	}
	return cluster
}

// start creates (or, after restart, recreates) the node and coordinator for id
// on top of the surviving log.
func (cluster *groupCluster) start(t *testing.T, id uint32) {
	t.Helper()
	node, err := raft.NewNode(raft.Config{
		Identity: groupRaftIdentity, NodeID: id, Voters: cluster.voters,
		ElectionTimeoutTicks: 6 + uint64(id), HeartbeatTicks: 1,
	}, cluster.logs[id])
	if err != nil {
		t.Fatal(err)
	}
	coordinator, err := NewCoordinator(node, CoordinatorConfig{
		State: Config{Partitions: func(topic string) (uint32, bool) { count, ok := testTopics[topic]; return count, ok }},
	})
	if err != nil {
		t.Fatal(err)
	}
	cluster.nodes[id], cluster.coords[id] = node, coordinator
}

func (cluster *groupCluster) handle(t *testing.T, id uint32, out Output, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("node %d: %v", id, err)
	}
	cluster.queue = append(cluster.queue, out.Messages...)
	cluster.completions[id] = append(cluster.completions[id], out.Completions...)
}

func (cluster *groupCluster) ready(t *testing.T, id uint32, ready raft.Ready, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("node %d raft: %v", id, err)
	}
	out, err := cluster.coords[id].HandleReady(ready, cluster.now)
	cluster.handle(t, id, out, err)
}

func (cluster *groupCluster) elect(t *testing.T, id uint32) *Coordinator {
	t.Helper()
	ready, err := cluster.nodes[id].Campaign()
	cluster.ready(t, id, ready, err)
	cluster.drain(t)
	cluster.heartbeat(t, id)
	if !cluster.coords[id].Serving() {
		t.Fatalf("node %d is not serving after election: %+v", id, cluster.nodes[id].Snapshot())
	}
	return cluster.coords[id]
}

func (cluster *groupCluster) drain(t *testing.T) {
	t.Helper()
	for limit := 2000; len(cluster.queue) > 0; limit-- {
		if limit == 0 {
			t.Fatalf("cluster did not quiesce: %d messages queued", len(cluster.queue))
		}
		message := cluster.queue[0]
		cluster.queue = cluster.queue[1:]
		if cluster.blocked[[2]uint32{message.From, message.To}] {
			continue
		}
		ready, err := cluster.nodes[message.To].Step(message)
		cluster.ready(t, message.To, ready, err)
	}
}

func (cluster *groupCluster) heartbeat(t *testing.T, id uint32) {
	t.Helper()
	ready, err := cluster.nodes[id].Tick()
	cluster.ready(t, id, ready, err)
	cluster.drain(t)
}

func (cluster *groupCluster) isolate(id uint32) {
	for _, peer := range cluster.voters {
		if peer != id {
			cluster.blocked[[2]uint32{id, peer}] = true
			cluster.blocked[[2]uint32{peer, id}] = true
		}
	}
}

func (cluster *groupCluster) heal() { cluster.blocked = map[[2]uint32]bool{} }

// completion finds the settled proposal for a ticket on node id.
func (cluster *groupCluster) completion(t *testing.T, id uint32, ticket Ticket) Completion {
	t.Helper()
	for _, completion := range cluster.completions[id] {
		if completion.Index == ticket.Index && completion.RequestID == ticket.RequestID {
			return completion
		}
	}
	t.Fatalf("node %d: no completion for %+v", id, ticket)
	return Completion{}
}

var _ raft.DurableLog = (*memoryLog)(nil)
