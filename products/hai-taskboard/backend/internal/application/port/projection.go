package port

import (
	"context"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// CommittedProjection is a post-commit notification. Cursor and payload were
// already durably recorded by the command transaction.
type CommittedProjection struct {
	ProjectID domain.ProjectID
	Cursor    Cursor
	Payload   []byte
}

func (projection CommittedProjection) Clone() CommittedProjection {
	projection.Payload = slices.Clone(projection.Payload)
	return projection
}

// ProjectionSink may wake an in-process hub after commit. Delivery failure
// never rolls back or repeats an already committed command.
type ProjectionSink interface {
	PublishCommitted(context.Context, CommittedProjection) error
}
