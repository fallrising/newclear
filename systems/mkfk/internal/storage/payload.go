package storage

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"unicode/utf8"

	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
)

const (
	maxRecordsPerBatch = 1000
	maxRawRecordBytes  = 1 << 20
)

type DataRecord struct {
	Key   []byte `json:"key_base64"`
	Value []byte `json:"value_base64"`
}

type DataPayload struct {
	BaseOffset      string       `json:"base_offset"`
	RecordCount     uint32       `json:"record_count"`
	AppendTimestamp string       `json:"append_timestamp_ms"`
	ProducerID      *string      `json:"producer_id"`
	ProducerEpoch   *string      `json:"producer_epoch"`
	FirstSequence   *string      `json:"first_sequence"`
	BatchDigest     *string      `json:"batch_digest"`
	Records         []DataRecord `json:"records"`
}

type ProducerMetadata struct {
	ProducerID    string
	Epoch         uint64
	FirstSequence uint64
	BatchDigest   [32]byte
}

type DataFrameDetails struct {
	BaseOffset      uint64
	EndOffset       uint64
	AppendTimestamp uint64
	Records         []DataRecord
	Producer        *ProducerMetadata
}

type FencePayload struct {
	ProducerID    string `json:"producer_id"`
	ExpectedEpoch string `json:"expected_epoch"`
	NewEpoch      string `json:"new_epoch"`
	RequestID     string `json:"request_id"`
}

type FenceCommand struct {
	ProducerID    string
	ExpectedEpoch int64
	NewEpoch      uint64
	RequestID     string
}

func newStandaloneDataPayload(baseOffset, timestamp uint64, records []DataRecord) DataPayload {
	return DataPayload{
		BaseOffset:      strconv.FormatUint(baseOffset, 10),
		RecordCount:     uint32(len(records)),
		AppendTimestamp: strconv.FormatUint(timestamp, 10),
		ProducerID:      nil,
		ProducerEpoch:   nil,
		FirstSequence:   nil,
		BatchDigest:     nil,
		Records:         cloneDataRecords(records),
	}
}

// NewStandaloneDataFrame builds the non-idempotent DATA entry used by the M1
// through M4 storage and Raft fixtures. It is not a public producer protocol:
// M5 replaces this path with durable producer identity and sequence fields.
func NewStandaloneDataFrame(logIndex, term, baseOffset, timestamp uint64, records []DataRecord) (Frame, error) {
	payload, err := encodeDataPayload(newStandaloneDataPayload(baseOffset, timestamp, records))
	if err != nil {
		return Frame{}, err
	}
	frame := Frame{Kind: KindData, LogIndex: logIndex, Term: term, Payload: payload}
	if err := frame.Validate(); err != nil {
		return Frame{}, err
	}
	return frame, nil
}

// NewProducerDataFrame binds the producer epoch, sequence, and batch digest
// to the exact DATA bytes replicated by Raft.
func NewProducerDataFrame(logIndex, term, baseOffset, timestamp uint64, metadata ProducerMetadata, records []DataRecord) (Frame, error) {
	payload := newStandaloneDataPayload(baseOffset, timestamp, records)
	epoch := strconv.FormatUint(metadata.Epoch, 10)
	sequence := strconv.FormatUint(metadata.FirstSequence, 10)
	digest := hex.EncodeToString(metadata.BatchDigest[:])
	payload.ProducerID = &metadata.ProducerID
	payload.ProducerEpoch = &epoch
	payload.FirstSequence = &sequence
	payload.BatchDigest = &digest
	payloadBytes, err := encodeDataPayload(payload)
	if err != nil {
		return Frame{}, err
	}
	frame := Frame{Kind: KindData, LogIndex: logIndex, Term: term, Payload: payloadBytes}
	if err := frame.Validate(); err != nil {
		return Frame{}, err
	}
	return frame, nil
}

// InspectDataFrame exposes validated persisted DATA fields for committed-state
// replay without making callers depend on the JSON representation.
func InspectDataFrame(frame Frame) (DataFrameDetails, error) {
	if frame.Kind != KindData {
		return DataFrameDetails{}, errors.New("frame is not DATA")
	}
	payload, err := decodeDataPayload(frame.Payload, nil)
	if err != nil {
		return DataFrameDetails{}, err
	}
	baseOffset, err := parseCanonicalUint64(payload.BaseOffset)
	if err != nil {
		return DataFrameDetails{}, err
	}
	timestamp, err := parseCanonicalUint64(payload.AppendTimestamp)
	if err != nil {
		return DataFrameDetails{}, err
	}
	details := DataFrameDetails{
		BaseOffset: baseOffset, EndOffset: baseOffset + uint64(len(payload.Records)),
		AppendTimestamp: timestamp, Records: cloneDataRecords(payload.Records),
	}
	if payload.ProducerID == nil {
		return details, nil
	}
	epoch, err := parseCanonicalUint64(*payload.ProducerEpoch)
	if err != nil {
		return DataFrameDetails{}, err
	}
	sequence, err := parseCanonicalUint64(*payload.FirstSequence)
	if err != nil {
		return DataFrameDetails{}, err
	}
	digestBytes, err := hex.DecodeString(*payload.BatchDigest)
	if err != nil || len(digestBytes) != 32 {
		return DataFrameDetails{}, errors.New("invalid producer batch digest")
	}
	metadata := ProducerMetadata{ProducerID: *payload.ProducerID, Epoch: epoch, FirstSequence: sequence}
	copy(metadata.BatchDigest[:], digestBytes)
	details.Producer = &metadata
	return details, nil
}

func NewFenceFrame(logIndex, term uint64, command FenceCommand) (Frame, error) {
	if err := validateFenceCommand(command); err != nil {
		return Frame{}, err
	}
	payload, err := json.Marshal(FencePayload{
		ProducerID: command.ProducerID, ExpectedEpoch: strconv.FormatInt(command.ExpectedEpoch, 10),
		NewEpoch: strconv.FormatUint(command.NewEpoch, 10), RequestID: command.RequestID,
	})
	if err != nil {
		return Frame{}, err
	}
	frame := Frame{Kind: KindFence, LogIndex: logIndex, Term: term, Payload: payload}
	if err := frame.Validate(); err != nil {
		return Frame{}, err
	}
	return frame, nil
}

func InspectFenceFrame(frame Frame) (FenceCommand, error) {
	if frame.Kind != KindFence {
		return FenceCommand{}, errors.New("frame is not FENCE")
	}
	var payload FencePayload
	if err := jsonstrict.Decode(frame.Payload, &payload); err != nil {
		return FenceCommand{}, err
	}
	expectedEpoch, err := parseCanonicalInt64(payload.ExpectedEpoch)
	if err != nil {
		return FenceCommand{}, fmt.Errorf("expected_epoch: %w", err)
	}
	newEpoch, err := parseCanonicalUint64(payload.NewEpoch)
	if err != nil {
		return FenceCommand{}, fmt.Errorf("new_epoch: %w", err)
	}
	command := FenceCommand{
		ProducerID: payload.ProducerID, ExpectedEpoch: expectedEpoch,
		NewEpoch: newEpoch, RequestID: payload.RequestID,
	}
	if err := validateFenceCommand(command); err != nil {
		return FenceCommand{}, err
	}
	return command, nil
}

// DataFrameEnd returns the exclusive record offset after a DATA frame. The
// boolean is false for control entries, which do not advance the user stream.
func DataFrameEnd(frame Frame) (uint64, bool, error) {
	if frame.Kind != KindData {
		return 0, false, nil
	}
	payload, err := decodeDataPayload(frame.Payload, nil)
	if err != nil {
		return 0, false, err
	}
	baseOffset, err := parseCanonicalUint64(payload.BaseOffset)
	if err != nil {
		return 0, false, err
	}
	return baseOffset + uint64(len(payload.Records)), true, nil
}

func (payload DataPayload) validate(expectedBaseOffset *uint64) (uint64, error) {
	baseOffset, err := parseCanonicalUint64(payload.BaseOffset)
	if err != nil {
		return 0, fmt.Errorf("base_offset: %w", err)
	}
	if expectedBaseOffset != nil && baseOffset != *expectedBaseOffset {
		return 0, fmt.Errorf("base_offset %d does not match expected LEO %d", baseOffset, *expectedBaseOffset)
	}
	if _, err := parseCanonicalUint64(payload.AppendTimestamp); err != nil {
		return 0, fmt.Errorf("append_timestamp_ms: %w", err)
	}
	if len(payload.Records) == 0 || len(payload.Records) > maxRecordsPerBatch {
		return 0, fmt.Errorf("records must contain 1..%d entries", maxRecordsPerBatch)
	}
	if payload.RecordCount != uint32(len(payload.Records)) {
		return 0, errors.New("record_count does not match records")
	}
	if payload.ProducerID == nil {
		if payload.ProducerEpoch != nil || payload.FirstSequence != nil || payload.BatchDigest != nil {
			return 0, errors.New("non-idempotent payload has partial producer metadata")
		}
	} else {
		if !utf8.ValidString(*payload.ProducerID) || *payload.ProducerID == "" {
			return 0, errors.New("producer_id is invalid")
		}
		if payload.ProducerEpoch == nil || payload.FirstSequence == nil || payload.BatchDigest == nil {
			return 0, errors.New("idempotent payload is missing producer metadata")
		}
		if _, err := parseCanonicalUint64(*payload.ProducerEpoch); err != nil {
			return 0, fmt.Errorf("producer_epoch: %w", err)
		}
		if _, err := parseCanonicalUint64(*payload.FirstSequence); err != nil {
			return 0, fmt.Errorf("first_sequence: %w", err)
		}
		if !isLowerHex(*payload.BatchDigest, 64) {
			return 0, errors.New("batch_digest must be 64 lowercase hex characters")
		}
	}
	for i, record := range payload.Records {
		if record.Value == nil {
			return 0, fmt.Errorf("record %d value_base64 must not be null", i)
		}
		if len(record.Value) > maxRawRecordBytes-len(record.Key) {
			return 0, fmt.Errorf("record %d exceeds %d raw bytes", i, maxRawRecordBytes)
		}
	}
	if baseOffset > math.MaxInt64-uint64(len(payload.Records)) {
		return 0, errors.New("record offset overflow")
	}
	return baseOffset, nil
}

func encodeDataPayload(payload DataPayload) ([]byte, error) {
	if _, err := payload.validate(nil); err != nil {
		return nil, err
	}
	return json.Marshal(payload)
}

func decodeDataPayload(data []byte, expectedBaseOffset *uint64) (DataPayload, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return DataPayload{}, err
	}
	for _, field := range []string{
		"base_offset", "record_count", "append_timestamp_ms", "producer_id",
		"producer_epoch", "first_sequence", "batch_digest", "records",
	} {
		if _, exists := fields[field]; !exists {
			return DataPayload{}, fmt.Errorf("required DATA field %q is missing", field)
		}
	}
	var payload DataPayload
	if err := jsonstrict.Decode(data, &payload); err != nil {
		return DataPayload{}, err
	}
	if _, err := payload.validate(expectedBaseOffset); err != nil {
		return DataPayload{}, err
	}
	return payload, nil
}

func validateNOOPPayload(data []byte) error {
	var object struct{}
	if err := jsonstrict.Decode(data, &object); err != nil {
		return err
	}
	if !bytes.Equal(bytes.TrimSpace(data), []byte("{}")) {
		return errors.New("NOOP payload must be an empty JSON object")
	}
	return nil
}

func cloneDataRecords(records []DataRecord) []DataRecord {
	cloned := make([]DataRecord, len(records))
	for i, record := range records {
		cloned[i] = DataRecord{
			Key:   cloneNullableBytes(record.Key),
			Value: append([]byte{}, record.Value...),
		}
	}
	return cloned
}

func cloneNullableBytes(value []byte) []byte {
	if value == nil {
		return nil
	}
	return append([]byte{}, value...)
}

func isLowerHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func parseCanonicalInt64(value string) (int64, error) {
	if value == "" || value[0] == '+' || value == "-0" {
		return 0, errors.New("expected canonical signed decimal string")
	}
	digits := value
	if value[0] == '-' {
		digits = value[1:]
	}
	if digits == "" || len(digits) > 1 && digits[0] == '0' {
		return 0, errors.New("expected canonical signed decimal string")
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}

func validateFenceCommand(command FenceCommand) error {
	if command.ProducerID == "" || len(command.ProducerID) > 64 || !utf8.ValidString(command.ProducerID) {
		return errors.New("producer_id is invalid")
	}
	if command.RequestID == "" || len(command.RequestID) > 64 || !isSafeToken(command.RequestID) {
		return errors.New("request_id is invalid")
	}
	if command.ExpectedEpoch < -1 {
		return errors.New("expected_epoch must be -1 or non-negative")
	}
	if command.ExpectedEpoch == -1 {
		if command.NewEpoch != 0 {
			return errors.New("first producer epoch must be zero")
		}
		return nil
	}
	if uint64(command.ExpectedEpoch) == math.MaxInt64 || command.NewEpoch != uint64(command.ExpectedEpoch)+1 {
		return errors.New("new_epoch must be expected_epoch + 1 without overflow")
	}
	return nil
}

func isSafeToken(value string) bool {
	for index, character := range []byte(value) {
		letter := character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z'
		digit := character >= '0' && character <= '9'
		if !letter && !digit && (index == 0 || character != '_' && character != '.' && character != '-') {
			return false
		}
	}
	return true
}
