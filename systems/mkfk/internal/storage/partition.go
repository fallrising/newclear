package storage

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

const MaxLocalReadBytes = 4 << 20

var (
	ErrRecoveryRequired = errors.New("partition requires restart recovery")
	ErrOffsetOutOfRange = errors.New("offset is outside the local log")
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

type storedBatch struct {
	LogIndex   uint64
	BaseOffset uint64
	Records    []DataRecord
}

type PartitionLog struct {
	mu               sync.Mutex
	filesystem       adapters.FileSystem
	directory        string
	topic            string
	partitionID      uint32
	wal              adapters.DurableFile
	writeOffset      int64
	frames           []Frame
	batches          []storedBatch
	lastLogIndex     uint64
	leo              uint64
	hardState        HardState
	recovery         *RecoveryEvent
	recoveryRequired bool
	closed           bool
	onClose          func()
}

func openPartitionLog(filesystem adapters.FileSystem, directory, topic string, partitionID uint32) (*PartitionLog, error) {
	hardState, err := readHardState(filesystem, directory)
	if err != nil {
		return nil, fmt.Errorf("read hardstate: %w", err)
	}
	walPath, err := findM1WAL(filesystem, directory)
	if err != nil {
		return nil, err
	}
	wal, err := filesystem.Open(walPath, adapters.OpenOptions{Read: true, Write: true})
	if err != nil {
		return nil, err
	}
	partition := &PartitionLog{
		filesystem:  filesystem,
		directory:   directory,
		topic:       topic,
		partitionID: partitionID,
		wal:         wal,
		hardState:   hardState,
	}
	if err := partition.recover(); err != nil {
		_ = wal.Close()
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
// return means the complete group reached one File.Sync barrier.
func (partition *PartitionLog) AppendEntries(entries []Frame) error {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if err := partition.requireWritable(); err != nil {
		return err
	}
	return partition.appendEntriesLocked(entries)
}

func (partition *PartitionLog) appendEntriesLocked(entries []Frame) error {
	if len(entries) == 0 {
		return errors.New("append requires at least one entry")
	}
	nextIndex := partition.lastLogIndex + 1
	nextLEO := partition.leo
	encodedEntries := make([][]byte, 0, len(entries))
	newBatches := make([]storedBatch, 0, len(entries))
	totalBytes := 0
	for _, entry := range entries {
		if entry.LogIndex != nextIndex {
			return fmt.Errorf("entry index %d does not match next index %d", entry.LogIndex, nextIndex)
		}
		encoded, err := EncodeFrame(entry)
		if err != nil {
			return err
		}
		if len(encoded) > math.MaxInt-totalBytes {
			return errors.New("append byte length overflow")
		}
		totalBytes += len(encoded)
		encodedEntries = append(encodedEntries, encoded)
		if entry.Kind == KindData {
			payload, err := decodeDataPayload(entry.Payload, &nextLEO)
			if err != nil {
				return err
			}
			newBatches = append(newBatches, storedBatch{
				LogIndex:   entry.LogIndex,
				BaseOffset: nextLEO,
				Records:    cloneDataRecords(payload.Records),
			})
			nextLEO += uint64(len(payload.Records))
		}
		nextIndex++
	}
	combined := make([]byte, 0, totalBytes)
	for _, encoded := range encodedEntries {
		combined = append(combined, encoded...)
	}
	if err := writeAllAt(partition.wal, partition.writeOffset, combined); err != nil {
		partition.recoveryRequired = true
		return fmt.Errorf("append WAL bytes: %w", err)
	}
	if err := partition.wal.Sync(); err != nil {
		partition.recoveryRequired = true
		return fmt.Errorf("sync WAL: %w", err)
	}
	partition.writeOffset += int64(len(combined))
	for _, entry := range entries {
		partition.frames = append(partition.frames, cloneFrame(entry))
	}
	partition.batches = append(partition.batches, newBatches...)
	partition.lastLogIndex = entries[len(entries)-1].LogIndex
	partition.leo = nextLEO
	return nil
}

func (partition *PartitionLog) ReadLocalRecords(offset uint64, maxBytes int) ([]LocalRecord, uint64, error) {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if partition.closed {
		return nil, offset, errors.New("partition is closed")
	}
	if partition.recoveryRequired {
		return nil, offset, ErrRecoveryRequired
	}
	if offset > partition.leo {
		return nil, offset, ErrOffsetOutOfRange
	}
	if maxBytes <= 0 || maxBytes > MaxLocalReadBytes {
		return nil, offset, fmt.Errorf("maxBytes must be in 1..%d", MaxLocalReadBytes)
	}
	result := make([]LocalRecord, 0)
	nextOffset := offset
	usedBytes := 0
	for _, batch := range partition.batches {
		for i, record := range batch.Records {
			recordOffset := batch.BaseOffset + uint64(i)
			if recordOffset < offset {
				continue
			}
			recordBytes := len(record.Key) + len(record.Value)
			if len(result) == 0 && recordBytes > maxBytes {
				return nil, offset, &ReadBudgetTooSmallError{RequiredBytes: recordBytes}
			}
			if recordBytes > maxBytes-usedBytes || len(result) == maxRecordsPerBatch {
				return result, nextOffset, nil
			}
			result = append(result, LocalRecord{
				Offset: recordOffset,
				Key:    cloneNullableBytes(record.Key),
				Value:  append([]byte{}, record.Value...),
			})
			usedBytes += recordBytes
			nextOffset = recordOffset + 1
		}
	}
	return result, nextOffset, nil
}

func (partition *PartitionLog) ReadEntries(fromIndex uint64, maxBytes int) ([]Frame, error) {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if partition.closed {
		return nil, errors.New("partition is closed")
	}
	if fromIndex == 0 || maxBytes <= 0 || maxBytes > MaxWALFrameBytes {
		return nil, errors.New("invalid replication read bounds")
	}
	result := make([]Frame, 0)
	used := 0
	for _, frame := range partition.frames {
		if frame.LogIndex < fromIndex {
			continue
		}
		encoded, err := EncodeFrame(frame)
		if err != nil {
			return nil, err
		}
		if len(result) == 0 && len(encoded) > maxBytes {
			return nil, &ReadBudgetTooSmallError{RequiredBytes: len(encoded)}
		}
		if len(encoded) > maxBytes-used {
			break
		}
		result = append(result, cloneFrame(frame))
		used += len(encoded)
	}
	return result, nil
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
	partition.mu.Lock()
	defer partition.mu.Unlock()
	return partition.leo
}

func (partition *PartitionLog) LastLogIndex() uint64 {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	return partition.lastLogIndex
}

func (partition *PartitionLog) HardState() HardState {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	return cloneHardState(partition.hardState)
}

func (partition *PartitionLog) RecoveryEvent() *RecoveryEvent {
	partition.mu.Lock()
	defer partition.mu.Unlock()
	if partition.recovery == nil {
		return nil
	}
	event := *partition.recovery
	return &event
}

func (partition *PartitionLog) Close() error {
	partition.mu.Lock()
	if partition.closed {
		partition.mu.Unlock()
		return nil
	}
	partition.closed = true
	syncErr := partition.wal.Sync()
	closeErr := partition.wal.Close()
	onClose := partition.onClose
	partition.mu.Unlock()
	if onClose != nil {
		onClose()
	}
	return errors.Join(syncErr, closeErr)
}

func (partition *PartitionLog) recover() error {
	info, err := partition.wal.Stat()
	if err != nil {
		return err
	}
	fileSize := info.Size()
	position := int64(0)
	expectedIndex := uint64(1)
	leo := uint64(0)
	for position < fileSize {
		remaining := fileSize - position
		if remaining < 4 {
			return partition.repairTornTail(position, fileSize)
		}
		var lengthBytes [4]byte
		if err := readExactlyAt(partition.wal, position, lengthBytes[:]); err != nil {
			return err
		}
		frameLength := uint64(binary.BigEndian.Uint32(lengthBytes[:]))
		if frameLength < frameAfterLength || frameLength+4 > MaxWALFrameBytes {
			return fmt.Errorf("invalid complete frame length %d at byte %d", frameLength, position)
		}
		total := int64(frameLength + 4)
		if remaining < total {
			return partition.repairTornTail(position, fileSize)
		}
		encoded := make([]byte, int(total))
		if err := readExactlyAt(partition.wal, position, encoded); err != nil {
			return err
		}
		frame, consumed, err := DecodeFrame(encoded)
		if err != nil {
			return fmt.Errorf("decode complete frame at byte %d: %w", position, err)
		}
		if consumed != len(encoded) {
			return errors.New("frame decoder did not consume complete frame")
		}
		if frame.LogIndex != expectedIndex {
			return fmt.Errorf("log index gap: got %d, want %d", frame.LogIndex, expectedIndex)
		}
		if frame.Kind == KindData {
			payload, err := decodeDataPayload(frame.Payload, &leo)
			if err != nil {
				return fmt.Errorf("decode DATA at index %d: %w", frame.LogIndex, err)
			}
			partition.batches = append(partition.batches, storedBatch{
				LogIndex:   frame.LogIndex,
				BaseOffset: leo,
				Records:    cloneDataRecords(payload.Records),
			})
			leo += uint64(len(payload.Records))
		}
		partition.frames = append(partition.frames, cloneFrame(frame))
		partition.lastLogIndex = frame.LogIndex
		expectedIndex++
		position += total
	}
	partition.writeOffset = position
	partition.leo = leo
	if err := partition.hardState.Validate(partition.lastLogIndex); err != nil {
		return fmt.Errorf("hardstate does not match recovered WAL: %w", err)
	}
	return nil
}

func (partition *PartitionLog) repairTornTail(validBytes, originalBytes int64) error {
	if partition.lastLogIndex < partition.hardState.CommitIndex {
		return fmt.Errorf("torn tail leaves index %d below durable commit floor %d", partition.lastLogIndex, partition.hardState.CommitIndex)
	}
	if err := partition.wal.Truncate(validBytes); err != nil {
		return err
	}
	if err := partition.wal.Sync(); err != nil {
		return err
	}
	partition.writeOffset = validBytes
	partition.leo = dataEnd(partition.batches)
	partition.recovery = &RecoveryEvent{
		TruncatedBytes: originalBytes - validBytes,
		ValidBytes:     validBytes,
		LastLogIndex:   partition.lastLogIndex,
	}
	if err := partition.hardState.Validate(partition.lastLogIndex); err != nil {
		return fmt.Errorf("hardstate does not match repaired WAL: %w", err)
	}
	return nil
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

func findM1WAL(filesystem adapters.FileSystem, directory string) (string, error) {
	entries, err := filesystem.ReadDir(directory)
	if err != nil {
		return "", err
	}
	walNames := make([]string, 0)
	for _, entry := range entries {
		if entry.Type()&fs.ModeSymlink != 0 {
			return "", fmt.Errorf("partition directory contains symlink %q", entry.Name())
		}
		if strings.HasSuffix(entry.Name(), ".wal") {
			walNames = append(walNames, entry.Name())
		}
	}
	sort.Strings(walNames)
	if len(walNames) != 1 || walNames[0] != initialWALName {
		return "", fmt.Errorf("M1 requires exactly %s", initialWALName)
	}
	return filepath.Join(directory, walNames[0]), nil
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

func dataEnd(batches []storedBatch) uint64 {
	if len(batches) == 0 {
		return 0
	}
	last := batches[len(batches)-1]
	return last.BaseOffset + uint64(len(last.Records))
}
