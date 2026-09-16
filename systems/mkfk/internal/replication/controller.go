// Package replication layers M4 ISR observation, committed DATA visibility,
// and conservative acks=all gates over the fixed-membership Raft core.
package replication

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const DefaultLagWindow = 2 * time.Second

var (
	ErrNotEnoughReplicas = errors.New("not enough in-sync replicas")
	ErrBackpressure      = errors.New("pending operation capacity exhausted")
	ErrReadBarrier       = errors.New("a current-term read barrier is required")
	ErrOperationPending  = errors.New("operation already has a pending acknowledgement gate")
)

type RecordLog interface {
	LEO() uint64
	ReadRecords(uint64, uint64, int) ([]storage.LocalRecord, uint64, storage.ReadStats, error)
}

type Config struct {
	NodeID               uint32
	Voters               []uint32
	MinISR               int
	LagWindow            time.Duration
	MaxPendingOperations int
	MaxPendingBytes      int64
	MaxPendingFetches    int
	MaxOperationHistory  int
	MaxGateHistory       int
}

func (config Config) validate() (Config, error) {
	if config.NodeID == 0 || len(config.Voters) == 0 {
		return Config{}, errors.New("node and voters are required")
	}
	config.Voters = append([]uint32(nil), config.Voters...)
	sort.Slice(config.Voters, func(i, j int) bool { return config.Voters[i] < config.Voters[j] })
	found := false
	for index, voter := range config.Voters {
		if voter == 0 || index > 0 && voter == config.Voters[index-1] {
			return Config{}, errors.New("voters must be unique positive IDs")
		}
		found = found || voter == config.NodeID
	}
	if !found || config.MinISR < 1 || config.MinISR > len(config.Voters) {
		return Config{}, errors.New("invalid node membership or min ISR")
	}
	if config.LagWindow == 0 {
		config.LagWindow = DefaultLagWindow
	}
	if config.LagWindow < 0 {
		return Config{}, errors.New("lag window must be positive")
	}
	if config.MaxPendingOperations == 0 {
		config.MaxPendingOperations = 256
	}
	if config.MaxPendingBytes == 0 {
		config.MaxPendingBytes = 16 << 20
	}
	if config.MaxPendingOperations < 1 || config.MaxPendingBytes < 1 {
		return Config{}, errors.New("pending caps must be positive")
	}
	if config.MaxPendingFetches == 0 {
		config.MaxPendingFetches = 256
	}
	if config.MaxPendingFetches < 1 {
		return Config{}, errors.New("pending fetch cap must be positive")
	}
	if config.MaxOperationHistory == 0 {
		config.MaxOperationHistory = 4096
	}
	if config.MaxGateHistory == 0 {
		config.MaxGateHistory = 8192
	}
	if config.MaxOperationHistory < config.MaxPendingOperations || config.MaxGateHistory < config.MaxPendingOperations {
		return Config{}, errors.New("history caps must cover pending operation capacity")
	}
	return config, nil
}

type PeerObservation struct {
	PeerID            uint32
	Term              uint64
	DurableMatchIndex uint64
	CatchupTarget     uint64
	LastSuccessAt     time.Time
	LastCaughtUpAt    time.Time
	InSync            bool
}

type GateStatus string

const (
	GatePending        GateStatus = "pending"
	GateSucceeded      GateStatus = "succeeded"
	GateOutcomeUnknown GateStatus = "outcome_unknown"
)

type GateResult struct {
	RequestID   string
	OperationID string
	Index       uint64
	BaseOffset  uint64
	LastOffset  uint64
	Term        uint64
	CapturedISR []uint32
	Status      GateStatus
	Reason      string
}

type operation struct {
	id          string
	index       uint64
	baseOffset  uint64
	lastOffset  uint64
	entryTerm   uint64
	bytes       int64
	pendingGate string
}

type gate struct {
	result GateResult
}

type readBarrier struct {
	term  uint64
	index uint64
}

type Controller struct {
	node              *raft.Node
	log               RecordLog
	config            Config
	term              uint64
	role              raft.Role
	leaderReady       bool
	highWatermark     uint64
	isr               map[uint32]struct{}
	peers             map[uint32]*PeerObservation
	durableMatch      map[uint32]uint64
	operations        map[string]*operation
	gates             map[string]*gate
	readBarriers      map[string]readBarrier
	pendingReads      map[string]struct{}
	pendingOperations int
	pendingBytes      int64
	recoveredApplied  []storage.Frame
}

func NewController(node *raft.Node, log RecordLog, config Config, now time.Time) (*Controller, error) {
	if node == nil || log == nil {
		return nil, errors.New("raft node and record log are required")
	}
	config, err := config.validate()
	if err != nil {
		return nil, err
	}
	snapshot := node.Snapshot()
	if snapshot.NodeID != config.NodeID {
		return nil, errors.New("controller node ID does not match Raft node")
	}
	controller := &Controller{
		node: node, log: log, config: config, term: snapshot.Term, role: snapshot.Role,
		leaderReady: snapshot.LeaderReady, isr: make(map[uint32]struct{}),
		peers: make(map[uint32]*PeerObservation), durableMatch: make(map[uint32]uint64),
		operations: make(map[string]*operation), gates: make(map[string]*gate),
		readBarriers: make(map[string]readBarrier), pendingReads: make(map[string]struct{}),
	}
	for _, voter := range config.Voters {
		if voter != config.NodeID {
			controller.peers[voter] = &PeerObservation{PeerID: voter, Term: snapshot.Term, CatchupTarget: snapshot.LastLogIndex}
		}
	}
	if snapshot.Role == raft.Leader {
		controller.resetLeaderTerm(snapshot, now)
	}
	recovered := node.RecoveredApplied()
	controller.recoveredApplied = cloneFrames(recovered)
	if _, err := controller.apply(recovered); err != nil {
		return nil, err
	}
	return controller, nil
}

func (controller *Controller) HandleReady(ready raft.Ready, now time.Time) ([]GateResult, error) {
	terminal := make([]GateResult, 0)
	for _, change := range ready.RoleChanges {
		controller.term = change.Term
		controller.role = change.To
		controller.leaderReady = false
		controller.readBarriers = make(map[string]readBarrier)
		controller.pendingReads = make(map[string]struct{})
		if change.To == raft.Leader {
			controller.resetLeaderTerm(controller.node.Snapshot(), now)
		} else {
			controller.isr = make(map[uint32]struct{})
			terminal = append(terminal, controller.failPending("leadership changed before acknowledgement")...)
		}
	}
	snapshot := controller.node.Snapshot()
	if snapshot.Term != controller.term {
		controller.term = snapshot.Term
		controller.role = snapshot.Role
		if snapshot.Role != raft.Leader {
			controller.isr = make(map[uint32]struct{})
			controller.readBarriers = make(map[string]readBarrier)
			controller.pendingReads = make(map[string]struct{})
		}
	}
	controller.leaderReady = ready.LeaderReady && snapshot.Role == raft.Leader
	if _, err := controller.apply(ready.Applied); err != nil {
		return nil, err
	}
	snapshot = controller.node.Snapshot()
	if snapshot.Role == raft.Leader && snapshot.Term == controller.term {
		controller.durableMatch[controller.config.NodeID] = snapshot.LastLogIndex
		for _, observation := range controller.peers {
			if observation.InSync && observation.CatchupTarget < snapshot.LastLogIndex {
				observation.CatchupTarget = snapshot.LastLogIndex
			}
		}
	}
	for _, ack := range ready.DurableAcks {
		if snapshot.Role != raft.Leader || ack.Term != controller.term {
			continue
		}
		observation := controller.peers[ack.PeerID]
		if observation == nil {
			continue
		}
		observation.Term = ack.Term
		observation.LastSuccessAt = now
		if ack.MatchIndex > observation.DurableMatchIndex {
			observation.DurableMatchIndex = ack.MatchIndex
		}
		if ack.MatchIndex > controller.durableMatch[ack.PeerID] {
			controller.durableMatch[ack.PeerID] = ack.MatchIndex
		}
		if ack.MatchIndex >= observation.CatchupTarget {
			observation.LastCaughtUpAt = now
			observation.InSync = true
			controller.isr[ack.PeerID] = struct{}{}
			observation.CatchupTarget = snapshot.LastLogIndex
		}
	}
	for _, read := range ready.ReadStates {
		if _, pending := controller.pendingReads[read.Context]; pending && snapshot.Role == raft.Leader && snapshot.Term == controller.term {
			delete(controller.pendingReads, read.Context)
			controller.readBarriers[read.Context] = readBarrier{term: controller.term, index: read.Index}
		}
	}
	return append(terminal, controller.completeEligible()...), nil
}

func (controller *Controller) AdvanceTime(now time.Time) []uint32 {
	if controller.role != raft.Leader {
		return nil
	}
	evicted := make([]uint32, 0)
	for peer, observation := range controller.peers {
		if !observation.InSync {
			continue
		}
		staleSuccess := observation.LastSuccessAt.IsZero() || now.Sub(observation.LastSuccessAt) > controller.config.LagWindow
		staleCatchup := observation.LastCaughtUpAt.IsZero() || now.Sub(observation.LastCaughtUpAt) > controller.config.LagWindow
		if staleSuccess || staleCatchup {
			observation.InSync = false
			delete(controller.isr, peer)
			evicted = append(evicted, peer)
		}
	}
	sort.Slice(evicted, func(i, j int) bool { return evicted[i] < evicted[j] })
	return evicted
}

func (controller *Controller) ProposeData(operationID, requestID string, timestamp uint64, records []storage.DataRecord, now time.Time) (uint64, raft.Ready, []GateResult, error) {
	return controller.proposeData(operationID, requestID, records, now, func() (uint64, raft.Ready, error) {
		return controller.node.ProposeData(timestamp, records)
	})
}

func (controller *Controller) ProposeProducerData(operationID, requestID string, timestamp uint64, metadata storage.ProducerMetadata, records []storage.DataRecord, now time.Time) (uint64, raft.Ready, []GateResult, error) {
	return controller.proposeData(operationID, requestID, records, now, func() (uint64, raft.Ready, error) {
		return controller.node.ProposeProducerData(timestamp, metadata, records)
	})
}

func (controller *Controller) proposeData(operationID, requestID string, records []storage.DataRecord, now time.Time, propose func() (uint64, raft.Ready, error)) (uint64, raft.Ready, []GateResult, error) {
	if operationID == "" || requestID == "" {
		return 0, raft.Ready{}, nil, errors.New("operation and request IDs are required")
	}
	if existing := controller.operations[operationID]; existing != nil {
		results, err := controller.retry(existing, requestID)
		return existing.index, raft.Ready{LeaderReady: controller.leaderReady}, results, err
	}
	if len(controller.operations) >= controller.config.MaxOperationHistory || len(controller.gates) >= controller.config.MaxGateHistory {
		return 0, raft.Ready{}, nil, ErrBackpressure
	}
	if controller.role != raft.Leader {
		return 0, raft.Ready{}, nil, raft.ErrNotLeader
	}
	if !controller.leaderReady {
		return 0, raft.Ready{}, nil, raft.ErrLeaderNotReady
	}
	captured := controller.ISR()
	if len(captured) < controller.config.MinISR {
		return 0, raft.Ready{}, nil, ErrNotEnoughReplicas
	}
	reserved := recordBytes(records)
	if controller.pendingOperations >= controller.config.MaxPendingOperations || reserved > controller.config.MaxPendingBytes-controller.pendingBytes {
		return 0, raft.Ready{}, nil, ErrBackpressure
	}
	if _, exists := controller.gates[requestID]; exists {
		return 0, raft.Ready{}, nil, errors.New("request ID already exists")
	}
	baseOffset := controller.log.LEO()
	index, ready, err := propose()
	if err != nil {
		return 0, raft.Ready{}, nil, err
	}
	operation := &operation{
		id: operationID, index: index, baseOffset: baseOffset,
		lastOffset: baseOffset + uint64(len(records)) - 1, entryTerm: controller.term,
		bytes: reserved, pendingGate: requestID,
	}
	controller.operations[operationID] = operation
	controller.pendingOperations++
	controller.pendingBytes += reserved
	controller.gates[requestID] = &gate{result: GateResult{
		RequestID: requestID, OperationID: operationID, Index: index,
		BaseOffset: operation.baseOffset, LastOffset: operation.lastOffset,
		Term: controller.term, CapturedISR: captured, Status: GatePending,
	}}
	results, handleErr := controller.HandleReady(ready, now)
	return index, ready, results, handleErr
}

// AwaitExistingData creates an acks=all gate for a committed producer batch
// reconstructed from the WAL. It never appends and therefore lets M5 retries
// survive leader and process restart without weakening the captured ISR rule.
func (controller *Controller) AwaitExistingData(operationID, requestID string, index, baseOffset, lastOffset, entryTerm uint64, bytes int64) ([]GateResult, error) {
	existingOperation := controller.operations[operationID]
	if existingOperation == nil {
		if len(controller.operations) >= controller.config.MaxOperationHistory {
			return nil, ErrBackpressure
		}
		entry, err := controller.node.Entry(index)
		if err != nil || entry.Kind != storage.KindData || entry.Term != entryTerm {
			return nil, errors.New("existing DATA entry is not present in the Raft log")
		}
		details, err := storage.InspectDataFrame(entry)
		if err != nil || details.BaseOffset != baseOffset || details.EndOffset == 0 || details.EndOffset-1 != lastOffset {
			return nil, errors.New("existing DATA entry offsets do not match the operation")
		}
		existingOperation = &operation{
			id: operationID, index: index, baseOffset: baseOffset, lastOffset: lastOffset,
			entryTerm: entryTerm, bytes: bytes,
		}
		controller.operations[operationID] = existingOperation
	} else if existingOperation.index != index || existingOperation.baseOffset != baseOffset || existingOperation.lastOffset != lastOffset || existingOperation.entryTerm != entryTerm || existingOperation.bytes != bytes {
		return nil, errors.New("operation identity refers to different DATA metadata")
	}
	return controller.retry(existingOperation, requestID)
}

func (controller *Controller) Retry(operationID, requestID string) ([]GateResult, error) {
	operation := controller.operations[operationID]
	if operation == nil {
		return nil, errors.New("operation identity is unknown")
	}
	return controller.retry(operation, requestID)
}

func (controller *Controller) retry(operation *operation, requestID string) ([]GateResult, error) {
	if requestID == "" {
		return nil, errors.New("request ID is required")
	}
	if existing := controller.gates[requestID]; existing != nil {
		return []GateResult{cloneGateResult(existing.result)}, nil
	}
	if len(controller.gates) >= controller.config.MaxGateHistory {
		return nil, ErrBackpressure
	}
	if operation.pendingGate != "" {
		return nil, ErrOperationPending
	}
	if controller.role != raft.Leader || !controller.leaderReady {
		return nil, raft.ErrNotLeader
	}
	entry, err := controller.node.Entry(operation.index)
	if err != nil || entry.Kind != storage.KindData || entry.Term != operation.entryTerm {
		return nil, errors.New("operation entry is no longer present in the Raft log")
	}
	captured := controller.ISR()
	if len(captured) < controller.config.MinISR {
		return nil, ErrNotEnoughReplicas
	}
	if controller.pendingOperations >= controller.config.MaxPendingOperations || operation.bytes > controller.config.MaxPendingBytes-controller.pendingBytes {
		return nil, ErrBackpressure
	}
	operation.pendingGate = requestID
	controller.pendingOperations++
	controller.pendingBytes += operation.bytes
	controller.gates[requestID] = &gate{result: GateResult{
		RequestID: requestID, OperationID: operation.id, Index: operation.index,
		BaseOffset: operation.baseOffset, LastOffset: operation.lastOffset,
		Term: controller.term, CapturedISR: captured, Status: GatePending,
	}}
	return controller.completeEligible(), nil
}

func (controller *Controller) Timeout(requestID string) (GateResult, error) {
	gate := controller.gates[requestID]
	if gate == nil {
		return GateResult{}, errors.New("request ID is unknown")
	}
	if gate.result.Status == GatePending {
		gate.result.Status = GateOutcomeUnknown
		gate.result.Reason = "request timeout after append; commit outcome may be visible"
		controller.releaseGate(gate.result.OperationID, requestID)
	}
	return cloneGateResult(gate.result), nil
}

func (controller *Controller) BeginFetch(context string) (raft.Ready, error) {
	if context == "" {
		return raft.Ready{}, errors.New("read context is required")
	}
	if _, exists := controller.pendingReads[context]; exists {
		return raft.Ready{}, errors.New("read context is already pending")
	}
	if _, exists := controller.readBarriers[context]; exists {
		return raft.Ready{}, errors.New("read context already has an unused barrier")
	}
	if len(controller.pendingReads)+len(controller.readBarriers) >= controller.config.MaxPendingFetches {
		return raft.Ready{}, ErrBackpressure
	}
	ready, err := controller.node.RequestRead(context)
	if err != nil {
		return raft.Ready{}, err
	}
	controller.pendingReads[context] = struct{}{}
	return ready, nil
}

func (controller *Controller) Fetch(context string, offset uint64, maxBytes int) ([]storage.LocalRecord, uint64, uint64, storage.ReadStats, error) {
	barrier, ok := controller.readBarriers[context]
	delete(controller.readBarriers, context)
	snapshot := controller.node.Snapshot()
	if !ok || snapshot.Role != raft.Leader || !snapshot.LeaderReady || barrier.term != snapshot.Term || snapshot.LastApplied < barrier.index {
		return nil, offset, controller.highWatermark, storage.ReadStats{}, ErrReadBarrier
	}
	records, next, stats, err := controller.log.ReadRecords(offset, controller.highWatermark, maxBytes)
	return records, next, controller.highWatermark, stats, err
}

func (controller *Controller) HighWatermark() uint64 { return controller.highWatermark }

func (controller *Controller) ISR() []uint32 {
	result := make([]uint32, 0, len(controller.isr))
	for voter := range controller.isr {
		result = append(result, voter)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func (controller *Controller) PeerObservations() []PeerObservation {
	result := make([]PeerObservation, 0, len(controller.peers))
	for _, observation := range controller.peers {
		result = append(result, *observation)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].PeerID < result[j].PeerID })
	return result
}

func (controller *Controller) Gate(requestID string) (GateResult, bool) {
	gate := controller.gates[requestID]
	if gate == nil {
		return GateResult{}, false
	}
	return cloneGateResult(gate.result), true
}

func (controller *Controller) PendingUsage() (int, int64) {
	return controller.pendingOperations, controller.pendingBytes
}

func (controller *Controller) PendingFetches() int {
	return len(controller.pendingReads) + len(controller.readBarriers)
}

// RecoveredApplied returns the committed prefix consumed during construction
// exactly once so another deterministic state machine can replay the same
// durable entries.
func (controller *Controller) RecoveredApplied() []storage.Frame {
	result := cloneFrames(controller.recoveredApplied)
	controller.recoveredApplied = nil
	return result
}

func (controller *Controller) resetLeaderTerm(snapshot raft.Snapshot, now time.Time) {
	controller.term = snapshot.Term
	controller.role = raft.Leader
	controller.leaderReady = snapshot.LeaderReady
	controller.isr = map[uint32]struct{}{controller.config.NodeID: {}}
	controller.durableMatch = map[uint32]uint64{controller.config.NodeID: snapshot.LastLogIndex}
	controller.readBarriers = make(map[string]readBarrier)
	controller.pendingReads = make(map[string]struct{})
	controller.peers = make(map[uint32]*PeerObservation)
	for _, voter := range controller.config.Voters {
		if voter != controller.config.NodeID {
			controller.peers[voter] = &PeerObservation{
				PeerID: voter, Term: snapshot.Term, CatchupTarget: snapshot.LastLogIndex,
			}
		}
	}
	_ = now // The peer timers start only after a verified success.
}

func (controller *Controller) apply(frames []storage.Frame) ([]uint64, error) {
	ends := make([]uint64, 0)
	for _, frame := range frames {
		end, data, err := storage.DataFrameEnd(frame)
		if err != nil {
			return nil, err
		}
		if data {
			if end < controller.highWatermark {
				return nil, errors.New("applied DATA high watermark moved backward")
			}
			controller.highWatermark = end
			ends = append(ends, end)
		}
	}
	return ends, nil
}

func (controller *Controller) completeEligible() []GateResult {
	completed := make([]GateResult, 0)
	snapshot := controller.node.Snapshot()
	for _, gate := range controller.gates {
		if gate.result.Status != GatePending || gate.result.Term != snapshot.Term || snapshot.Role != raft.Leader || !snapshot.LeaderReady || snapshot.LastApplied < gate.result.Index {
			continue
		}
		allDurable := true
		for _, replica := range gate.result.CapturedISR {
			if controller.durableMatch[replica] < gate.result.Index {
				allDurable = false
				break
			}
		}
		if !allDurable {
			continue
		}
		gate.result.Status = GateSucceeded
		completed = append(completed, cloneGateResult(gate.result))
		controller.releaseGate(gate.result.OperationID, gate.result.RequestID)
	}
	sort.Slice(completed, func(i, j int) bool { return completed[i].RequestID < completed[j].RequestID })
	return completed
}

func (controller *Controller) failPending(reason string) []GateResult {
	failed := make([]GateResult, 0)
	for _, gate := range controller.gates {
		if gate.result.Status == GatePending {
			gate.result.Status = GateOutcomeUnknown
			gate.result.Reason = reason
			controller.releaseGate(gate.result.OperationID, gate.result.RequestID)
			failed = append(failed, cloneGateResult(gate.result))
		}
	}
	sort.Slice(failed, func(i, j int) bool { return failed[i].RequestID < failed[j].RequestID })
	return failed
}

func (controller *Controller) releaseGate(operationID, requestID string) {
	operation := controller.operations[operationID]
	if operation == nil || operation.pendingGate != requestID {
		return
	}
	operation.pendingGate = ""
	controller.pendingOperations--
	controller.pendingBytes -= operation.bytes
}

func recordBytes(records []storage.DataRecord) int64 {
	var total int64
	for _, record := range records {
		total += int64(len(record.Key) + len(record.Value))
	}
	return total
}

func cloneGateResult(result GateResult) GateResult {
	result.CapturedISR = append([]uint32(nil), result.CapturedISR...)
	return result
}

func cloneFrames(frames []storage.Frame) []storage.Frame {
	result := make([]storage.Frame, len(frames))
	for index, frame := range frames {
		result[index] = frame
		result[index].Payload = append([]byte(nil), frame.Payload...)
	}
	return result
}

func (controller *Controller) String() string {
	return fmt.Sprintf("node=%d term=%d role=%s isr=%v hw=%d", controller.config.NodeID, controller.term, controller.role, controller.ISR(), controller.highWatermark)
}
