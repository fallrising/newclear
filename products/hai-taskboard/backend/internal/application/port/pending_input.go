package port

import (
	"context"
	"errors"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// ErrStaleRunInput is returned only after a Pending reconciliation mark commits.
var ErrStaleRunInput = errors.New("pending Run input needs reconciliation")

// StaleRunInputError identifies the Run whose pre-lease reconciliation committed.
type StaleRunInputError struct {
	ProjectID   domain.ProjectID
	RunID       domain.RunID
	InputDigest domain.Digest
}

func (StaleRunInputError) Error() string { return ErrStaleRunInput.Error() }
func (StaleRunInputError) Unwrap() error { return ErrStaleRunInput }

type PendingInputStaleRequest struct {
	ProjectID         domain.ProjectID
	RunID             domain.RunID
	InputDigest       domain.Digest
	RestoreGeneration uint64
}

type PendingInputTransaction interface {
	MarkPendingInputStale(context.Context, PendingInputStaleRequest) (RunAuthority, error)
}
