package protocol

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
)

const MaxOffsetPartitions = 32

type TopicPartition struct {
	Topic     string `json:"topic"`
	Partition uint32 `json:"partition"`
}

type JoinGroupResponseData struct {
	Generation      DecimalUint64 `json:"generation"`
	State           string        `json:"state"`
	CoordinatorTerm DecimalUint64 `json:"coordinator_term"`
}

type JoinGroupResponse struct {
	RequestID string                `json:"request_id"`
	Data      JoinGroupResponseData `json:"data"`
}

type SyncGroupResponseData struct {
	Generation DecimalUint64    `json:"generation"`
	State      string           `json:"state"`
	Assignment []TopicPartition `json:"assignment"`
}

type SyncGroupResponse struct {
	RequestID string                `json:"request_id"`
	Data      SyncGroupResponseData `json:"data"`
}

type HeartbeatResponseData struct {
	Generation        DecimalUint64 `json:"generation"`
	State             string        `json:"state"`
	RebalanceRequired bool          `json:"rebalance_required"`
}

type HeartbeatResponse struct {
	RequestID string                `json:"request_id"`
	Data      HeartbeatResponseData `json:"data"`
}

type LeaveGroupResponseData struct {
	Removed    bool          `json:"removed"`
	Generation DecimalUint64 `json:"generation"`
}

type LeaveGroupResponse struct {
	RequestID string                 `json:"request_id"`
	Data      LeaveGroupResponseData `json:"data"`
}

type CommitOffsetsResponseData struct {
	Generation DecimalUint64  `json:"generation"`
	Offsets    []OffsetCommit `json:"offsets"`
}

type CommitOffsetsResponse struct {
	RequestID string                    `json:"request_id"`
	Data      CommitOffsetsResponseData `json:"data"`
}

// CommittedOffset is a committed next offset; a nil Offset means none yet.
type CommittedOffset struct {
	Topic     string         `json:"topic"`
	Partition uint32         `json:"partition"`
	Offset    *DecimalUint64 `json:"offset"`
}

type GetOffsetsResponseData struct {
	Offsets []CommittedOffset `json:"offsets"`
}

type GetOffsetsResponse struct {
	RequestID string                 `json:"request_id"`
	Data      GetOffsetsResponseData `json:"data"`
}

type FetchedRecord struct {
	Offset            DecimalUint64 `json:"offset"`
	KeyBase64         *string       `json:"key_base64"`
	ValueBase64       string        `json:"value_base64"`
	AppendTimestampMS DecimalUint64 `json:"append_timestamp_ms"`
}

type FetchResponseData struct {
	Records       []FetchedRecord `json:"records"`
	NextOffset    DecimalUint64   `json:"next_offset"`
	HighWatermark DecimalUint64   `json:"high_watermark"`
	LogEndOffset  DecimalUint64   `json:"log_end_offset"`
	LeaderTerm    DecimalUint64   `json:"leader_term"`
}

type FetchResponse struct {
	RequestID string            `json:"request_id"`
	Data      FetchResponseData `json:"data"`
}

// OffsetsQuery encodes GET /v1/groups/{group}/offsets partitions as
// repeated `partition=<topic>/<id>` query parameters (ADR-010).
func OffsetsQuery(partitions []TopicPartition) url.Values {
	query := url.Values{}
	for _, partition := range partitions {
		query.Add("partition", fmt.Sprintf("%s/%d", partition.Topic, partition.Partition))
	}
	return query
}

func ParseOffsetsQuery(query url.Values) ([]TopicPartition, error) {
	if err := onlyQueryKeys(query, "partition"); err != nil {
		return nil, err
	}
	values := query["partition"]
	if len(values) == 0 || len(values) > MaxOffsetPartitions {
		return nil, fmt.Errorf("partition must be given 1..%d times", MaxOffsetPartitions)
	}
	partitions := make([]TopicPartition, 0, len(values))
	seen := map[TopicPartition]bool{}
	for _, value := range values {
		partition, err := parseTopicPartition(value)
		if err != nil {
			return nil, err
		}
		if seen[partition] {
			return nil, fmt.Errorf("partition %s is repeated", value)
		}
		seen[partition] = true
		partitions = append(partitions, partition)
	}
	return partitions, nil
}

// FetchQuery encodes GET /v1/fetch fields as query parameters (ADR-010).
func FetchQuery(request FetchRequest) url.Values {
	return url.Values{
		"topic":       {request.Topic},
		"partition":   {strconv.FormatUint(uint64(request.Partition), 10)},
		"offset":      {strconv.FormatUint(uint64(request.Offset), 10)},
		"max_bytes":   {strconv.FormatUint(uint64(request.MaxBytes), 10)},
		"max_wait_ms": {strconv.FormatUint(uint64(request.MaxWaitMS), 10)},
	}
}

func ParseFetchQuery(query url.Values) (FetchRequest, error) {
	fields := []string{"topic", "partition", "offset", "max_bytes", "max_wait_ms"}
	if err := onlyQueryKeys(query, fields...); err != nil {
		return FetchRequest{}, err
	}
	numbers := map[string]uint64{}
	for _, field := range fields {
		if len(query[field]) != 1 {
			return FetchRequest{}, fmt.Errorf("%s must be given exactly once", field)
		}
		if field == "topic" {
			continue
		}
		bits := 32
		if field == "offset" {
			bits = 64
		}
		value, err := parseCanonicalDecimal(query.Get(field), bits)
		if err != nil {
			return FetchRequest{}, fmt.Errorf("%s: %w", field, err)
		}
		numbers[field] = value
	}
	request := FetchRequest{
		Topic: query.Get("topic"), Partition: uint32(numbers["partition"]), Offset: DecimalUint64(numbers["offset"]),
		MaxBytes: uint32(numbers["max_bytes"]), MaxWaitMS: uint32(numbers["max_wait_ms"]),
	}
	return request, request.Validate()
}

func parseTopicPartition(value string) (TopicPartition, error) {
	for i := len(value) - 1; i >= 0; i-- {
		if value[i] != '/' {
			continue
		}
		topic := value[:i]
		if err := validateUserTopic(topic); err != nil {
			return TopicPartition{}, err
		}
		id, err := parseCanonicalDecimal(value[i+1:], 31)
		if err != nil {
			return TopicPartition{}, fmt.Errorf("partition id: %w", err)
		}
		return TopicPartition{Topic: topic, Partition: uint32(id)}, nil
	}
	return TopicPartition{}, errors.New("partition must be <topic>/<id>")
}

func parseCanonicalDecimal(raw string, bits int) (uint64, error) {
	if raw == "" || len(raw) > 1 && raw[0] == '0' {
		return 0, errors.New("expected a canonical unsigned decimal")
	}
	return strconv.ParseUint(raw, 10, bits)
}

func onlyQueryKeys(query url.Values, allowed ...string) error {
	for key := range query {
		known := false
		for _, name := range allowed {
			known = known || key == name
		}
		if !known {
			return fmt.Errorf("unknown query parameter %q", key)
		}
	}
	return nil
}
