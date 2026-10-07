package broker

import (
	"context"
	"errors"

	"github.com/fallrising/newclear/systems/mkfk/internal/group"
	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/peer"
	"github.com/fallrising/newclear/systems/mkfk/internal/producer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/transport"
)

// clientBackend routes public API calls to local partition actors. A call
// for a partition this broker does not lead answers NOT_LEADER with the
// leader it last observed, so clients refresh instead of guessing.
type clientBackend struct{ b *Broker }

func (c clientBackend) data(topic string, id uint32) (*partition.Data, error) {
	if !c.b.partitionExists(topic, id) {
		return nil, transport.ErrUnknownPartition
	}
	r := c.b.replicas[peer.GroupID(topic, id)]
	if r == nil {
		return nil, &transport.LeaderHint{Err: raft.ErrNotLeader}
	}
	return r.data, nil
}

func (c clientBackend) hint(ctx context.Context, r *replica, err error) error {
	if !errors.Is(err, raft.ErrNotLeader) && !group.IsCode(err, group.CodeNotCoordinator) {
		return err
	}
	snapshot, snapshotErr := r.actor.Snapshot(ctx)
	if snapshotErr != nil || snapshot.LeaderID == c.b.self.ID {
		return err
	}
	return &transport.LeaderHint{Err: err, LeaderID: snapshot.LeaderID, Term: snapshot.Term}
}

func (c clientBackend) OpenProducer(ctx context.Context, request protocol.OpenProducerRequest) (producer.OpenResult, error) {
	data, err := c.data(request.Topic, request.Partition)
	if err != nil {
		return producer.OpenResult{}, err
	}
	result, err := data.OpenProducer(ctx, request)
	return result, c.hint(ctx, c.b.replica(request.Topic, request.Partition), err)
}

func (c clientBackend) Produce(ctx context.Context, requestID string, request protocol.ProduceRequest) (producer.ProduceResult, error) {
	data, err := c.data(request.Topic, request.Partition)
	if err != nil {
		return producer.ProduceResult{}, err
	}
	result, err := data.Produce(ctx, requestID, request)
	return result, c.hint(ctx, c.b.replica(request.Topic, request.Partition), err)
}

func (c clientBackend) Fetch(ctx context.Context, request protocol.FetchRequest) (protocol.FetchResponseData, error) {
	data, err := c.data(request.Topic, request.Partition)
	if err != nil {
		return protocol.FetchResponseData{}, err
	}
	result, err := data.Fetch(ctx, request)
	return result, c.hint(ctx, c.b.replica(request.Topic, request.Partition), err)
}

// groupCall runs one group operation on the local coordinator replica, or
// answers NOT_COORDINATOR when this broker holds no groups replica.
func groupCall[Data any](ctx context.Context, c clientBackend, call func(*group.Service) (Data, error)) (Data, error) {
	if c.b.groups == nil {
		var zero Data
		return zero, &transport.LeaderHint{Err: raft.ErrNotLeader}
	}
	data, err := call(c.b.groups)
	return data, c.hint(ctx, c.b.replica(groupsTopic, 0), err)
}

func (c clientBackend) JoinGroup(ctx context.Context, g string, r protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error) {
	return groupCall(ctx, c, func(s *group.Service) (protocol.JoinGroupResponseData, error) { return s.JoinGroup(ctx, g, r) })
}

func (c clientBackend) SyncGroup(ctx context.Context, g string, r protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error) {
	return groupCall(ctx, c, func(s *group.Service) (protocol.SyncGroupResponseData, error) { return s.SyncGroup(ctx, g, r) })
}

func (c clientBackend) Heartbeat(ctx context.Context, g string, r protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error) {
	return groupCall(ctx, c, func(s *group.Service) (protocol.HeartbeatResponseData, error) { return s.Heartbeat(ctx, g, r) })
}

func (c clientBackend) LeaveGroup(ctx context.Context, g string, r protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error) {
	return groupCall(ctx, c, func(s *group.Service) (protocol.LeaveGroupResponseData, error) { return s.LeaveGroup(ctx, g, r) })
}

func (c clientBackend) CommitOffsets(ctx context.Context, g string, r protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	return groupCall(ctx, c, func(s *group.Service) (protocol.CommitOffsetsResponseData, error) { return s.CommitOffsets(ctx, g, r) })
}

func (c clientBackend) CommittedOffsets(ctx context.Context, g string, p []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error) {
	return groupCall(ctx, c, func(s *group.Service) (protocol.GetOffsetsResponseData, error) { return s.CommittedOffsets(ctx, g, p) })
}

// peerBackend serves the peer listener from local replicas only; it never
// forwards, so a proof always comes from the replica that answers.
type peerBackend struct{ b *Broker }

func (p peerBackend) Step(ctx context.Context, request raft.Message) ([]raft.Message, error) {
	replies, err := p.b.registry.Step(ctx, request)
	switch {
	case errors.Is(err, partition.ErrUnknownGroup):
		return nil, peer.ErrUnknownPartition
	case errors.Is(err, partition.ErrClosed), errors.Is(err, partition.ErrFailed):
		return nil, peer.ErrUnavailable
	}
	return replies, err
}

func (p peerBackend) HighWatermark(ctx context.Context, topic string, id uint32) (uint64, error) {
	r := p.b.replica(topic, id)
	if r == nil || r.data == nil {
		return 0, peer.ErrUnknownPartition
	}
	hw, err := r.data.HighWatermark(ctx)
	switch {
	case errors.Is(err, raft.ErrNotLeader), errors.Is(err, raft.ErrLeaderNotReady):
		snapshot, _ := r.actor.Snapshot(ctx)
		return 0, &peer.NotLeaderError{LeaderID: snapshot.LeaderID}
	case errors.Is(err, replication.ErrReadBarrier), errors.Is(err, partition.ErrClosed), errors.Is(err, partition.ErrFailed):
		return 0, peer.ErrUnavailable
	}
	return hw, err
}

func (b *Broker) replica(topic string, id uint32) *replica {
	return b.replicas[peer.GroupID(topic, id)]
}

func (b *Broker) partitionExists(topic string, id uint32) bool {
	count, exists := b.userPartitionCount(topic)
	return exists && id < count
}
