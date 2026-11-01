package storage

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func goldenGroupVector(t *testing.T) walVector {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "wal-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vectors []walVector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, vector := range vectors {
		if vector.Kind == KindGroup {
			return vector
		}
	}
	t.Fatal("no GROUP golden vector")
	return walVector{}
}

func TestGroupFrameEncodesPinnedGoldenVector(t *testing.T) {
	t.Parallel()
	vector := goldenGroupVector(t)
	frame, err := NewGroupFrame(vector.LogIndex, vector.Term, GroupCommand{
		Type: GroupBeginRebalance, GroupID: "g", RequestID: "rebalance-1", ExpectedGeneration: 0, Generation: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := EncodeFrame(frame)
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(encoded); got != vector.Hex {
		t.Fatalf("encoded hex = %s, want pinned %s", got, vector.Hex)
	}
}

func TestGroupFrameRoundTripsEveryCommand(t *testing.T) {
	t.Parallel()
	commands := []GroupCommand{
		{Type: GroupJoin, GroupID: "g1", RequestID: "join-1", MemberID: "m1", Subscription: []string{"events", "orders"}},
		{Type: GroupSyncReady, GroupID: "g1", MemberID: "m1", Generation: 3},
		{Type: GroupSetAssignment, GroupID: "g1", RequestID: "assign-3", Generation: 3},
		{Type: GroupLeave, GroupID: "g1", RequestID: "leave-1", MemberID: "m1", Generation: 3},
		{Type: GroupRemoveMembers, GroupID: "g1", RequestID: "expire-3", MemberIDs: []string{"m1", "m2"}, ExpectedGeneration: 3},
		{Type: GroupBeginRebalance, GroupID: "g1", RequestID: "term-7", ExpectedGeneration: 3, Generation: 4},
		{Type: GroupCommitOffsets, GroupID: "g1", RequestID: "commit-9", MemberID: "m1", Generation: 3, Offsets: []GroupOffset{
			{Topic: "events", Partition: 0, Offset: 10, HighWatermark: 12},
			{Topic: "events", Partition: 2, Offset: 0, HighWatermark: 0},
		}},
	}
	for _, command := range commands {
		frame, err := NewGroupFrame(7, 2, command)
		if err != nil {
			t.Fatalf("%s: %v", command.Type, err)
		}
		decoded, err := InspectGroupFrame(frame)
		if err != nil {
			t.Fatalf("%s: %v", command.Type, err)
		}
		if !reflect.DeepEqual(decoded, command) {
			t.Fatalf("%s round trip = %#v, want %#v", command.Type, decoded, command)
		}
	}
}

func TestGroupFrameRejectsNonCanonicalCommands(t *testing.T) {
	t.Parallel()
	invalid := map[string]GroupCommand{
		"unsorted subscription": {Type: GroupJoin, GroupID: "g", RequestID: "r", MemberID: "m", Subscription: []string{"b", "a"}},
		"internal topic":        {Type: GroupJoin, GroupID: "g", RequestID: "r", MemberID: "m", Subscription: []string{"__mkfk_groups"}},
		"sync with request_id":  {Type: GroupSyncReady, GroupID: "g", RequestID: "r", MemberID: "m", Generation: 1},
		"rebalance skips":       {Type: GroupBeginRebalance, GroupID: "g", RequestID: "r", ExpectedGeneration: 1, Generation: 3},
		"duplicate partition": {Type: GroupCommitOffsets, GroupID: "g", RequestID: "r", MemberID: "m", Generation: 1, Offsets: []GroupOffset{
			{Topic: "t", Partition: 0, Offset: 1, HighWatermark: 1}, {Topic: "t", Partition: 0, Offset: 1, HighWatermark: 1}}},
		"offset beyond hw": {Type: GroupCommitOffsets, GroupID: "g", RequestID: "r", MemberID: "m", Generation: 1, Offsets: []GroupOffset{
			{Topic: "t", Partition: 0, Offset: 2, HighWatermark: 1}}},
		"unknown command": {Type: "DELETE_GROUP", GroupID: "g", RequestID: "r"},
	}
	for name, command := range invalid {
		if _, err := NewGroupFrame(1, 1, command); err == nil {
			t.Errorf("%s: NewGroupFrame accepted %#v", name, command)
		}
	}
}

func TestInspectGroupFrameRejectsUnknownFields(t *testing.T) {
	t.Parallel()
	frame := Frame{Kind: KindGroup, LogIndex: 1, Term: 1,
		Payload: []byte(`{"command":"SET_ASSIGNMENT","group_id":"g","request_id":"r","generation":"1","assignment":[]}`)}
	if _, err := InspectGroupFrame(frame); err == nil {
		t.Fatal("InspectGroupFrame accepted an unknown field")
	}
}
