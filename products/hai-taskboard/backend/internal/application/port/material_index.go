package port

import (
	"context"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const MaterialIndexRowLimit = 1024
const MaterialIndexWireLimit = 4 << 20
const MaterialIndexBlockerByteLimit = 2 << 20

var ErrMaterialIndexCapacity = errors.New("material index capacity exceeded")

// MaterialIndexReader is an optional snapshot projection, never completion authority.
type MaterialIndexReader interface {
	ReadWorkItemMaterialIndex(context.Context, domain.ProjectID, domain.WorkItemID) (WorkItemMaterialIndex, error)
}
type WorkItemMaterialIndex struct {
	ProjectID           domain.ProjectID
	WorkItemID          domain.WorkItemID
	Title               string
	Goal                string
	OwnerID             domain.ActorID
	Phase               domain.Phase
	Version             uint64
	Accepted            *MaterialIndexSpecification
	RequiredACRevisions []MaterialIndexAC
	Runs                []MaterialIndexRun
	Candidates          []MaterialIndexCandidate
	Cursor              Cursor
	RestoreGeneration   uint64
}
type MaterialIndexSpecification struct {
	AcceptedRevisionDigest domain.Digest
	BindingDigest          domain.Digest
	GraphRevisionDigest    domain.Digest
	PolicyRevisionDigest   domain.Digest
	ProjectHeadVersion     uint64
	WorkItemHeadVersion    uint64
	AcceptanceKind         string
}
type MaterialIndexAC struct {
	ACID           string
	RevisionDigest domain.Digest
}
type MaterialIndexRun struct {
	RunID               domain.RunID
	InputDigest         domain.Digest
	CreatedAtNS         int64
	DesiredAction       string
	DispatchState       string
	ObservedState       string
	ReconciliationState string // Persisted Reconciled; transport maps it to Resolved.
	SideEffectOutcome   string
}
type MaterialIndexCandidate struct {
	CandidateID        domain.CandidateID
	RunID              domain.RunID
	CandidateDigest    domain.Digest
	InputSubjectDigest domain.Digest
	CreatedAtNS        int64
}
