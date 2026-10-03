package port

import (
	"context"
	"io"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// ArtifactStore owns immutable object bytes. Authoritative bindings and
// availability remain persistence records and are evaluated in UnitOfWork.
type ArtifactStore interface {
	Put(context.Context, io.Reader) (domain.Digest, uint64, error)
	Open(context.Context, domain.Digest) (io.ReadCloser, error)
}
