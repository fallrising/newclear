package group

import "sort"

type TopicPartition struct {
	Topic     string
	Partition uint32
}

func (tp TopicPartition) less(other TopicPartition) bool {
	if tp.Topic != other.Topic {
		return tp.Topic < other.Topic
	}
	return tp.Partition < other.Partition
}

// Assign distributes partitions round-robin: after sorting partitions by
// (topic, partition) and members by ID, partition i goes to members[i % n].
// Every member gets an entry, possibly empty, so the result covers the group.
func Assign(members []string, partitions []TopicPartition) map[string][]TopicPartition {
	sortedMembers := append([]string(nil), members...)
	sort.Strings(sortedMembers)
	sortedPartitions := append([]TopicPartition(nil), partitions...)
	sort.Slice(sortedPartitions, func(i, j int) bool { return sortedPartitions[i].less(sortedPartitions[j]) })

	assignment := make(map[string][]TopicPartition, len(sortedMembers))
	for _, member := range sortedMembers {
		assignment[member] = []TopicPartition{}
	}
	if len(sortedMembers) == 0 {
		return assignment
	}
	for index, partition := range sortedPartitions {
		owner := sortedMembers[index%len(sortedMembers)]
		assignment[owner] = append(assignment[owner], partition)
	}
	return assignment
}
