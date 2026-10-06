package client

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

// ErrStaleGeneration means the coordinator fenced this member's generation:
// work fetched under it was not committed and must not be committed later.
var ErrStaleGeneration = errors.New("consumer generation is stale; uncommitted work was discarded")

const defaultFetchBytes = 1 << 20

// Message is one fetched record handed to the Process callback.
type Message struct {
	Topic     string
	Partition uint32
	Offset    uint64
	Key       []byte
	Value     []byte
}

type ConsumerConfig struct {
	GroupID    string
	MemberID   string
	Topics     []string
	Transport  GroupTransport
	Process    func(context.Context, Message) error
	MaxBytes   uint32
	RequestIDs RequestIDSource
}

// GroupConsumer runs join → sync → fetch → process → commit. Records are
// processed before their next offset is committed, so a crash between the
// two reprocesses them: delivery is at-least-once.
type GroupConsumer struct {
	config     ConsumerConfig
	joined     bool
	stable     bool
	generation uint64
	assignment []protocol.TopicPartition
	positions  map[protocol.TopicPartition]uint64
	committed  map[protocol.TopicPartition]uint64
	pending    *pendingCommit
}

type pendingCommit struct {
	requestID string
	request   protocol.CommitOffsetsRequest
}

func NewGroupConsumer(config ConsumerConfig) (*GroupConsumer, error) {
	if config.Transport == nil || config.Process == nil {
		return nil, errors.New("transport and process callback are required")
	}
	probe := protocol.JoinGroupRequest{MemberID: config.MemberID, Subscription: config.Topics, RequestID: "client-validation"}
	if err := probe.Validate(); err != nil {
		return nil, err
	}
	if err := protocol.ValidateGroupID(config.GroupID); err != nil {
		return nil, err
	}
	if config.MaxBytes == 0 {
		config.MaxBytes = defaultFetchBytes
	}
	if config.RequestIDs == nil {
		config.RequestIDs = randomRequestID
	}
	return &GroupConsumer{config: config}, nil
}

func (c *GroupConsumer) Generation() uint64 { return c.generation }

// Assignment lists the partitions owned in the current STABLE generation.
func (c *GroupConsumer) Assignment() []protocol.TopicPartition {
	if !c.stable {
		return nil
	}
	return append([]protocol.TopicPartition(nil), c.assignment...)
}

// Poll runs one round. Until the group is STABLE it only advances the
// rebalance; callers poll again.
func (c *GroupConsumer) Poll(ctx context.Context) error {
	if !c.stable {
		return c.rebalance(ctx)
	}
	heartbeat, err := call(c, func(id string) (protocol.HeartbeatResponseData, error) {
		return c.config.Transport.Heartbeat(ctx, id, c.config.GroupID, protocol.HeartbeatRequest{
			MemberID: c.config.MemberID, Generation: protocol.DecimalUint64(c.generation),
		})
	})
	if err != nil {
		return c.sessionError(err)
	}
	if heartbeat.RebalanceRequired {
		c.revoke(uint64(heartbeat.Generation))
		return nil
	}
	if c.pending != nil {
		return c.commit(ctx, c.pending)
	}
	for _, partition := range c.assignment {
		if err := c.consume(ctx, partition); err != nil {
			return err
		}
	}
	return c.commitProgress(ctx)
}

// Leave removes this member from the group so others take over now.
func (c *GroupConsumer) Leave(ctx context.Context) error {
	_, err := call(c, func(id string) (protocol.LeaveGroupResponseData, error) {
		return c.config.Transport.LeaveGroup(ctx, id, c.config.GroupID, protocol.LeaveGroupRequest{
			MemberID: c.config.MemberID, Generation: protocol.DecimalUint64(c.generation), RequestID: id,
		})
	})
	c.joined, c.stable = false, false
	return err
}

func (c *GroupConsumer) consume(ctx context.Context, partition protocol.TopicPartition) error {
	fetched, err := call(c, func(id string) (protocol.FetchResponseData, error) {
		return c.config.Transport.Fetch(ctx, id, protocol.FetchRequest{
			Topic: partition.Topic, Partition: partition.Partition,
			Offset: protocol.DecimalUint64(c.positions[partition]), MaxBytes: c.config.MaxBytes,
		})
	})
	if err != nil {
		return err
	}
	for _, record := range fetched.Records {
		message, err := decodeFetched(partition, record)
		if err != nil {
			return err
		}
		if err := c.config.Process(ctx, message); err != nil {
			return err
		}
		c.positions[partition] = message.Offset + 1
	}
	return nil
}

func (c *GroupConsumer) commitProgress(ctx context.Context) error {
	var offsets []protocol.OffsetCommit
	for _, partition := range c.assignment {
		if position := c.positions[partition]; position != c.committed[partition] {
			offsets = append(offsets, protocol.OffsetCommit{
				Topic: partition.Topic, Partition: partition.Partition, Offset: protocol.DecimalUint64(position),
			})
		}
	}
	if len(offsets) == 0 {
		return nil
	}
	requestID, err := c.config.RequestIDs()
	if err != nil {
		return err
	}
	return c.commit(ctx, &pendingCommit{requestID: requestID, request: protocol.CommitOffsetsRequest{
		MemberID: c.config.MemberID, Generation: protocol.DecimalUint64(c.generation), Offsets: offsets, RequestID: requestID,
	}})
}

// commit sends one CommitOffsets; an unknown outcome keeps it pending so the
// next Poll retries the identical request.
func (c *GroupConsumer) commit(ctx context.Context, commit *pendingCommit) error {
	c.pending = commit
	_, err := c.config.Transport.CommitOffsets(ctx, commit.requestID, c.config.GroupID, commit.request)
	if err != nil && !isAPIError(err) || isOutcome(err, protocol.OutcomeUnknown) {
		return fmt.Errorf("commit outcome unknown, will retry: %w", err)
	}
	c.pending = nil
	if err != nil {
		return c.sessionError(err)
	}
	for _, offset := range commit.request.Offsets {
		c.committed[protocol.TopicPartition{Topic: offset.Topic, Partition: offset.Partition}] = uint64(offset.Offset)
	}
	return nil
}

// sessionError stops a fenced session: positions past the last commit are
// dropped and the member rejoins on the next Poll.
func (c *GroupConsumer) sessionError(err error) error {
	switch apiCode(err) {
	case "ILLEGAL_GENERATION", "NOT_OWNER":
		c.joined, c.stable = false, false
		return fmt.Errorf("%w: %v", ErrStaleGeneration, err)
	case "REBALANCE_IN_PROGRESS":
		c.revoke(c.generation)
		return nil
	}
	return err
}

func (c *GroupConsumer) revoke(generation uint64) {
	c.stable, c.generation, c.assignment, c.pending = false, generation, nil, nil
}

func decodeFetched(partition protocol.TopicPartition, record protocol.FetchedRecord) (Message, error) {
	message := Message{Topic: partition.Topic, Partition: partition.Partition, Offset: uint64(record.Offset)}
	value, err := base64.StdEncoding.Strict().DecodeString(record.ValueBase64)
	if err != nil {
		return Message{}, fmt.Errorf("decode fetched value: %w", err)
	}
	message.Value = value
	if record.KeyBase64 != nil {
		if message.Key, err = base64.StdEncoding.Strict().DecodeString(*record.KeyBase64); err != nil {
			return Message{}, fmt.Errorf("decode fetched key: %w", err)
		}
	}
	return message, nil
}

// call runs one request under a fresh trace request ID.
func call[Data any](c *GroupConsumer, send func(string) (Data, error)) (Data, error) {
	requestID, err := c.config.RequestIDs()
	if err != nil {
		var zero Data
		return zero, err
	}
	return send(requestID)
}

func apiCode(err error) string {
	var response *ResponseError
	if errors.As(err, &response) {
		return response.API.Code
	}
	return ""
}

func isAPIError(err error) bool { return apiCode(err) != "" }

func isOutcome(err error, outcome protocol.Outcome) bool {
	var response *ResponseError
	return errors.As(err, &response) && response.API.Outcome == outcome
}
