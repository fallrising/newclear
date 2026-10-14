package group

import (
	"reflect"
	"testing"
)

// TestAssignPinsRoundRobinOwnersIndependentOfInputOrder locks the sorted
// round-robin owners. The CG-01 property tests accept any deterministic split
// that covers every partition once, so a different split would still pass them.
func TestAssignPinsRoundRobinOwnersIndependentOfInputOrder(t *testing.T) {
	t.Parallel()
	partitions := []TopicPartition{
		{Topic: "events", Partition: 2},
		{Topic: "events", Partition: 0},
		{Topic: "events", Partition: 1},
	}
	cases := []struct {
		name    string
		members []string
		want    map[string][]TopicPartition
	}{
		{
			name:    "one",
			members: []string{"m1"},
			want: map[string][]TopicPartition{
				"m1": {
					{Topic: "events", Partition: 0},
					{Topic: "events", Partition: 1},
					{Topic: "events", Partition: 2},
				},
			},
		},
		{
			name:    "two",
			members: []string{"m2", "m1"},
			want: map[string][]TopicPartition{
				"m1": {
					{Topic: "events", Partition: 0},
					{Topic: "events", Partition: 2},
				},
				"m2": {{Topic: "events", Partition: 1}},
			},
		},
		{
			name:    "three",
			members: []string{"m3", "m1", "m2"},
			want: map[string][]TopicPartition{
				"m1": {{Topic: "events", Partition: 0}},
				"m2": {{Topic: "events", Partition: 1}},
				"m3": {{Topic: "events", Partition: 2}},
			},
		},
		{
			name:    "five",
			members: []string{"m5", "m2", "m4", "m1", "m3"},
			want: map[string][]TopicPartition{
				"m1": {{Topic: "events", Partition: 0}},
				"m2": {{Topic: "events", Partition: 1}},
				"m3": {{Topic: "events", Partition: 2}},
				"m4": {},
				"m5": {},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := Assign(tc.members, partitions)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("Assign() = %#v, want %#v", got, tc.want)
			}
		})
	}
}
