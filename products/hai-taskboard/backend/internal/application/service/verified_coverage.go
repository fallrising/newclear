package service

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"maps"
	"math"
	"reflect"
	"slices"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type coverageSnapshot struct {
	completionPreparationSnapshot
	Cursor port.Cursor
	Now    time.Time
}

func coverageSubject(m port.CompletionMaterial, policy CompletionPolicy) (domain.CompletionSubject, error) {
	// A different active Run is a completion prerequisite, not a reader lifecycle failure.
	m.ActiveOrUnknownRun = false
	subject, err := preparationSubject(m, policy)
	if err != nil && !errors.Is(err, port.ErrRunLifecycle) {
		return subject, domain.StorageCorruptionError{Reason: "invalid coverage subject"}
	}
	return subject, err
}

func coverageID(id string) bool {
	if len(id) == 0 || len(id) > 120 || !utf8.ValidString(id) {
		return false
	}
	for _, r := range id {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func validateCoverageMaterial(m port.CompletionMaterial) error {
	bad := func() error { return domain.StorageCorruptionError{Reason: "invalid coverage material"} }
	if len(m.RequiredACRevisions) > 256 || len(m.CandidateArtifacts) > 1024 || len(m.Artifacts) > 1024 || len(m.Evidence) > 1024 || len(m.Reviews) > 1024 || len(m.Approvals) > 1024 || m.WorkItem.Version() > math.MaxInt64 || (m.WorkItem.Phase() == domain.PhaseReview && m.WorkItem.Version() == math.MaxInt64) {
		return bad()
	}
	if _, err := coverageArtifactMetadata(m); err != nil {
		return err
	}
	for _, ac := range m.RequiredACRevisions {
		if !coverageID(string(ac.ACID)) {
			return bad()
		}
	}
	seen := map[domain.EvidenceID]bool{}
	for _, e := range m.Evidence {
		if !coverageID(string(e.ID)) || seen[e.ID] || e.ProjectID != m.WorkItem.ProjectID() {
			return bad()
		}
		seen[e.ID] = true
		if _, err := domain.NewEvidence(domain.EvidenceConfig{ID: e.ID, SubjectDigest: e.SubjectDigest, CheckID: domain.CheckID(e.ACID), State: domain.EvidenceState(e.Verdict), Applicability: domain.EvidenceApplicability(e.Applicability), Availability: domain.EvidenceAvailability(e.Availability), VerifierActor: e.VerifierActor, VerifierRole: e.VerifierRole, VerifierClass: e.VerifierClass}); err != nil {
			return bad()
		}
	}
	for _, r := range m.Reviews {
		if r.ProjectID != m.WorkItem.ProjectID() {
			return bad()
		}
		if _, err := domain.NewReview(r.ID, r.SubjectDigest, domain.ReviewVerdict(r.Verdict), r.Reviewer, r.Independent); err != nil {
			return bad()
		}
	}
	for _, a := range m.Approvals {
		if a.ProjectID != m.WorkItem.ProjectID() {
			return bad()
		}
		if _, err := domain.NewApproval(a.ID, a.SubjectDigest, domain.CommandKind(a.CommandKind), a.Actor, time.Unix(0, a.ExpiresAtNS).UTC()); err != nil {
			return bad()
		}
	}
	return nil
}

func (s *Service) readCoverageSnapshot(ctx context.Context, project domain.ProjectID, item domain.WorkItemID, candidate domain.CandidateID) (coverageSnapshot, error) {
	var out coverageSnapshot
	err := s.unit.Within(ctx, func(tx port.Transaction) error {
		out.Policy = s.completionFor(project)
		out.Policy.Checks = maps.Clone(out.Policy.Checks)
		query := port.CompletionMaterialQuery{ProjectID: project, WorkItemID: item, CandidateID: candidate, MaximumRecords: 1024}
		stage1, identity, incomplete, err := s.preparationMaterialMode(ctx, tx, query, out.Policy, true)
		if err != nil {
			return err
		}
		if err = validateCoverageMaterial(stage1); err != nil {
			return err
		}
		subject, err := coverageSubject(stage1, out.Policy)
		if err != nil {
			return err
		}
		query.RunID = subject.RunID()
		query.SubjectDigest = subject.Digest()
		query.GraphRevisionDigest = subject.GraphRevisionDigest()
		out.Material, out.Identity, out.Incomplete, err = s.preparationMaterialMode(ctx, tx, query, out.Policy, true)
		if err != nil {
			return err
		}
		if err = validateCoverageMaterial(out.Material); err != nil {
			return err
		}
		out.Subject, err = coverageSubject(out.Material, out.Policy)
		if err != nil {
			return err
		}
		if out.Subject.Digest() != subject.Digest() || out.Identity != identity || out.Incomplete != incomplete {
			return domain.StorageCorruptionError{Reason: "coverage stage identity changed"}
		}
		authority, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		out.Authority, err = authority.LoadRunAuthority(ctx, project, out.Material.Run.ID)
		if err != nil {
			return err
		}
		if out.Authority.Run != out.Material.Run || out.Authority.Lease.Fence.Epoch == 0 || out.Authority.RestoreGeneration == 0 {
			return domain.StorageCorruptionError{Reason: "coverage Run authority"}
		}
		cursor, ok := tx.(port.CoverageTransaction)
		if !ok {
			return errors.New("coverage cursor unavailable")
		}
		out.Cursor, err = cursor.LoadCoverageCursor(ctx, project)
		if err != nil {
			return err
		}
		if out.Cursor.Epoch == 0 || out.Cursor.Epoch > math.MaxInt64 || out.Cursor.Sequence > math.MaxInt64 {
			return domain.StorageCorruptionError{Reason: "coverage cursor invalid"}
		}
		out.Now = s.clock.Now().UTC()
		if out.Now.IsZero() {
			return errors.New("coverage clock unavailable")
		}
		out.Material.RequiredACRevisions = slices.Clone(out.Material.RequiredACRevisions)
		out.Material.CandidateArtifacts = slices.Clone(out.Material.CandidateArtifacts)
		out.Material.Artifacts = slices.Clone(out.Material.Artifacts)
		out.Material.Evidence = slices.Clone(out.Material.Evidence)
		out.Material.Reviews = slices.Clone(out.Material.Reviews)
		out.Material.Approvals = slices.Clone(out.Material.Approvals)
		if out.Incomplete {
			return incompletePreparationPolicy()
		}
		return ctx.Err()
	})
	return out, err
}

// DescribeVerifiedCoverage observes byte-verified coverage. It reserves nothing:
// an explicit CompleteWorkItem command independently checks its own snapshot.
func (s *Service) DescribeVerifiedCoverage(ctx context.Context, actor domain.ActorID, project domain.ProjectID, item domain.WorkItemID, candidate domain.CandidateID) ([]byte, error) {
	if actor != s.config.Operator || project == "" || item == "" || candidate == "" {
		return nil, port.ErrNotFound
	}
	before, err := s.readCoverageSnapshot(ctx, project, item, candidate)
	if err != nil {
		return nil, err
	}
	verified, ioErr := s.verifyCoverageMaterial(ctx, before)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	after, err := s.readCoverageSnapshot(ctx, project, item, candidate)
	if err != nil {
		if _, ok := errors.AsType[domain.StorageCorruptionError](err); ok {
			return nil, err
		}
		var ce *command.Error
		if errors.Is(err, port.ErrNotFound) || errors.Is(err, port.ErrRunLifecycle) || (errors.As(err, &ce) && (ce.Code == command.CodePolicyRejected || ce.Code == command.CodeStaleSubject)) {
			return nil, staleCurrentInput(err)
		}
		return nil, err
	}
	if !reflect.DeepEqual(before.Policy, after.Policy) || before.Identity != after.Identity || before.Authority != after.Authority || before.Subject.Digest() != after.Subject.Digest() || before.Cursor.Epoch != after.Cursor.Epoch || after.Cursor.Sequence < before.Cursor.Sequence || !sameCompletionMaterial(before.Material, after.Material) {
		return nil, staleCurrentInput(nil)
	}
	if ioErr != nil {
		return nil, ioErr
	}
	input, _, err := assembleCompletionInput(actor, command.CompleteWorkItem{Metadata: command.Metadata{ExpectedVersion: after.Material.WorkItem.Version()}, ProjectID: project, WorkItemID: item, Subject: after.Subject}, verified, after.Policy, after.Subject, after.Now)
	if err != nil {
		return nil, err
	}
	return marshalCoverage(after, input)
}

func marshalCoverage(snapshot coverageSnapshot, input domain.CompletionInput) ([]byte, error) {
	subject := snapshot.Subject
	digest := func(d domain.Digest) string { return "sha256:" + d.String() }
	acs := make([]InitialACDescription, 0, len(subject.RequiredACRevisions()))
	rules := make([]map[string]any, 0, len(subject.RequiredACRevisions()))
	coverage := make([]map[string]any, 0, len(subject.RequiredACRevisions()))
	order := []domain.RejectionCode{domain.CodeEvidenceMissing, domain.CodeEvidenceUnavailable, domain.CodeEvidenceStale, domain.CodeEvidenceNonpassing, domain.CodeVerifierNotIndependent}
	requirements := map[domain.CheckID]domain.CheckRequirement{}
	for _, requirement := range input.RequiredChecks {
		requirements[requirement.CheckID] = requirement
	}
	for _, ac := range subject.RequiredACRevisions() {
		acs = append(acs, InitialACDescription{ACID: ac.ACID, RevisionDigest: digest(ac.RevisionDigest)})
		rule := snapshot.Policy.Checks[ac.ACID]
		rules = append(rules, map[string]any{"ac_id": ac.ACID, "verifier_class": rule.VerifierClass, "independent": rule.Independent, "prohibited_verifier_actor": rule.ProhibitedVerifierActor, "prohibited_verifier_run_role": rule.ProhibitedVerifierRunRole, "environment_digest": digest(rule.EnvironmentDigest)})
		ids, reasons := domain.EvaluateCheckRequirement(requirements[domain.CheckID(ac.ACID)], subject.Digest(), input.Evidence)
		slices.Sort(ids)
		ids = slices.Compact(ids)
		normalized := make([]domain.RejectionCode, 0, len(reasons))
		for _, code := range order {
			if slices.Contains(reasons, code) {
				normalized = append(normalized, code)
			}
		}
		coverage = append(coverage, map[string]any{"ac_id": ac.ACID, "ac_revision_digest": digest(ac.RevisionDigest), "covered": len(ids) > 0 && len(reasons) == 0, "matching_evidence_ids": ids, "reasons": normalized})
	}
	wireSubject := map[string]any{"project_id": subject.ProjectID(), "work_item_id": subject.WorkItemID(), "work_item_version": subject.WorkItemVersion(), "candidate_id": subject.CandidateID(), "candidate_digest": digest(subject.CandidateDigest()), "run_id": subject.RunID(), "run_input_digest": digest(subject.RunInputDigest()), "required_ac_revisions": acs, "accepted_graph_revision_digest": digest(subject.GraphRevisionDigest()), "policy_revision_digest": digest(subject.PolicyRevisionDigest()), "completion_recipe_digest": digest(subject.RecipeDigest())}
	if !subject.IntegrationBaseDigest().IsZero() {
		wireSubject["integration_base_digest"] = digest(subject.IntegrationBaseDigest())
	}
	mode := "prospective_qa"
	evaluated := false
	satisfied := false
	reasons := []domain.RejectionCode{domain.CodePhaseNotQA}
	if snapshot.Material.WorkItem.Phase() == domain.PhaseQA {
		mode = "current_qa"
		evaluated = true
		reasons = domain.EvaluateCompletionEligibility(input)
		satisfied = len(reasons) == 0
	}
	result, err := json.Marshal(map[string]any{"schema_version": 1, "observation_only": true, "observed_at": snapshot.Now.Format(time.RFC3339Nano), "expected_version": snapshot.Material.WorkItem.Version(), "phase": snapshot.Material.WorkItem.Phase(), "subject_mode": mode, "completion_subject": wireSubject, "completion_subject_digest": digest(subject.Digest()), "lease_epoch": snapshot.Authority.Lease.Fence.Epoch, "restore_generation": snapshot.Authority.RestoreGeneration, "cursor": map[string]uint64{"stream_epoch": snapshot.Cursor.Epoch, "event_sequence": snapshot.Cursor.Sequence}, "approval_required": snapshot.Policy.ApprovalRequired, "verification_rules": rules, "coverage": coverage, "completion_eligibility": map[string]any{"evaluated": evaluated, "satisfied": satisfied, "reasons": reasons}}, json.Deterministic(true))
	if err == nil && len(result) > 1<<20 {
		return nil, domain.StorageCorruptionError{Reason: "coverage response capacity"}
	}
	return result, err
}
