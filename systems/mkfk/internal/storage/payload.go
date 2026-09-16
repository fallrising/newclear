package storage

import (
	"bytes"
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
