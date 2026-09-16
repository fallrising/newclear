// Package producer implements the committed producer epoch and sequence state
// derived exclusively from FENCE and DATA entries in a partition Raft log.
package producer

import (
	"errors"
	"fmt"
	"math"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const (
	DefaultMaxProducerIDs = 1024
	DefaultDedupResults   = 64
)

type ErrorCode string

const (
	CodeFencedProducer         ErrorCode = "FENCED_PRODUCER"
	CodeSequenceConflict       ErrorCode = "SEQUENCE_CONFLICT"
	CodeOutOfOrderSequence     ErrorCode = "OUT_OF_ORDER_SEQUENCE"
	CodeDuplicateWindowExpired ErrorCode = "DUPLICATE_WINDOW_EXPIRED"
	CodeProducerBusy           ErrorCode = "PRODUCER_BUSY"
	CodeProducerLimit          ErrorCode = "RESOURCE_EXHAUSTED"
	CodeRequestConflict        ErrorCode = "REQUEST_CONFLICT"
)

type Error struct {
	Code    ErrorCode
	Message string
}

func (err *Error) Error() string { return err.Message }

func IsCode(err error, code ErrorCode) bool {
	var producerError *Error
	return errors.As(err, &producerError) && producerError.Code == code
}

func stateError(code ErrorCode, message string) error {
	return &Error{Code: code, Message: message}
}

type Config struct {
	MaxProducerIDs int
	DedupResults   int
}

func (config Config) normalized() (Config, error) {
	if config.MaxProducerIDs == 0 {
		config.MaxProducerIDs = DefaultMaxProducerIDs
	}
	if config.DedupResults == 0 {
		config.DedupResults = DefaultDedupResults
	}
	if config.MaxProducerIDs < 1 || config.DedupResults < 1 {
		return Config{}, errors.New("producer and dedup limits must be positive")
	}
	return config, nil
}

type FenceResult struct {
	RequestID     string
	ExpectedEpoch int64
	Epoch         uint64
	InternalIndex uint64
	EntryTerm     uint64
}

type BatchResult struct {
	Epoch         uint64
	FirstSequence uint64
	RecordCount   uint32
	BatchDigest   [32]byte
	BaseOffset    uint64
	LastOffset    uint64
	NextSequence  uint64
	InternalIndex uint64
	EntryTerm     uint64
}

type ProducerState struct {
	ProducerID   string
	Epoch        uint64
	NextSequence uint64
	LastFence    FenceResult
	Batches      []BatchResult
}

type OpenDecision struct {
	Duplicate bool
	NewEpoch  uint64
	Existing  *FenceResult
}

type BatchDecision struct {
	Duplicate bool
	Existing  *BatchResult
}

type State struct {
	config    Config
	producers map[string]*ProducerState
}

func NewState(config Config) (*State, error) {
	config, err := config.normalized()
	if err != nil {
		return nil, err
	}
	return &State{config: config, producers: make(map[string]*ProducerState)}, nil
}

func (state *State) ProducerCount() int { return len(state.producers) }

func (state *State) Producer(producerID string) (ProducerState, bool) {
	producer := state.producers[producerID]
	if producer == nil {
		return ProducerState{}, false
	}
	return cloneProducerState(*producer), true
}

func (state *State) EvaluateOpen(producerID string, expectedEpoch int64, requestID string) (OpenDecision, error) {
	producer := state.producers[producerID]
	if producer == nil {
		if expectedEpoch != -1 {
			return OpenDecision{}, stateError(CodeFencedProducer, "producer is not open; expected_epoch must be -1")
		}
		if len(state.producers) >= state.config.MaxProducerIDs {
			return OpenDecision{}, stateError(CodeProducerLimit, "producer ID limit is exhausted")
		}
		return OpenDecision{NewEpoch: 0}, nil
	}
	if producer.LastFence.RequestID == requestID {
		if producer.LastFence.ExpectedEpoch != expectedEpoch {
			return OpenDecision{}, stateError(CodeRequestConflict, "request_id was already used with different OpenProducer parameters")
		}
		result := producer.LastFence
		return OpenDecision{Duplicate: true, NewEpoch: result.Epoch, Existing: &result}, nil
	}
	if expectedEpoch < 0 || uint64(expectedEpoch) != producer.Epoch {
		return OpenDecision{}, stateError(CodeFencedProducer, "expected_epoch does not match the committed producer epoch")
	}
	if producer.Epoch == math.MaxInt64 {
		return OpenDecision{}, stateError(CodeFencedProducer, "producer epoch cannot be incremented without overflow")
	}
	return OpenDecision{NewEpoch: producer.Epoch + 1}, nil
}

func (state *State) EvaluateBatch(producerID string, epoch, firstSequence uint64, count uint32, digest [32]byte) (BatchDecision, error) {
	producer := state.producers[producerID]
	if producer == nil || epoch != producer.Epoch {
		return BatchDecision{}, stateError(CodeFencedProducer, "producer epoch is not current for this partition")
	}
	if count == 0 || firstSequence > math.MaxUint64-uint64(count) {
		return BatchDecision{}, stateError(CodeSequenceConflict, "batch sequence range is invalid")
	}
	end := firstSequence + uint64(count)
	if firstSequence == producer.NextSequence {
		return BatchDecision{}, nil
	}
	if firstSequence > producer.NextSequence {
		return BatchDecision{}, stateError(CodeOutOfOrderSequence, "first_sequence is greater than the next expected sequence")
	}
	for index := len(producer.Batches) - 1; index >= 0; index-- {
		batch := producer.Batches[index]
		if batch.FirstSequence != firstSequence {
			continue
		}
		if batch.RecordCount != count || batch.BatchDigest != digest {
			return BatchDecision{}, stateError(CodeSequenceConflict, "sequence range was already committed with different records")
		}
		result := batch
		return BatchDecision{Duplicate: true, Existing: &result}, nil
	}
	if end > producer.NextSequence {
		return BatchDecision{}, stateError(CodeSequenceConflict, "batch overlaps the committed sequence boundary")
	}
	for _, batch := range producer.Batches {
		if firstSequence < batch.NextSequence && end > batch.FirstSequence {
			return BatchDecision{}, stateError(CodeSequenceConflict, "batch incompletely overlaps a committed sequence range")
		}
	}
	return BatchDecision{}, stateError(CodeDuplicateWindowExpired, "the committed batch result is outside the deduplication window")
}

func (state *State) Replay(frames []storage.Frame) error {
	for _, frame := range frames {
		if err := state.Apply(frame); err != nil {
			return fmt.Errorf("replay producer state at index %d: %w", frame.LogIndex, err)
		}
	}
	return nil
}

func (state *State) Apply(frame storage.Frame) error {
	switch frame.Kind {
	case storage.KindFence:
		return state.applyFence(frame)
	case storage.KindData:
		return state.applyData(frame)
	default:
		return nil
	}
}

func (state *State) applyFence(frame storage.Frame) error {
	command, err := storage.InspectFenceFrame(frame)
	if err != nil {
		return err
	}
	producer := state.producers[command.ProducerID]
	if producer == nil {
		if len(state.producers) >= state.config.MaxProducerIDs {
			return errors.New("committed FENCE exceeds producer ID limit")
		}
		if command.ExpectedEpoch != -1 || command.NewEpoch != 0 {
			return errors.New("first committed FENCE is not epoch zero")
		}
		producer = &ProducerState{ProducerID: command.ProducerID}
		state.producers[command.ProducerID] = producer
	} else {
		if command.ExpectedEpoch < 0 || uint64(command.ExpectedEpoch) != producer.Epoch || command.NewEpoch != producer.Epoch+1 {
			return errors.New("committed FENCE does not advance the current epoch exactly once")
		}
	}
	producer.Epoch = command.NewEpoch
	producer.NextSequence = 0
	producer.Batches = nil
	producer.LastFence = FenceResult{
		RequestID: command.RequestID, ExpectedEpoch: command.ExpectedEpoch, Epoch: command.NewEpoch,
		InternalIndex: frame.LogIndex, EntryTerm: frame.Term,
	}
	return nil
}

func (state *State) applyData(frame storage.Frame) error {
	details, err := storage.InspectDataFrame(frame)
	if err != nil {
		return err
	}
	if details.Producer == nil {
		return nil
	}
	metadata := details.Producer
	producer := state.producers[metadata.ProducerID]
	if producer == nil || producer.Epoch != metadata.Epoch {
		return errors.New("committed DATA references an unopened or fenced producer epoch")
	}
	if metadata.FirstSequence != producer.NextSequence {
		return errors.New("committed DATA is not at the next producer sequence")
	}
	records := make([]protocol.Record, len(details.Records))
	for index, record := range details.Records {
		records[index] = protocol.Record{Key: record.Key, Value: record.Value}
	}
	digest, err := protocol.BatchFingerprint(records)
	if err != nil {
		return err
	}
	if digest != metadata.BatchDigest {
		return errors.New("committed DATA batch digest does not match its records")
	}
	count := uint32(len(details.Records))
	if metadata.FirstSequence > math.MaxUint64-uint64(count) {
		return errors.New("committed DATA sequence overflows")
	}
	next := metadata.FirstSequence + uint64(count)
	result := BatchResult{
		Epoch: metadata.Epoch, FirstSequence: metadata.FirstSequence, RecordCount: count,
		BatchDigest: metadata.BatchDigest, BaseOffset: details.BaseOffset, LastOffset: details.EndOffset - 1,
		NextSequence: next, InternalIndex: frame.LogIndex, EntryTerm: frame.Term,
	}
	producer.NextSequence = next
	producer.Batches = append(producer.Batches, result)
	if len(producer.Batches) > state.config.DedupResults {
		producer.Batches = append([]BatchResult(nil), producer.Batches[len(producer.Batches)-state.config.DedupResults:]...)
	}
	return nil
}

func cloneProducerState(state ProducerState) ProducerState {
	state.Batches = append([]BatchResult(nil), state.Batches...)
	return state
}
