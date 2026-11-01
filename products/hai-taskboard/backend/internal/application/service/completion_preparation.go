package service

import (
	"context"
	"errors"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// Preparation compares every available identity before classifying incomplete
// current policy. Mutating commands retain verifyCurrentRunInput's semantics.
func (s *Service) preparationMaterial(ctx context.Context, tx port.Transaction, query port.CompletionMaterialQuery, policy CompletionPolicy) (port.CompletionMaterial, inputIdentity, bool, error) {
	return s.preparationMaterialMode(ctx, tx, query, policy, false)
}

func (s *Service) preparationMaterialMode(ctx context.Context, tx port.Transaction, query port.CompletionMaterialQuery, policy CompletionPolicy, coverage bool) (port.CompletionMaterial, inputIdentity, bool, error) {
	m, err := tx.LoadCompletionMaterial(ctx, query)
	if err != nil {
		return m, inputIdentity{}, false, err
	}
	if m.WorkItem.ProjectID() != query.ProjectID || m.WorkItem.ID() != query.WorkItemID {
		return m, inputIdentity{}, false, port.ErrNotFound
	}
	if !m.CandidatePresent || !m.RunPresent || m.Candidate.ID != query.CandidateID {
		return m, inputIdentity{}, false, port.ErrNotFound
	}
	if coverage {
		if err := validateCoverageMaterial(m); err != nil {
			return m, inputIdentity{}, false, err
		}
	}
	v, err := currentInputTransaction(tx)
	if err != nil {
		return m, inputIdentity{}, false, err
	}
	envelope, err := v.LoadRunInput(ctx, query.ProjectID, m.Run.ID)
	if errors.Is(err, port.ErrNotFound) {
		err = staleCurrentInput(err)
	}
	if err != nil {
		return m, inputIdentity{}, false, err
	}
	// Validate persisted canonical integrity before consulting incomplete policy.
	input, err := port.DecodeRunInput(envelope.Input.CanonicalJSON(), envelope.Input.Digest())
	if err != nil {
		return m, inputIdentity{}, false, err
	}
	captured := input.Material()
	if envelope.RunID != m.Run.ID || m.Run.ProjectID != query.ProjectID || m.Run.WorkItemID != query.WorkItemID || captured.ProjectID != query.ProjectID || captured.WorkItemID != query.WorkItemID || input.Digest() != m.Run.InputDigest || captured.AdapterID != m.Run.AdapterID || captured.AdapterVersion != m.Run.AdapterVersion || captured.ScenarioID != m.Run.ScenarioID {
		return m, inputIdentity{}, false, domain.StorageCorruptionError{Reason: "Run input scope mismatch"}
	}
	current, err := v.LoadCurrentSpecification(ctx, query.ProjectID, query.WorkItemID)
	if errors.Is(err, port.ErrNotFound) || errors.Is(err, port.ErrUnsupportedAcceptedKind) {
		err = staleCurrentInput(err)
	}
	if err != nil {
		return m, inputIdentity{}, false, err
	}
	identity := inputIdentity{current.ProjectHeadVersion, current.WorkItemHeadVersion, current.AcceptedRevisionDigest, current.BindingDigest, input.Digest()}
	if current.ProjectID != query.ProjectID || current.WorkItemID != query.WorkItemID || current.ProjectHeadVersion == 0 || current.WorkItemHeadVersion == 0 || current.AcceptedRevisionDigest.IsZero() || current.BindingDigest.IsZero() || current.GraphRevisionDigest.IsZero() || len(current.Requirements) == 0 {
		return m, identity, false, domain.StorageCorruptionError{Reason: "current specification scope mismatch"}
	}
	stale := captured.BindingDigest != current.BindingDigest.String() || captured.GraphRevisionDigest != current.GraphRevisionDigest.String() || captured.PolicyRevisionDigest != current.PolicyRevisionDigest.String() || captured.RecipeDigest != current.RecipeDigest.String() || captured.PolicyRevisionDigest != policy.RevisionDigest.String() || captured.RecipeDigest != policy.RecipeDigest.String() || captured.ApprovalRequired != policy.ApprovalRequired || !input.SupportsExecutor(s.executorDeclaration) || m.Candidate.ProjectID != query.ProjectID || m.Candidate.RunID != m.Run.ID || m.Candidate.InputSubjectDigest != m.Run.InputDigest
	if policy.IntegrationBaseDigest.IsZero() {
		stale = stale || captured.IntegrationBase.Applicability != "absent"
	} else {
		stale = stale || captured.IntegrationBase.Digest == nil || *captured.IntegrationBase.Digest != policy.IntegrationBaseDigest.String()
	}
	acs := make([]port.InitialACBinding, 0, len(current.Requirements))
	seen := map[domain.ACID]bool{}
	for _, ac := range current.Requirements {
		if ac.RevisionDigest.IsZero() || ac.ACID == "" || seen[ac.ACID] {
			return m, identity, false, domain.StorageCorruptionError{Reason: "current AC identity"}
		}
		seen[ac.ACID] = true
		acs = append(acs, port.InitialACBinding{ACID: ac.ACID, Digest: ac.RevisionDigest.String()})
	}
	slices.SortFunc(acs, func(a, b port.InitialACBinding) int {
		if a.ACID < b.ACID {
			return -1
		}
		if a.ACID > b.ACID {
			return 1
		}
		return 0
	})
	stale = stale || !slices.Equal(acs, captured.ACs)
	incomplete := false
	for _, old := range captured.Rules {
		rule, ok := policy.Checks[old.ACID]
		if !ok {
			incomplete = true
			continue
		}
		if coverage && rule.VerifierClass == "" {
			incomplete = true
		} else {
			stale = stale || rule.VerifierClass != old.VerifierClass
		}
		stale = stale || rule.Independent != old.Independent || rule.ProhibitedVerifierActor != old.ProhibitedVerifierActor || rule.ProhibitedVerifierRunRole != old.ProhibitedVerifierRunRole
		if rule.EnvironmentDigest.IsZero() {
			incomplete = true
		} else {
			stale = stale || rule.EnvironmentDigest.String() != old.EnvironmentDigest
		}
	}
	if stale {
		return m, identity, incomplete, staleCurrentInput(nil)
	}
	m.GraphRevisionDigest = current.GraphRevisionDigest
	m.RequiredACRevisions = current.Requirements
	return m, identity, incomplete, nil
}

func incompletePreparationPolicy() error {
	return command.NewError(command.CodePolicyRejected, "verification policy is incomplete", false, nil, nil)
}
