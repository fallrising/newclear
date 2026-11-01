package service

import (
	"context"
	"errors"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
	"slices"
	"time"
)

func (service *Service) initialAuthority(project domain.ProjectID, p specification.Proposal) error {
	deny := func() error {
		return command.NewError(command.CodePermissionDenied, "repository binding is not approved", false, nil, nil)
	}
	if nilRepositoryDependency(service.config.RepositoryAuthority) {
		return deny()
	}
	b := p.Binding()
	a, e := service.config.RepositoryAuthority.Lookup(project, b.ID)
	if e != nil {
		return deny()
	}
	_, d, e := port.CanonicalRepositoryBinding(a)
	if e != nil || a.Binding != b || d != b.Digest || a.ApprovedBy != service.config.Operator || !slices.Contains(a.ManifestPaths, p.ManifestPath()) {
		return deny()
	}
	return nil
}
func (service *Service) AcceptInitialSpecification(ctx context.Context, principal domain.ActorID, v command.AcceptInitialSpecification) (command.Outcome, error) {
	if principal != service.config.Operator {
		return failureOutcome(v.Metadata, command.NewError(command.CodePermissionDenied, "principal is not authorized", false, nil, nil))
	}
	request, digest, e := command.CanonicalAcceptInitialSpecification(v)
	if e != nil {
		return failureOutcome(v.Metadata, invalidRequest(e))
	}
	return service.execute(ctx, principal, v.Metadata, command.AcceptInitialSpecificationOperation, v.ProjectID, request, digest, func(ctx context.Context, base port.Transaction, now time.Time) (mutation, error) {
		tx, ok := base.(port.InitialAcceptanceTransaction)
		if !ok {
			return mutation{}, errors.New("initial acceptance transaction unavailable")
		}
		p, e := tx.LoadProposal(ctx, v.ProjectID, v.ProposalDigest)
		if e != nil {
			return mutation{}, e
		}
		if e = service.initialAuthority(v.ProjectID, p); e != nil {
			return mutation{}, e
		}
		policy := service.completionFor(v.ProjectID)
		if v.PolicyRevisionDigest != policy.RevisionDigest {
			return mutation{}, command.NewError(command.CodeStaleSubject, "policy revision changed", false, nil, nil)
		}
		subject := port.NewInitialAcceptanceSubject(v.ProjectID, v.ExpectedVersion, p, v.PolicyRevisionDigest, v.WorkItems)
		_, sd, e := port.CanonicalInitialAcceptanceSubject(subject)
		if e != nil {
			return mutation{}, invalidRequest(e)
		}
		if sd != v.AcceptanceSubjectDigest {
			return mutation{}, command.NewError(command.CodeStaleSubject, "acceptance subject mismatch", false, nil, nil)
		}
		record, e := port.BuildInitialAcceptedRecord(p, subject, principal)
		if e != nil {
			return mutation{}, invalidRequest(e)
		}
		material := record.Material()
		for _, binding := range material.Bindings {
			for _, n := range binding.Nodes {
				if n.Recipe != policy.RecipeDigest.String() {
					return mutation{}, invalidRequest(errors.New("unsupported recipe"))
				}
			}
		}
		contents := map[domain.ACID][]byte{}
		for _, a := range v.ACContents {
			contents[a.ACID] = a.Content
		}
		if len(contents) != len(material.ACs) {
			return mutation{}, invalidRequest(errors.New("AC content coverage"))
		}
		revisions := make([]port.ACRevision, 0, len(material.ACs))
		for _, a := range material.ACs {
			rule, exists := policy.Checks[a.ACID]
			if !exists || rule.VerifierClass == "" {
				return mutation{}, invalidRequest(errors.New("AC verification policy missing"))
			}
			content, exists := contents[a.ACID]
			if !exists || domain.HashBytes(content).String() != a.Digest {
				return mutation{}, invalidRequest(errors.New("AC content mismatch"))
			}
			d, _ := domain.ParseDigest(a.Digest)
			revisions = append(revisions, port.ACRevision{ProjectID: v.ProjectID, ACID: a.ACID, Digest: d, Content: slices.Clone(content), CreatedAtNS: now.UnixNano()})
		}
		ids := make([]domain.WorkItemID, len(material.Subject.WorkItems))
		for i, w := range material.Subject.WorkItems {
			ids[i] = w.WorkItemID
		}
		state, e := tx.LoadInitialAcceptanceState(ctx, v.ProjectID, ids)
		if e != nil {
			return mutation{}, e
		}
		if state.Project.ID != v.ProjectID || len(state.Items) != len(ids) || len(state.ItemHeads) != len(ids) || len(state.RunHistory) != len(ids) {
			return mutation{}, domain.StorageCorruptionError{Reason: "initial state scope or cardinality"}
		}
		for i, id := range ids {
			if state.Items[i].ID() != id || state.Items[i].ProjectID() != v.ProjectID {
				return mutation{}, domain.StorageCorruptionError{Reason: "initial item scope"}
			}
		}
		if state.Project.Version != v.ExpectedVersion {
			return mutation{}, domain.Rejection{Code: domain.CodeVersionConflict}
		}
		if state.ProjectHead {
			return mutation{}, command.NewError(command.CodeLifecycleRejected, "project already has an accepted specification", false, nil, nil)
		}
		for i, w := range material.Subject.WorkItems {
			if state.Items[i].Version() != w.ExpectedVersion {
				return mutation{}, domain.Rejection{Code: domain.CodeVersionConflict}
			}
			if state.Items[i].Phase() != domain.PhaseDraft || state.ItemHeads[i] || state.RunHistory[i] {
				return mutation{}, command.NewError(command.CodeLifecycleRejected, "initial acceptance requires headless Draft without Run history", false, nil, nil)
			}
		}
		if e = ctx.Err(); e != nil {
			return mutation{}, e
		}
		if e = tx.StoreInitialAcceptance(ctx, record, revisions, now.UnixNano()); e != nil {
			return mutation{}, rollbackMutationError{e}
		}
		result := command.Result{Type: "InitialSpecificationAccepted", ProjectID: v.ProjectID, Version: v.ExpectedVersion + 1, ProposalDigest: "sha256:" + p.Digest().String(), GraphDigest: "sha256:" + p.Graph().Revision().String(), AcceptedRevisionDigest: "sha256:" + record.Digest().String(), AcceptanceSubjectDigest: "sha256:" + sd.String()}
		return changeMutation(v.ProjectID, "project", string(v.ProjectID), v.ExpectedVersion+1, result, sd), nil
	})
}
