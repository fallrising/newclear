package storage

import (
	"encoding/binary"
	"errors"
	"fmt"
)

type ReadStats struct {
	SegmentComparisons int
	IndexComparisons   int
	ScannedFrames      int
	ScannedBytes       int64
	IndexBytes         int64
}

type SegmentInfo struct {
	BaseIndex   uint64
	LastIndex   uint64
	SizeBytes   int64
	Sealed      bool
	HasData     bool
	FirstOffset uint64
	EndOffset   uint64
	AnchorCount int
	IndexValid  bool
}

func (partition *PartitionLog) Segments() []SegmentInfo {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	result := make([]SegmentInfo, 0, len(partition.segments))
	for _, segment := range partition.segments {
		result = append(result, SegmentInfo{
			BaseIndex:   segment.baseIndex,
			LastIndex:   segment.lastIndex,
			SizeBytes:   segment.size,
			Sealed:      segment.sealed,
			HasData:     segment.hasData,
			FirstOffset: segment.firstOffset,
			EndOffset:   segment.dataEnd,
			AnchorCount: len(segment.anchors),
			IndexValid:  segment.indexHealthy,
		})
	}
	return result
}

func (partition *PartitionLog) ReadLocalRecords(offset uint64, maxBytes int) ([]LocalRecord, uint64, error) {
	records, next, _, err := partition.ReadLocalRecordsWithStats(offset, maxBytes)
	return records, next, err
}

func (partition *PartitionLog) ReadLocalRecordsWithStats(offset uint64, maxBytes int) ([]LocalRecord, uint64, ReadStats, error) {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	return partition.readRecordsLocked(offset, partition.leo, maxBytes)
}

// ReadRecords limits visibility to highWatermark, an exclusive DATA offset.
func (partition *PartitionLog) ReadRecords(offset, highWatermark uint64, maxBytes int) ([]LocalRecord, uint64, ReadStats, error) {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	if highWatermark > partition.leo {
		return nil, offset, ReadStats{}, fmt.Errorf("high watermark %d exceeds LEO %d", highWatermark, partition.leo)
	}
	return partition.readRecordsLocked(offset, highWatermark, maxBytes)
}

func (partition *PartitionLog) readRecordsLocked(offset, limit uint64, maxBytes int) ([]LocalRecord, uint64, ReadStats, error) {
	stats := ReadStats{}
	if partition.closed {
		return nil, offset, stats, errors.New("partition is closed")
	}
	if partition.recoveryRequired {
		return nil, offset, stats, ErrRecoveryRequired
	}
	if offset > limit {
		return nil, offset, stats, ErrOffsetOutOfRange
	}
	if maxBytes <= 0 || maxBytes > MaxLocalReadBytes {
		return nil, offset, stats, fmt.Errorf("maxBytes must be in 1..%d", MaxLocalReadBytes)
	}
	for _, segment := range partition.segments {
		stats.IndexBytes += int64(indexHeaderBytes + len(segment.anchors)*indexEntryBytes + indexCRCBytes)
	}
	if offset == limit {
		return []LocalRecord{}, offset, stats, nil
	}

	segmentIndex := partition.findDataSegment(offset, &stats)
	if segmentIndex < 0 {
		return nil, offset, stats, ErrOffsetOutOfRange
	}
	result := make([]LocalRecord, 0)
	nextOffset := offset
	usedBytes := 0
	for i := segmentIndex; i < len(partition.dataSegments); i++ {
		segment := partition.dataSegments[i]
		if segment.firstOffset >= limit {
			break
		}
		start := int64(0)
		if i == segmentIndex {
			anchor := findAnchor(segment.anchors, offset, &stats)
			if anchor >= 0 {
				start = int64(segment.anchors[anchor].FilePosition)
			}
		} else if len(segment.anchors) > 0 {
			start = int64(segment.anchors[0].FilePosition)
		}
		position := start
		for position < segment.size {
			frame, total, err := readFrameAt(segment, position)
			if err != nil {
				return nil, offset, stats, err
			}
			stats.ScannedFrames++
			stats.ScannedBytes += int64(total)
			position += int64(total)
			if frame.Kind != KindData {
				continue
			}
			payload, err := decodeDataPayload(frame.Payload, nil)
			if err != nil {
				return nil, offset, stats, err
			}
			baseOffset, err := parseCanonicalUint64(payload.BaseOffset)
			if err != nil {
				return nil, offset, stats, err
			}
			if baseOffset >= limit {
				return result, nextOffset, stats, nil
			}
			for recordIndex, record := range payload.Records {
				recordOffset := baseOffset + uint64(recordIndex)
				if recordOffset < offset {
					continue
				}
				if recordOffset >= limit {
					return result, nextOffset, stats, nil
				}
				recordBytes := len(record.Key) + len(record.Value)
				if len(result) == 0 && recordBytes > maxBytes {
					return nil, offset, stats, &ReadBudgetTooSmallError{RequiredBytes: recordBytes}
				}
				if recordBytes > maxBytes-usedBytes || len(result) == maxRecordsPerBatch {
					return result, nextOffset, stats, nil
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
	}
	return result, nextOffset, stats, nil
}

func (partition *PartitionLog) findDataSegment(offset uint64, stats *ReadStats) int {
	low, high := 0, len(partition.dataSegments)
	for low < high {
		stats.SegmentComparisons++
		middle := low + (high-low)/2
		segment := partition.dataSegments[middle]
		if offset < segment.firstOffset {
			high = middle
		} else if offset >= segment.dataEnd {
			low = middle + 1
		} else {
			return middle
		}
	}
	return -1
}

func findAnchor(entries []IndexEntry, offset uint64, stats *ReadStats) int {
	low, high := 0, len(entries)
	for low < high {
		stats.IndexComparisons++
		middle := low + (high-low)/2
		if entries[middle].BaseOffset <= offset {
			low = middle + 1
		} else {
			high = middle
		}
	}
	return low - 1
}

func (partition *PartitionLog) ReadEntries(fromIndex uint64, maxBytes int) ([]Frame, error) {
	partition.mu.RLock()
	defer partition.mu.RUnlock()
	if partition.closed {
		return nil, errors.New("partition is closed")
	}
	if partition.recoveryRequired {
		return nil, ErrRecoveryRequired
	}
	if fromIndex == 0 || maxBytes <= 0 || maxBytes > MaxWALFrameBytes {
		return nil, errors.New("invalid replication read bounds")
	}
	result := make([]Frame, 0)
	used := 0
	for _, segment := range partition.segments {
		if len(segment.frames) == 0 || segment.lastIndex < fromIndex {
			continue
		}
		for _, meta := range segment.frames {
			if meta.logIndex < fromIndex {
				continue
			}
			frame, total, err := readFrameAt(segment, meta.position)
			if err != nil {
				return nil, err
			}
			if total != meta.length {
				return nil, errors.New("frame length changed after recovery")
			}
			if len(result) == 0 && total > maxBytes {
				return nil, &ReadBudgetTooSmallError{RequiredBytes: total}
			}
			if total > maxBytes-used {
				return result, nil
			}
			result = append(result, frame)
			used += total
		}
	}
	return result, nil
}

func readFrameAt(segment *logSegment, position int64) (Frame, int, error) {
	if position < 0 || position+4 > segment.size {
		return Frame{}, 0, errors.New("frame position is outside segment")
	}
	var lengthBytes [4]byte
	if err := readExactlyAt(segment.file, position, lengthBytes[:]); err != nil {
		return Frame{}, 0, err
	}
	frameLength := uint64(binary.BigEndian.Uint32(lengthBytes[:]))
	if frameLength < frameAfterLength || frameLength+4 > MaxWALFrameBytes {
		return Frame{}, 0, fmt.Errorf("invalid frame length %d at byte %d", frameLength, position)
	}
	total := int(frameLength + 4)
	if position+int64(total) > segment.size {
		return Frame{}, 0, errors.New("frame extends past recovered segment size")
	}
	encoded := make([]byte, total)
	if err := readExactlyAt(segment.file, position, encoded); err != nil {
		return Frame{}, 0, err
	}
	frame, consumed, err := DecodeFrame(encoded)
	if err != nil {
		return Frame{}, 0, err
	}
	return frame, consumed, nil
}
