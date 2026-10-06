package group

import "sort"

// View is a read-only copy of one group's committed state.
type View struct {
	Subscription []string
	Generation   uint64
	Phase        Phase
	Members      []string
}

func (s *State) Group(groupID string) (View, bool) {
	group, exists := s.groups[groupID]
	if !exists {
		return View{}, false
	}
	return View{
		Subscription: append([]string(nil), group.subscription...),
		Generation:   group.generation,
		Phase:        group.phase,
		Members:      group.memberIDs(),
	}, true
}

// Assignment returns a member's partitions in the current STABLE generation.
func (s *State) Assignment(groupID, memberID string) ([]TopicPartition, bool) {
	group, exists := s.groups[groupID]
	if !exists || group.phase != PhaseStable {
		return nil, false
	}
	assigned, ok := group.assignment[memberID]
	if !ok {
		return nil, false
	}
	return append([]TopicPartition{}, assigned...), true
}

// CommittedOffset returns the committed next offset; false means none yet.
func (s *State) CommittedOffset(groupID string, partition TopicPartition) (uint64, bool) {
	group, exists := s.groups[groupID]
	if !exists {
		return 0, false
	}
	offset, ok := group.offsets[partition]
	return offset, ok
}

// UnsyncedMembers lists members that have not revoked for the current generation.
func (s *State) UnsyncedMembers(groupID string) []string {
	group, exists := s.groups[groupID]
	if !exists {
		return nil
	}
	var unsynced []string
	for _, id := range group.memberIDs() {
		if !group.members[id].synced {
			unsynced = append(unsynced, id)
		}
	}
	return unsynced
}

// Groups lists group IDs in sorted order, for coordinator failover handling.
func (s *State) Groups() []string {
	ids := make([]string, 0, len(s.groups))
	for id := range s.groups {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
