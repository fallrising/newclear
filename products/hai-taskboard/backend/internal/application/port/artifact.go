package port

import (
	"context"
	"errors"
	"io"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// ArtifactStore owns immutable object bytes. Authoritative bindings and
// availability remain persistence records and are evaluated in UnitOfWork.
type ArtifactStore interface {
	Put(context.Context, io.Reader) (domain.Digest, uint64, error)
	Open(context.Context, domain.Digest) (io.ReadCloser, error)
}

// ErrArtifactUnavailable means a definite object absence, integrity, identity,
// type or confinement failure. Unknown store/I/O faults must not wrap it.
var ErrArtifactUnavailable = errors.New("artifact unavailable")

// CoverageTransaction is a narrow observation-only extension to Transaction.
type CoverageTransaction interface {
	LoadCoverageCursor(context.Context, domain.ProjectID) (Cursor, error)
}

// BoundedArtifactReader opens a confined object without pre-reading its bytes.
// Implementations check the actual object size against declaredBytes before
// returning; the caller owns the sole bounded read/hash and closes the reader.
// Stores whose Open already performs I/O implement this optional capability so
// coverage's physical byte budget includes every read.
type BoundedArtifactReader interface {
	OpenBounded(context.Context, domain.Digest, uint64) (io.ReadCloser, error)
}
