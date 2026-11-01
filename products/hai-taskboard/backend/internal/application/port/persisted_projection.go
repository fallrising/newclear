package port

import (
	"context"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// PersistedProjectionReader supplies an immutable consistent read of rows and
// their durable stream position. It exposes no SQL or transport types.
type PersistedProjectionReader interface {
	ReadBoard(context.Context, domain.ProjectID) (PersistedBoard, error)
	ReadProjectionEvents(context.Context, domain.ProjectID, Cursor) (PersistedReplay, error)
}

type PersistedBoard struct {
	ProjectID       domain.ProjectID
	Cursor          Cursor
	MinimumSequence uint64
	Items           []BoardWorkItem
}

type BoardWorkItem struct {
	ID              domain.WorkItemID
	Item            domain.WorkItem
	Title           string
	OwnerID         domain.ActorID
	RequiredACCount int
	CurrentRun      *BoardRun
}

type BoardRun struct {
	ID                  domain.RunID
	DesiredAction       string
	DispatchState       string
	ObservedState       string
	ReconciliationState string
	SideEffectOutcome   string
}

type PersistedReplay struct {
	Cursor          Cursor
	MinimumSequence uint64
	Events          []CommittedProjection
}
