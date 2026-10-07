package group

import (
	"sort"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// Status is a group's state as seen by one member.
type Status struct {
	Generation uint64
	Phase      Phase
	Assignment []TopicPartition // set only when Phase is STABLE
}

// Join proposes a JOIN; the result arrives as a Completion for the ticket.
func (c *Coordinator) Join(groupID string, request protocol.JoinGroupRequest, now time.Time) (Ticket, Output, error) {
	c.now = now
	if err := c.ready(request.Validate()); err != nil {
		return Ticket{}, Output{}, err
	}
	subscription := append([]string(nil), request.Subscription...)
	sort.Strings(subscription)
	ticket, err := c.propose(storage.GroupCommand{
		Type: storage.GroupJoin, GroupID: groupID, RequestID: request.RequestID,
		MemberID: request.MemberID, Subscription: subscription,
	})
	if err == nil {
		c.lastSeen[memberKey{groupID, request.MemberID}] = now
	}
	return ticket, c.take(), err
}

// Sync records that a member revoked its old assignment for the current
// generation and returns the group status; callers poll until STABLE.
func (c *Coordinator) Sync(groupID string, request protocol.SyncGroupRequest, now time.Time) (Status, Output, error) {
	c.now = now
	if err := c.ready(request.Validate()); err != nil {
		return Status{}, Output{}, err
	}
	status, err := c.memberStatus(groupID, request.MemberID, uint64(request.Generation))
	if err != nil {
		return Status{}, Output{}, err
	}
	c.lastSeen[memberKey{groupID, request.MemberID}] = now
	key := memberKey{groupID, request.MemberID}
	if status.Phase == PhasePreparing && request.Revoked && c.unsynced(groupID, request.MemberID) && c.syncProposed[key] != status.Generation {
		c.syncProposed[key] = status.Generation
		if _, err := c.proposeInternal(storage.GroupCommand{
			Type: storage.GroupSyncReady, GroupID: groupID, MemberID: request.MemberID, Generation: status.Generation,
		}); err != nil {
			return Status{}, c.take(), err
		}
		status, err = c.memberStatus(groupID, request.MemberID, status.Generation)
	}
	return status, c.take(), err
}

// Heartbeat keeps a member's session alive. A member from an older
// generation gets REBALANCE_IN_PROGRESS and must sync the new generation.
func (c *Coordinator) Heartbeat(groupID string, request protocol.HeartbeatRequest, now time.Time) (Status, error) {
	c.now = now
	if err := c.ready(request.Validate()); err != nil {
		return Status{}, err
	}
	view, exists := c.state.Group(groupID)
	if !exists || !contains(view.Members, request.MemberID) {
		return Status{}, groupError(CodeIllegalGeneration, "member %s must rejoin group %q", request.MemberID, groupID)
	}
	c.lastSeen[memberKey{groupID, request.MemberID}] = now
	if uint64(request.Generation) != view.Generation || view.Phase != PhaseStable {
		return Status{Generation: view.Generation, Phase: view.Phase},
			groupError(CodeRebalanceInProgress, "group %q is rebalancing to generation %d", groupID, view.Generation)
	}
	return c.memberStatus(groupID, request.MemberID, view.Generation)
}

func (c *Coordinator) Leave(groupID string, request protocol.LeaveGroupRequest, now time.Time) (Ticket, Output, error) {
	c.now = now
	if err := c.ready(request.Validate()); err != nil {
		return Ticket{}, Output{}, err
	}
	delete(c.lastSeen, memberKey{groupID, request.MemberID})
	ticket, err := c.propose(storage.GroupCommand{
		Type: storage.GroupLeave, GroupID: groupID, RequestID: request.RequestID,
		MemberID: request.MemberID, Generation: uint64(request.Generation),
	})
	return ticket, c.take(), err
}

// CommitOffsets checks every offset against a quorum-confirmed high watermark
// from proofs before proposing; generation and ownership are re-checked when
// it applies. HW only grows, so a proof obtained earlier is a safe bound.
func (c *Coordinator) CommitOffsets(groupID string, request protocol.CommitOffsetsRequest, proofs HighWatermarkSource, now time.Time) (Ticket, Output, error) {
	c.now = now
	if err := c.ready(request.Validate()); err != nil {
		return Ticket{}, Output{}, err
	}
	offsets := make([]storage.GroupOffset, 0, len(request.Offsets))
	for _, entry := range request.Offsets {
		hw, err := proofs.HighWatermark(entry.Topic, entry.Partition)
		if err != nil {
			return Ticket{}, Output{}, groupError(CodeDependencyFailed, "no committed high watermark for %s/%d: %v", entry.Topic, entry.Partition, err)
		}
		offset := uint64(entry.Offset)
		if offset > hw {
			return Ticket{}, Output{}, groupError(CodeOffsetOutOfRange, "offset %d exceeds high watermark %d for %s/%d", offset, hw, entry.Topic, entry.Partition)
		}
		offsets = append(offsets, storage.GroupOffset{Topic: entry.Topic, Partition: entry.Partition, Offset: offset, HighWatermark: hw})
	}
	sort.Slice(offsets, func(i, j int) bool {
		return TopicPartition{offsets[i].Topic, offsets[i].Partition}.less(TopicPartition{offsets[j].Topic, offsets[j].Partition})
	})
	ticket, err := c.propose(storage.GroupCommand{
		Type: storage.GroupCommitOffsets, GroupID: groupID, RequestID: request.RequestID,
		MemberID: request.MemberID, Generation: uint64(request.Generation), Offsets: offsets,
	})
	return ticket, c.take(), err
}

// CommittedOffset reads a committed next offset. Callers that need a
// linearizable read must first complete a Raft read barrier on this leader.
func (c *Coordinator) CommittedOffset(groupID string, partition TopicPartition) (uint64, bool, error) {
	if err := c.ready(nil); err != nil {
		return 0, false, err
	}
	offset, ok := c.state.CommittedOffset(groupID, partition)
	return offset, ok, nil
}

// ready rejects requests unless this node is the serving coordinator.
func (c *Coordinator) ready(validation error) error {
	if validation != nil {
		return groupError(CodeInvalidRequest, "%v", validation)
	}
	if !c.serving {
		return groupError(CodeNotCoordinator, "this node is not the serving group coordinator")
	}
	return nil
}

func (c *Coordinator) memberStatus(groupID, memberID string, generation uint64) (Status, error) {
	view, exists := c.state.Group(groupID)
	if !exists || !contains(view.Members, memberID) {
		return Status{}, groupError(CodeIllegalGeneration, "member %s must rejoin group %q", memberID, groupID)
	}
	if generation != view.Generation {
		return Status{}, groupError(CodeIllegalGeneration, "generation %d is not current (%d)", generation, view.Generation)
	}
	status := Status{Generation: view.Generation, Phase: view.Phase}
	if assigned, ok := c.state.Assignment(groupID, memberID); ok {
		status.Assignment = assigned
	}
	return status, nil
}

func (c *Coordinator) unsynced(groupID, memberID string) bool {
	return contains(c.state.UnsyncedMembers(groupID), memberID)
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
