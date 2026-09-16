package storage

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"math"
)

const (
	IndexFormatVersion uint16 = 1
	indexHeaderBytes          = 16
	indexEntryBytes           = 24
	indexCRCBytes             = 4
)

var indexMagic = [4]byte{'M', 'K', 'I', 'X'}

type IndexEntry struct {
	BaseOffset   uint64
	FilePosition uint64
	LogIndex     uint64
}

func EncodeIndex(entries []IndexEntry) ([]byte, error) {
	if err := validateIndexEntries(entries); err != nil {
		return nil, err
	}
	if len(entries) > (math.MaxInt-indexHeaderBytes-indexCRCBytes)/indexEntryBytes {
		return nil, errors.New("index size overflow")
	}
	encoded := make([]byte, indexHeaderBytes+len(entries)*indexEntryBytes+indexCRCBytes)
	copy(encoded[0:4], indexMagic[:])
	binary.BigEndian.PutUint16(encoded[4:6], IndexFormatVersion)
	binary.BigEndian.PutUint16(encoded[6:8], 0)
	binary.BigEndian.PutUint64(encoded[8:16], uint64(len(entries)))
	position := indexHeaderBytes
	for _, entry := range entries {
		binary.BigEndian.PutUint64(encoded[position:position+8], entry.BaseOffset)
		binary.BigEndian.PutUint64(encoded[position+8:position+16], entry.FilePosition)
		binary.BigEndian.PutUint64(encoded[position+16:position+24], entry.LogIndex)
		position += indexEntryBytes
	}
	binary.BigEndian.PutUint32(encoded[position:], crc32.Checksum(encoded[:position], castagnoliTable))
	return encoded, nil
}

func DecodeIndex(input []byte) ([]IndexEntry, error) {
	if len(input) < indexHeaderBytes+indexCRCBytes {
		return nil, errors.New("index is shorter than header and checksum")
	}
	if string(input[0:4]) != string(indexMagic[:]) {
		return nil, errors.New("bad index magic")
	}
	if version := binary.BigEndian.Uint16(input[4:6]); version != IndexFormatVersion {
		return nil, fmt.Errorf("unsupported index version %d", version)
	}
	if binary.BigEndian.Uint16(input[6:8]) != 0 {
		return nil, errors.New("index reserved field is non-zero")
	}
	count := binary.BigEndian.Uint64(input[8:16])
	if count > uint64((math.MaxInt-indexHeaderBytes-indexCRCBytes)/indexEntryBytes) {
		return nil, errors.New("index entry count overflow")
	}
	expectedLength := indexHeaderBytes + int(count)*indexEntryBytes + indexCRCBytes
	if len(input) != expectedLength {
		return nil, fmt.Errorf("index length %d does not match entry count %d", len(input), count)
	}
	storedCRC := binary.BigEndian.Uint32(input[len(input)-indexCRCBytes:])
	actualCRC := crc32.Checksum(input[:len(input)-indexCRCBytes], castagnoliTable)
	if storedCRC != actualCRC {
		return nil, fmt.Errorf("index CRC32C mismatch: stored %08x computed %08x", storedCRC, actualCRC)
	}
	entries := make([]IndexEntry, 0, int(count))
	for position := indexHeaderBytes; position < len(input)-indexCRCBytes; position += indexEntryBytes {
		entries = append(entries, IndexEntry{
			BaseOffset:   binary.BigEndian.Uint64(input[position : position+8]),
			FilePosition: binary.BigEndian.Uint64(input[position+8 : position+16]),
			LogIndex:     binary.BigEndian.Uint64(input[position+16 : position+24]),
		})
	}
	if err := validateIndexEntries(entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func validateIndexEntries(entries []IndexEntry) error {
	for i, entry := range entries {
		if entry.LogIndex == 0 || entry.LogIndex > math.MaxInt64 {
			return fmt.Errorf("entry %d log index must be in 1..=MaxInt64", i)
		}
		if i == 0 {
			continue
		}
		previous := entries[i-1]
		if entry.BaseOffset <= previous.BaseOffset {
			return errors.New("index base offsets must strictly increase")
		}
		if entry.FilePosition <= previous.FilePosition {
			return errors.New("index file positions must strictly increase")
		}
		if entry.LogIndex <= previous.LogIndex {
			return errors.New("index log indexes must strictly increase")
		}
	}
	return nil
}
