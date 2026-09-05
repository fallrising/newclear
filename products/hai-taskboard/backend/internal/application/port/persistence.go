// Package port defines the persistence boundary consumed by application
// services. It intentionally contains no SQL, driver, or transport types.
package port

import (
	"context"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// ErrNotFound is the adapter-independent result for an absent persisted
// record. Application code must never need to match database/sql errors.
var ErrNotFound = errors.New("persistence record not found")

type Project struct {
	ID         domain.ProjectID
	Name       string
	Repository string
	Ref        string
	Version    uint64
}

type WorkItem struct {
	Item  domain.WorkItem
	Title string
	Goal  string
	Owner domain.ActorID
}

type Persistence interface {
	UnitOfWork
	CreateProject(context.Context, Project) error
	LoadProject(context.Context, domain.ProjectID) (Project, error)
	CreateWorkItem(context.Context, WorkItem) error
	LoadWorkItem(context.Context, domain.ProjectID, domain.WorkItemID) (domain.WorkItem, error)
	UpdateWorkItem(context.Context, domain.WorkItem, uint64) error
	AddBlocker(context.Context, domain.ProjectID, domain.WorkItemID, uint64, domain.Blocker) (domain.WorkItem, error)
	ResolveBlocker(context.Context, domain.ProjectID, domain.WorkItemID, uint64, domain.BlockerID, int64) (domain.WorkItem, error)
}

// UnitOfWork is application-owned. It provides one bounded transaction without
// exposing a database driver or concrete adapter to application commands.
type UnitOfWork interface {
	Within(context.Context, func(Transaction) error) error
}

type Transaction interface {
	CreateProject(context.Context, Project) error
	CreateWorkItem(context.Context, WorkItem) error
	LoadIdempotency(context.Context, domain.ActorID, domain.ProjectID, string, string) (Idempotency, error)
	LoadCommandResult(context.Context, domain.ProjectID, string) (CommandResult, error)
	LoadWorkItem(context.Context, domain.ProjectID, domain.WorkItemID) (domain.WorkItem, error)
	LoadCompletionMaterial(context.Context, CompletionMaterialQuery) (CompletionMaterial, error)
	UpdateWorkItem(context.Context, domain.WorkItem, uint64) error
	CreateRun(context.Context, Run) error
	StoreACRevision(context.Context, ACRevision) error
	RequireACRevision(context.Context, ACRequirement) error
	StoreDependencyRevision(context.Context, DependencyRevision) error
	StoreCandidate(context.Context, Candidate) error
	StoreArtifact(context.Context, Artifact) error
	BindCandidateArtifact(context.Context, domain.ProjectID, domain.CandidateID, domain.Digest) error
	StoreEvidence(context.Context, Evidence) error
	StoreReview(context.Context, Review) error
	StoreApproval(context.Context, Approval) error
	StoreCompletion(context.Context, Completion) error
	ConsumeApproval(context.Context, ApprovalConsumption) error
	StoreCommandResult(context.Context, CommandResult) error
	StoreIdempotency(context.Context, Idempotency) error
	AppendAudit(context.Context, AuditEntry) (uint64, error)
	EnqueueOutbox(context.Context, OutboxIntent) error
	AppendProjectionEvent(context.Context, ProjectionEvent) (Cursor, error)
}

type Run struct {
	ID                  domain.RunID
	ProjectID           domain.ProjectID
	WorkItemID          domain.WorkItemID
	InputDigest         domain.Digest
	AdapterID           string
	AdapterVersion      string
	ScenarioID          string
	Attempt             uint64
	DesiredAction       string
	DispatchState       string
	ObservedState       string
	ReconciliationState string
	SideEffectOutcome   string
	CreatedAtNS         int64
}

type ACRevision struct {
	ID          string
	ProjectID   domain.ProjectID
	ACID        domain.ACID
	Digest      domain.Digest
	Content     []byte
	CreatedAtNS int64
}

type ACRequirement struct {
	ProjectID      domain.ProjectID
	WorkItemID     domain.WorkItemID
	ACID           domain.ACID
	RevisionDigest domain.Digest
}

type DependencyRevision struct {
	ProjectID   domain.ProjectID
	Digest      domain.Digest
	Content     []byte
	CreatedAtNS int64
}

type Candidate struct {
	ID                 domain.CandidateID
	ProjectID          domain.ProjectID
	RunID              domain.RunID
	Digest             domain.Digest
	InputSubjectDigest domain.Digest
	CreatedAtNS        int64
}

type Artifact struct {
	Digest       domain.Digest
	MediaType    string
	ByteLength   uint64
	StorageKey   string
	Availability string
}

type Evidence struct {
	ID                domain.EvidenceID
	ProjectID         domain.ProjectID
	SubjectDigest     domain.Digest
	ACID              domain.ACID
	ACRevisionDigest  domain.Digest
	Verdict           string
	Applicability     string
	Availability      string
	VerifierClass     string
	VerifierActor     domain.ActorID
	VerifierRole      string
	RecipeDigest      domain.Digest
	EnvironmentDigest domain.Digest
	ArtifactDigest    domain.Digest
}

type Review struct {
	ID            domain.ReviewID
	ProjectID     domain.ProjectID
	SubjectDigest domain.Digest
	Verdict       string
	Reviewer      domain.ActorID
	Independent   bool
	CreatedAtNS   int64
}

type Approval struct {
	ID            domain.ApprovalID
	ProjectID     domain.ProjectID
	SubjectDigest domain.Digest
	CommandKind   string
	Actor         domain.ActorID
	ExpiresAtNS   int64
}

type CompletionMaterialQuery struct {
	ProjectID           domain.ProjectID
	WorkItemID          domain.WorkItemID
	CandidateID         domain.CandidateID
	RunID               domain.RunID
	SubjectDigest       domain.Digest
	GraphRevisionDigest domain.Digest
}

type CompletionMaterial struct {
	WorkItem            domain.WorkItem
	Candidate           Candidate
	Run                 Run
	CandidatePresent    bool
	CandidateAvailable  bool
	RunPresent          bool
	ActiveOrUnknownRun  bool
	RequiredACRevisions []ACRequirement
	GraphRevisionDigest domain.Digest
	Evidence            []Evidence
	Reviews             []Review
	Approvals           []Approval
	Artifacts           []Artifact
}

type Completion struct {
	Item         domain.WorkItem
	Record       domain.CompletionRecord
	Actor        domain.ActorID
	TimestampNS  int64
	EvidenceIDs  []domain.EvidenceID
	ReviewIDs    []domain.ReviewID
	ApprovalIDs  []domain.ApprovalID
	Consumptions []ApprovalConsumption
}
type ApprovalConsumption struct {
	ID                 string
	ProjectID          domain.ProjectID
	CompletionRecordID domain.CompletionRecordID
	ApprovalID         domain.ApprovalID
	CommandID          string
	SubjectDigest      domain.Digest
	Actor              domain.ActorID
	TimestampNS        int64
}
type CommandResult struct {
	ID          string
	ProjectID   domain.ProjectID
	Digest      domain.Digest
	Payload     []byte
	TimestampNS int64
}
type Idempotency struct {
	Principal     domain.ActorID
	ProjectID     domain.ProjectID
	Operation     string
	Key           string
	RequestDigest domain.Digest
	CommandID     string
	ExpiresAtNS   int64
	Tombstoned    bool
}
type AuditEntry struct {
	GroupID       string
	CommandID     string
	ProjectID     domain.ProjectID
	Actor         domain.ActorID
	Operation     string
	SubjectDigest domain.Digest
	BeforeDigest  domain.Digest
	AfterDigest   domain.Digest
	TimestampNS   int64
}
type OutboxIntent struct {
	ID            string
	CommandID     string
	AuditGroupID  string
	ProjectID     domain.ProjectID
	RunID         domain.RunID
	PayloadDigest domain.Digest
	TimestampNS   int64
}
type ProjectionEvent struct {
	ProjectID     domain.ProjectID
	Epoch         uint64
	Sequence      uint64
	PayloadDigest domain.Digest
	Payload       []byte
	AuditSequence uint64
}

type Cursor struct {
	Epoch    uint64
	Sequence uint64
}
