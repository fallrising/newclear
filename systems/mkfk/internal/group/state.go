// Package group implements the durable consumer-group state machine derived
// exclusively from committed GROUP entries in the __mkfk_groups Raft log.
package group

import (
	"errors"
	"fmt"
	"sort"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const (
	DefaultMaxGroups  = 128
	DefaultMaxMembers = 64
)

type Phase string

const (
	PhaseEmpty     Phase = "EMPTY"
	PhasePreparing Phase = "PREPARING"
	PhaseAssigning Phase = "ASSIGNING"
	PhaseStable    Phase = "STABLE"
)

// PartitionCounts reports how many partitions a user topic has.
type PartitionCounts func(topic string) (uint32, bool)

type Config struct {
	MaxGroups  int
	MaxMembers int
	Partitions PartitionCounts
}

type State struct {
	config Config
	groups map[string]*groupState
}

type groupState struct {
	subscription []string
	generation   uint64
	phase        Phase
	members      map[string]*member
	assignment   map[string][]TopicPartition
	owners       map[TopicPartition]string
	offsets      map[TopicPartition]uint64
}

type member struct {
	synced     bool
	lastCommit *commitResult
}

// Result reports the group's generation and phase after a command applied.
// Err carries a deterministic rejection; rejected commands change nothing.
type Result struct {
	Generation uint64
	Phase      Phase
	Err        error
}

func NewState(config Config) (*State, error) {
	if config.MaxGroups == 0 {
		config.MaxGroups = DefaultMaxGroups
	}
	if config.MaxMembers == 0 {
		config.MaxMembers = DefaultMaxMembers
	}
	if config.MaxGroups < 1 || config.MaxMembers < 1 {
		return nil, errors.New("group and member limits must be positive")
	}
	if config.Partitions == nil {
		return nil, errors.New("partition counts are required")
	}
	return &State{config: config, groups: make(map[string]*groupState)}, nil
}

// ApplyFrame applies one committed GROUP frame; other frame kinds are ignored.
func (s *State) ApplyFrame(frame storage.Frame) (Result, error) {
	if frame.Kind != storage.KindGroup {
		return Result{}, nil
	}
	command, err := storage.InspectGroupFrame(frame)
	if err != nil {
		return Result{}, fmt.Errorf("group frame %d: %w", frame.LogIndex, err)
	}
	return s.Apply(command), nil
}

// Replay rebuilds state from committed frames in log order.
func (s *State) Replay(frames []storage.Frame) error {
	for _, frame := range frames {
		if _, err := s.ApplyFrame(frame); err != nil {
			return err
		}
	}
	return nil
}

// Apply runs one command. All checks happen before any mutation, so a
// rejected command leaves the state untouched.
func (s *State) Apply(command storage.GroupCommand) Result {
	switch command.Type {
	case storage.GroupJoin:
		return s.join(command)
	case storage.GroupSyncReady:
		return s.syncReady(command)
	case storage.GroupSetAssignment:
		return s.setAssignment(command)
	case storage.GroupLeave:
		return s.removeMembers(command.GroupID, []string{command.MemberID}, nil)
	case storage.GroupRemoveMembers:
		return s.removeMembers(command.GroupID, command.MemberIDs, &command.ExpectedGeneration)
	case storage.GroupBeginRebalance:
		return s.beginRebalance(command)
	case storage.GroupCommitOffsets:
		return s.commitOffsets(command)
	}
	return Result{Err: groupError(CodeInvalidRequest, "unknown group command %q", command.Type)}
}

func (s *State) join(command storage.GroupCommand) Result {
	group, exists := s.groups[command.GroupID]
	if !exists {
		if len(s.groups) >= s.config.MaxGroups {
			return Result{Err: groupError(CodeResourceExhausted, "group limit %d reached", s.config.MaxGroups)}
		}
		for _, topic := range command.Subscription {
			if _, ok := s.config.Partitions(topic); !ok {
				return Result{Err: groupError(CodeUnknownTopic, "unknown topic %q", topic)}
			}
		}
		group = &groupState{
			subscription: append([]string(nil), command.Subscription...), phase: PhaseEmpty,
			members: map[string]*member{}, offsets: map[TopicPartition]uint64{},
		}
	}
	if !equalStrings(group.subscription, command.Subscription) {
		return group.result(groupError(CodeInvalidRequest, "subscription must equal the group's subscription %v", group.subscription))
	}
	if _, joined := group.members[command.MemberID]; joined {
		return group.result(nil)
	}
	if len(group.members) >= s.config.MaxMembers {
		return group.result(groupError(CodeResourceExhausted, "member limit %d reached", s.config.MaxMembers))
	}
	s.groups[command.GroupID] = group
	group.members[command.MemberID] = &member{}
	group.nextGeneration()
	return group.result(nil)
}

func (s *State) syncReady(command storage.GroupCommand) Result {
	group, current, err := s.currentMember(command.GroupID, command.MemberID, command.Generation)
	if err != nil {
		return Result{Err: err}
	}
	if group.phase != PhasePreparing {
		return group.result(nil)
	}
	current.synced = true
	for _, other := range group.members {
		if !other.synced {
			return group.result(nil)
		}
	}
	group.phase = PhaseAssigning
	return group.result(nil)
}

func (s *State) setAssignment(command storage.GroupCommand) Result {
	group, exists := s.groups[command.GroupID]
	if !exists || group.generation != command.Generation {
		return Result{Err: groupError(CodeIllegalGeneration, "generation %d is not current", command.Generation)}
	}
	switch group.phase {
	case PhaseStable:
		return group.result(nil)
	case PhaseAssigning:
	default:
		return group.result(groupError(CodeRebalanceInProgress, "members of generation %d are not all synced", group.generation))
	}
	partitions := s.subscribedPartitions(group.subscription)
	group.assignment = Assign(group.memberIDs(), partitions)
	group.owners = make(map[TopicPartition]string, len(partitions))
	for owner, assigned := range group.assignment {
		for _, partition := range assigned {
			group.owners[partition] = owner
		}
	}
	group.phase = PhaseStable
	return group.result(nil)
}

// removeMembers handles LEAVE (expected == nil, always allowed) and
// coordinator-issued REMOVE_MEMBERS, which must match the current generation.
func (s *State) removeMembers(groupID string, memberIDs []string, expected *uint64) Result {
	group, exists := s.groups[groupID]
	if !exists {
		if expected != nil {
			return Result{Err: groupError(CodeIllegalGeneration, "group %q has no generation", groupID)}
		}
		return Result{Phase: PhaseEmpty}
	}
	if expected != nil && group.generation != *expected {
		return group.result(groupError(CodeIllegalGeneration, "generation %d is not current", *expected))
	}
	removed := false
	for _, id := range memberIDs {
		if _, ok := group.members[id]; ok {
			delete(group.members, id)
			removed = true
		}
	}
	if removed {
		group.nextGeneration()
	}
	return group.result(nil)
}

func (s *State) beginRebalance(command storage.GroupCommand) Result {
	group, exists := s.groups[command.GroupID]
	if !exists || group.generation != command.ExpectedGeneration {
		return Result{Err: groupError(CodeIllegalGeneration, "generation %d is not current", command.ExpectedGeneration)}
	}
	group.nextGeneration()
	return group.result(nil)
}

// currentMember resolves a member; a non-zero generation must be current.
func (s *State) currentMember(groupID, memberID string, generation uint64) (*groupState, *member, error) {
	group, exists := s.groups[groupID]
	if !exists {
		return nil, nil, groupError(CodeIllegalGeneration, "member %s is not in group %q", memberID, groupID)
	}
	current, joined := group.members[memberID]
	if !joined {
		return nil, nil, groupError(CodeIllegalGeneration, "member %s must rejoin group %q", memberID, groupID)
	}
	if generation != 0 && generation != group.generation {
		return nil, nil, groupError(CodeIllegalGeneration, "generation %d is not current (%d)", generation, group.generation)
	}
	return group, current, nil
}

func (s *State) subscribedPartitions(topics []string) []TopicPartition {
	var partitions []TopicPartition
	for _, topic := range topics {
		count, _ := s.config.Partitions(topic)
		for partition := uint32(0); partition < count; partition++ {
			partitions = append(partitions, TopicPartition{Topic: topic, Partition: partition})
		}
	}
	return partitions
}

// nextGeneration starts a new generation: old commits become invalid at once,
// every remaining member must sync again, and an empty group rests in EMPTY.
func (g *groupState) nextGeneration() {
	g.generation++
	g.assignment = nil
	g.owners = nil
	for _, current := range g.members {
		current.synced = false
	}
	g.phase = PhasePreparing
	if len(g.members) == 0 {
		g.phase = PhaseEmpty
	}
}

func (g *groupState) result(err error) Result {
	return Result{Generation: g.generation, Phase: g.phase, Err: err}
}

func (g *groupState) memberIDs() []string {
	ids := make([]string, 0, len(g.members))
	for id := range g.members {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for index := range a {
		if a[index] != b[index] {
			return false
		}
	}
	return true
}
