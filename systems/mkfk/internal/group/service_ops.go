package group

import (
	"context"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

func (s *Service) JoinGroup(ctx context.Context, groupID string, request protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error) {
	var data protocol.JoinGroupResponseData
	var err error
	if callErr := s.do(ctx, func() {
		var result Result
		result, err = s.await(s.coordinator.Join(groupID, request, s.clock.Now()))
		data = protocol.JoinGroupResponseData{
			Generation: protocol.DecimalUint64(result.Generation), State: string(result.Phase),
			CoordinatorTerm: protocol.DecimalUint64(s.node.Snapshot().Term),
		}
	}); callErr != nil {
		return data, callErr
	}
	return data, err
}

func (s *Service) SyncGroup(ctx context.Context, groupID string, request protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error) {
	var data protocol.SyncGroupResponseData
	var err error
	if callErr := s.do(ctx, func() {
		status, out, syncErr := s.coordinator.Sync(groupID, request, s.clock.Now())
		if err = s.settle(out, nil); err == nil {
			err = syncErr
		}
		data = protocol.SyncGroupResponseData{
			Generation: protocol.DecimalUint64(status.Generation), State: string(status.Phase),
			Assignment: wirePartitions(status.Assignment),
		}
	}); callErr != nil {
		return data, callErr
	}
	return data, err
}

// Heartbeat answers a member of an older generation with
// rebalance_required and the generation it must sync.
func (s *Service) Heartbeat(ctx context.Context, groupID string, request protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error) {
	var data protocol.HeartbeatResponseData
	var err error
	if callErr := s.do(ctx, func() {
		status, heartbeatErr := s.coordinator.Heartbeat(groupID, request, s.clock.Now())
		data = protocol.HeartbeatResponseData{Generation: protocol.DecimalUint64(status.Generation), State: string(status.Phase)}
		if IsCode(heartbeatErr, CodeRebalanceInProgress) {
			data.RebalanceRequired = true
			return
		}
		err = heartbeatErr
	}); callErr != nil {
		return data, callErr
	}
	return data, err
}

func (s *Service) LeaveGroup(ctx context.Context, groupID string, request protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error) {
	var data protocol.LeaveGroupResponseData
	var err error
	if callErr := s.do(ctx, func() {
		before, _ := s.coordinator.State().Group(groupID)
		var result Result
		result, err = s.await(s.coordinator.Leave(groupID, request, s.clock.Now()))
		data = protocol.LeaveGroupResponseData{
			Removed:    err == nil && contains(before.Members, request.MemberID),
			Generation: protocol.DecimalUint64(result.Generation),
		}
	}); callErr != nil {
		return data, callErr
	}
	return data, err
}

func (s *Service) CommitOffsets(ctx context.Context, groupID string, request protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	var data protocol.CommitOffsetsResponseData
	var err error
	if callErr := s.do(ctx, func() {
		var result Result
		result, err = s.await(s.coordinator.CommitOffsets(groupID, request, s.clock.Now()))
		data = protocol.CommitOffsetsResponseData{
			Generation: protocol.DecimalUint64(result.Generation),
			Offsets:    append([]protocol.OffsetCommit(nil), request.Offsets...),
		}
	}); callErr != nil {
		return data, callErr
	}
	return data, err
}

// CommittedOffsets reads committed next offsets after a Raft read barrier,
// so a deposed coordinator cannot answer from stale state.
func (s *Service) CommittedOffsets(ctx context.Context, groupID string, partitions []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error) {
	var data protocol.GetOffsetsResponseData
	var err error
	if callErr := s.do(ctx, func() {
		if err = s.readBarrier(); err != nil {
			return
		}
		data.Offsets = make([]protocol.CommittedOffset, 0, len(partitions))
		for _, partition := range partitions {
			offset, ok, readErr := s.coordinator.CommittedOffset(groupID, TopicPartition{Topic: partition.Topic, Partition: partition.Partition})
			if readErr != nil {
				err = readErr
				return
			}
			entry := protocol.CommittedOffset{Topic: partition.Topic, Partition: partition.Partition}
			if ok {
				value := protocol.DecimalUint64(offset)
				entry.Offset = &value
			}
			data.Offsets = append(data.Offsets, entry)
		}
	}); callErr != nil {
		return data, callErr
	}
	return data, err
}

func wirePartitions(partitions []TopicPartition) []protocol.TopicPartition {
	wire := make([]protocol.TopicPartition, 0, len(partitions))
	for _, partition := range partitions {
		wire = append(wire, protocol.TopicPartition{Topic: partition.Topic, Partition: partition.Partition})
	}
	return wire
}
