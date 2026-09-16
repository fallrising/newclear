package storage

import (
	"errors"
	"fmt"
	"math"
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

const (
	MaxLocalReadBytes    = 4 << 20
	DefaultSegmentBytes  = 64 << 20
	SparseIndexStride    = 4 << 10
	maximumIndexFileSize = 64 << 20
)

var (
	ErrRecoveryRequired  = errors.New("partition requires restart recovery")
	ErrOffsetOutOfRange  = errors.New("offset is outside the local log")
	ErrCommittedTruncate = errors.New("cannot truncate the committed prefix")
)

type ReadBudgetTooSmallError struct {
	RequiredBytes int
}

func (err *ReadBudgetTooSmallError) Error() string {
	return fmt.Sprintf("read budget is too small; first record requires %d bytes", err.RequiredBytes)
}

type AppendResult struct {
	BaseOffset  uint64
	LastOffset  uint64
	LogIndex    uint64
	RecordCount uint32
}

type LocalRecord struct {
	Offset uint64
	Key    []byte
	Value  []byte
}

type RecoveryEvent struct {
	TruncatedBytes int64
	ValidBytes     int64
	LastLogIndex   uint64
}

// PartitionOptions controls physical segmentation. Zero selects the v1
// default. Small values are useful for deterministic acceptance fixtures.
type PartitionOptions struct {
	SegmentBytes int64
}

func (options PartitionOptions) normalized() (PartitionOptions, error) {
	if options.SegmentBytes == 0 {
		options.SegmentBytes = DefaultSegmentBytes
	}
	if options.SegmentBytes < frameFixedBytes || options.SegmentBytes > math.MaxInt64 {
		return PartitionOptions{}, fmt.Errorf("segment bytes must be in %d..=%d", frameFixedBytes, int64(math.MaxInt64))
	}
	return options, nil
}

type segmentFrame struct {
	position   int64
	length     int
	kind       EntryKind
	logIndex   uint64
	term       uint64
	baseOffset uint64
	dataEnd    uint64
}

type logSegment struct {
	baseIndex    uint64
	lastIndex    uint64
	walPath      string
	indexPath    string
	file         adapters.DurableFile
	size         int64
	sealed       bool
	frames       []segmentFrame
	hasData      bool
	firstOffset  uint64
	dataEnd      uint64
	anchors      []IndexEntry
	indexHealthy bool
}

type PartitionLog struct {
	// The read lock is a stable read-view lease: segment handles cannot be
	// closed, truncated, or reused until the reader releases it.
	mu               sync.RWMutex
	filesystem       adapters.FileSystem
	directory        string
	topic            string
	partitionID      uint32
	options          PartitionOptions
	segments         []*logSegment
	dataSegments     []*logSegment
	lastLogIndex     uint64
	leo              uint64
	hardState        HardState
	recovery         *RecoveryEvent
	indexRebuilds    uint64
	recoveryRequired bool
	closed           bool
	onClose          func()
}

func openPartitionLog(filesystem adapters.FileSystem, directory, topic string, partitionID uint32) (*PartitionLog, error) {
	return openPartitionLogWithOptions(filesystem, directory, topic, partitionID, PartitionOptions{})
}

func openPartitionLogWithOptions(filesystem adapters.FileSystem, directory, topic string, partitionID uint32, options PartitionOptions) (*PartitionLog, error) {
	options, err := options.normalized()
	if err != nil {
		return nil, err
	}
	hardState, err := readHardState(filesystem, directory)
	if err != nil {
		return nil, fmt.Errorf("read hardstate: %w", err)
	}
	partition := &PartitionLog{
		filesystem:  filesystem,
		directory:   directory,
		topic:       topic,
		partitionID: partitionID,
		options:     options,
		hardState:   hardState,
	}
	if err := partition.recoverSegments(); err != nil {
		partition.closeSegmentFiles()
		return nil, err
	}
	return partition, nil
}

func (partition *PartitionLog) AppendBatch(term, appendTimestampMS uint64, records []DataRecord) (AppendResult, error) {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if err := partition.requireWritable(); err != nil {
		return AppendResult{}, err
	}
	if term == 0 || term > math.MaxInt64 {
		return AppendResult{}, errors.New("term must be in 1..=MaxInt64")
	}
	if appendTimestampMS > math.MaxInt64 {
		return AppendResult{}, errors.New("append timestamp exceeds MaxInt64")
	}
	if partition.lastLogIndex == math.MaxInt64 {
		return AppendResult{}, errors.New("log index overflow")
	}
	payload := newStandaloneDataPayload(partition.leo, appendTimestampMS, records)
	payloadBytes, err := encodeDataPayload(payload)
	if err != nil {
		return AppendResult{}, err
	}
	frame := Frame{
		Kind:     KindData,
		LogIndex: partition.lastLogIndex + 1,
		Term:     term,
		Payload:  payloadBytes,
	}
	if err := partition.appendEntriesLocked([]Frame{frame}); err != nil {
		return AppendResult{}, err
	}
	return AppendResult{
		BaseOffset:  partition.leo - uint64(len(records)),
		LastOffset:  partition.leo - 1,
		LogIndex:    frame.LogIndex,
		RecordCount: uint32(len(records)),
	}, nil
}

// AppendEntries durably appends already-encoded Raft entries. A successful
// return means every touched WAL segment reached a File.Sync barrier. Index
// files are disposable caches and never form a second commit path.
func (partition *PartitionLog) AppendEntries(entries []Frame) error {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if err := partition.requireWritable(); err != nil {
		return err
	}
	return partition.appendEntriesLocked(entries)
}

type preparedEntry struct {
	frame      Frame
	encoded    []byte
	baseOffset uint64
	dataEnd    uint64
}

type placedEntry struct {
	segment *logSegment
	meta    segmentFrame
}

func (partition *PartitionLog) appendEntriesLocked(entries []Frame) error {
	if len(entries) == 0 {
		return errors.New("append requires at least one entry")
	}
	nextIndex := partition.lastLogIndex + 1
	nextLEO := partition.leo
	prepared := make([]preparedEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.LogIndex != nextIndex {
			return fmt.Errorf("entry index %d does not match next index %d", entry.LogIndex, nextIndex)
		}
		encoded, err := EncodeFrame(entry)
		if err != nil {
			return err
		}
		item := preparedEntry{frame: cloneFrame(entry), encoded: encoded}
		if entry.Kind == KindData {
			payload, err := decodeDataPayload(entry.Payload, &nextLEO)
			if err != nil {
				return err
			}
			item.baseOffset = nextLEO
			nextLEO += uint64(len(payload.Records))
			item.dataEnd = nextLEO
		}
		prepared = append(prepared, item)
		nextIndex++
	}

	placed := make([]placedEntry, 0, len(prepared))
	touched := make(map[*logSegment]struct{})
	for _, entry := range prepared {
		active := partition.segments[len(partition.segments)-1]
		if active.size > 0 && active.size+int64(len(entry.encoded)) > partition.options.SegmentBytes {
			if err := active.file.Sync(); err != nil {
				partition.recoveryRequired = true
				return fmt.Errorf("sync segment before rotation: %w", err)
			}
			active.sealed = true
			var err error
			active, err = partition.createSegment(entry.frame.LogIndex)
			if err != nil {
				partition.recoveryRequired = true
				return fmt.Errorf("rotate WAL segment: %w", err)
			}
			partition.segments = append(partition.segments, active)
		}
		position := active.size
		if err := writeAllAt(active.file, position, entry.encoded); err != nil {
			partition.recoveryRequired = true
			return fmt.Errorf("append WAL bytes: %w", err)
		}
		active.size += int64(len(entry.encoded))
		touched[active] = struct{}{}
		placed = append(placed, placedEntry{
			segment: active,
			meta: segmentFrame{
				position:   position,
				length:     len(entry.encoded),
				kind:       entry.frame.Kind,
				logIndex:   entry.frame.LogIndex,
				term:       entry.frame.Term,
				baseOffset: entry.baseOffset,
				dataEnd:    entry.dataEnd,
			},
		})
	}
	for _, segment := range partition.segments {
		if _, ok := touched[segment]; !ok {
			continue
		}
		if err := segment.file.Sync(); err != nil {
			partition.recoveryRequired = true
			return fmt.Errorf("sync WAL: %w", err)
		}
	}

	for _, placement := range placed {
		segment := placement.segment
		segment.frames = append(segment.frames, placement.meta)
		segment.lastIndex = placement.meta.logIndex
	}
	partition.lastLogIndex = entries[len(entries)-1].LogIndex
	partition.leo = nextLEO
	for segment := range touched {
		segment.rebuildDerived()
		if err := partition.persistSegmentIndex(segment); err != nil {
			segment.indexHealthy = false
		} else {
			segment.indexHealthy = true
		}
	}
	partition.rebuildDataCatalog()
	return nil
}

func (partition *PartitionLog) PersistHardState(next HardState) error {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if err := partition.requireWritable(); err != nil {
		return err
	}
	if err := validateHardStateTransition(partition.hardState, next, partition.lastLogIndex); err != nil {
		return err
	}
	if err := persistHardState(partition.filesystem, partition.directory, next); err != nil {
		partition.recoveryRequired = true
		return err
	}
	partition.hardState = cloneHardState(next)
	return nil
}

func (partition *PartitionLog) LEO() uint64 {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	return partition.leo
}

func (partition *PartitionLog) LastLogIndex() uint64 {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	return partition.lastLogIndex
}

func (partition *PartitionLog) HardState() HardState {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	return cloneHardState(partition.hardState)
}

func (partition *PartitionLog) RecoveryEvent() *RecoveryEvent {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	if partition.recovery == nil {
		return nil
	}
	event := *partition.recovery
	return &event
}

func (partition *PartitionLog) IndexRebuildCount() uint64 {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	return partition.indexRebuilds
}

func (partition *PartitionLog) Term(index uint64) (uint64, error) {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	if partition.closed {
		return 0, errors.New("partition is closed")
	}
	for _, segment := range partition.segments {
		if len(segment.frames) == 0 || index < segment.baseIndex || index > segment.lastIndex {
			continue
		}
		position := int(index - segment.baseIndex)
		if position >= 0 && position < len(segment.frames) && segment.frames[position].logIndex == index {
			return segment.frames[position].term, nil
		}
		for _, frame := range segment.frames {
			if frame.logIndex == index {
				return frame.term, nil
			}
		}
	}
	return 0, fmt.Errorf("log index %d is not present", index)
}

// TruncateSuffix removes fromIndex and every later entry. It is only legal for
// an uncommitted suffix. The WAL mutation and directory removals are synced
// before success; affected sparse indexes are then rebuilt from retained WAL.
func (partition *PartitionLog) TruncateSuffix(fromIndex uint64) error {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if err := partition.requireWritable(); err != nil {
		return err
	}
	if fromIndex == 0 || fromIndex > partition.lastLogIndex+1 {
		return fmt.Errorf("truncate index %d is outside 1..=%d", fromIndex, partition.lastLogIndex+1)
	}
	if fromIndex <= partition.hardState.CommitIndex {
		return fmt.Errorf("%w: index %d <= commit index %d", ErrCommittedTruncate, fromIndex, partition.hardState.CommitIndex)
	}
	if fromIndex == partition.lastLogIndex+1 {
		return nil
	}

	targetIndex := -1
	targetPosition := int64(0)
	for i, segment := range partition.segments {
		for _, frame := range segment.frames {
			if frame.logIndex == fromIndex {
				targetIndex = i
				targetPosition = frame.position
				break
			}
		}
		if targetIndex >= 0 {
			break
		}
	}
	if targetIndex < 0 {
		return fmt.Errorf("truncate index %d is not present", fromIndex)
	}
	target := partition.segments[targetIndex]
	if err := target.file.Truncate(targetPosition); err != nil {
		partition.recoveryRequired = true
		return fmt.Errorf("truncate WAL: %w", err)
	}
	if err := target.file.Sync(); err != nil {
		partition.recoveryRequired = true
		return fmt.Errorf("sync truncated WAL: %w", err)
	}
	for _, segment := range partition.segments[targetIndex+1:] {
		if err := segment.file.Close(); err != nil {
			partition.recoveryRequired = true
			return fmt.Errorf("close removed segment: %w", err)
		}
		if err := partition.filesystem.Remove(segment.walPath); err != nil {
			partition.recoveryRequired = true
			return fmt.Errorf("remove WAL suffix: %w", err)
		}
		if err := partition.filesystem.Remove(segment.indexPath); err != nil {
			// Missing indexes are expected because they are disposable caches.
			if !isNotExist(err) {
				partition.recoveryRequired = true
				return fmt.Errorf("remove index suffix: %w", err)
			}
		}
	}
	if err := partition.filesystem.SyncDir(partition.directory); err != nil {
		partition.recoveryRequired = true
		return fmt.Errorf("sync partition directory after truncate: %w", err)
	}

	keptFrames := target.frames[:0]
	for _, frame := range target.frames {
		if frame.logIndex < fromIndex {
			keptFrames = append(keptFrames, frame)
		}
	}
	target.frames = keptFrames
	target.size = targetPosition
	target.sealed = false
	target.rebuildDerived()
	partition.segments = partition.segments[:targetIndex+1]
	partition.lastLogIndex = fromIndex - 1
	partition.leo = partition.dataEndFromFrames()
	partition.rebuildDataCatalog()
	if err := partition.persistSegmentIndex(target); err != nil {
		target.indexHealthy = false
	} else {
		target.indexHealthy = true
	}
	return nil
}

func (partition *PartitionLog) Close() error {
	partition.mu.Lock()
	if partition.closed {
		partition.mu.Unlock()
		return nil
	}
	partition.closed = true
	var closeErrors []error
	for _, segment := range partition.segments {
		if err := segment.file.Sync(); err != nil {
			closeErrors = append(closeErrors, err)
		}
		if err := segment.file.Close(); err != nil {
			closeErrors = append(closeErrors, err)
		}
	}
	onClose := partition.onClose
	partition.mu.Unlock()
	if onClose != nil {
		onClose()
	}
	return errors.Join(closeErrors...)
}

func (partition *PartitionLog) requireWritable() error {
	if partition.closed {
		return errors.New("partition is closed")
	}
	if partition.recoveryRequired {
		return ErrRecoveryRequired
	}
	return nil
}

func (partition *PartitionLog) closeSegmentFiles() {
	for _, segment := range partition.segments {
		_ = segment.file.Close()
	}
}

func (partition *PartitionLog) dataEndFromFrames() uint64 {
	var end uint64
	for _, segment := range partition.segments {
		for _, frame := range segment.frames {
			if frame.kind == KindData {
				end = frame.dataEnd
			}
		}
	}
	return end
}

func (partition *PartitionLog) rebuildDataCatalog() {
	partition.dataSegments = partition.dataSegments[:0]
	for _, segment := range partition.segments {
		if segment.hasData {
			partition.dataSegments = append(partition.dataSegments, segment)
		}
	}
}

func cloneFrame(frame Frame) Frame {
	frame.Payload = append([]byte(nil), frame.Payload...)
	return frame
}

func cloneHardState(state HardState) HardState {
	if state.VotedFor != nil {
		vote := *state.VotedFor
		state.VotedFor = &vote
	}
	return state
}
