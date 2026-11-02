package port

import (
	"context"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var ErrWorkItemDetailCapacity = errors.New("work item detail capacity exceeded")

// WorkItemDetailReader is an optional snapshot projection of stored history,
// never completion authority. Unrecorded fields have no representation here.
type WorkItemDetailReader interface {
	ReadWorkItemDetail(context.Context, domain.ProjectID, domain.WorkItemID) (WorkItemDetail, error)
}
type WorkItemDetail struct {
	Summary           BoardWorkItem
	Material          WorkItemMaterialIndex
	Blockers          []DetailBlocker
	Reviews           []DetailReview
	Evidence          []DetailEvidence
	Approvals         []DetailApproval
	CompletionRecords []DetailCompletionRecord
	Audit             []DetailAuditEntry
}
type DetailBlocker struct {
	ID           string
	Reason       string
	ResolvedAtNS *int64
}
type DetailReview struct {
	ID            string
	SubjectDigest domain.Digest
	ReviewerID    string
	Independent   bool
	Verdict       string
	CreatedAtNS   int64
	HumanReportID string
}
type DetailEvidence struct {
	ID                   string
	SubjectDigest        domain.Digest
	ACID                 string
	ACRevisionDigest     domain.Digest
	Verdict              string
	Applicability        string
	Availability         string
	VerifierClass        string
	VerifierActor        string
	VerifierRole         string
	RecipeDigest         domain.Digest
	EnvironmentDigest    domain.Digest
	ReportArtifactDigest *domain.Digest
	HumanReportID        string
}
type DetailApproval struct {
	ID                 string
	SubjectDigest      domain.Digest
	ActorID            string
	ExpiresAtNS        int64
	ConsumedAtNS       *int64
	CompletionRecordID string
}
type DetailCompletionRecord struct {
	ID            string
	SubjectDigest domain.Digest
	ResultVersion uint64
	CompletedBy   string
	CompletedAtNS int64
	EvidenceIDs   []string
	ReviewIDs     []string
	ApprovalIDs   []string
}
type DetailAuditEntry struct {
	Sequence      uint64
	GroupID       string
	CommandID     string
	ActorID       string
	Operation     string
	SubjectDigest domain.Digest
	BeforeDigest  *domain.Digest
	AfterDigest   *domain.Digest
	OccurredAtNS  int64
	RunID         domain.RunID
}
