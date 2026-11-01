package domain

import (
	"reflect"
	"testing"
)

func TestAdvanceDraftSpecificationVersion_PreservesBlockers(t *testing.T) {
	item, e := NewWorkItem("wi_A", "prj_A", PhaseDraft, 1)
	if e != nil {
		t.Fatal(e)
	}
	item, e = item.AddBlocker(1, Blocker{ID: "blocker", Reason: "blocked"})
	if e != nil {
		t.Fatal(e)
	}
	next, e := item.AdvanceDraftSpecificationVersion(2)
	if e != nil || next.Version() != 3 || next.Phase() != PhaseDraft || !reflect.DeepEqual(next.Blockers(), item.Blockers()) || item.Version() != 2 {
		t.Fatalf("bad advance %v %v", next, e)
	}
	if _, e = item.AdvanceDraftSpecificationVersion(1); e == nil {
		t.Fatal("stale version accepted")
	}
	ready, _ := NewWorkItem("wi_A", "prj_A", PhaseReady, 1)
	if _, e = ready.AdvanceDraftSpecificationVersion(1); e == nil {
		t.Fatal("non-Draft accepted")
	}
	max, _ := NewWorkItem("wi_A", "prj_A", PhaseDraft, 1<<63-1)
	if _, e = max.AdvanceDraftSpecificationVersion(1<<63 - 1); e == nil {
		t.Fatal("signed overflow accepted")
	}
}
