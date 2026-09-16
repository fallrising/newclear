package replication

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"reflect"
	"sort"
	"strconv"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

var replicationIdentity = raft.Identity{ClusterID: "m4-test", ConfigHash: "topology-v1", GroupID: "events/0"}

type randomizedGateObservation struct {
	index    uint64
	captured []uint32
	status   GateStatus
}

type randomizedSafetyState struct {
	applied uint64
	hw      uint64
}

func TestM4RP08PartialProgressDoesNotMaskCatchupLag(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{})
	leader := cluster.elect(t, 1)
	start := cluster.now
	if got := leader.ISR(); !reflect.DeepEqual(got, []uint32{1, 2, 3}) {
		t.Fatalf("initial ISR = %v", got)
	}

	_, ready, _, err := leader.ProposeData("lag-target", "lag-gate", 1, []storage.DataRecord{{Value: []byte("target")}}, start)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	// Deliver only node 2's replication. Node 3 keeps reporting success for
	// the prior prefix, which refreshes contact but not catch-up completion.
	cluster.drainMatching(t, func(message raft.Message) bool { return message.From != 3 && message.To != 3 }, 200)
	for step := 1; step <= 4; step++ {
		now := start.Add(time.Duration(step) * 500 * time.Millisecond)
		_, err := leader.HandleReady(raft.Ready{LeaderReady: true, DurableAcks: []raft.DurableAck{
			{PeerID: 2, Term: cluster.nodes[1].Snapshot().Term, MatchIndex: 2, RPCID: uint64(50 + step)},
			{PeerID: 3, Term: cluster.nodes[1].Snapshot().Term, MatchIndex: 1, RPCID: uint64(100 + step)},
		}}, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	evicted := leader.AdvanceTime(start.Add(2501 * time.Millisecond))
	if !reflect.DeepEqual(evicted, []uint32{3}) || !reflect.DeepEqual(leader.ISR(), []uint32{1, 2}) {
		t.Fatalf("evicted=%v ISR=%v", evicted, leader.ISR())
	}
	observation := leader.PeerObservations()[1]
	if observation.LastSuccessAt.Before(start.Add(2*time.Second)) || observation.LastCaughtUpAt.After(start) {
		t.Fatalf("partial progress incorrectly refreshed catch-up: %#v", observation)
	}
}

func TestM4RP09CapturedISRDoesNotShrinkAndRetryDoesNotAppend(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{})
	leader := cluster.elect(t, 1)
	index, ready, completions, err := leader.ProposeData("operation-1", "request-a3", 1, []storage.DataRecord{{Value: []byte("committed-but-timeout")}}, cluster.now)
	if err != nil || len(completions) != 0 {
		t.Fatalf("proposal = index %d completions %#v error %v", index, completions, err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drainMatching(t, func(message raft.Message) bool { return message.From != 3 && message.To != 3 }, 200)
	gate, _ := leader.Gate("request-a3")
	if gate.Status != GatePending || !reflect.DeepEqual(gate.CapturedISR, []uint32{1, 2, 3}) {
		t.Fatalf("captured gate = %#v", gate)
	}
	if leader.HighWatermark() != 1 {
		t.Fatalf("quorum-committed DATA HW = %d, want 1", leader.HighWatermark())
	}
	if _, err := leader.HandleReady(raft.Ready{LeaderReady: true, DurableAcks: []raft.DurableAck{{
		PeerID: 2, Term: cluster.nodes[1].Snapshot().Term, MatchIndex: index, RPCID: 500,
	}}}, cluster.now.Add(DefaultLagWindow)); err != nil {
		t.Fatal(err)
	}
	leader.AdvanceTime(cluster.now.Add(DefaultLagWindow + time.Millisecond))
	if !reflect.DeepEqual(leader.ISR(), []uint32{1, 2}) {
		t.Fatalf("ISR after eviction = %v", leader.ISR())
	}
	gate, _ = leader.Gate("request-a3")
	if gate.Status != GatePending {
		t.Fatalf("shrinking ISR waived original gate: %#v", gate)
	}
	timedOut, err := leader.Timeout("request-a3")
	if err != nil || timedOut.Status != GateOutcomeUnknown {
		t.Fatalf("timeout result = %#v, %v", timedOut, err)
	}
	lastIndex := cluster.nodes[1].Snapshot().LastLogIndex
	completed, err := leader.Retry("operation-1", "request-a2")
	if err != nil || len(completed) != 1 || completed[0].Status != GateSucceeded {
		t.Fatalf("retry gate = %#v, %v", completed, err)
	}
	if cluster.nodes[1].Snapshot().LastLogIndex != lastIndex || completed[0].Index != index || !reflect.DeepEqual(completed[0].CapturedISR, []uint32{1, 2}) {
		t.Fatalf("retry appended or changed identity: %#v", completed[0])
	}
	readReady, err := leader.BeginFetch("timeout-visible")
	if err != nil {
		t.Fatal(err)
	}
	cluster.handle(t, 1, readReady)
	cluster.enqueue(readReady.Messages)
	cluster.drainMatching(t, func(message raft.Message) bool { return message.From != 3 && message.To != 3 }, 200)
	records, _, hw, _, err := leader.Fetch("timeout-visible", 0, storage.MaxLocalReadBytes)
	if err != nil || len(records) != 1 || hw != 1 {
		t.Fatalf("timed-out committed operation was not readable: records=%d HW=%d err=%v", len(records), hw, err)
	}
}

func TestM4RP10HighWatermarkUsesAppliedDATAOffsets(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{})
	leader := cluster.elect(t, 1)
	_, ready, _, err := leader.ProposeData("data-01", "data-01-request", 1, []storage.DataRecord{{Value: []byte("a")}, {Value: []byte("b")}}, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drainMatching(t, func(message raft.Message) bool { return message.From != 3 && message.To != 3 }, 200)
	if leader.HighWatermark() != 2 {
		t.Fatalf("HW after first DATA = %d", leader.HighWatermark())
	}
	_, controlReady, err := cluster.nodes[1].ProposeFrame(storage.KindFence, []byte(`{"producer":"fixture"}`))
	if err != nil {
		t.Fatal(err)
	}
	cluster.handle(t, 1, controlReady)
	cluster.enqueue(controlReady.Messages)
	cluster.drainMatching(t, func(message raft.Message) bool { return message.From != 3 && message.To != 3 }, 200)
	if leader.HighWatermark() != 2 || cluster.nodes[1].Snapshot().CommitIndex != 3 {
		t.Fatalf("control entry changed HW: HW=%d snapshot=%#v", leader.HighWatermark(), cluster.nodes[1].Snapshot())
	}
	readReady, err := leader.BeginFetch("fetch-rp10")
	if err != nil {
		t.Fatal(err)
	}
	cluster.handle(t, 1, readReady)
	cluster.enqueue(readReady.Messages)
	cluster.drainMatching(t, func(message raft.Message) bool { return message.From != 3 && message.To != 3 }, 200)
	records, next, hw, _, err := leader.Fetch("fetch-rp10", 0, storage.MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 || next != 2 || hw != 2 {
		t.Fatalf("committed fetch returned %d through %d at HW %d", len(records), next, hw)
	}
	_, uncommitted, err := cluster.nodes[1].ProposeData(2, []storage.DataRecord{{Value: []byte("hidden")}})
	if err != nil {
		t.Fatal(err)
	}
	cluster.handle(t, 1, uncommitted)
	if leader.HighWatermark() != 2 || cluster.logs[1].LEO() != 3 {
		t.Fatalf("uncommitted DATA visibility: HW=%d LEO=%d", leader.HighWatermark(), cluster.logs[1].LEO())
	}
}

func TestM4RP11RecoveryRequiresCurrentTermTarget(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{})
	leader := cluster.elect(t, 1)
	_, ready, _, err := leader.ProposeData("target", "target-request", 1, []storage.DataRecord{{Value: []byte("x")}}, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	cluster.enqueue(ready.Messages)
	cluster.drainMatching(t, func(message raft.Message) bool { return message.From != 3 && message.To != 3 }, 200)
	leader.AdvanceTime(cluster.now.Add(DefaultLagWindow + time.Millisecond))
	term := cluster.nodes[1].Snapshot().Term
	for _, ack := range []raft.DurableAck{
		{PeerID: 3, Term: term - 1, MatchIndex: 2, RPCID: 90},
		{PeerID: 3, Term: term, MatchIndex: 1, RPCID: 91},
	} {
		if _, err := leader.HandleReady(raft.Ready{LeaderReady: true, DurableAcks: []raft.DurableAck{ack}}, cluster.now.Add(3*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	if contains(leader.ISR(), 3) {
		t.Fatal("old-term or below-target ACK rejoined follower")
	}
	if _, err := leader.HandleReady(raft.Ready{LeaderReady: true, DurableAcks: []raft.DurableAck{{
		PeerID: 3, Term: term, MatchIndex: 2, RPCID: 92,
	}}}, cluster.now.Add(3100*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if !contains(leader.ISR(), 3) {
		t.Fatal("current-term target match did not rejoin follower")
	}
}

func TestM4OP03BackpressureRejectsBeforeAppend(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{MaxPendingOperations: 1, MaxPendingBytes: 8})
	leader := cluster.elect(t, 1)
	_, _, _, err := leader.ProposeData("first", "first-request", 1, []storage.DataRecord{{Value: []byte("12345678")}}, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	last := cluster.nodes[1].Snapshot().LastLogIndex
	if _, _, _, err := leader.ProposeData("second", "second-request", 2, []storage.DataRecord{{Value: []byte("x")}}, cluster.now); !errors.Is(err, ErrBackpressure) {
		t.Fatalf("second admission error = %v", err)
	}
	if cluster.nodes[1].Snapshot().LastLogIndex != last {
		t.Fatal("backpressure rejection appended to the log")
	}
	if operations, bytes := leader.PendingUsage(); operations != 1 || bytes != 8 {
		t.Fatalf("pending usage = %d/%d", operations, bytes)
	}
}

func TestM4OP03RetryAndFetchWaitersStayBounded(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 2, Config{
		MaxPendingOperations: 1,
		MaxPendingBytes:      4,
		MaxPendingFetches:    1,
	})
	leader := cluster.elect(t, 1)
	_, _, _, err := leader.ProposeData("bounded-operation", "request-original", 1, []storage.DataRecord{{Value: []byte("data")}}, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := leader.Timeout("request-original"); err != nil {
		t.Fatal(err)
	}
	if _, err := leader.Retry("bounded-operation", "request-retry"); err != nil {
		t.Fatal(err)
	}
	if operations, bytes := leader.PendingUsage(); operations != 1 || bytes != 4 {
		t.Fatalf("retry pending usage = %d/%d", operations, bytes)
	}
	if _, err := leader.Retry("bounded-operation", "request-overlap"); err == nil {
		t.Fatal("a second concurrent gate for one operation was admitted")
	}
	last := cluster.nodes[1].Snapshot().LastLogIndex
	if _, _, _, err := leader.ProposeData("blocked-operation", "blocked-request", 2, []storage.DataRecord{{Value: []byte("x")}}, cluster.now); !errors.Is(err, ErrBackpressure) {
		t.Fatalf("pending retry did not apply backpressure: %v", err)
	}
	if cluster.nodes[1].Snapshot().LastLogIndex != last {
		t.Fatal("retry backpressure rejection appended DATA")
	}
	if _, err := leader.Timeout("request-retry"); err != nil {
		t.Fatal(err)
	}

	readReady, err := leader.BeginFetch("bounded-fetch")
	if err != nil {
		t.Fatal(err)
	}
	if leader.PendingFetches() != 1 {
		t.Fatalf("pending fetches = %d", leader.PendingFetches())
	}
	if _, err := leader.BeginFetch("rejected-fetch"); !errors.Is(err, ErrBackpressure) {
		t.Fatalf("fetch cap error = %v", err)
	}
	cluster.enqueue(readReady.Messages)
	cluster.drainMatching(t, func(message raft.Message) bool { return true }, 200)
	if _, _, _, _, err := leader.Fetch("bounded-fetch", 0, storage.MaxLocalReadBytes); err != nil {
		t.Fatal(err)
	}
	if leader.PendingFetches() != 0 {
		t.Fatalf("completed fetch reservation was not released: %d", leader.PendingFetches())
	}
	if _, err := leader.BeginFetch("accepted-fetch"); err != nil {
		t.Fatalf("fetch capacity was not reusable: %v", err)
	}
}

func TestM4MinISRAdmissionRejectsBeforeAppend(t *testing.T) {
	t.Parallel()
	cluster := newReplicationCluster(t, 3, Config{})
	leader := cluster.elect(t, 1)
	term := cluster.nodes[1].Snapshot().Term
	if _, err := leader.HandleReady(raft.Ready{LeaderReady: true, DurableAcks: []raft.DurableAck{{
		PeerID: 2, Term: term, MatchIndex: 1, RPCID: 700,
	}}}, cluster.now.Add(DefaultLagWindow)); err != nil {
		t.Fatal(err)
	}
	leader.AdvanceTime(cluster.now.Add(DefaultLagWindow + time.Millisecond))
	if !reflect.DeepEqual(leader.ISR(), []uint32{1, 2}) {
		t.Fatalf("ISR = %v", leader.ISR())
	}
	last := cluster.nodes[1].Snapshot().LastLogIndex
	if _, _, _, err := leader.ProposeData("rejected", "rejected-request", 1, []storage.DataRecord{{Value: []byte("x")}}, cluster.now); !errors.Is(err, ErrNotEnoughReplicas) {
		t.Fatalf("min ISR admission error = %v", err)
	}
	if cluster.nodes[1].Snapshot().LastLogIndex != last {
		t.Fatal("min ISR rejection appended DATA")
	}
}

func TestM4RandomizedISRAndGateInvariants(t *testing.T) {
	for seed := int64(0); seed < 100; seed++ {
		seed := seed
		t.Run(fmt.Sprintf("seed-%03d", seed), func(t *testing.T) {
			cluster := newReplicationCluster(t, 2, Config{})
			leader := cluster.elect(t, 1)
			random := rand.New(rand.NewSource(seed))
			start := cluster.now
			operations := make([]string, 0)
			requests := make([]string, 0)
			observed := make(map[string]randomizedGateObservation)
			model := randomizedSafetyState{}
			for event := 0; event < 1000; event++ {
				cluster.now = start.Add(time.Duration(event) * 10 * time.Millisecond)
				action := random.Intn(256)
				switch {
				case action == 0:
					operationID := fmt.Sprintf("seed-%d-operation-%d", seed, event)
					requestID := fmt.Sprintf("seed-%d-request-%d", seed, event)
					_, ready, _, err := leader.ProposeData(operationID, requestID, uint64(event), []storage.DataRecord{{Value: []byte("x")}}, cluster.now)
					if err == nil {
						operations = append(operations, operationID)
						requests = append(requests, requestID)
						observeNewRandomizedGate(t, leader, observed, requestID)
						cluster.enqueue(ready.Messages)
					} else if !errors.Is(err, ErrNotEnoughReplicas) && !errors.Is(err, ErrBackpressure) {
						t.Fatal(err)
					}
				case action < 64:
					if len(cluster.queue) > 0 {
						index := random.Intn(len(cluster.queue))
						message := cluster.queue[index]
						cluster.queue = append(cluster.queue[:index], cluster.queue[index+1:]...)
						cluster.deliver(t, message)
					}
				case action < 96:
					if len(cluster.queue) > 0 {
						index := random.Intn(len(cluster.queue))
						cluster.queue = append(cluster.queue[:index], cluster.queue[index+1:]...)
					}
				case action < 112:
					ready, err := cluster.nodes[1].Tick()
					if err != nil {
						t.Fatal(err)
					}
					cluster.handle(t, 1, ready)
					cluster.enqueue(ready.Messages)
				case action < 160:
					leader.AdvanceTime(cluster.now)
				case action < 176:
					if len(requests) > 0 {
						if _, err := leader.Timeout(requests[random.Intn(len(requests))]); err != nil {
							t.Fatal(err)
						}
					}
				case action == 176:
					if len(operations) > 0 {
						operationID := operations[random.Intn(len(operations))]
						requestID := fmt.Sprintf("seed-%d-retry-%d", seed, event)
						if _, err := leader.Retry(operationID, requestID); err == nil {
							requests = append(requests, requestID)
							observeNewRandomizedGate(t, leader, observed, requestID)
						} else if !errors.Is(err, ErrNotEnoughReplicas) && !errors.Is(err, ErrBackpressure) &&
							!errors.Is(err, ErrOperationPending) {
							t.Fatal(err)
						}
					}
				default:
					if len(cluster.queue) > 500 {
						cluster.queue = cluster.queue[len(cluster.queue)-500:]
					}
				}
				assertM4RandomizedSafety(t, cluster, leader, requests, observed, &model, seed, event)
			}
		})
	}
}

func observeNewRandomizedGate(t *testing.T, leader *Controller, observed map[string]randomizedGateObservation, requestID string) {
	t.Helper()
	gate, exists := leader.Gate(requestID)
	if !exists {
		t.Fatalf("new request %q has no gate", requestID)
	}
	observed[requestID] = randomizedGateObservation{
		index: gate.Index, captured: append([]uint32(nil), gate.CapturedISR...), status: gate.Status,
	}
}

func assertM4RandomizedSafety(t *testing.T, cluster *replicationCluster, leader *Controller, requests []string, observed map[string]randomizedGateObservation, model *randomizedSafetyState, seed int64, event int) {
	t.Helper()
	isr := leader.ISR()
	if !contains(isr, 1) || len(isr) > 3 || !sort.SliceIsSorted(isr, func(i, j int) bool { return isr[i] < isr[j] }) {
		t.Fatalf("seed=%d event=%d invalid ISR=%v", seed, event, isr)
	}
	log := cluster.logs[1]
	snapshot := cluster.nodes[1].Snapshot()
	for index := model.applied; index < snapshot.LastApplied; index++ {
		end, data, err := storage.DataFrameEnd(log.frames[index])
		if err != nil {
			t.Fatal(err)
		}
		if data {
			model.hw = end
		}
	}
	model.applied = snapshot.LastApplied
	if leader.HighWatermark() != model.hw || model.hw > log.LEO() {
		t.Fatalf("seed=%d event=%d HW=%d want=%d LEO=%d", seed, event, leader.HighWatermark(), model.hw, log.LEO())
	}
	peerMatch := make(map[uint32]uint64)
	for _, peer := range leader.PeerObservations() {
		peerMatch[peer.PeerID] = peer.DurableMatchIndex
	}
	check := requests
	full := event%50 == 0 || event == 999
	if !full && len(requests) > 0 {
		check = requests[event%len(requests) : event%len(requests)+1]
	}
	for _, requestID := range check {
		gate, exists := leader.Gate(requestID)
		if !exists {
			t.Fatalf("seed=%d event=%d request %q disappeared", seed, event, requestID)
		}
		before, seen := observed[requestID]
		if seen {
			if before.index != gate.Index || !reflect.DeepEqual(before.captured, gate.CapturedISR) {
				t.Fatalf("seed=%d event=%d gate identity mutated: before=%#v after=%#v", seed, event, before, gate)
			}
			if before.status != GatePending && before.status != gate.Status {
				t.Fatalf("seed=%d event=%d terminal gate changed: %s -> %s", seed, event, before.status, gate.Status)
			}
		}
		observed[requestID] = randomizedGateObservation{
			index: gate.Index, captured: append([]uint32(nil), gate.CapturedISR...), status: gate.Status,
		}
		if gate.Status == GateSucceeded {
			if snapshot.LastApplied < gate.Index || gate.Term != snapshot.Term {
				t.Fatalf("seed=%d event=%d invalid success: %#v snapshot=%#v", seed, event, gate, snapshot)
			}
			for _, replica := range gate.CapturedISR {
				if replica != 1 && peerMatch[replica] < gate.Index {
					t.Fatalf("seed=%d event=%d success lacked durable captured replica %d: %#v", seed, event, replica, gate)
				}
			}
		}
	}
	operations, bytes := leader.PendingUsage()
	if operations > leader.config.MaxPendingOperations || bytes > leader.config.MaxPendingBytes {
		t.Fatalf("seed=%d event=%d pending usage exceeded cap: %d/%d", seed, event, operations, bytes)
	}
	if full {
		pending := 0
		var pendingBytes int64
		for _, operation := range leader.operations {
			if operation.pendingGate != "" {
				pending++
				pendingBytes += operation.bytes
			}
		}
		if operations != pending || bytes != pendingBytes {
			t.Fatalf("seed=%d event=%d pending usage=%d/%d model=%d/%d", seed, event, operations, bytes, pending, pendingBytes)
		}
	}
}

type replicationLog struct {
	frames []storage.Frame
	state  storage.HardState
}

func (log *replicationLog) HardState() storage.HardState { return log.state }
func (log *replicationLog) PersistHardState(state storage.HardState) error {
	if state.CurrentTerm < log.state.CurrentTerm || state.CommitIndex < log.state.CommitIndex || state.CommitIndex > uint64(len(log.frames)) {
		return errors.New("invalid hardstate")
	}
	log.state = state
	return nil
}
func (log *replicationLog) LastLogIndex() uint64 { return uint64(len(log.frames)) }
func (log *replicationLog) Term(index uint64) (uint64, error) {
	if index == 0 || index > uint64(len(log.frames)) {
		return 0, errors.New("missing index")
	}
	return log.frames[index-1].Term, nil
}
func (log *replicationLog) ReadEntries(from uint64, maxBytes int) ([]storage.Frame, error) {
	result := make([]storage.Frame, 0)
	used := 0
	for index := from; index <= uint64(len(log.frames)); index++ {
		frame := cloneReplicationFrame(log.frames[index-1])
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
func (log *replicationLog) AppendEntries(entries []storage.Frame) error {
	for _, frame := range entries {
		if frame.LogIndex != uint64(len(log.frames)+1) {
			return errors.New("append gap")
		}
		log.frames = append(log.frames, cloneReplicationFrame(frame))
	}
	return nil
}
func (log *replicationLog) TruncateSuffix(from uint64) error {
	if from <= log.state.CommitIndex {
		return storage.ErrCommittedTruncate
	}
	log.frames = log.frames[:from-1]
	return nil
}
func (log *replicationLog) LEO() uint64 {
	var leo uint64
	for _, frame := range log.frames {
		end, data, _ := storage.DataFrameEnd(frame)
		if data {
			leo = end
		}
	}
	return leo
}
func (log *replicationLog) ReadRecords(offset, highWatermark uint64, maxBytes int) ([]storage.LocalRecord, uint64, storage.ReadStats, error) {
	if offset > highWatermark {
		return nil, offset, storage.ReadStats{}, storage.ErrOffsetOutOfRange
	}
	result := make([]storage.LocalRecord, 0)
	used := 0
	next := offset
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

type replicationCluster struct {
	nodes       map[uint32]*raft.Node
	controllers map[uint32]*Controller
	logs        map[uint32]*replicationLog
	queue       []raft.Message
	now         time.Time
}

func newReplicationCluster(t *testing.T, minISR int, overrides Config) *replicationCluster {
	t.Helper()
	cluster := &replicationCluster{
		nodes: make(map[uint32]*raft.Node), controllers: make(map[uint32]*Controller),
		logs: make(map[uint32]*replicationLog), now: time.Unix(1700000000, 0),
	}
	for id := uint32(1); id <= 3; id++ {
		log := &replicationLog{}
		node, err := raft.NewNode(raft.Config{
			Identity: replicationIdentity, NodeID: id, Voters: []uint32{1, 2, 3},
			ElectionTimeoutTicks: 6 + uint64(id), HeartbeatTicks: 1,
		}, log)
		if err != nil {
			t.Fatal(err)
		}
		config := overrides
		config.NodeID = id
		config.Voters = []uint32{1, 2, 3}
		config.MinISR = minISR
		controller, err := NewController(node, log, config, cluster.now)
		if err != nil {
			t.Fatal(err)
		}
		cluster.logs[id], cluster.nodes[id], cluster.controllers[id] = log, node, controller
	}
	return cluster
}

func (cluster *replicationCluster) elect(t *testing.T, id uint32) *Controller {
	t.Helper()
	ready, err := cluster.nodes[id].Campaign()
	if err != nil {
		t.Fatal(err)
	}
	cluster.handle(t, id, ready)
	cluster.enqueue(ready.Messages)
	cluster.drainMatching(t, func(raft.Message) bool { return true }, 300)
	controller := cluster.controllers[id]
	if snapshot := cluster.nodes[id].Snapshot(); snapshot.Role != raft.Leader || !snapshot.LeaderReady {
		t.Fatalf("node %d election failed: %#v", id, snapshot)
	}
	return controller
}

func (cluster *replicationCluster) handle(t *testing.T, id uint32, ready raft.Ready) []GateResult {
	t.Helper()
	results, err := cluster.controllers[id].HandleReady(ready, cluster.now)
	if err != nil {
		t.Fatal(err)
	}
	return results
}

func (cluster *replicationCluster) enqueue(messages []raft.Message) {
	cluster.queue = append(cluster.queue, messages...)
}

func (cluster *replicationCluster) deliver(t *testing.T, message raft.Message) {
	t.Helper()
	ready, err := cluster.nodes[message.To].Step(message)
	if err != nil {
		t.Fatalf("deliver %s %d->%d: %v", message.Kind, message.From, message.To, err)
	}
	cluster.handle(t, message.To, ready)
	cluster.enqueue(ready.Messages)
}

func (cluster *replicationCluster) drainMatching(t *testing.T, match func(raft.Message) bool, limit int) {
	t.Helper()
	for limit > 0 {
		found := -1
		for index, message := range cluster.queue {
			if match(message) {
				found = index
				break
			}
		}
		if found < 0 {
			return
		}
		message := cluster.queue[found]
		cluster.queue = append(cluster.queue[:found], cluster.queue[found+1:]...)
		cluster.deliver(t, message)
		limit--
	}
	t.Fatal("matching message queue did not quiesce")
}

func cloneReplicationFrame(frame storage.Frame) storage.Frame {
	frame.Payload = append([]byte(nil), frame.Payload...)
	return frame
}

func contains(values []uint32, value uint32) bool {
	index := sort.Search(len(values), func(index int) bool { return values[index] >= value })
	return index < len(values) && values[index] == value
}

func (cluster *replicationCluster) String() string {
	return fmt.Sprintf("queue=%d leader=%s", len(cluster.queue), cluster.controllers[1])
}

var _ raft.DurableLog = (*replicationLog)(nil)
var _ RecordLog = (*replicationLog)(nil)
