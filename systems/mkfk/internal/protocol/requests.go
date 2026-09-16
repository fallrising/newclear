// Package protocol defines the strict HTTP/JSON v1 boundary. It intentionally
// contains no HTTP handlers before the broker milestones exist.
package protocol

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
)

const (
	MaxHTTPBodyBytes = 6 << 20
	MaxFetchBytes    = 4 << 20
	MaxLongPollMS    = 5000
)

var uuidPattern = regexp.MustCompile(`^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$`)

func DecodeJSON(body []byte, destination any) error {
	if len(body) > MaxHTTPBodyBytes {
		return fmt.Errorf("HTTP body exceeds %d bytes", MaxHTTPBodyBytes)
	}
	if err := jsonstrict.Decode(body, destination); err != nil {
		return err
	}
	if contract, ok := destination.(requiredJSONFields); ok {
		if err := requireObjectFields(body, contract.requiredFields()); err != nil {
			return err
		}
	}
	return nil
}

type requiredJSONFields interface {
	requiredFields() []string
}

type OpenProducerRequest struct {
	Topic         string       `json:"topic"`
	Partition     uint32       `json:"partition"`
	ProducerID    string       `json:"producer_id"`
	ExpectedEpoch DecimalInt64 `json:"expected_epoch"`
	RequestID     string       `json:"request_id"`
}

type OpenProducerResponseData struct {
	ProducerID string        `json:"producer_id"`
	Epoch      DecimalUint64 `json:"epoch"`
	LeaderTerm DecimalUint64 `json:"leader_term"`
}

type OpenProducerResponse struct {
	RequestID string                   `json:"request_id"`
	Data      OpenProducerResponseData `json:"data"`
}

func (*OpenProducerRequest) requiredFields() []string {
	return []string{"topic", "partition", "producer_id", "expected_epoch", "request_id"}
}

func (r OpenProducerRequest) Validate() error {
	if err := validateUserTopic(r.Topic); err != nil {
		return err
	}
	if err := validateProducerID(r.ProducerID); err != nil {
		return err
	}
	if err := config.ValidateToken("request_id", r.RequestID); err != nil {
		return err
	}
	if r.ExpectedEpoch < -1 {
		return errors.New("expected_epoch must be -1 or non-negative")
	}
	return nil
}

type WireRecord struct {
	KeyBase64   json.RawMessage `json:"key_base64"`
	ValueBase64 *string         `json:"value_base64"`
}

func (r WireRecord) Decode() (Record, error) {
	if len(r.KeyBase64) == 0 {
		return Record{}, errors.New("key_base64 is required and may be null")
	}
	if r.ValueBase64 == nil {
		return Record{}, errors.New("value_base64 is required and must be a string")
	}
	var key []byte
	if !IsJSONNull(r.KeyBase64) {
		var encodedKey string
		if err := json.Unmarshal(r.KeyBase64, &encodedKey); err != nil {
			return Record{}, errors.New("key_base64 must be null or a string")
		}
		decoded, err := decodeBase64(encodedKey)
		if err != nil {
			return Record{}, fmt.Errorf("decode key_base64: %w", err)
		}
		key = decoded
	}
	value, err := decodeBase64(*r.ValueBase64)
	if err != nil {
		return Record{}, fmt.Errorf("decode value_base64: %w", err)
	}
	record := Record{Key: key, Value: value}
	if err := record.Validate(); err != nil {
		return Record{}, err
	}
	return record, nil
}

type ProduceRequest struct {
	Topic         string        `json:"topic"`
	Partition     uint32        `json:"partition"`
	ProducerID    string        `json:"producer_id"`
	Epoch         DecimalUint64 `json:"epoch"`
	FirstSequence DecimalUint64 `json:"first_sequence"`
	Acks          string        `json:"acks"`
	Records       []WireRecord  `json:"records"`
}

type ProduceResponseData struct {
	BaseOffset   DecimalUint64 `json:"base_offset"`
	LastOffset   DecimalUint64 `json:"last_offset"`
	NextSequence DecimalUint64 `json:"next_sequence"`
	Duplicate    bool          `json:"duplicate"`
	LeaderTerm   DecimalUint64 `json:"leader_term"`
}

type ProduceResponse struct {
	RequestID string              `json:"request_id"`
	Data      ProduceResponseData `json:"data"`
}

func (*ProduceRequest) requiredFields() []string {
	return []string{"topic", "partition", "producer_id", "epoch", "first_sequence", "acks", "records"}
}

type ValidatedProduce struct {
	Records      []Record
	Fingerprint  [32]byte
	NextSequence uint64
}

func (r ProduceRequest) Validate() (ValidatedProduce, error) {
	if err := validateUserTopic(r.Topic); err != nil {
		return ValidatedProduce{}, err
	}
	if err := validateProducerID(r.ProducerID); err != nil {
		return ValidatedProduce{}, err
	}
	if r.Acks != "all" {
		return ValidatedProduce{}, errors.New("only acks=all is supported")
	}
	if len(r.Records) == 0 || len(r.Records) > MaxRecordsPerBatch {
		return ValidatedProduce{}, fmt.Errorf("records must contain 1..%d entries", MaxRecordsPerBatch)
	}
	records := make([]Record, 0, len(r.Records))
	totalRaw := 0
	for _, wire := range r.Records {
		record, err := wire.Decode()
		if err != nil {
			return ValidatedProduce{}, err
		}
		if len(record.Key) > math.MaxInt-totalRaw-len(record.Value) {
			return ValidatedProduce{}, errors.New("batch byte length overflow")
		}
		totalRaw += len(record.Key) + len(record.Value)
		records = append(records, record)
	}
	if totalRaw > (4<<20)-512 {
		return ValidatedProduce{}, errors.New("decoded batch cannot fit in one WAL frame")
	}
	if uint64(r.FirstSequence) > math.MaxUint64-uint64(len(records)) {
		return ValidatedProduce{}, errors.New("sequence overflow")
	}
	fingerprint, err := BatchFingerprint(records)
	if err != nil {
		return ValidatedProduce{}, err
	}
	return ValidatedProduce{
		Records:      records,
		Fingerprint:  fingerprint,
		NextSequence: uint64(r.FirstSequence) + uint64(len(records)),
	}, nil
}

type FetchRequest struct {
	Topic     string        `json:"topic"`
	Partition uint32        `json:"partition"`
	Offset    DecimalUint64 `json:"offset"`
	MaxBytes  uint32        `json:"max_bytes"`
	MaxWaitMS uint32        `json:"max_wait_ms"`
}

func (*FetchRequest) requiredFields() []string {
	return []string{"topic", "partition", "offset", "max_bytes", "max_wait_ms"}
}

func (r FetchRequest) Validate() error {
	if err := validateUserTopic(r.Topic); err != nil {
		return err
	}
	if r.MaxBytes == 0 || r.MaxBytes > MaxFetchBytes {
		return fmt.Errorf("max_bytes must be in 1..%d", MaxFetchBytes)
	}
	if r.MaxWaitMS > MaxLongPollMS {
		return fmt.Errorf("max_wait_ms must be at most %d", MaxLongPollMS)
	}
	return nil
}

type JoinGroupRequest struct {
	MemberID     string   `json:"member_id"`
	Subscription []string `json:"subscription"`
	RequestID    string   `json:"request_id"`
}

func (*JoinGroupRequest) requiredFields() []string {
	return []string{"member_id", "subscription", "request_id"}
}

func (r JoinGroupRequest) Validate() error {
	if err := validateMemberRequest(r.MemberID, r.RequestID); err != nil {
		return err
	}
	if len(r.Subscription) == 0 || len(r.Subscription) > 32 {
		return errors.New("subscription must contain 1..32 topics")
	}
	topics := append([]string(nil), r.Subscription...)
	sort.Strings(topics)
	for i, topic := range topics {
		if err := validateUserTopic(topic); err != nil {
			return err
		}
		if i > 0 && topics[i-1] == topic {
			return fmt.Errorf("subscription repeats topic %q", topic)
		}
	}
	return nil
}

type SyncGroupRequest struct {
	MemberID   string        `json:"member_id"`
	Generation DecimalUint64 `json:"generation"`
	Revoked    bool          `json:"revoked"`
}

func (*SyncGroupRequest) requiredFields() []string {
	return []string{"member_id", "generation", "revoked"}
}

func (r SyncGroupRequest) Validate() error {
	return config.ValidateToken("member_id", r.MemberID)
}

type HeartbeatRequest struct {
	MemberID   string        `json:"member_id"`
	Generation DecimalUint64 `json:"generation"`
}

func (*HeartbeatRequest) requiredFields() []string {
	return []string{"member_id", "generation"}
}

func (r HeartbeatRequest) Validate() error {
	return config.ValidateToken("member_id", r.MemberID)
}

type LeaveGroupRequest struct {
	MemberID   string        `json:"member_id"`
	Generation DecimalUint64 `json:"generation"`
	RequestID  string        `json:"request_id"`
}

func (*LeaveGroupRequest) requiredFields() []string {
	return []string{"member_id", "generation", "request_id"}
}

func (r LeaveGroupRequest) Validate() error {
	return validateMemberRequest(r.MemberID, r.RequestID)
}

type OffsetCommit struct {
	Topic     string        `json:"topic"`
	Partition uint32        `json:"partition"`
	Offset    DecimalUint64 `json:"offset"`
}

type CommitOffsetsRequest struct {
	MemberID   string         `json:"member_id"`
	Generation DecimalUint64  `json:"generation"`
	Offsets    []OffsetCommit `json:"offsets"`
	RequestID  string         `json:"request_id"`
}

func (*CommitOffsetsRequest) requiredFields() []string {
	return []string{"member_id", "generation", "offsets", "request_id"}
}

func (r CommitOffsetsRequest) Validate() error {
	if err := validateMemberRequest(r.MemberID, r.RequestID); err != nil {
		return err
	}
	if len(r.Offsets) == 0 || len(r.Offsets) > 32 {
		return errors.New("offsets must contain 1..32 entries")
	}
	seen := make(map[string]struct{}, len(r.Offsets))
	for _, offset := range r.Offsets {
		if err := validateUserTopic(offset.Topic); err != nil {
			return err
		}
		key := fmt.Sprintf("%s/%d", offset.Topic, offset.Partition)
		if _, exists := seen[key]; exists {
			return fmt.Errorf("offsets repeat %s", key)
		}
		seen[key] = struct{}{}
	}
	return nil
}

type Outcome string

const (
	OutcomeNotApplied    Outcome = "not_applied"
	OutcomeUnknown       Outcome = "unknown"
	OutcomeApplied       Outcome = "applied"
	OutcomeNotApplicable Outcome = "not_applicable"
)

type APIError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Retryable bool           `json:"retryable"`
	Outcome   Outcome        `json:"outcome"`
	Details   map[string]any `json:"details,omitempty"`
}

type ErrorEnvelope struct {
	RequestID string   `json:"request_id"`
	Error     APIError `json:"error"`
}

func decodeBase64(encoded string) ([]byte, error) {
	if len(encoded) > base64.StdEncoding.EncodedLen(MaxRawRecordBytes) {
		return nil, errors.New("encoded field exceeds record limit")
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	return decoded, nil
}

func validateUserTopic(topic string) error {
	return config.ValidateTopicName(topic, false)
}

func validateProducerID(producerID string) error {
	if !uuidPattern.MatchString(producerID) {
		return errors.New("producer_id must be a canonical hyphenated UUID")
	}
	return nil
}

func validateMemberRequest(memberID, requestID string) error {
	if err := config.ValidateToken("member_id", memberID); err != nil {
		return err
	}
	return config.ValidateToken("request_id", requestID)
}

func ValidateGroupID(groupID string) error {
	return config.ValidateToken("group_id", groupID)
}

func ValidateRequestID(requestID string) error {
	return config.ValidateToken("request_id", requestID)
}

func requireObjectFields(body []byte, fields []string) error {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(body, &object); err != nil {
		return fmt.Errorf("decode object fields: %w", err)
	}
	if object == nil {
		return errors.New("request must be a JSON object")
	}
	for _, field := range fields {
		if _, exists := object[field]; !exists {
			return fmt.Errorf("required field %q is missing", field)
		}
	}
	return nil
}
