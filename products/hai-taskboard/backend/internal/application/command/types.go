// Package command defines transport-neutral application command DTOs and
// their canonical V1 representations. Authenticated identity is deliberately
// absent: services receive it as a separate trusted argument.
package command

import (
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type Operation string

const (
	CreateProjectOperation    Operation = "CreateProject"
	CreateWorkItemOperation   Operation = "CreateWorkItem"
	MarkReadyOperation        Operation = "MarkReady"
	DispatchRunOperation      Operation = "DispatchRun"
	SubmitCandidateOperation  Operation = "SubmitCandidate"
	PublishReviewOperation    Operation = "PublishFixtureReview"
	PublishEvidenceOperation  Operation = "PublishFixtureEvidence"
	ApproveSubjectOperation   Operation = "ApproveSubject"
	RequestQAOperation        Operation = "RequestQA"
	RequestCancelOperation    Operation = "RequestCancellation"
	CompleteWorkItemOperation Operation = "CompleteWorkItem"
)

// Metadata contains caller-supplied command identity. CorrelationID is not
// part of the idempotency request digest; replay returns the originally
// recorded response bytes and therefore its original correlation identity.
type Metadata struct {
	CommandID       string
	IdempotencyKey  string
	ExpectedVersion uint64
	IssuedAt        time.Time
	CorrelationID   string
}

type ACRevision struct {
	ACID           domain.ACID
	RevisionDigest domain.Digest
}

type CreateProject struct {
	Metadata
	ProjectID      domain.ProjectID
	Name           string
	RepositoryRoot string
	ApprovedRef    string
}

type CreateWorkItem struct {
	Metadata
	ProjectID           domain.ProjectID
	WorkItemID          domain.WorkItemID
	Title               string
	Goal                string
	OwnerID             domain.ActorID
	RequiredACRevisions []ACRevision
}

type MarkReady struct {
	Metadata
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
}

type DispatchRun struct {
	Metadata
	ProjectID    domain.ProjectID
	WorkItemID   domain.WorkItemID
	AdapterID    string
	ScenarioID   string
	RetryOfRunID domain.RunID
}

type ArtifactLocator struct {
	Digest       domain.Digest
	MediaType    string
	ByteLength   uint64
	Availability string
	Href         string
	Disposition  string
}

type Candidate struct {
	ID                 domain.CandidateID
	RunID              domain.RunID
	Digest             domain.Digest
	InputSubjectDigest domain.Digest
	CreatedAt          time.Time
	Artifacts          []ArtifactLocator
}

type SubmitCandidate struct {
	Metadata
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
	RunID      domain.RunID
	Candidate  Candidate
}

type Review struct {
	ID            domain.ReviewID
	SubjectDigest domain.Digest
	ReviewerID    domain.ActorID
	ReviewerClass string
	Verdict       string
	CreatedAt     time.Time
}

type PublishFixtureReview struct {
	Metadata
	ProjectID         domain.ProjectID
	RunID             domain.RunID
	LeaseEpoch        uint64
	RestoreGeneration uint64
	Review            Review
}

type Evidence struct {
	ID                   domain.EvidenceID
	SubjectDigest        domain.Digest
	ACID                 domain.ACID
	ACRevisionDigest     domain.Digest
	ObservationVerdict   string
	ReviewDisposition    string
	Applicability        string
	MaterialAvailability string
	VerifierID           domain.ActorID
	VerifierClass        string
	RecipeDigest         domain.Digest
	EnvironmentDigest    domain.Digest
	ObservedAt           time.Time
	Report               ArtifactLocator
}

type PublishFixtureEvidence struct {
	Metadata
	ProjectID         domain.ProjectID
	RunID             domain.RunID
	LeaseEpoch        uint64
	RestoreGeneration uint64
	Evidence          Evidence
}

type ApproveSubject struct {
	Metadata
	ProjectID     domain.ProjectID
	WorkItemID    domain.WorkItemID
	CandidateID   domain.CandidateID
	RequestID     string
	SubjectDigest domain.Digest
	Decision      string
}

type RequestQA struct {
	Metadata
	ProjectID     domain.ProjectID
	WorkItemID    domain.WorkItemID
	CandidateID   domain.CandidateID
	SubjectDigest domain.Digest
}

type RequestCancellation struct {
	Metadata
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
	RunID      domain.RunID
	Reason     string
}

type CompleteWorkItem struct {
	Metadata
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
	Subject    domain.CompletionSubject
}

type Result struct {
	Type       string
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
	RunID      domain.RunID
	Version    uint64
	Phase      domain.Phase
}

type Outcome struct {
	Payload            []byte
	Replayed           bool
	ProjectionDeferred bool
}
