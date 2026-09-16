// Package storage defines mkfk's persisted v1 formats. It does not perform
// network or consensus work.
package storage

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"math"
)

const (
	WALFormatVersion uint16 = 1
	MaxWALFrameBytes        = 4 << 20
	frameFixedBytes         = 32
	frameAfterLength        = 28
)

var castagnoliTable = crc32.MakeTable(crc32.Castagnoli)

type EntryKind uint8

const (
	KindData  EntryKind = 1
	KindNOOP  EntryKind = 2
	KindFence EntryKind = 3
	KindGroup EntryKind = 4
)

func (k EntryKind) valid() bool {
	return k >= KindData && k <= KindGroup
}

type Frame struct {
	Kind     EntryKind
	LogIndex uint64
	Term     uint64
	Payload  []byte
}

func (f Frame) Validate() error {
	if !f.Kind.valid() {
		return fmt.Errorf("unknown entry kind %d", f.Kind)
	}
	if f.LogIndex == 0 || f.LogIndex > math.MaxInt64 {
		return errors.New("log index must be in 1..=MaxInt64")
	}
	if f.Term == 0 || f.Term > math.MaxInt64 {
		return errors.New("term must be in 1..=MaxInt64")
	}
	if !json.Valid(f.Payload) {
		return errors.New("payload must be valid UTF-8 JSON")
	}
	if len(f.Payload) > MaxWALFrameBytes-frameFixedBytes {
		return fmt.Errorf("payload exceeds %d-byte frame limit", MaxWALFrameBytes)
	}
	return nil
}

func EncodeFrame(frame Frame) ([]byte, error) {
	if err := frame.Validate(); err != nil {
		return nil, err
	}
	total, ok := checkedAdd(frameFixedBytes, len(frame.Payload))
	if !ok || total > MaxWALFrameBytes {
		return nil, errors.New("frame length overflow")
	}
	encoded := make([]byte, total)
	binary.BigEndian.PutUint32(encoded[0:4], uint32(frameAfterLength+len(frame.Payload)))
	binary.BigEndian.PutUint16(encoded[8:10], WALFormatVersion)
	encoded[10] = byte(frame.Kind)
	encoded[11] = 0
	binary.BigEndian.PutUint64(encoded[12:20], frame.LogIndex)
	binary.BigEndian.PutUint64(encoded[20:28], frame.Term)
	binary.BigEndian.PutUint32(encoded[28:32], uint32(len(frame.Payload)))
	copy(encoded[32:], frame.Payload)
	binary.BigEndian.PutUint32(encoded[4:8], crc32.Checksum(encoded[8:], castagnoliTable))
	return encoded, nil
}

// DecodeFrame decodes one frame and returns the exact number of bytes consumed.
// Length bounds are checked before allocating or slicing the payload.
func DecodeFrame(input []byte) (Frame, int, error) {
	if len(input) < 4 {
		return Frame{}, 0, io.ErrUnexpectedEOF
	}
	frameLength := uint64(binary.BigEndian.Uint32(input[0:4]))
	if frameLength < frameAfterLength {
		return Frame{}, 0, fmt.Errorf("frame length %d is smaller than %d", frameLength, frameAfterLength)
	}
	total := frameLength + 4
	if total > MaxWALFrameBytes {
		return Frame{}, 0, fmt.Errorf("frame length %d exceeds %d-byte limit", total, MaxWALFrameBytes)
	}
	if uint64(len(input)) < total {
		return Frame{}, 0, io.ErrUnexpectedEOF
	}
	encoded := input[:int(total)]
	expectedCRC := binary.BigEndian.Uint32(encoded[4:8])
	actualCRC := crc32.Checksum(encoded[8:], castagnoliTable)
	if expectedCRC != actualCRC {
		return Frame{}, 0, fmt.Errorf("CRC32C mismatch: stored %08x computed %08x", expectedCRC, actualCRC)
	}
	version := binary.BigEndian.Uint16(encoded[8:10])
	if version != WALFormatVersion {
		return Frame{}, 0, fmt.Errorf("unsupported WAL format version %d", version)
	}
	kind := EntryKind(encoded[10])
	if !kind.valid() {
		return Frame{}, 0, fmt.Errorf("unknown entry kind %d", kind)
	}
	if encoded[11] != 0 {
		return Frame{}, 0, fmt.Errorf("unknown frame flags 0x%02x", encoded[11])
	}
	payloadLength := uint64(binary.BigEndian.Uint32(encoded[28:32]))
	if payloadLength != frameLength-frameAfterLength {
		return Frame{}, 0, fmt.Errorf("payload length %d does not match frame length %d", payloadLength, frameLength)
	}
	frame := Frame{
		Kind:     kind,
		LogIndex: binary.BigEndian.Uint64(encoded[12:20]),
		Term:     binary.BigEndian.Uint64(encoded[20:28]),
		Payload:  append([]byte(nil), encoded[32:]...),
	}
	if err := frame.Validate(); err != nil {
		return Frame{}, 0, err
	}
	return frame, int(total), nil
}

func checkedAdd(a, b int) (int, bool) {
	if b > math.MaxInt-a {
		return 0, false
	}
	return a + b, true
}
