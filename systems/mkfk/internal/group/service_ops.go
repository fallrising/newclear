package group

import (
	"context"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

func (s *Service) JoinGroup(ctx context.Context, groupID string, request protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error) {
	result, err := s.propose(ctx, func(now time.Time) (Ticket, Output, error) {
		return s.coordinator.Join(groupID, request, now)
	})
	return protocol.JoinGroupResponseData{
		Generation: protocol.DecimalUint64(result.Generation), State: string(result.Phase),
		CoordinatorTerm: protocol.DecimalUint64(s.term(ctx)),
	}, err
}

func (s *Service) SyncGroup(ctx context.Context, groupID string, request protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error) {
	var status Status
	var err error
	if callErr := s.actor.Do(ctx, func() error {
		var out Output
		status, out, err = s.coordinator.Sync(groupID, request, s.clock.Now())
		s.emit(out)
		return nil
	}); callErr != nil {
		return protocol.SyncGroupResponseData{}, callErr
	}
	return protocol.SyncGroupResponseData{
		Generation: protocol.DecimalUint64(status.Generation), State: string(status.Phase),
		Assignment: wirePartitions(status.Assignment),
	}, err
}

// Heartbeat answers a member of an older generation with
// rebalance_required and the generation it must sync.
func (s *Service) Heartbeat(ctx context.Context, groupID string, request protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error) {
	var status Status
	var err error
	if callErr := s.actor.Do(ctx, func() error {
		status, err = s.coordinator.Heartbeat(groupID, request, s.clock.Now())
		return nil
	}); callErr != nil {
		return protocol.HeartbeatResponseData{}, callErr
	}
	data := protocol.HeartbeatResponseData{Generation: protocol.DecimalUint64(status.Generation), State: string(status.Phase)}
	if IsCode(err, CodeRebalanceInProgress) {
		data.RebalanceRequired = true
		return data, nil
	}
	return data, err
}

func (s *Service) LeaveGroup(ctx context.Context, groupID string, request protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error) {
	var wasMember bool
	result, err := s.propose(ctx, func(now time.Time) (Ticket, Output, error) {
		before, _ := s.coordinator.State().Group(groupID)
		wasMember = contains(before.Members, request.MemberID)
		return s.coordinator.Leave(groupID, request, now)
	})
	return protocol.LeaveGroupResponseData{
		Removed: err == nil && wasMember, Generation: protocol.DecimalUint64(result.Generation),
	}, err
}

// CommitOffsets first obtains a high-watermark proof for every partition
// from its data leader, outside the coordinator actor, then proposes.
func (s *Service) CommitOffsets(ctx context.Context, groupID string, request protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	data := protocol.CommitOffsetsResponseData{Offsets: append([]protocol.OffsetCommit(nil), request.Offsets...)}
	if err := request.Validate(); err != nil {
		return data, groupError(CodeInvalidRequest, "%v", err)
	}
	if serving, err := s.Serving(ctx); err != nil || !serving {
		return data, s.coordinatorError(err)
	}
	proofs := provenWatermarks{}
	for _, entry := range request.Offsets {
		hw, err := s.proofs.HighWatermark(ctx, entry.Topic, entry.Partition)
		if err != nil {
			return data, groupError(CodeDependencyFailed, "no committed high watermark for %s/%d: %v", entry.Topic, entry.Partition, err)
		}
		proofs[TopicPartition{Topic: entry.Topic, Partition: entry.Partition}] = hw
	}
	result, err := s.propose(ctx, func(now time.Time) (Ticket, Output, error) {
		return s.coordinator.CommitOffsets(groupID, request, proofs, now)
	})
	data.Generation = protocol.DecimalUint64(result.Generation)
	return data, err
}

// CommittedOffsets reads committed next offsets after a Raft read barrier,
// so a deposed coordinator cannot answer from stale state.
func (s *Service) CommittedOffsets(ctx context.Context, groupID string, partitions []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error) {
	var data protocol.GetOffsetsResponseData
	err := s.read(ctx, func() error {
		data.Offsets = make([]protocol.CommittedOffset, 0, len(partitions))
		for _, partition := range partitions {
			offset, ok, err := s.coordinator.CommittedOffset(groupID, TopicPartition{Topic: partition.Topic, Partition: partition.Partition})
			if err != nil {
				return err
			}
			entry := protocol.CommittedOffset{Topic: partition.Topic, Partition: partition.Partition}
			if ok {
				value := protocol.DecimalUint64(offset)
				entry.Offset = &value
			}
			data.Offsets = append(data.Offsets, entry)
		}
		return nil
	})
	return data, err
}

func (s *Service) coordinatorError(err error) error {
	if err != nil {
		return err
	}
	return groupError(CodeNotCoordinator, "this node is not the serving group coordinator")
}

func (s *Service) term(ctx context.Context) uint64 {
	snapshot, _ := s.actor.Snapshot(ctx)
	return snapshot.Term
}

// provenWatermarks carries the proofs a CommitOffsets call obtained.
type provenWatermarks map[TopicPartition]uint64

func (p provenWatermarks) HighWatermark(topic string, partition uint32) (uint64, error) {
	hw, ok := p[TopicPartition{Topic: topic, Partition: partition}]
	if !ok {
		return 0, groupError(CodeDependencyFailed, "no proof was obtained for %s/%d", topic, partition)
	}
	return hw, nil
}

func wirePartitions(partitions []TopicPartition) []protocol.TopicPartition {
	wire := make([]protocol.TopicPartition, 0, len(partitions))
	for _, partition := range partitions {
		wire = append(wire, protocol.TopicPartition{Topic: partition.Topic, Partition: partition.Partition})
	}
	return wire
}
