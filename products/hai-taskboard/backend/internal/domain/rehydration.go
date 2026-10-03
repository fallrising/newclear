package domain

import (
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/internal/rehydrationcap"
)

// ErrStorageCorruption marks persisted state that cannot safely become a
// domain aggregate. Callers must fail closed rather than return a partial item.
var ErrStorageCorruption = errors.New("storage corruption")

type StorageCorruptionError struct {
	Reason string
}

func (err StorageCorruptionError) Error() string {
	if err.Reason == "" {
		return ErrStorageCorruption.Error()
	}
	return ErrStorageCorruption.Error() + ": " + err.Reason
}

func (err StorageCorruptionError) Unwrap() error { return ErrStorageCorruption }

// RehydrateWorkItem rebuilds a non-Done aggregate after storage validation.
// Done is deliberately excluded from this ordinary path.
func RehydrateWorkItem(id WorkItemID, projectID ProjectID, phase Phase, version uint64, source []Blocker) (WorkItem, error) {
	if phase == PhaseDone {
		return WorkItem{}, StorageCorruptionError{Reason: "Done requires completion record"}
	}
	if _, err := NewWorkItem(id, projectID, phase, version); err != nil {
		return WorkItem{}, StorageCorruptionError{Reason: "invalid work item"}
	}
	blockers := make(map[BlockerID]Blocker, len(source))
	for _, blocker := range source {
		if !validStableID(string(blocker.ID)) || blocker.Reason == "" {
			return WorkItem{}, StorageCorruptionError{Reason: "invalid blocker"}
		}
		if _, duplicate := blockers[blocker.ID]; duplicate {
			return WorkItem{}, StorageCorruptionError{Reason: "duplicate blocker"}
		}
		blockers[blocker.ID] = blocker
	}
	return WorkItem{id: id, projectID: projectID, phase: phase, version: version, blockers: blockers}, nil
}

// RehydrateCompletedWorkItem is the sole domain entry point for reconstructing
// a stored Done aggregate. It accepts no raw phase or completion fields.
func RehydrateCompletedWorkItem(
	capability rehydrationcap.Capability,
	load rehydrationcap.CompletedLoad,
) (WorkItem, CompletionRecord, error) {
	subjectDigest, err := ParseDigest(load.SubjectDigest())
	if !capability.Valid(load) || !validStableID(load.WorkItemID()) ||
		!validStableID(load.ProjectID()) || load.Version() == 0 ||
		!validStableID(load.RecordID()) || err != nil || subjectDigest.IsZero() {
		return WorkItem{}, CompletionRecord{}, StorageCorruptionError{Reason: "invalid completed load"}
	}

	blockers := make(map[BlockerID]Blocker, len(load.Blockers()))
	for _, blocker := range load.Blockers() {
		if !validStableID(blocker.ID) || blocker.Reason == "" {
			return WorkItem{}, CompletionRecord{}, StorageCorruptionError{Reason: "invalid blocker"}
		}
		blockerID := BlockerID(blocker.ID)
		if _, duplicate := blockers[blockerID]; duplicate {
			return WorkItem{}, CompletionRecord{}, StorageCorruptionError{Reason: "duplicate blocker"}
		}
		blockers[blockerID] = Blocker{ID: blockerID, Reason: blocker.Reason}
	}

	item := WorkItem{
		id: WorkItemID(load.WorkItemID()), projectID: ProjectID(load.ProjectID()), phase: PhaseDone,
		version: load.Version(), blockers: blockers,
	}
	record := CompletionRecord{
		id: CompletionRecordID(load.RecordID()), workItemID: item.id, subjectDigest: subjectDigest, resultVersion: item.version,
	}
	return item, record, nil
}
