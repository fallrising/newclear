package service

import (
	"context"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func currentInputTransaction(tx port.Transaction) (port.CurrentInputTransaction, error) {
	v, ok := tx.(port.CurrentInputTransaction)
	if !ok {
		return nil, errors.New("current input transaction unavailable")
	}
	return v, nil
}

// currentRunInput binds only verified accepted material and trusted configured rules.
// The legacy SpecificationPolicy boolean cannot grant accepted authority.
func (s *Service) currentRunInput(ctx context.Context, tx port.Transaction, item domain.WorkItem, scenario string) (port.RunInput, error) {
	v, err := currentInputTransaction(tx)
	if err != nil {
		return port.RunInput{}, err
	}
	current, err := v.LoadCurrentSpecification(ctx, item.ProjectID(), item.ID())
	if errors.Is(err, port.ErrNotFound) || errors.Is(err, port.ErrUnsupportedAcceptedKind) {
		return port.RunInput{}, command.NewError(command.CodeLifecycleRejected, "current accepted specification unavailable", false, nil, err)
	}
	if err != nil {
		return port.RunInput{}, err
	}
	return s.runInputFromCurrent(item, scenario, current)
}

func (s *Service) runInputFromCurrent(item domain.WorkItem, scenario string, current port.CurrentSpecification) (port.RunInput, error) {
	policy := s.config.Completion
	if current.ProjectID != item.ProjectID() || current.WorkItemID != item.ID() || current.ProjectHeadVersion == 0 || current.WorkItemHeadVersion == 0 || current.AcceptedRevisionDigest.IsZero() {
		return port.RunInput{}, domain.StorageCorruptionError{Reason: "current specification scope mismatch"}
	}
	if current.PolicyRevisionDigest != policy.RevisionDigest || current.RecipeDigest != policy.RecipeDigest {
		return port.RunInput{}, command.NewError(command.CodeLifecycleRejected, "current specification policy or recipe changed", false, nil, nil)
	}
	m := port.RunInputMaterial{Schema: 1, ProjectID: item.ProjectID(), WorkItemID: item.ID(), ReadyVersion: item.Version(), BindingDigest: current.BindingDigest.String(), GraphRevisionDigest: current.GraphRevisionDigest.String(), PolicyRevisionDigest: policy.RevisionDigest.String(), RecipeDigest: policy.RecipeDigest.String(), ApprovalRequired: policy.ApprovalRequired, IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}, AdapterID: s.executorDeclaration.AdapterID, AdapterVersion: s.executorDeclaration.AdapterVersion, ScenarioID: scenario}
	if !policy.IntegrationBaseDigest.IsZero() {
		m.IntegrationBase = port.RunInputIntegrationBase{Applicability: "present", Digest: new(policy.IntegrationBaseDigest.String())}
	}
	for _, r := range current.Requirements {
		rule, ok := policy.Checks[r.ACID]
		if !ok || rule.EnvironmentDigest.IsZero() {
			return port.RunInput{}, command.NewError(command.CodeLifecycleRejected, "verification rule or concrete trusted environment missing", false, nil, nil)
		}
		m.ACs = append(m.ACs, port.InitialACBinding{ACID: r.ACID, Digest: r.RevisionDigest.String()})
		m.Rules = append(m.Rules, port.RunInputVerificationRule{ACID: r.ACID, VerifierClass: rule.VerifierClass, Independent: rule.Independent, ProhibitedVerifierActor: rule.ProhibitedVerifierActor, ProhibitedVerifierRunRole: rule.ProhibitedVerifierRunRole, EnvironmentDigest: rule.EnvironmentDigest.String()})
	}
	input, err := port.NewRunInput(m)
	if err != nil {
		return port.RunInput{}, command.NewError(command.CodeLifecycleRejected, "current input is unsupported", false, nil, err)
	}
	if !input.SupportsExecutor(s.executorDeclaration) {
		return port.RunInput{}, command.NewError(command.CodeCapabilityUnsupported, "current input executor unavailable", false, nil, nil)
	}
	return input, nil
}

// inputIdentity also fences a change of accepted heads during outside-lock reads.
type inputIdentity struct {
	ProjectHeadVersion, WorkItemHeadVersion uint64
	AcceptedRevision, Binding, Input        domain.Digest
}

func staleCurrentInput(err error) error {
	return command.NewError(command.CodeStaleSubject, "Run input is not current", false, []domain.RejectionCode{domain.CodeSubjectStale}, err)
}

func (s *Service) verifyCurrentRunInput(ctx context.Context, tx port.Transaction, item domain.WorkItem, run port.Run) (port.CurrentSpecification, inputIdentity, error) {
	v, err := currentInputTransaction(tx)
	if err != nil {
		return port.CurrentSpecification{}, inputIdentity{}, err
	}
	envelope, err := v.LoadRunInput(ctx, item.ProjectID(), run.ID)
	if errors.Is(err, port.ErrNotFound) {
		return port.CurrentSpecification{}, inputIdentity{}, staleCurrentInput(err)
	}
	if err != nil {
		return port.CurrentSpecification{}, inputIdentity{}, err
	}
	current, err := v.LoadCurrentSpecification(ctx, item.ProjectID(), item.ID())
	if errors.Is(err, port.ErrNotFound) || errors.Is(err, port.ErrUnsupportedAcceptedKind) {
		return port.CurrentSpecification{}, inputIdentity{}, staleCurrentInput(err)
	}
	if err != nil {
		return port.CurrentSpecification{}, inputIdentity{}, err
	}
	input, err := s.runInputFromCurrent(item, run.ScenarioID, current)
	if err != nil {
		if isCurrentInputRejection(err) {
			err = staleCurrentInput(err)
		}
		return port.CurrentSpecification{}, inputIdentity{}, err
	}
	m := envelope.Input.Material()
	if envelope.RunID != run.ID || run.ProjectID != item.ProjectID() || run.WorkItemID != item.ID() || m.ProjectID != item.ProjectID() || m.WorkItemID != item.ID() || envelope.Input.Digest() != run.InputDigest || m.AdapterID != run.AdapterID || m.AdapterVersion != run.AdapterVersion || m.ScenarioID != run.ScenarioID {
		return port.CurrentSpecification{}, inputIdentity{}, domain.StorageCorruptionError{Reason: "Run input scope mismatch"}
	}
	if !envelope.Input.SupportsExecutor(s.executorDeclaration) || !envelope.Input.SemanticallyEqual(input) {
		return port.CurrentSpecification{}, inputIdentity{}, staleCurrentInput(nil)
	}
	return current, inputIdentity{current.ProjectHeadVersion, current.WorkItemHeadVersion, current.AcceptedRevisionDigest, current.BindingDigest, envelope.Input.Digest()}, nil
}

// Historical material is only a record selector. Verified heads supply authority.
func (s *Service) currentCompletionMaterial(ctx context.Context, tx port.Transaction, query port.CompletionMaterialQuery) (port.CompletionMaterial, inputIdentity, error) {
	m, err := tx.LoadCompletionMaterial(ctx, query)
	if err != nil {
		return m, inputIdentity{}, err
	}
	if m.WorkItem.ProjectID() != query.ProjectID || m.WorkItem.ID() != query.WorkItemID ||
		(m.CandidatePresent && query.CandidateID != "" && m.Candidate.ID != query.CandidateID) ||
		(m.RunPresent && query.RunID != "" && m.Run.ID != query.RunID) {
		return m, inputIdentity{}, domain.StorageCorruptionError{Reason: "completion material scope mismatch"}
	}
	if !m.CandidatePresent || !m.RunPresent {
		return m, inputIdentity{}, nil
	}
	current, identity, err := s.verifyCurrentRunInput(ctx, tx, m.WorkItem, m.Run)
	if err != nil {
		return m, identity, err
	}
	if m.Candidate.ProjectID != m.WorkItem.ProjectID() || m.Candidate.RunID != m.Run.ID || m.Candidate.InputSubjectDigest != m.Run.InputDigest {
		return m, identity, staleCurrentInput(nil)
	}
	m.GraphRevisionDigest = current.GraphRevisionDigest
	m.RequiredACRevisions = current.Requirements
	return m, identity, nil
}

type publicationSnapshot struct {
	Run       port.RunAuthority
	Version   uint64
	Phase     domain.Phase
	Identity  inputIdentity
	Artifacts []publicationArtifact
	Outputs   []port.RunOutput
}

type publicationArtifact struct {
	Artifact port.Artifact
	Present  bool
}

func snapshotPublicationArtifacts(ctx context.Context, tx port.AuthorityTransaction, locators []command.ArtifactLocator) ([]publicationArtifact, error) {
	result := make([]publicationArtifact, len(locators))
	for i, locator := range locators {
		artifact, err := tx.LoadArtifact(ctx, locator.Digest)
		if errors.Is(err, port.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		result[i] = publicationArtifact{artifact, true}
	}
	return result, nil
}

func samePublicationArtifact(before publicationArtifact, after port.Artifact, err error) bool {
	return (!before.Present && errors.Is(err, port.ErrNotFound)) || (before.Present && err == nil && before.Artifact == after)
}

func (s *Service) candidateSnapshot(ctx context.Context, project domain.ProjectID, itemID domain.WorkItemID, runID domain.RunID, locators []command.ArtifactLocator) (publicationSnapshot, error) {
	var snapshot publicationSnapshot
	err := s.unit.Within(ctx, func(tx port.Transaction) error {
		authority, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		snapshot.Run, err = authority.LoadRunAuthority(ctx, project, runID)
		if err != nil {
			return err
		}
		item, err := tx.LoadWorkItem(ctx, project, itemID)
		if err != nil {
			return err
		}
		snapshot.Version, snapshot.Phase = item.Version(), item.Phase()
		_, snapshot.Identity, err = s.verifyCurrentRunInput(ctx, tx, item, snapshot.Run.Run)
		if err != nil {
			return err
		}
		if item.Phase() != domain.PhaseDeveloping || snapshot.Run.Run.WorkItemID != itemID || snapshot.Run.Run.ObservedState != "Succeeded" || snapshot.Run.Run.ReconciliationState != "None" || snapshot.Run.Run.SideEffectOutcome != "Confirmed" {
			return port.ErrRunLifecycle
		}
		snapshot.Outputs, err = verifiedRunOutputs(ctx, tx, snapshot.Run, locators)
		return err
	})
	return snapshot, err
}

func (s *Service) evidenceSnapshot(ctx context.Context, project domain.ProjectID, runID domain.RunID, subject domain.Digest, locator command.ArtifactLocator) (port.CompletionMaterial, inputIdentity, []publicationArtifact, error) {
	var material port.CompletionMaterial
	var identity inputIdentity
	var artifacts []publicationArtifact
	err := s.unit.Within(ctx, func(tx port.Transaction) error {
		authority, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		run, err := authority.LoadRunAuthority(ctx, project, runID)
		if err != nil {
			return err
		}
		material, identity, err = s.currentCompletionMaterial(ctx, tx, port.CompletionMaterialQuery{ProjectID: project, WorkItemID: run.Run.WorkItemID, RunID: runID, SubjectDigest: subject, MaximumRecords: 1024})
		if err != nil {
			return err
		}
		artifacts, err = snapshotPublicationArtifacts(ctx, authority, []command.ArtifactLocator{locator})
		return err
	})
	return material, identity, artifacts, err
}

func isCurrentInputRejection(err error) bool {
	_, ok := errors.AsType[*command.Error](err)
	return ok
}

// verifiedRunOutputs compares the entire persisted association set with the exact
// requested manifest. Global artifact metadata grants no producer authority.
func verifiedRunOutputs(ctx context.Context, tx port.Transaction, run port.RunAuthority, locators []command.ArtifactLocator) ([]port.RunOutput, error) {
	outputs, ok := tx.(port.RunOutputTransaction)
	if !ok {
		return nil, errors.New("Run output transaction unavailable")
	}
	stored, err := outputs.LoadRunOutputs(ctx, run.Run.ProjectID, run.Run.ID)
	if err != nil {
		return nil, err
	}
	if len(stored) == 0 || len(stored) != len(locators) {
		return nil, port.ErrRunLifecycle
	}
	byDigest := make(map[domain.Digest]port.Artifact, len(stored))
	for _, output := range stored {
		a := output.Artifact
		if output.ProjectID != run.Run.ProjectID || output.RunID != run.Run.ID || output.InputDigest != run.Run.InputDigest || output.ArtifactDigest != a.Digest || output.LeaseEpoch == 0 || output.RestoreGeneration == 0 || a.Digest.IsZero() || a.Availability != "Present" || a.StorageKey != artifactStorageKey(a.Digest) {
			return nil, domain.StorageCorruptionError{Reason: "Run output identity mismatch"}
		}
		if _, exists := byDigest[a.Digest]; exists {
			return nil, domain.StorageCorruptionError{Reason: "duplicate Run output identity"}
		}
		byDigest[a.Digest] = a
	}
	for _, locator := range locators {
		a, ok := byDigest[locator.Digest]
		if !ok || a.MediaType != locator.MediaType || a.ByteLength != locator.ByteLength || locator.Availability != "Present" {
			return nil, port.ErrRunLifecycle
		}
		delete(byDigest, locator.Digest)
	}
	return stored, nil
}
