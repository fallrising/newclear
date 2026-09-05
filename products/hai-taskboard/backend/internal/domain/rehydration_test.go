package domain

import (
	"errors"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/internal/rehydrationcap"
)

func TestRehydrateCompletedWorkItem_RequiresPairedOpaqueAuthority(t *testing.T) {
	digest := HashString("subject")
	capability, load := rehydrationcap.NewCompletedLoad("item-1", "project-1", 6, nil, "record-1", digest.String())
	item, record, err := RehydrateCompletedWorkItem(capability, load)
	if err != nil {
		t.Fatal(err)
	}
	if item.Phase() != PhaseDone || record.WorkItemID() != item.ID() || record.ResultVersion() != item.Version() {
		t.Fatalf("rehydrated pair = (%#v, %#v)", item, record)
	}
	otherCapability, _ := rehydrationcap.NewCompletedLoad("item-1", "project-1", 6, nil, "record-1", digest.String())
	_, _, err = RehydrateCompletedWorkItem(otherCapability, load)
	if !errors.Is(err, ErrStorageCorruption) {
		t.Fatalf("mixed capability error = %v", err)
	}
}
