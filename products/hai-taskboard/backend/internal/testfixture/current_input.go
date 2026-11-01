// Package testfixture supplies explicitly modeled verified inputs to historical
// tests. It is not used by runtime and does not prove accepted-head admission.
package testfixture

import (
	"context"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type VerifiedInputUnit struct {
	Base port.UnitOfWork
	View port.CurrentSpecification
}

func (u VerifiedInputUnit) Within(ctx context.Context, f func(port.Transaction) error) error {
	return u.Base.Within(ctx, func(tx port.Transaction) error {
		return f(verifiedTransaction{AuthorityTransaction: tx.(port.AuthorityTransaction), current: tx.(port.CurrentInputTransaction), pending: tx.(port.PendingInputTransaction), view: u.View})
	})
}

type verifiedTransaction struct {
	port.AuthorityTransaction
	current port.CurrentInputTransaction
	pending port.PendingInputTransaction
	view    port.CurrentSpecification
}

func (t verifiedTransaction) StoreRunOutput(ctx context.Context, w port.RunOutputWrite) error {
	return t.current.(port.RunOutputTransaction).StoreRunOutput(ctx, w)
}
func (t verifiedTransaction) LoadRunOutputs(ctx context.Context, p domain.ProjectID, r domain.RunID) ([]port.RunOutput, error) {
	return t.current.(port.RunOutputTransaction).LoadRunOutputs(ctx, p, r)
}
func (t verifiedTransaction) LoadCurrentSpecification(_ context.Context, p domain.ProjectID, w domain.WorkItemID) (port.CurrentSpecification, error) {
	if p != t.view.ProjectID || w != t.view.WorkItemID {
		return port.CurrentSpecification{}, port.ErrNotFound
	}
	return t.view.Clone(), nil
}
func (t verifiedTransaction) StoreRunInput(ctx context.Context, v port.RunInputEnvelope) error {
	return t.current.StoreRunInput(ctx, v)
}
func (t verifiedTransaction) LoadRunInput(ctx context.Context, p domain.ProjectID, r domain.RunID) (port.RunInputEnvelope, error) {
	return t.current.LoadRunInput(ctx, p, r)
}
func (t verifiedTransaction) MarkPendingInputStale(ctx context.Context, r port.PendingInputStaleRequest) (port.RunAuthority, error) {
	return t.pending.MarkPendingInputStale(ctx, r)
}

// View is an explicit test assertion of a verified result, never a legacy DB read.
func View(p domain.ProjectID, w domain.WorkItemID, ac domain.ACID, revision, graph, policy, recipe domain.Digest) port.CurrentSpecification {
	return port.CurrentSpecification{ProjectID: p, WorkItemID: w, ProjectHeadVersion: 1, WorkItemHeadVersion: 1, AcceptedRevisionDigest: domain.HashString("modeled accepted revision"), BindingDigest: domain.HashString("modeled accepted binding"), GraphRevisionDigest: graph, PolicyRevisionDigest: policy, RecipeDigest: recipe, Requirements: []port.ACRequirement{{ProjectID: p, WorkItemID: w, ACID: ac, RevisionDigest: revision}}}
}
