package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
)

// GroupCommandType names one replicated consumer-group transition (ADR-010).
type GroupCommandType string

const (
	GroupJoin           GroupCommandType = "JOIN"
	GroupSyncReady      GroupCommandType = "SYNC_READY"
	GroupSetAssignment  GroupCommandType = "SET_ASSIGNMENT"
	GroupLeave          GroupCommandType = "LEAVE"
	GroupRemoveMembers  GroupCommandType = "REMOVE_MEMBERS"
	GroupBeginRebalance GroupCommandType = "BEGIN_REBALANCE"
	GroupCommitOffsets  GroupCommandType = "COMMIT_OFFSETS"
)

const (
	maxGroupSubscription = 32
	maxGroupOffsets      = 32
	maxGroupMembers      = 64
)

// GroupOffset is one committed next-offset together with the quorum-confirmed
// high watermark the coordinator observed before proposing it.
type GroupOffset struct {
	Topic         string
	Partition     uint32
	Offset        uint64
	HighWatermark uint64
}

type GroupCommand struct {
	Type               GroupCommandType
	GroupID            string
	RequestID          string
	MemberID           string
	MemberIDs          []string
	Subscription       []string
	ExpectedGeneration uint64
	Generation         uint64
	Offsets            []GroupOffset
}

// GroupPayload is the canonical JSON form. Field order is part of the pinned
// WAL golden vector; unused fields are omitted.
type GroupPayload struct {
	Command            string               `json:"command"`
	GroupID            string               `json:"group_id"`
	RequestID          string               `json:"request_id,omitempty"`
	MemberID           string               `json:"member_id,omitempty"`
	MemberIDs          []string             `json:"member_ids,omitempty"`
	Subscription       []string             `json:"subscription,omitempty"`
	ExpectedGeneration string               `json:"expected_generation,omitempty"`
	Generation         string               `json:"generation,omitempty"`
	Offsets            []GroupOffsetPayload `json:"offsets,omitempty"`
}

type GroupOffsetPayload struct {
	Topic         string `json:"topic"`
	Partition     uint32 `json:"partition"`
	Offset        string `json:"offset"`
	HighWatermark string `json:"high_watermark"`
}

// groupFields lists which optional fields each command carries.
type groupFields struct {
	requestID, memberID, memberIDs, subscription, expectedGeneration, generation, offsets bool
}

var groupCommandFields = map[GroupCommandType]groupFields{
	GroupJoin:           {requestID: true, memberID: true, subscription: true},
	GroupSyncReady:      {memberID: true, generation: true},
	GroupSetAssignment:  {requestID: true, generation: true},
	GroupLeave:          {requestID: true, memberID: true, generation: true},
	GroupRemoveMembers:  {requestID: true, memberIDs: true, expectedGeneration: true},
	GroupBeginRebalance: {requestID: true, expectedGeneration: true, generation: true},
	GroupCommitOffsets:  {requestID: true, memberID: true, generation: true, offsets: true},
}

func NewGroupFrame(logIndex, term uint64, command GroupCommand) (Frame, error) {
	if err := ValidateGroupCommand(command); err != nil {
		return Frame{}, err
	}
	payload, err := json.Marshal(encodeGroupPayload(command))
	if err != nil {
		return Frame{}, err
	}
	frame := Frame{Kind: KindGroup, LogIndex: logIndex, Term: term, Payload: payload}
	if err := frame.Validate(); err != nil {
		return Frame{}, err
	}
	return frame, nil
}

func InspectGroupFrame(frame Frame) (GroupCommand, error) {
	if frame.Kind != KindGroup {
		return GroupCommand{}, errors.New("frame is not GROUP")
	}
	var payload GroupPayload
	if err := jsonstrict.Decode(frame.Payload, &payload); err != nil {
		return GroupCommand{}, err
	}
	command, err := decodeGroupPayload(payload)
	if err != nil {
		return GroupCommand{}, err
	}
	if err := ValidateGroupCommand(command); err != nil {
		return GroupCommand{}, err
	}
	return command, nil
}

func encodeGroupPayload(command GroupCommand) GroupPayload {
	fields := groupCommandFields[command.Type]
	payload := GroupPayload{Command: string(command.Type), GroupID: command.GroupID, RequestID: command.RequestID, MemberID: command.MemberID}
	if fields.memberIDs {
		payload.MemberIDs = append([]string(nil), command.MemberIDs...)
	}
	if fields.subscription {
		payload.Subscription = append([]string(nil), command.Subscription...)
	}
	if fields.expectedGeneration {
		payload.ExpectedGeneration = strconv.FormatUint(command.ExpectedGeneration, 10)
	}
	if fields.generation {
		payload.Generation = strconv.FormatUint(command.Generation, 10)
	}
	for _, offset := range command.Offsets {
		payload.Offsets = append(payload.Offsets, GroupOffsetPayload{
			Topic: offset.Topic, Partition: offset.Partition,
			Offset:        strconv.FormatUint(offset.Offset, 10),
			HighWatermark: strconv.FormatUint(offset.HighWatermark, 10),
		})
	}
	return payload
}

func decodeGroupPayload(payload GroupPayload) (GroupCommand, error) {
	command := GroupCommand{
		Type: GroupCommandType(payload.Command), GroupID: payload.GroupID, RequestID: payload.RequestID,
		MemberID: payload.MemberID, MemberIDs: payload.MemberIDs, Subscription: payload.Subscription,
	}
	fields, known := groupCommandFields[command.Type]
	if !known {
		return GroupCommand{}, fmt.Errorf("unknown group command %q", payload.Command)
	}
	if fields.expectedGeneration != (payload.ExpectedGeneration != "") || fields.generation != (payload.Generation != "") {
		return GroupCommand{}, fmt.Errorf("%s has unexpected generation fields", command.Type)
	}
	var err error
	if fields.expectedGeneration {
		if command.ExpectedGeneration, err = parseCanonicalUint64(payload.ExpectedGeneration); err != nil {
			return GroupCommand{}, fmt.Errorf("expected_generation: %w", err)
		}
	}
	if fields.generation {
		if command.Generation, err = parseCanonicalUint64(payload.Generation); err != nil {
			return GroupCommand{}, fmt.Errorf("generation: %w", err)
		}
	}
	for _, offset := range payload.Offsets {
		value, err := parseCanonicalUint64(offset.Offset)
		if err != nil {
			return GroupCommand{}, fmt.Errorf("offset: %w", err)
		}
		hw, err := parseCanonicalUint64(offset.HighWatermark)
		if err != nil {
			return GroupCommand{}, fmt.Errorf("high_watermark: %w", err)
		}
		command.Offsets = append(command.Offsets, GroupOffset{Topic: offset.Topic, Partition: offset.Partition, Offset: value, HighWatermark: hw})
	}
	return command, nil
}

// ValidateGroupCommand checks the shape of a command; group semantics are
// enforced by the group state machine at apply time.
func ValidateGroupCommand(command GroupCommand) error {
	fields, known := groupCommandFields[command.Type]
	if !known {
		return fmt.Errorf("unknown group command %q", command.Type)
	}
	if err := config.ValidateToken("group_id", command.GroupID); err != nil {
		return err
	}
	if err := checkPresence("request_id", fields.requestID, command.RequestID != ""); err != nil {
		return err
	}
	if fields.requestID {
		if err := config.ValidateToken("request_id", command.RequestID); err != nil {
			return err
		}
	}
	if err := checkPresence("member_id", fields.memberID, command.MemberID != ""); err != nil {
		return err
	}
	if fields.memberID {
		if err := config.ValidateToken("member_id", command.MemberID); err != nil {
			return err
		}
	}
	if err := checkPresence("member_ids", fields.memberIDs, len(command.MemberIDs) > 0); err != nil {
		return err
	}
	if err := validateSortedUnique("member_ids", command.MemberIDs, maxGroupMembers, func(id string) error {
		return config.ValidateToken("member_ids", id)
	}); err != nil {
		return err
	}
	if err := checkPresence("subscription", fields.subscription, len(command.Subscription) > 0); err != nil {
		return err
	}
	if err := validateSortedUnique("subscription", command.Subscription, maxGroupSubscription, func(topic string) error {
		return config.ValidateTopicName(topic, false)
	}); err != nil {
		return err
	}
	if !fields.expectedGeneration && command.ExpectedGeneration != 0 {
		return errors.New("expected_generation is not allowed for this command")
	}
	if !fields.generation && command.Generation != 0 {
		return errors.New("generation is not allowed for this command")
	}
	if command.Type == GroupBeginRebalance && (command.ExpectedGeneration == math.MaxUint64 || command.Generation != command.ExpectedGeneration+1) {
		return errors.New("generation must be expected_generation + 1 without overflow")
	}
	if err := checkPresence("offsets", fields.offsets, len(command.Offsets) > 0); err != nil {
		return err
	}
	return validateGroupOffsets(command.Offsets)
}

func checkPresence(field string, required, present bool) error {
	if required && !present {
		return fmt.Errorf("%s is required", field)
	}
	if !required && present {
		return fmt.Errorf("%s is not allowed for this command", field)
	}
	return nil
}

// validateSortedUnique requires canonical (sorted, duplicate-free) lists so a
// command has exactly one encoding.
func validateSortedUnique(field string, values []string, limit int, validate func(string) error) error {
	if len(values) > limit {
		return fmt.Errorf("%s must contain at most %d entries", field, limit)
	}
	for index, value := range values {
		if err := validate(value); err != nil {
			return err
		}
		if index > 0 && values[index-1] >= value {
			return fmt.Errorf("%s must be sorted and unique", field)
		}
	}
	return nil
}

func validateGroupOffsets(offsets []GroupOffset) error {
	if len(offsets) > maxGroupOffsets {
		return fmt.Errorf("offsets must contain at most %d entries", maxGroupOffsets)
	}
	for index, offset := range offsets {
		if err := config.ValidateTopicName(offset.Topic, false); err != nil {
			return err
		}
		if offset.Offset > offset.HighWatermark {
			return fmt.Errorf("offset %d exceeds high watermark %d for %s/%d", offset.Offset, offset.HighWatermark, offset.Topic, offset.Partition)
		}
		if index > 0 && !offsetLess(offsets[index-1], offset) {
			return errors.New("offsets must be sorted by topic and partition without duplicates")
		}
	}
	return nil
}

func offsetLess(a, b GroupOffset) bool {
	if a.Topic != b.Topic {
		return a.Topic < b.Topic
	}
	return a.Partition < b.Partition
}
