package command

import (
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type canonicalArtifact struct {
	SHA256       string `json:"sha256"`
	MediaType    string `json:"media_type"`
	ByteLength   uint64 `json:"byte_length"`
	Availability string `json:"availability"`
	Href         string `json:"href,omitempty"`
	Disposition  string `json:"disposition,omitempty"`
}

type canonicalCandidateCommand struct {
	canonicalMetadata
	WorkItemID string `json:"work_item_id"`
	RunID      string `json:"run_id"`
	Candidate  struct {
		ID                 string              `json:"candidate_id"`
		RunID              string              `json:"run_id"`
		Digest             string              `json:"candidate_digest"`
		InputSubjectDigest string              `json:"input_subject_digest"`
		CreatedAt          string              `json:"created_at"`
		Artifacts          []canonicalArtifact `json:"artifact_manifest"`
	} `json:"candidate"`
}

type canonicalReviewCommand struct {
	canonicalMetadata
	RunID             string `json:"run_id"`
	LeaseEpoch        uint64 `json:"lease_epoch"`
	RestoreGeneration uint64 `json:"restore_generation"`
	Review            struct {
		ID            string `json:"review_id"`
		SubjectDigest string `json:"completion_subject_digest"`
		ReviewerID    string `json:"reviewer_id"`
		ReviewerClass string `json:"reviewer_class"`
		Verdict       string `json:"verdict"`
		CreatedAt     string `json:"created_at"`
	} `json:"review"`
}

type canonicalEvidenceCommand struct {
	canonicalMetadata
	RunID             string `json:"run_id"`
	LeaseEpoch        uint64 `json:"lease_epoch"`
	RestoreGeneration uint64 `json:"restore_generation"`
	Evidence          struct {
		ID                   string            `json:"evidence_id"`
		SubjectDigest        string            `json:"completion_subject_digest"`
		ACID                 string            `json:"ac_id"`
		ACRevisionDigest     string            `json:"ac_revision_digest"`
		ObservationVerdict   string            `json:"observation_verdict"`
		ReviewDisposition    string            `json:"review_disposition"`
		Applicability        string            `json:"applicability"`
		MaterialAvailability string            `json:"material_availability"`
		VerifierID           string            `json:"verifier_id"`
		VerifierClass        string            `json:"verifier_class"`
		RecipeDigest         string            `json:"recipe_digest"`
		EnvironmentDigest    string            `json:"environment_digest"`
		ObservedAt           string            `json:"observed_at"`
		Report               canonicalArtifact `json:"report"`
	} `json:"evidence"`
}

type canonicalApprovalCommand struct {
	canonicalMetadata
	WorkItemID    string `json:"work_item_id"`
	CandidateID   string `json:"candidate_id"`
	RequestID     string `json:"approval_request_id"`
	SubjectDigest string `json:"subject_digest"`
	Decision      string `json:"decision"`
}

type canonicalQACommand struct {
	canonicalMetadata
	WorkItemID    string `json:"work_item_id"`
	CandidateID   string `json:"candidate_id"`
	SubjectDigest string `json:"completion_subject_digest"`
}

type canonicalCancelCommand struct {
	canonicalMetadata
	WorkItemID string `json:"work_item_id"`
	RunID      string `json:"run_id"`
	Reason     string `json:"reason"`
}

func canonicalSHA256(value domain.Digest) string {
	return "sha256:" + value.String()
}

func CanonicalSubmitCandidate(value SubmitCandidate) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, SubmitCandidateOperation, value.ProjectID)
	if err != nil || value.ExpectedVersion == 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) ||
		!runIDPattern.MatchString(string(value.RunID)) || value.Candidate.RunID != value.RunID ||
		!validText(string(value.Candidate.ID), 80) || value.Candidate.Digest.IsZero() ||
		value.Candidate.InputSubjectDigest.IsZero() || value.Candidate.CreatedAt.IsZero() || len(value.Candidate.Artifacts) == 0 {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	artifacts, err := canonicalArtifacts(value.ProjectID, value.Candidate.Artifacts)
	if err != nil {
		return nil, domain.Digest{}, err
	}
	canonical := canonicalCandidateCommand{canonicalMetadata: metadata, WorkItemID: string(value.WorkItemID), RunID: string(value.RunID)}
	canonical.Candidate.ID = string(value.Candidate.ID)
	canonical.Candidate.RunID = string(value.Candidate.RunID)
	canonical.Candidate.Digest = canonicalSHA256(value.Candidate.Digest)
	canonical.Candidate.InputSubjectDigest = canonicalSHA256(value.Candidate.InputSubjectDigest)
	canonical.Candidate.CreatedAt = normalizeTime(value.Candidate.CreatedAt)
	canonical.Candidate.Artifacts = artifacts
	return marshalCanonical(canonical)
}

func CanonicalPublishFixtureReview(value PublishFixtureReview) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, PublishReviewOperation, value.ProjectID)
	if err != nil || value.ExpectedVersion == 0 || !runIDPattern.MatchString(string(value.RunID)) ||
		value.LeaseEpoch == 0 || value.RestoreGeneration == 0 || !validText(string(value.Review.ID), 80) ||
		value.Review.SubjectDigest.IsZero() || !validText(string(value.Review.ReviewerID), 120) ||
		!oneOf(value.Review.ReviewerClass, "producer", "independent", "human") ||
		!oneOf(value.Review.Verdict, "Approved", "ChangesRequested", "Rejected") || value.Review.CreatedAt.IsZero() {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	canonical := canonicalReviewCommand{canonicalMetadata: metadata, RunID: string(value.RunID), LeaseEpoch: value.LeaseEpoch, RestoreGeneration: value.RestoreGeneration}
	canonical.Review.ID = string(value.Review.ID)
	canonical.Review.SubjectDigest = canonicalSHA256(value.Review.SubjectDigest)
	canonical.Review.ReviewerID = string(value.Review.ReviewerID)
	canonical.Review.ReviewerClass = value.Review.ReviewerClass
	canonical.Review.Verdict = value.Review.Verdict
	canonical.Review.CreatedAt = normalizeTime(value.Review.CreatedAt)
	return marshalCanonical(canonical)
}

func CanonicalPublishFixtureEvidence(value PublishFixtureEvidence) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, PublishEvidenceOperation, value.ProjectID)
	evidence := value.Evidence
	if err != nil || value.ExpectedVersion == 0 || !runIDPattern.MatchString(string(value.RunID)) || value.LeaseEpoch == 0 || value.RestoreGeneration == 0 ||
		!validText(string(evidence.ID), 80) || evidence.SubjectDigest.IsZero() || !validText(string(evidence.ACID), 80) || evidence.ACRevisionDigest.IsZero() ||
		!oneOf(evidence.ObservationVerdict, "Passing", "Failing", "Inconclusive", "Error") || !oneOf(evidence.ReviewDisposition, "Pending", "Accepted", "Rejected") ||
		!oneOf(evidence.Applicability, "Fresh", "Stale", "Unknown") || !oneOf(evidence.MaterialAvailability, "Present", "Missing", "Quarantined") ||
		!validText(string(evidence.VerifierID), 120) || !oneOf(evidence.VerifierClass, "producer", "independent", "human") ||
		evidence.RecipeDigest.IsZero() || evidence.EnvironmentDigest.IsZero() || evidence.ObservedAt.IsZero() {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	reports, err := canonicalArtifacts(value.ProjectID, []ArtifactLocator{evidence.Report})
	if err != nil {
		return nil, domain.Digest{}, err
	}
	canonical := canonicalEvidenceCommand{canonicalMetadata: metadata, RunID: string(value.RunID), LeaseEpoch: value.LeaseEpoch, RestoreGeneration: value.RestoreGeneration}
	canonical.Evidence.ID = string(evidence.ID)
	canonical.Evidence.SubjectDigest = canonicalSHA256(evidence.SubjectDigest)
	canonical.Evidence.ACID = string(evidence.ACID)
	canonical.Evidence.ACRevisionDigest = canonicalSHA256(evidence.ACRevisionDigest)
	canonical.Evidence.ObservationVerdict = evidence.ObservationVerdict
	canonical.Evidence.ReviewDisposition = evidence.ReviewDisposition
	canonical.Evidence.Applicability = evidence.Applicability
	canonical.Evidence.MaterialAvailability = evidence.MaterialAvailability
	canonical.Evidence.VerifierID = string(evidence.VerifierID)
	canonical.Evidence.VerifierClass = evidence.VerifierClass
	canonical.Evidence.RecipeDigest = canonicalSHA256(evidence.RecipeDigest)
	canonical.Evidence.EnvironmentDigest = canonicalSHA256(evidence.EnvironmentDigest)
	canonical.Evidence.ObservedAt = normalizeTime(evidence.ObservedAt)
	canonical.Evidence.Report = reports[0]
	return marshalCanonical(canonical)
}

func CanonicalApproveSubject(value ApproveSubject) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, ApproveSubjectOperation, value.ProjectID)
	if err != nil || value.ExpectedVersion == 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) ||
		!validText(string(value.CandidateID), 80) || !validText(value.RequestID, 80) ||
		value.SubjectDigest.IsZero() || !oneOf(value.Decision, "Approved", "Rejected") {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(canonicalApprovalCommand{
		canonicalMetadata: metadata, WorkItemID: string(value.WorkItemID), CandidateID: string(value.CandidateID),
		RequestID: value.RequestID, SubjectDigest: canonicalSHA256(value.SubjectDigest), Decision: value.Decision,
	})
}

func CanonicalRequestQA(value RequestQA) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, RequestQAOperation, value.ProjectID)
	if err != nil || value.ExpectedVersion == 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) || !validText(string(value.CandidateID), 80) || value.SubjectDigest.IsZero() {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(canonicalQACommand{canonicalMetadata: metadata, WorkItemID: string(value.WorkItemID), CandidateID: string(value.CandidateID), SubjectDigest: canonicalSHA256(value.SubjectDigest)})
}

func CanonicalRequestCancellation(value RequestCancellation) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(value.Metadata, RequestCancelOperation, value.ProjectID)
	if err != nil || value.ExpectedVersion == 0 || !workItemIDPattern.MatchString(string(value.WorkItemID)) || !runIDPattern.MatchString(string(value.RunID)) || !validText(value.Reason, 2000) {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(canonicalCancelCommand{canonicalMetadata: metadata, WorkItemID: string(value.WorkItemID), RunID: string(value.RunID), Reason: value.Reason})
}

func canonicalArtifacts(projectID domain.ProjectID, source []ArtifactLocator) ([]canonicalArtifact, error) {
	artifacts := slices.Clone(source)
	slices.SortFunc(artifacts, func(left, right ArtifactLocator) int {
		return strings.Compare(left.Digest.String(), right.Digest.String())
	})
	result := make([]canonicalArtifact, len(artifacts))
	for index, artifact := range artifacts {
		expectedHref := "/api/v1/projects/" + string(projectID) + "/artifacts/sha256:" + artifact.Digest.String()
		if artifact.Digest.IsZero() || !validText(artifact.MediaType, 160) || artifact.ByteLength > 10_485_760 ||
			!oneOf(artifact.Availability, "Present", "Missing", "Quarantined") ||
			(artifact.Href != "" && artifact.Href != expectedHref) ||
			(artifact.Disposition != "" && !oneOf(artifact.Disposition, "inline", "attachment")) ||
			(index > 0 && artifacts[index-1].Digest == artifact.Digest) {
			return nil, ErrInvalidCommand
		}
		result[index] = canonicalArtifact{SHA256: canonicalSHA256(artifact.Digest), MediaType: artifact.MediaType, ByteLength: artifact.ByteLength, Availability: artifact.Availability, Href: artifact.Href, Disposition: artifact.Disposition}
	}
	return result, nil
}

func oneOf(value string, allowed ...string) bool { return slices.Contains(allowed, value) }
