package port

import (
	"context"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const RunOutputLimit = 1024

// RunOutputTransaction is an optional publication/history capability. Store follows
// successful fenced terminal publication and artifact metadata in the same transaction.
type RunOutputTransaction interface {
	Transaction
	StoreRunOutput(context.Context, RunOutputWrite) error
	LoadRunOutputs(context.Context, domain.ProjectID, domain.RunID) ([]RunOutput, error)
}

type RunOutputWrite struct {
	Fence          RunFence
	ArtifactDigest domain.Digest
	PublishedAtNS  int64
}

// RunOutput records historical fence identity, independent of current authority.
type RunOutput struct {
	ProjectID         domain.ProjectID
	RunID             domain.RunID
	InputDigest       domain.Digest
	ArtifactDigest    domain.Digest
	LeaseEpoch        uint64
	RestoreGeneration uint64
	Artifact          Artifact
}

// RunOutputReadTransaction exposes scoped immutable history without requiring
// publication authority, current leases, or current specification heads.
type RunOutputReadTransaction interface {
	Transaction
	LoadRunOutputs(context.Context, domain.ProjectID, domain.RunID) ([]RunOutput, error)
	LoadScopedRunOutputs(context.Context, domain.ProjectID, domain.WorkItemID, domain.RunID) ([]RunOutput, error)
	LoadProjectRunOutput(context.Context, domain.ProjectID, domain.Digest) (RunOutput, error)
}
