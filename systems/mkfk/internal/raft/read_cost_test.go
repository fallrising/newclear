package raft

import (
	"fmt"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

// Replaying a committed prefix on restart and looking up single entries
// must each read a frame a bounded number of times; reading a 4 MiB window
// per entry made restart quadratic in the log length.
func TestM7RestartReplayAndEntryLookupsReadFramesLinearly(t *testing.T) {
	t.Parallel()
	const entries = 3000
	log := newMemoryLog()
	for index := uint64(1); index <= entries; index++ {
		frame := fenceFrame(index, 1, fmt.Sprintf("v%d", index))
		if err := log.AppendEntries([]storage.Frame{frame}); err != nil {
			t.Fatal(err)
		}
	}
	if err := log.PersistHardState(storage.HardState{CurrentTerm: 1, CommitIndex: entries}); err != nil {
		t.Fatal(err)
	}
	node := newTestNode(t, 1, log)
	if replayed := len(node.RecoveredApplied()); replayed != entries {
		t.Fatalf("replayed %d entries, want %d", replayed, entries)
	}
	if log.framesRead > 2*entries {
		t.Fatalf("replaying %d entries read %d frames", entries, log.framesRead)
	}
	log.framesRead = 0
	for index := uint64(1); index <= 300; index++ {
		if _, err := node.Entry(index); err != nil {
			t.Fatal(err)
		}
	}
	if log.framesRead > 300*200 {
		t.Fatalf("300 single-entry lookups read %d frames", log.framesRead)
	}
}
