package service

import (
	"context"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func completionQuery(value command.CompleteWorkItem) port.CompletionMaterialQuery {
	return port.CompletionMaterialQuery{
		ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, CandidateID: value.Subject.CandidateID(),
		RunID: value.Subject.RunID(), SubjectDigest: value.Subject.Digest(), GraphRevisionDigest: value.Subject.GraphRevisionDigest(),
		MaximumRecords: 1024,
	}
}

// completionSnapshot captures metadata in a bounded transaction. Its bytes are
// verified only after that transaction has released the SQLite writer lock.
func (service *Service) completionSnapshot(ctx context.Context, value command.CompleteWorkItem) (port.CompletionMaterial, error) {
	var material port.CompletionMaterial
	err := service.unit.Within(ctx, func(tx port.Transaction) error {
		var err error
		material, err = tx.LoadCompletionMaterial(ctx, completionQuery(value))
		if len(material.RequiredACRevisions) > 1024 || len(material.CandidateArtifacts) > 1024 || len(material.Artifacts) > 1024 ||
			len(material.Evidence) > 1024 || len(material.Reviews) > 1024 || len(material.Approvals) > 1024 {
			return domain.StorageCorruptionError{Reason: "completion metadata exceeds capacity"}
		}
		material.RequiredACRevisions = slices.Clone(material.RequiredACRevisions)
		material.CandidateArtifacts = slices.Clone(material.CandidateArtifacts)
		material.Artifacts = slices.Clone(material.Artifacts)
		material.Evidence = slices.Clone(material.Evidence)
		material.Reviews = slices.Clone(material.Reviews)
		material.Approvals = slices.Clone(material.Approvals)
		return err
	})
	return material, err
}

func sameCompletionMaterial(left, right port.CompletionMaterial) bool {
	return left.WorkItem.ID() == right.WorkItem.ID() && left.WorkItem.ProjectID() == right.WorkItem.ProjectID() &&
		left.WorkItem.Version() == right.WorkItem.Version() && left.WorkItem.Phase() == right.WorkItem.Phase() &&
		slices.Equal(left.WorkItem.Blockers(), right.WorkItem.Blockers()) && left.Candidate == right.Candidate && left.Run == right.Run &&
		left.CandidatePresent == right.CandidatePresent && left.CandidateAvailable == right.CandidateAvailable &&
		left.RunPresent == right.RunPresent && left.ActiveOrUnknownRun == right.ActiveOrUnknownRun &&
		left.GraphRevisionDigest == right.GraphRevisionDigest && slices.Equal(left.RequiredACRevisions, right.RequiredACRevisions) &&
		slices.Equal(left.CandidateArtifacts, right.CandidateArtifacts) && slices.Equal(left.Artifacts, right.Artifacts) &&
		slices.Equal(left.Evidence, right.Evidence) && slices.Equal(left.Reviews, right.Reviews) && slices.Equal(left.Approvals, right.Approvals)
}

func (service *Service) verifyCompletionMaterial(ctx context.Context, value command.CompleteWorkItem, material port.CompletionMaterial) error {
	// Existing gate errors retain precedence for absent/unavailable Candidates.
	if !material.CandidatePresent || !material.RunPresent || !material.CandidateAvailable {
		return nil
	}
	current, err := currentSubject(material, service.config.Completion)
	if err != nil || current.Digest() != value.Subject.Digest() || material.WorkItem.Version() != value.ExpectedVersion {
		return nil // Preserve the existing current-subject/version gate classification.
	}
	const maximumObjects = 1024
	const maximumTotalBytes = 50 * 1024 * 1024
	verified := make(map[domain.Digest]port.Artifact)
	var total uint64
	verify := func(artifact port.Artifact, reason domain.RejectionCode) error {
		unavailable := func() error {
			return command.NewError(command.CodeDoneGateUnsatisfied, "completion material is unavailable", false, []domain.RejectionCode{reason}, nil)
		}
		if previous, exists := verified[artifact.Digest]; exists {
			if previous != artifact {
				return domain.StorageCorruptionError{Reason: "conflicting completion artifact metadata"}
			}
			return nil
		}
		if artifact.StorageKey != artifactStorageKey(artifact.Digest) {
			return domain.StorageCorruptionError{Reason: "invalid completion artifact storage identity"}
		}
		if artifact.Digest.IsZero() || artifact.Availability != "Present" ||
			artifact.ByteLength > maxRunArtifactBytes || total+artifact.ByteLength > maximumTotalBytes || len(verified) == maximumObjects {
			return unavailable()
		}
		if err := service.verifyArtifact(ctx, command.ArtifactLocator{
			Digest: artifact.Digest, MediaType: artifact.MediaType, ByteLength: artifact.ByteLength, Availability: artifact.Availability,
		}); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return unavailable()
		}
		total += artifact.ByteLength
		verified[artifact.Digest] = artifact
		return nil
	}
	boundCandidate := false
	for _, artifact := range material.CandidateArtifacts {
		if err := verify(artifact, domain.CodeCandidateUnavailable); err != nil {
			return err
		}
		boundCandidate = boundCandidate || artifact.Digest == material.Candidate.Digest
	}
	if !boundCandidate {
		return command.NewError(command.CodeDoneGateUnsatisfied, "candidate material binding is unavailable", false, []domain.RejectionCode{domain.CodeCandidateUnavailable}, nil)
	}
	artifacts := make(map[domain.Digest]port.Artifact, len(material.Artifacts))
	for _, artifact := range material.Artifacts {
		artifacts[artifact.Digest] = artifact
	}
	for _, evidence := range material.Evidence {
		rule, required := service.config.Completion.Checks[evidence.ACID]
		bound := slices.ContainsFunc(material.RequiredACRevisions, func(ac port.ACRequirement) bool {
			return ac.ACID == evidence.ACID && ac.RevisionDigest == evidence.ACRevisionDigest
		})
		if !required || !bound || evidence.SubjectDigest != current.Digest() || evidence.VerifierClass != rule.VerifierClass || evidence.Verdict != "Passed" ||
			evidence.Applicability != "Current" || evidence.Availability != "Present" ||
			evidence.RecipeDigest != service.config.Completion.RecipeDigest ||
			(!rule.EnvironmentDigest.IsZero() && evidence.EnvironmentDigest != rule.EnvironmentDigest) {
			continue // The existing Done predicate rejects missing/nonpassing/stale coverage.
		}
		if artifact, exists := artifacts[evidence.ArtifactDigest]; exists && artifact.Availability == "Present" {
			if err := verify(artifact, domain.CodeEvidenceUnavailable); err != nil {
				return err
			}
		}
	}
	return nil
}
