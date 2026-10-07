package group

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition/partitiontest"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/testkit"
)

// proofs stands in for data-partition leaders: it serves a fixed HW per
// partition, or fails as a deposed data leader would.
type proofs struct {
	mu     sync.Mutex
	hw     uint64
	failed bool
	calls  int
}

func (p *proofs) HighWatermark(_ context.Context, _ string, _ uint32) (uint64, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
	if p.failed {
		return 0, errors.New("data leader could not confirm its high watermark")
	}
	return p.hw, nil
}

type serviceCluster struct {
	network  *partitiontest.Network
	services map[uint32]*Service
	proofs   *proofs
}

// newServiceCluster runs __mkfk_groups/0 on three in-memory logs behind
// partition actors. Ticks never fire; elections are explicit.
func newServiceCluster(t *testing.T) *serviceCluster {
	t.Helper()
	voters := []uint32{1, 2, 3}
	clock := testkit.NewManualClock(time.Unix(1700000000, 0))
	cluster := &serviceCluster{
		network: partitiontest.NewNetwork(t, voters...), services: map[uint32]*Service{}, proofs: &proofs{hw: 10},
	}
	for _, id := range voters {
		node, err := raft.NewNode(raft.Config{
			Identity: groupRaftIdentity, NodeID: id, Voters: voters, ElectionTimeoutTicks: 6, HeartbeatTicks: 1,
		}, &memoryLog{})
		if err != nil {
			t.Fatal(err)
		}
		service, err := NewService(ServiceConfig{
			Node: node, Proofs: cluster.proofs, Clock: clock, TickClock: testkit.NewManualClock(time.Unix(0, 0)),
			Sender: cluster.network.Sender(id), RequestTimeout: 300 * time.Millisecond,
			Coordinator: CoordinatorConfig{State: Config{Partitions: func(topic string) (uint32, bool) {
				count, ok := testTopics[topic]
				return count, ok
			}}},
		})
		if err != nil {
			t.Fatal(err)
		}
		cluster.network.Registry(id).Add(groupRaftIdentity.GroupID, service.Actor())
		cluster.services[id] = service
		t.Cleanup(service.Close)
	}
	return cluster
}

func (c *serviceCluster) elect(t *testing.T, id uint32) *Service {
	t.Helper()
	service := c.services[id]
	if err := service.Actor().Campaign(context.Background()); err != nil {
		t.Fatal(err)
	}
	partitiontest.Eventually(t, fmt.Sprintf("node %d to serve", id), func() bool {
		serving, err := service.Serving(context.Background())
		return err == nil && serving
	})
	return service
}

// stabilize joins (if requestID is set) and syncs member until STABLE.
func stabilizeMember(t *testing.T, service *Service, member, requestID string) uint64 {
	t.Helper()
	ctx := context.Background()
	if requestID != "" {
		if _, err := service.JoinGroup(ctx, "g", protocol.JoinGroupRequest{MemberID: member, Subscription: []string{"events"}, RequestID: requestID}); err != nil {
			t.Fatalf("join %s: %v", member, err)
		}
	}
	view, _, err := service.View(ctx, "g")
	if err != nil {
		t.Fatal(err)
	}
	var synced protocol.SyncGroupResponseData
	partitiontest.Eventually(t, member+" to sync", func() bool {
		synced, err = service.SyncGroup(ctx, "g", protocol.SyncGroupRequest{MemberID: member, Generation: protocol.DecimalUint64(view.Generation), Revoked: true})
		return err == nil && synced.State == string(PhaseStable)
	})
	return uint64(synced.Generation)
}

func commitOffset(service *Service, member, requestID string, generation, offset uint64) error {
	_, err := service.CommitOffsets(context.Background(), "g", protocol.CommitOffsetsRequest{
		MemberID: member, Generation: protocol.DecimalUint64(generation), RequestID: requestID,
		Offsets: []protocol.OffsetCommit{{Topic: "events", Partition: 0, Offset: protocol.DecimalUint64(offset)}},
	})
	return err
}

func committed(service *Service) (*protocol.DecimalUint64, error) {
	data, err := service.CommittedOffsets(context.Background(), "g", []protocol.TopicPartition{{Topic: "events", Partition: 0}})
	if err != nil {
		return nil, err
	}
	return data.Offsets[0].Offset, nil
}

func TestM7RF3CoordinatorFailoverKeepsOffsetsAndFencesOldGeneration(t *testing.T) {
	t.Parallel()
	cluster := newServiceCluster(t)
	first := cluster.elect(t, 1)
	generation := stabilizeMember(t, first, "m1", "join-1")
	if err := commitOffset(first, "m1", "commit-1", generation, 5); err != nil {
		t.Fatalf("commit on first coordinator: %v", err)
	}
	cluster.network.Isolate(1)
	second := cluster.elect(t, 2)
	if err := commitOffset(second, "m1", "commit-2", generation, 6); !IsCode(err, CodeIllegalGeneration) {
		t.Fatalf("old-generation commit after failover = %v, want ILLEGAL_GENERATION", err)
	}
	if offset, err := committed(second); err != nil || offset == nil || *offset != 5 {
		t.Fatalf("offset after failover = %v, %v; want 5", offset, err)
	}
	next := stabilizeMember(t, second, "m1", "")
	if next <= generation {
		t.Fatalf("generation %d was reused after failover (was %d)", next, generation)
	}
	cluster.proofs.mu.Lock()
	cluster.proofs.failed = true
	cluster.proofs.mu.Unlock()
	if err := commitOffset(second, "m1", "commit-3", next, 7); !IsCode(err, CodeDependencyFailed) {
		t.Fatalf("commit without a data-leader proof = %v, want DEPENDENCY_FAILED", err)
	}
	if offset, _ := committed(second); offset == nil || *offset != 5 {
		t.Fatalf("offset changed without a proof: %v", offset)
	}
}

// A coordinator cut off from the majority still believes it serves. Its
// offset read must fail at the read barrier instead of returning the value
// it last applied, which the new coordinator has since overwritten.
func TestM7DeposedCoordinatorOffsetReadIsRejectedByReadBarrier(t *testing.T) {
	t.Parallel()
	cluster := newServiceCluster(t)
	first := cluster.elect(t, 1)
	generation := stabilizeMember(t, first, "m1", "join-1")
	if err := commitOffset(first, "m1", "commit-1", generation, 5); err != nil {
		t.Fatal(err)
	}
	cluster.network.Isolate(1)
	second := cluster.elect(t, 2)
	next := stabilizeMember(t, second, "m1", "")
	if err := commitOffset(second, "m1", "commit-2", next, 7); err != nil {
		t.Fatalf("commit on new coordinator: %v", err)
	}
	if serving, _ := first.Serving(context.Background()); !serving {
		t.Fatal("isolated coordinator should still believe it serves")
	}
	offset, err := committed(first)
	if !IsCode(err, CodeDependencyFailed) {
		t.Fatalf("deposed coordinator read = %v, %v; want DEPENDENCY_FAILED from the read barrier", offset, err)
	}
	if _, err := first.JoinGroup(context.Background(), "g", protocol.JoinGroupRequest{
		MemberID: "m2", Subscription: []string{"events"}, RequestID: "join-stale",
	}); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatalf("deposed coordinator join = %v, want outcome unknown", err)
	}
	cluster.network.Heal()
	partitiontest.Eventually(t, "deposed coordinator to step down", func() bool {
		_, err := committed(first)
		return errors.Is(err, raft.ErrNotLeader)
	})
	if offset, err := committed(second); err != nil || offset == nil || *offset != 7 {
		t.Fatalf("offset on the serving coordinator = %v, %v; want 7", offset, err)
	}
}
