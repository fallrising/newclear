package client

import (
	"context"
	"fmt"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

// rebalance joins if needed, then revokes and syncs the current generation.
// Once STABLE it resumes every assigned partition from its committed next
// offset, never from local progress of an earlier generation.
func (c *GroupConsumer) rebalance(ctx context.Context) error {
	if !c.joined {
		joined, err := call(c, func(id string) (protocol.JoinGroupResponseData, error) {
			return c.config.Transport.JoinGroup(ctx, id, c.config.GroupID, protocol.JoinGroupRequest{
				MemberID: c.config.MemberID, Subscription: c.config.Topics, RequestID: id,
			})
		})
		if err != nil {
			return err
		}
		c.joined, c.generation = true, uint64(joined.Generation)
	}
	synced, err := call(c, func(id string) (protocol.SyncGroupResponseData, error) {
		return c.config.Transport.SyncGroup(ctx, id, c.config.GroupID, protocol.SyncGroupRequest{
			MemberID: c.config.MemberID, Generation: protocol.DecimalUint64(c.generation), Revoked: true,
		})
	})
	if err != nil {
		return c.sessionError(err)
	}
	if synced.State != "STABLE" {
		return nil
	}
	return c.resume(ctx, synced.Assignment)
}

// resume drops any commit left pending by an earlier generation: the
// committed offsets read here already reflect it if it applied.
func (c *GroupConsumer) resume(ctx context.Context, assignment []protocol.TopicPartition) error {
	c.pending = nil
	c.positions = map[protocol.TopicPartition]uint64{}
	c.committed = map[protocol.TopicPartition]uint64{}
	if len(assignment) > 0 {
		offsets, err := call(c, func(id string) (protocol.GetOffsetsResponseData, error) {
			return c.config.Transport.CommittedOffsets(ctx, id, c.config.GroupID, assignment)
		})
		if err != nil {
			return err
		}
		if len(offsets.Offsets) != len(assignment) {
			return fmt.Errorf("offsets response has %d partitions, want %d", len(offsets.Offsets), len(assignment))
		}
		for _, entry := range offsets.Offsets {
			partition := protocol.TopicPartition{Topic: entry.Topic, Partition: entry.Partition}
			if entry.Offset != nil {
				c.positions[partition], c.committed[partition] = uint64(*entry.Offset), uint64(*entry.Offset)
			}
		}
	}
	c.assignment, c.stable = append([]protocol.TopicPartition(nil), assignment...), true
	return nil
}
