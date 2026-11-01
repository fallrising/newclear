package service

import (
	"context"
	json "encoding/json/v2"
	"maps"
	"reflect"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type completionPreparationSnapshot struct {
	Material   port.CompletionMaterial
	Identity   inputIdentity
	Authority  port.RunAuthority
	Subject    domain.CompletionSubject
	Policy     CompletionPolicy
	Incomplete bool
}

func (s *Service) readCompletionPreparation(ctx context.Context, project domain.ProjectID, item domain.WorkItemID, candidate domain.CandidateID) (completionPreparationSnapshot, error) {
	var result completionPreparationSnapshot
	err := s.unit.Within(ctx, func(tx port.Transaction) error {
		var err error
		result.Policy = s.completionFor(project)
		result.Policy.Checks = maps.Clone(result.Policy.Checks)
		result.Material, result.Identity, result.Incomplete, err = s.preparationMaterial(ctx, tx, port.CompletionMaterialQuery{ProjectID: project, WorkItemID: item, CandidateID: candidate, MaximumRecords: 1024}, result.Policy)
		if err != nil {
			return err
		}
		m := &result.Material
		if !m.CandidatePresent || !m.RunPresent || !m.CandidateAvailable || m.Candidate.ID != candidate {
			return port.ErrNotFound
		}
		if len(m.RequiredACRevisions) > 1024 || len(m.CandidateArtifacts) > 1024 || len(m.Artifacts) > 1024 || len(m.Evidence) > 1024 || len(m.Reviews) > 1024 || len(m.Approvals) > 1024 {
			return domain.StorageCorruptionError{Reason: "completion preparation capacity"}
		}
		m.RequiredACRevisions = slices.Clone(m.RequiredACRevisions)
		m.CandidateArtifacts = slices.Clone(m.CandidateArtifacts)
		m.Artifacts = slices.Clone(m.Artifacts)
		m.Evidence = slices.Clone(m.Evidence)
		m.Reviews = slices.Clone(m.Reviews)
		m.Approvals = slices.Clone(m.Approvals)
		result.Subject, err = preparationSubject(*m, result.Policy)
		if err != nil {
			return err
		}
		authority, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		result.Authority, err = authority.LoadRunAuthority(ctx, project, m.Run.ID)
		if err != nil {
			return err
		}
		if result.Authority.Run != m.Run || result.Authority.Lease.Fence.Epoch == 0 || result.Authority.RestoreGeneration == 0 {
			return domain.StorageCorruptionError{Reason: "completion preparation Run scope"}
		}
		return ctx.Err()
	})
	return result, err
}

// DescribeCompletion is a snapshot for explicit operator intent, never a reservation or gate result.
func (s *Service) DescribeCompletion(ctx context.Context, actor domain.ActorID, project domain.ProjectID, item domain.WorkItemID, candidate domain.CandidateID) ([]byte, error) {
	if actor != s.config.Operator || project == "" || item == "" || candidate == "" {
		return nil, port.ErrNotFound
	}
	before, err := s.readCompletionPreparation(ctx, project, item, candidate)
	if err != nil {
		return nil, err
	}
	var total uint64
	bound := false
	for _, artifact := range before.Material.CandidateArtifacts {
		if artifact.Digest.IsZero() || artifact.Availability != "Present" || artifact.StorageKey != artifactStorageKey(artifact.Digest) || artifact.ByteLength > maxRunArtifactBytes || artifact.ByteLength > (50<<20)-total {
			return nil, port.ErrNotFound
		}
		total += artifact.ByteLength
		if err := s.verifyArtifact(ctx, command.ArtifactLocator{Digest: artifact.Digest, MediaType: artifact.MediaType, ByteLength: artifact.ByteLength, Availability: artifact.Availability}); err != nil {
			return nil, err
		}
		bound = bound || artifact.Digest == before.Material.Candidate.Digest
	}
	if !bound {
		return nil, port.ErrNotFound
	}
	after, err := s.readCompletionPreparation(ctx, project, item, candidate)
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(before.Policy, after.Policy) || before.Incomplete != after.Incomplete || before.Identity != after.Identity || before.Authority != after.Authority || before.Subject.Digest() != after.Subject.Digest() || !sameCompletionMaterial(before.Material, after.Material) {
		return nil, staleCurrentInput(nil)
	}
	if after.Incomplete {
		return nil, incompletePreparationPolicy()
	}
	subject := after.Subject
	wireDigest := func(d domain.Digest) string { return "sha256:" + d.String() }
	acs := make([]InitialACDescription, 0, len(subject.RequiredACRevisions()))
	rules := make([]map[string]any, 0, len(subject.RequiredACRevisions()))
	for _, ac := range subject.RequiredACRevisions() {
		acs = append(acs, InitialACDescription{ACID: ac.ACID, RevisionDigest: wireDigest(ac.RevisionDigest)})
		rule, ok := after.Policy.Checks[ac.ACID]
		if !ok || rule.EnvironmentDigest.IsZero() {
			return nil, incompletePreparationPolicy()
		}
		rules = append(rules, map[string]any{"ac_id": ac.ACID, "verifier_class": rule.VerifierClass, "independent": rule.Independent, "prohibited_verifier_actor": rule.ProhibitedVerifierActor, "prohibited_verifier_run_role": rule.ProhibitedVerifierRunRole, "environment_digest": wireDigest(rule.EnvironmentDigest)})
	}
	wireSubject := map[string]any{"project_id": project, "work_item_id": item, "work_item_version": subject.WorkItemVersion(), "candidate_id": subject.CandidateID(), "candidate_digest": wireDigest(subject.CandidateDigest()), "run_id": subject.RunID(), "run_input_digest": wireDigest(subject.RunInputDigest()), "required_ac_revisions": acs, "accepted_graph_revision_digest": wireDigest(subject.GraphRevisionDigest()), "policy_revision_digest": wireDigest(subject.PolicyRevisionDigest()), "completion_recipe_digest": wireDigest(subject.RecipeDigest())}
	if !subject.IntegrationBaseDigest().IsZero() {
		wireSubject["integration_base_digest"] = wireDigest(subject.IntegrationBaseDigest())
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"expected_version": after.Material.WorkItem.Version(), "phase": after.Material.WorkItem.Phase(), "completion_subject": wireSubject, "completion_subject_digest": wireDigest(subject.Digest()), "lease_epoch": after.Authority.Lease.Fence.Epoch, "restore_generation": after.Authority.RestoreGeneration, "approval_required": after.Policy.ApprovalRequired, "verification_rules": rules}, json.Deterministic(true))
}
