package broker

import (
	"context"
	"errors"
	"fmt"

	"github.com/fallrising/newclear/systems/mkfk/internal/peer"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// proofSource gives the group coordinator a quorum-confirmed high watermark
// from the data partition's current leader: the local replica when it
// leads, otherwise the leader it names, otherwise each other replica.
type proofSource struct{ b *Broker }

func (p proofSource) HighWatermark(ctx context.Context, topic string, id uint32) (uint64, error) {
	r := p.b.replica(topic, id)
	tried := map[uint32]bool{p.b.self.ID: true}
	candidates := p.b.replicaSet(topic, id)
	if r != nil && r.data != nil {
		hw, err := r.data.HighWatermark(ctx)
		if !errors.Is(err, raft.ErrNotLeader) && !errors.Is(err, raft.ErrLeaderNotReady) {
			return hw, err
		}
		if snapshot, snapshotErr := r.actor.Snapshot(ctx); snapshotErr == nil && snapshot.LeaderID != 0 {
			candidates = append([]uint32{snapshot.LeaderID}, candidates...)
		}
	}
	var lastErr error = fmt.Errorf("%s/%d has no reachable leader", topic, id)
	for _, candidate := range candidates {
		if tried[candidate] {
			continue
		}
		tried[candidate] = true
		client := p.b.peers[candidate]
		if client == nil {
			continue
		}
		hw, err := client.HighWatermark(ctx, topic, id)
		if err == nil {
			return hw, nil
		}
		lastErr = err
		var notLeader *peer.NotLeaderError
		if errors.As(err, &notLeader) && notLeader.LeaderID != 0 && !tried[notLeader.LeaderID] {
			candidates = append(candidates, notLeader.LeaderID)
		}
	}
	return 0, lastErr
}

func (b *Broker) replicaSet(topic string, id uint32) []uint32 {
	for _, candidate := range b.manifest.Topics {
		if candidate.Name != topic {
			continue
		}
		for _, spec := range candidate.Partitions {
			if spec.ID == id {
				return append([]uint32(nil), spec.Replicas...)
			}
		}
	}
	return nil
}
