package producer

import (
	"errors"
	"fmt"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

type OperationStatus string

const (
	OperationPending        OperationStatus = "pending"
	OperationSucceeded      OperationStatus = "succeeded"
	OperationOutcomeUnknown OperationStatus = "outcome_unknown"
)

type PartitionConfig struct {
	Topic       string
	PartitionID uint32
	State       Config
}

type OpenResult struct {
	RequestID  string
	ProducerID string
	Epoch      uint64
	LeaderTerm uint64
	Status     OperationStatus
	Reason     string
}

type ProduceResult struct {
	RequestID    string
	ProducerID   string
	Epoch        uint64
	BaseOffset   uint64
	LastOffset   uint64
	NextSequence uint64
	LeaderTerm   uint64
	Duplicate    bool
	Status       OperationStatus
	Reason       string
}

type Completion struct {
	RequestID string
	Open      *OpenResult
	Produce   *ProduceResult
}

type pendingKind uint8

const (
	pendingOpen pendingKind = iota + 1
	pendingData
)

type pendingOperation struct {
	kind          pendingKind
	producerID    string
	waiters       map[string]bool
	expectedEpoch int64
	newEpoch      uint64
	openRequestID string
	epoch         uint64
	firstSequence uint64
	recordCount   uint32
	digest        [32]byte
	baseOffset    uint64
	lastOffset    uint64
	nextSequence  uint64
	index         uint64
	entryTerm     uint64
	bytes         int64
	operationID   string
	gateRequestID string
}

type Partition struct {
	node        *raft.Node
	replication *replication.Controller
	state       *State
	config      PartitionConfig
	pending     map[string]*pendingOperation
	nextGateID  uint64
}

func NewPartition(node *raft.Node, controller *replication.Controller, partitionConfig PartitionConfig) (*Partition, error) {
	if node == nil || controller == nil {
		return nil, errors.New("Raft node and replication controller are required")
	}
	if err := config.ValidateTopicName(partitionConfig.Topic, false); err != nil {
		return nil, err
	}
	state, err := NewState(partitionConfig.State)
	if err != nil {
		return nil, err
	}
	if err := state.Replay(controller.RecoveredApplied()); err != nil {
		return nil, err
	}
	return &Partition{
		node: node, replication: controller, state: state, config: partitionConfig,
		pending: make(map[string]*pendingOperation),
	}, nil
}

func (partition *Partition) State() *State { return partition.state }

func (partition *Partition) Open(request protocol.OpenProducerRequest, now time.Time) (OpenResult, raft.Ready, []Completion, error) {
	if err := request.Validate(); err != nil {
		return OpenResult{}, raft.Ready{}, nil, err
	}
	if err := partition.validateRoute(request.Topic, request.Partition); err != nil {
		return OpenResult{}, raft.Ready{}, nil, err
	}
	expectedEpoch := int64(request.ExpectedEpoch)
	if pending := partition.pending[request.ProducerID]; pending != nil {
		if pending.kind == pendingOpen && pending.openRequestID == request.RequestID && pending.expectedEpoch == expectedEpoch {
			pending.waiters[request.RequestID] = false
			return partition.pendingOpenResult(pending, request.RequestID), raft.Ready{}, nil, nil
		}
		return OpenResult{}, raft.Ready{}, nil, stateError(CodeProducerBusy, "producer already has an unresolved operation")
	}
	decision, err := partition.state.EvaluateOpen(request.ProducerID, expectedEpoch, request.RequestID)
	if err != nil {
		return OpenResult{}, raft.Ready{}, nil, err
	}
	if decision.Duplicate {
		return OpenResult{
			RequestID: request.RequestID, ProducerID: request.ProducerID, Epoch: decision.NewEpoch,
			LeaderTerm: partition.node.Snapshot().Term, Status: OperationSucceeded,
		}, raft.Ready{LeaderReady: partition.node.Snapshot().LeaderReady}, nil, nil
	}
	if partition.newProducerReservations() >= partition.state.config.MaxProducerIDs {
		return OpenResult{}, raft.Ready{}, nil, stateError(CodeProducerLimit, "producer ID limit is exhausted")
	}
	snapshot := partition.node.Snapshot()
	frame, err := storage.NewFenceFrame(snapshot.LastLogIndex+1, snapshot.Term, storage.FenceCommand{
		ProducerID: request.ProducerID, ExpectedEpoch: expectedEpoch,
		NewEpoch: decision.NewEpoch, RequestID: request.RequestID,
	})
	if err != nil {
		return OpenResult{}, raft.Ready{}, nil, err
	}
	index, ready, err := partition.node.ProposeFrame(storage.KindFence, frame.Payload)
	if err != nil {
		return OpenResult{}, raft.Ready{}, nil, err
	}
	pending := &pendingOperation{
		kind: pendingOpen, producerID: request.ProducerID, waiters: map[string]bool{request.RequestID: false},
		expectedEpoch: expectedEpoch, newEpoch: decision.NewEpoch, openRequestID: request.RequestID,
		index: index, entryTerm: snapshot.Term,
	}
	partition.pending[request.ProducerID] = pending
	completions, err := partition.HandleReady(ready, now)
	if err != nil {
		return OpenResult{}, ready, completions, err
	}
	if result, ok := openCompletion(completions, request.RequestID); ok {
		return result, ready, completions, nil
	}
	return partition.pendingOpenResult(pending, request.RequestID), ready, completions, nil
}

func (partition *Partition) Produce(requestID string, request protocol.ProduceRequest, timestamp uint64, now time.Time) (ProduceResult, raft.Ready, []Completion, error) {
	if err := config.ValidateToken("request_id", requestID); err != nil {
		return ProduceResult{}, raft.Ready{}, nil, err
	}
	validated, err := request.Validate()
	if err != nil {
		return ProduceResult{}, raft.Ready{}, nil, err
	}
	if err := partition.validateRoute(request.Topic, request.Partition); err != nil {
		return ProduceResult{}, raft.Ready{}, nil, err
	}
	epoch := uint64(request.Epoch)
	firstSequence := uint64(request.FirstSequence)
	count := uint32(len(validated.Records))
	if pending := partition.pending[request.ProducerID]; pending != nil {
		if pending.kind != pendingData || pending.epoch != epoch || pending.firstSequence != firstSequence || pending.recordCount != count || pending.digest != validated.Fingerprint {
			return ProduceResult{}, raft.Ready{}, nil, stateError(CodeProducerBusy, "producer already has a different unresolved operation")
		}
		pending.waiters[requestID] = true
		if pending.gateRequestID == "" {
			gateRequestID := partition.nextGateRequestID()
			gateResults, retryErr := partition.replication.Retry(pending.operationID, gateRequestID)
			if retryErr != nil {
				delete(pending.waiters, requestID)
				return ProduceResult{}, raft.Ready{}, nil, retryErr
			}
			pending.gateRequestID = gateRequestID
			completions := partition.completeGates(gateResults)
			if result, ok := produceCompletion(completions, requestID); ok {
				return result, raft.Ready{LeaderReady: partition.node.Snapshot().LeaderReady}, completions, nil
			}
		}
		return partition.pendingProduceResult(pending, requestID), raft.Ready{LeaderReady: partition.node.Snapshot().LeaderReady}, nil, nil
	}
	decision, err := partition.state.EvaluateBatch(request.ProducerID, epoch, firstSequence, count, validated.Fingerprint)
	if err != nil {
		return ProduceResult{}, raft.Ready{}, nil, err
	}
	records := make([]storage.DataRecord, len(validated.Records))
	var reserved int64
	for index, record := range validated.Records {
		records[index] = storage.DataRecord{Key: cloneBytes(record.Key), Value: cloneBytes(record.Value)}
		reserved += int64(len(record.Key) + len(record.Value))
	}
	gateRequestID := partition.nextGateRequestID()
	if decision.Duplicate {
		batch := *decision.Existing
		operationID := dataOperationID(batch.InternalIndex, batch.EntryTerm)
		pending := &pendingOperation{
			kind: pendingData, producerID: request.ProducerID, waiters: map[string]bool{requestID: true},
			epoch: epoch, firstSequence: firstSequence, recordCount: count, digest: validated.Fingerprint,
			baseOffset: batch.BaseOffset, lastOffset: batch.LastOffset, nextSequence: batch.NextSequence,
			index: batch.InternalIndex, entryTerm: batch.EntryTerm, bytes: reserved,
			operationID: operationID, gateRequestID: gateRequestID,
		}
		partition.pending[request.ProducerID] = pending
		gateResults, err := partition.replication.AwaitExistingData(
			operationID, gateRequestID, batch.InternalIndex, batch.BaseOffset, batch.LastOffset, batch.EntryTerm, reserved,
		)
		if err != nil {
			delete(partition.pending, request.ProducerID)
			return ProduceResult{}, raft.Ready{}, nil, err
		}
		completions := partition.completeGates(gateResults)
		if result, ok := produceCompletion(completions, requestID); ok {
			return result, raft.Ready{LeaderReady: partition.node.Snapshot().LeaderReady}, completions, nil
		}
		return partition.pendingProduceResult(pending, requestID), raft.Ready{LeaderReady: partition.node.Snapshot().LeaderReady}, completions, nil
	}
	snapshot := partition.node.Snapshot()
	operationID := dataOperationID(snapshot.LastLogIndex+1, snapshot.Term)
	index, ready, gateResults, err := partition.replication.ProposeProducerData(
		operationID, gateRequestID, timestamp,
		storage.ProducerMetadata{
			ProducerID: request.ProducerID, Epoch: epoch,
			FirstSequence: firstSequence, BatchDigest: validated.Fingerprint,
		}, records, now,
	)
	if err != nil {
		return ProduceResult{}, ready, nil, err
	}
	gate, exists := partition.replication.Gate(gateRequestID)
	if !exists {
		return ProduceResult{}, ready, nil, errors.New("replication controller did not retain the producer gate")
	}
	pending := &pendingOperation{
		kind: pendingData, producerID: request.ProducerID, waiters: map[string]bool{requestID: false},
		epoch: epoch, firstSequence: firstSequence, recordCount: count, digest: validated.Fingerprint,
		baseOffset: gate.BaseOffset, lastOffset: gate.LastOffset,
		nextSequence: firstSequence + uint64(count), index: index, entryTerm: snapshot.Term, bytes: reserved,
		operationID: operationID, gateRequestID: gateRequestID,
	}
	partition.pending[request.ProducerID] = pending
	if err := partition.applyFrames(ready.Applied); err != nil {
		return ProduceResult{}, ready, nil, err
	}
	completions := partition.completeGates(gateResults)
	if result, ok := produceCompletion(completions, requestID); ok {
		return result, ready, completions, nil
	}
	return partition.pendingProduceResult(pending, requestID), ready, completions, nil
}

func (partition *Partition) HandleReady(ready raft.Ready, now time.Time) ([]Completion, error) {
	gateResults, err := partition.replication.HandleReady(ready, now)
	if err != nil {
		return nil, err
	}
	completions, err := partition.applyFramesWithCompletions(ready.Applied)
	if err != nil {
		return nil, err
	}
	completions = append(completions, partition.completeGates(gateResults)...)
	lostLeadership := false
	for _, change := range ready.RoleChanges {
		lostLeadership = lostLeadership || change.To != raft.Leader
	}
	if lostLeadership {
		completions = append(completions, partition.failPending("leadership changed before the producer operation completed")...)
	}
	return completions, nil
}

func (partition *Partition) Timeout(requestID string) ([]Completion, error) {
	for _, pending := range partition.pending {
		if _, exists := pending.waiters[requestID]; !exists {
			continue
		}
		if pending.kind == pendingOpen {
			delete(pending.waiters, requestID)
			result := partition.pendingOpenResult(pending, requestID)
			result.Status = OperationOutcomeUnknown
			result.Reason = "OpenProducer outcome is unknown after timeout"
			return []Completion{{RequestID: requestID, Open: &result}}, nil
		}
		if pending.gateRequestID == "" {
			return nil, errors.New("producer DATA has no active acknowledgement gate")
		}
		gateResult, err := partition.replication.Timeout(pending.gateRequestID)
		if err != nil {
			return nil, err
		}
		return partition.completeGates([]replication.GateResult{gateResult}), nil
	}
	return nil, errors.New("request ID is not pending")
}

func (partition *Partition) validateRoute(topic string, partitionID uint32) error {
	if topic != partition.config.Topic || partitionID != partition.config.PartitionID {
		return errors.New("request topic/partition does not match this producer partition")
	}
	return nil
}

func (partition *Partition) applyFrames(frames []storage.Frame) error {
	_, err := partition.applyFramesWithCompletions(frames)
	return err
}

func (partition *Partition) applyFramesWithCompletions(frames []storage.Frame) ([]Completion, error) {
	completions := make([]Completion, 0)
	for _, frame := range frames {
		if err := partition.state.Apply(frame); err != nil {
			return nil, err
		}
		if frame.Kind != storage.KindFence {
			continue
		}
		command, err := storage.InspectFenceFrame(frame)
		if err != nil {
			return nil, err
		}
		pending := partition.pending[command.ProducerID]
		if pending == nil || pending.kind != pendingOpen || pending.openRequestID != command.RequestID || pending.newEpoch != command.NewEpoch {
			continue
		}
		for requestID := range pending.waiters {
			result := OpenResult{
				RequestID: requestID, ProducerID: pending.producerID, Epoch: pending.newEpoch,
				LeaderTerm: partition.node.Snapshot().Term, Status: OperationSucceeded,
			}
			copy := result
			completions = append(completions, Completion{RequestID: requestID, Open: &copy})
		}
		delete(partition.pending, command.ProducerID)
	}
	return completions, nil
}

func (partition *Partition) completeGates(results []replication.GateResult) []Completion {
	completions := make([]Completion, 0)
	for _, gate := range results {
		var pending *pendingOperation
		for _, candidate := range partition.pending {
			if candidate.kind == pendingData && candidate.gateRequestID == gate.RequestID {
				pending = candidate
				break
			}
		}
		if pending == nil {
			continue
		}
		status := OperationPending
		switch gate.Status {
		case replication.GateSucceeded:
			status = OperationSucceeded
		case replication.GateOutcomeUnknown:
			status = OperationOutcomeUnknown
		default:
			continue
		}
		for requestID, duplicate := range pending.waiters {
			result := partition.pendingProduceResult(pending, requestID)
			result.Status = status
			result.Duplicate = duplicate
			result.Reason = gate.Reason
			copy := result
			completions = append(completions, Completion{RequestID: requestID, Produce: &copy})
		}
		if status == OperationSucceeded {
			delete(partition.pending, pending.producerID)
		} else {
			pending.waiters = make(map[string]bool)
			pending.gateRequestID = ""
		}
	}
	return completions
}

func (partition *Partition) failPending(reason string) []Completion {
	completions := make([]Completion, 0)
	for producerID, pending := range partition.pending {
		for requestID, duplicate := range pending.waiters {
			if pending.kind == pendingOpen {
				result := partition.pendingOpenResult(pending, requestID)
				result.Status = OperationOutcomeUnknown
				result.Reason = reason
				copy := result
				completions = append(completions, Completion{RequestID: requestID, Open: &copy})
			} else {
				result := partition.pendingProduceResult(pending, requestID)
				result.Status = OperationOutcomeUnknown
				result.Duplicate = duplicate
				result.Reason = reason
				copy := result
				completions = append(completions, Completion{RequestID: requestID, Produce: &copy})
			}
		}
		delete(partition.pending, producerID)
	}
	return completions
}

func (partition *Partition) pendingOpenResult(pending *pendingOperation, requestID string) OpenResult {
	return OpenResult{
		RequestID: requestID, ProducerID: pending.producerID, Epoch: pending.newEpoch,
		LeaderTerm: partition.node.Snapshot().Term, Status: OperationPending,
	}
}

func (partition *Partition) pendingProduceResult(pending *pendingOperation, requestID string) ProduceResult {
	return ProduceResult{
		RequestID: requestID, ProducerID: pending.producerID, Epoch: pending.epoch,
		BaseOffset: pending.baseOffset, LastOffset: pending.lastOffset, NextSequence: pending.nextSequence,
		LeaderTerm: partition.node.Snapshot().Term, Duplicate: pending.waiters[requestID], Status: OperationPending,
	}
}

func (partition *Partition) newProducerReservations() int {
	count := partition.state.ProducerCount()
	for producerID, pending := range partition.pending {
		if pending.kind == pendingOpen {
			if _, exists := partition.state.Producer(producerID); !exists {
				count++
			}
		}
	}
	return count
}

func (partition *Partition) nextGateRequestID() string {
	partition.nextGateID++
	return fmt.Sprintf("m5-gate-%d", partition.nextGateID)
}

func dataOperationID(index, term uint64) string {
	return fmt.Sprintf("m5-data-%d-%d", term, index)
}

func openCompletion(completions []Completion, requestID string) (OpenResult, bool) {
	for _, completion := range completions {
		if completion.RequestID == requestID && completion.Open != nil {
			return *completion.Open, true
		}
	}
	return OpenResult{}, false
}

func produceCompletion(completions []Completion, requestID string) (ProduceResult, bool) {
	for _, completion := range completions {
		if completion.RequestID == requestID && completion.Produce != nil {
			return *completion.Produce, true
		}
	}
	return ProduceResult{}, false
}

func cloneBytes(value []byte) []byte {
	if value == nil {
		return nil
	}
	return append([]byte(nil), value...)
}
