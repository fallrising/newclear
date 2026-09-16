package storage

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

func (partition *PartitionLog) recoverSegments() error {
	bases, err := discoverWALSegments(partition.filesystem, partition.directory)
	if err != nil {
		return err
	}
	if len(bases) == 0 {
		return errors.New("partition has no WAL segment")
	}
	expectedIndex := uint64(1)
	leo := uint64(0)
	for i, base := range bases {
		if base != expectedIndex {
			return fmt.Errorf("segment base index %d does not match expected index %d", base, expectedIndex)
		}
		walPath := filepath.Join(partition.directory, segmentFileName(base, ".wal"))
		file, err := partition.filesystem.Open(walPath, adapters.OpenOptions{Read: true, Write: true})
		if err != nil {
			return err
		}
		segment := &logSegment{
			baseIndex: base,
			walPath:   walPath,
			indexPath: filepath.Join(partition.directory, segmentFileName(base, ".idx")),
			file:      file,
			sealed:    i != len(bases)-1,
		}
		partition.segments = append(partition.segments, segment)
		if err := partition.scanSegment(segment, i == len(bases)-1, &expectedIndex, &leo); err != nil {
			return err
		}
		if i != len(bases)-1 && len(segment.frames) == 0 {
			return fmt.Errorf("sealed segment %s is empty", filepath.Base(segment.walPath))
		}
	}
	partition.lastLogIndex = expectedIndex - 1
	partition.leo = leo
	if err := partition.hardState.Validate(partition.lastLogIndex); err != nil {
		return fmt.Errorf("hardstate does not match recovered WAL: %w", err)
	}
	for _, segment := range partition.segments {
		partition.loadOrRebuildIndex(segment)
	}
	partition.rebuildDataCatalog()
	return nil
}

func (partition *PartitionLog) scanSegment(segment *logSegment, active bool, expectedIndex, leo *uint64) error {
	info, err := segment.file.Stat()
	if err != nil {
		return err
	}
	fileSize := info.Size()
	position := int64(0)
	for position < fileSize {
		remaining := fileSize - position
		if remaining < 4 {
			return partition.handleIncompleteTail(segment, active, position, fileSize)
		}
		var lengthBytes [4]byte
		if err := readExactlyAt(segment.file, position, lengthBytes[:]); err != nil {
			return err
		}
		frameLength := uint64(binary.BigEndian.Uint32(lengthBytes[:]))
		if frameLength < frameAfterLength || frameLength+4 > MaxWALFrameBytes {
			return fmt.Errorf("invalid complete frame length %d at byte %d in %s", frameLength, position, filepath.Base(segment.walPath))
		}
		total := int64(frameLength + 4)
		if remaining < total {
			return partition.handleIncompleteTail(segment, active, position, fileSize)
		}
		encoded := make([]byte, int(total))
		if err := readExactlyAt(segment.file, position, encoded); err != nil {
			return err
		}
		frame, consumed, err := DecodeFrame(encoded)
		if err != nil {
			return fmt.Errorf("decode complete frame at byte %d in %s: %w", position, filepath.Base(segment.walPath), err)
		}
		if consumed != len(encoded) {
			return errors.New("frame decoder did not consume complete frame")
		}
		if frame.LogIndex != *expectedIndex {
			return fmt.Errorf("log index gap: got %d, want %d", frame.LogIndex, *expectedIndex)
		}
		if len(segment.frames) == 0 && frame.LogIndex != segment.baseIndex {
			return fmt.Errorf("segment filename base %d does not match first frame %d", segment.baseIndex, frame.LogIndex)
		}
		meta := segmentFrame{
			position: position,
			length:   consumed,
			kind:     frame.Kind,
			logIndex: frame.LogIndex,
			term:     frame.Term,
		}
		if frame.Kind == KindData {
			payload, err := decodeDataPayload(frame.Payload, leo)
			if err != nil {
				return fmt.Errorf("decode DATA at index %d: %w", frame.LogIndex, err)
			}
			meta.baseOffset = *leo
			*leo += uint64(len(payload.Records))
			meta.dataEnd = *leo
		}
		segment.frames = append(segment.frames, meta)
		segment.lastIndex = frame.LogIndex
		partition.lastLogIndex = frame.LogIndex
		(*expectedIndex)++
		position += total
	}
	segment.size = position
	segment.rebuildDerived()
	return nil
}

func (partition *PartitionLog) handleIncompleteTail(segment *logSegment, active bool, validBytes, originalBytes int64) error {
	if !active {
		return fmt.Errorf("sealed segment %s has an incomplete tail", filepath.Base(segment.walPath))
	}
	if partition.lastLogIndex < partition.hardState.CommitIndex {
		return fmt.Errorf("torn tail leaves index %d below durable commit floor %d", partition.lastLogIndex, partition.hardState.CommitIndex)
	}
	if err := segment.file.Truncate(validBytes); err != nil {
		return err
	}
	if err := segment.file.Sync(); err != nil {
		return err
	}
	segment.size = validBytes
	segment.rebuildDerived()
	partition.recovery = &RecoveryEvent{
		TruncatedBytes: originalBytes - validBytes,
		ValidBytes:     validBytes,
		LastLogIndex:   partition.lastLogIndex,
	}
	return nil
}

func discoverWALSegments(filesystem adapters.FileSystem, directory string) ([]uint64, error) {
	entries, err := filesystem.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	bases := make([]uint64, 0)
	for _, entry := range entries {
		if entry.Type()&fs.ModeSymlink != 0 {
			return nil, fmt.Errorf("partition directory contains symlink %q", entry.Name())
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".wal") {
			continue
		}
		base, err := parseSegmentFileName(name, ".wal")
		if err != nil {
			return nil, err
		}
		bases = append(bases, base)
	}
	sort.Slice(bases, func(i, j int) bool { return bases[i] < bases[j] })
	for i := 1; i < len(bases); i++ {
		if bases[i] == bases[i-1] {
			return nil, fmt.Errorf("duplicate segment base index %d", bases[i])
		}
	}
	return bases, nil
}

func parseSegmentFileName(name, suffix string) (uint64, error) {
	if !strings.HasSuffix(name, suffix) {
		return 0, fmt.Errorf("segment file %q lacks %s suffix", name, suffix)
	}
	stem := strings.TrimSuffix(name, suffix)
	if len(stem) != 20 {
		return 0, fmt.Errorf("segment file %q must use a 20-digit base index", name)
	}
	base, err := strconv.ParseUint(stem, 10, 64)
	if err != nil || base == 0 || base > math.MaxInt64 || segmentFileName(base, suffix) != name {
		return 0, fmt.Errorf("segment file %q has an invalid base index", name)
	}
	return base, nil
}

func segmentFileName(base uint64, suffix string) string {
	return fmt.Sprintf("%020d%s", base, suffix)
}

func (partition *PartitionLog) createSegment(base uint64) (*logSegment, error) {
	walPath := filepath.Join(partition.directory, segmentFileName(base, ".wal"))
	file, err := partition.filesystem.Open(walPath, adapters.OpenOptions{Read: true, Write: true, CreateNew: true})
	if err != nil {
		return nil, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return nil, err
	}
	if err := partition.filesystem.SyncDir(partition.directory); err != nil {
		_ = file.Close()
		return nil, err
	}
	segment := &logSegment{
		baseIndex: base,
		walPath:   walPath,
		indexPath: filepath.Join(partition.directory, segmentFileName(base, ".idx")),
		file:      file,
	}
	if err := partition.persistSegmentIndex(segment); err == nil {
		segment.indexHealthy = true
	}
	return segment, nil
}

func (segment *logSegment) rebuildDerived() {
	segment.hasData = false
	segment.firstOffset = 0
	segment.dataEnd = 0
	segment.anchors = segment.anchors[:0]
	segment.lastIndex = segment.baseIndex - 1
	var lastAnchorPosition int64
	for _, frame := range segment.frames {
		segment.lastIndex = frame.logIndex
		if frame.kind != KindData {
			continue
		}
		if !segment.hasData {
			segment.hasData = true
			segment.firstOffset = frame.baseOffset
		}
		segment.dataEnd = frame.dataEnd
		if len(segment.anchors) == 0 || frame.position-lastAnchorPosition >= SparseIndexStride {
			segment.anchors = append(segment.anchors, IndexEntry{
				BaseOffset:   frame.baseOffset,
				FilePosition: uint64(frame.position),
				LogIndex:     frame.logIndex,
			})
			lastAnchorPosition = frame.position
		}
	}
}

func (partition *PartitionLog) loadOrRebuildIndex(segment *logSegment) {
	data, err := readBoundedFile(partition.filesystem, segment.indexPath, maximumIndexFileSize)
	if err == nil {
		var entries []IndexEntry
		entries, err = DecodeIndex(data)
		if err == nil && indexEntriesEqual(entries, segment.anchors) {
			segment.anchors = entries
			segment.indexHealthy = true
			return
		}
	}
	partition.indexRebuilds++
	if err := partition.persistSegmentIndex(segment); err == nil {
		segment.indexHealthy = true
	} else {
		segment.indexHealthy = false
	}
}

func (partition *PartitionLog) persistSegmentIndex(segment *logSegment) error {
	encoded, err := EncodeIndex(segment.anchors)
	if err != nil {
		return err
	}
	temporary, temporaryPath, err := partition.filesystem.CreateTemp(partition.directory, ".mkfk-index-*")
	if err != nil {
		return err
	}
	keepTemporary := true
	defer func() {
		_ = temporary.Close()
		if keepTemporary {
			_ = partition.filesystem.Remove(temporaryPath)
		}
	}()
	if err := writeAllAt(temporary, 0, encoded); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := partition.filesystem.Rename(temporaryPath, segment.indexPath); err != nil {
		return err
	}
	keepTemporary = false
	return partition.filesystem.SyncDir(partition.directory)
}

func indexEntriesEqual(left, right []IndexEntry) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func isNotExist(err error) bool {
	return errors.Is(err, fs.ErrNotExist)
}
