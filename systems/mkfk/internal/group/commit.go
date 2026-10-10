package group

import (
	"fmt"
	"strings"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// commitResult remembers a member's latest CommitOffsets so a retry with the
// same request_id returns the original outcome instead of being re-evaluated.
type commitResult struct {
	requestID   string
	fingerprint string
	err         error
}

func (s *State) commitOffsets(command storage.GroupCommand) Result {
	group, current, err := s.currentMember(command.GroupID, command.MemberID, 0)
	if err != nil {
		return Result{Err: err}
	}
	fingerprint := commitFingerprint(command)
	if last := current.lastCommit; last != nil && last.requestID == command.RequestID {
		if last.fingerprint != fingerprint {
			return group.result(groupError(CodeRequestConflict, "request_id %q was used for different offsets", command.RequestID))
		}
		return group.result(last.err)
	}
	err = group.checkCommit(command)
	current.lastCommit = &commitResult{requestID: command.RequestID, fingerprint: fingerprint, err: err}
	if err != nil {
		return group.result(err)
	}
	for _, offset := range command.Offsets {
		group.offsets[TopicPartition{Topic: offset.Topic, Partition: offset.Partition}] = offset.Offset
	}
	return group.result(nil)
}

func (g *groupState) checkCommit(command storage.GroupCommand) error {
	if g.generation != command.Generation {
		return groupError(CodeIllegalGeneration, "generation %d is not current (%d)", command.Generation, g.generation)
	}
	if g.phase != PhaseStable {
		return groupError(CodeRebalanceInProgress, "generation %d is rebalancing", g.generation)
	}
	for _, offset := range command.Offsets {
		partition := TopicPartition{Topic: offset.Topic, Partition: offset.Partition}
		if g.owners[partition] != command.MemberID {
			return groupError(CodeNotOwner, "%s/%d is not assigned to %s", offset.Topic, offset.Partition, command.MemberID)
		}
		if offset.Offset > offset.HighWatermark {
			return groupError(CodeOffsetOutOfRange, "offset %d exceeds high watermark %d for %s/%d", offset.Offset, offset.HighWatermark, offset.Topic, offset.Partition)
		}
		if existing := g.offsets[partition]; offset.Offset < existing {
			return groupError(CodeOffsetRegression, "offset %d is below committed %d for %s/%d", offset.Offset, existing, offset.Topic, offset.Partition)
		}
	}
	return nil
}

func commitFingerprint(command storage.GroupCommand) string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "%d", command.Generation)
	for _, offset := range command.Offsets {
		fmt.Fprintf(&builder, "|%s/%d=%d", offset.Topic, offset.Partition, offset.Offset)
	}
	return builder.String()
}
