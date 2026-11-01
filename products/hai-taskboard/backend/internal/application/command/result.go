package command

import (
	"bytes"
	json "encoding/json/v2"
	"errors"
	"regexp"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

const (
	CodeInvalidRequest        = "invalid_request"
	CodeUnauthenticated       = "unauthenticated"
	CodePermissionDenied      = "permission_denied"
	CodeNotFound              = "not_found"
	CodeVersionConflict       = "version_conflict"
	CodeIdempotencyConflict   = "idempotency_conflict"
	CodeIdempotencyExpired    = "idempotency_expired"
	CodeStaleSubject          = "stale_subject"
	CodePolicyRejected        = "policy_rejected"
	CodeImpactPlanStale       = "impact_plan_stale"
	CodeLifecycleRejected     = "lifecycle_rejected"
	CodeDoneGateUnsatisfied   = "done_gate_unsatisfied"
	CodeCapabilityUnsupported = "capability_unsupported"
	CodeOutcomeUnknown        = "outcome_unknown"
	CodeStorageCorruption     = "storage_corruption"
	CodeProjectionUnavailable = "projection_unavailable"
)

var runIDPattern = regexp.MustCompile(`^run_[0-9A-HJKMNP-TV-Z]{10,26}$`)

type Error struct {
	Code      string
	Message   string
	Retryable bool
	Reasons   []domain.RejectionCode
	cause     error
}

func (err *Error) Error() string { return err.Message }
func (err *Error) Unwrap() error { return err.cause }

func NewError(code, message string, retryable bool, reasons []domain.RejectionCode, cause error) *Error {
	return &Error{Code: code, Message: message, Retryable: retryable, Reasons: slices.Clone(reasons), cause: cause}
}

type successEnvelope struct {
	APIVersion       string         `json:"api_version"`
	OK               bool           `json:"ok"`
	Command          successCommand `json:"command"`
	Result           successResult  `json:"result"`
	Audit            successAudit   `json:"audit"`
	ProjectionCursor successCursor  `json:"projection_cursor"`
	CorrelationID    string         `json:"correlation_id"`
}

type successCommand struct {
	CommandID string    `json:"command_id"`
	Operation Operation `json:"operation"`
	Status    string    `json:"status"`
	Replayed  bool      `json:"replayed"`
}

type successResult struct {
	ReportID                string            `json:"report_id,omitempty"`
	ReportKind              string            `json:"report_kind,omitempty"`
	AcceptedRevisionDigest  string            `json:"accepted_revision_digest,omitempty"`
	AcceptanceSubjectDigest string            `json:"acceptance_subject_digest,omitempty"`
	ProposalDigest          string            `json:"proposal_digest,omitempty"`
	GraphDigest             string            `json:"graph_revision_digest,omitempty"`
	ObjectFormat            string            `json:"object_format,omitempty"`
	CommitOID               string            `json:"commit_oid,omitempty"`
	Type                    string            `json:"type"`
	ProjectID               domain.ProjectID  `json:"project_id,omitempty"`
	WorkItemID              domain.WorkItemID `json:"work_item_id,omitempty"`
	RunID                   domain.RunID      `json:"run_id,omitempty"`
	Version                 uint64            `json:"version,omitzero"`
	Phase                   domain.Phase      `json:"phase,omitempty"`
	Reason                  string            `json:"reason,omitempty"`
	SubjectDigest           string            `json:"subject_digest,omitempty"`
}

type successAudit struct {
	Sequence uint64 `json:"sequence"`
}

type successCursor struct {
	StreamEpoch   uint64 `json:"stream_epoch"`
	EventSequence uint64 `json:"event_sequence"`
}

type failureEnvelope struct {
	APIVersion    string      `json:"api_version"`
	OK            bool        `json:"ok"`
	CommandID     string      `json:"command_id"`
	Error         failureBody `json:"error"`
	CorrelationID string      `json:"correlation_id"`
}

type failureBody struct {
	Code      string          `json:"code"`
	Message   string          `json:"message"`
	Retryable bool            `json:"retryable"`
	Details   *failureDetails `json:"details,omitempty"`
}

type failureDetails struct {
	Reasons []domain.RejectionCode `json:"reasons"`
}

func CanonicalSuccess(metadata Metadata, operation Operation, result Result, auditSequence uint64, cursor port.Cursor) ([]byte, error) {
	if !commandIDPattern.MatchString(metadata.CommandID) || !validText(metadata.CorrelationID, 80) ||
		!validSuccessResult(operation, wireResult(result)) || auditSequence == 0 || cursor.Epoch == 0 || cursor.Sequence == 0 {
		return nil, ErrInvalidCommand
	}
	return json.Marshal(successEnvelope{
		APIVersion: "v1", OK: true,
		Command:          successCommand{CommandID: metadata.CommandID, Operation: operation, Status: "recorded", Replayed: false},
		Result:           wireResult(result),
		Audit:            successAudit{Sequence: auditSequence},
		ProjectionCursor: successCursor{StreamEpoch: cursor.Epoch, EventSequence: cursor.Sequence},
		CorrelationID:    metadata.CorrelationID,
	})
}

func wireResult(result Result) successResult {
	wire := successResult{ReportID: result.ReportID, ReportKind: result.ReportKind, AcceptedRevisionDigest: result.AcceptedRevisionDigest, AcceptanceSubjectDigest: result.AcceptanceSubjectDigest, Type: result.Type, ProjectID: result.ProjectID, WorkItemID: result.WorkItemID, RunID: result.RunID, Version: result.Version, Phase: result.Phase, ProposalDigest: result.ProposalDigest, GraphDigest: result.GraphDigest, ObjectFormat: result.ObjectFormat, CommitOID: result.CommitOID, Reason: result.Reason}
	if !result.SubjectDigest.IsZero() {
		wire.SubjectDigest = canonicalSHA256(result.SubjectDigest)
	}
	return wire
}

func CanonicalFailure(metadata Metadata, failure *Error) ([]byte, error) {
	if !commandIDPattern.MatchString(metadata.CommandID) || !validText(metadata.CorrelationID, 80) || failure == nil ||
		!validFailureCode(failure.Code) || !validText(failure.Message, 1000) || !validReasons(failure.Reasons) {
		return nil, ErrInvalidCommand
	}
	body := failureBody{Code: failure.Code, Message: failure.Message, Retryable: failure.Retryable}
	if len(failure.Reasons) > 0 {
		body.Details = &failureDetails{Reasons: slices.Clone(failure.Reasons)}
	}
	return json.Marshal(failureEnvelope{
		APIVersion: "v1", OK: false, CommandID: metadata.CommandID, Error: body, CorrelationID: metadata.CorrelationID,
	})
}

// DecodeCanonicalResult validates the application-owned fields required to
// distinguish a stored success from a stored failure. Digest verification is
// the persistence adapter's responsibility; malformed canonical bytes are
// storage corruption rather than a reason to re-execute the command.
func DecodeCanonicalResult(payload []byte, commandID string, operation Operation) (*Error, error) {
	if !commandIDPattern.MatchString(commandID) || !validOperation(operation) {
		return nil, errors.New("invalid canonical command identity")
	}
	var discriminator struct {
		APIVersion string `json:"api_version"`
		OK         *bool  `json:"ok"`
	}
	if err := json.Unmarshal(payload, &discriminator); err != nil || discriminator.APIVersion != "v1" || discriminator.OK == nil {
		return nil, errors.New("invalid canonical command result")
	}
	if *discriminator.OK {
		var success successEnvelope
		if err := json.Unmarshal(payload, &success, json.RejectUnknownMembers(true)); err != nil ||
			success.Command.CommandID != commandID || success.Command.Operation != operation ||
			!commandIDPattern.MatchString(success.Command.CommandID) || success.Command.Status != "recorded" ||
			success.Command.Replayed || !validSuccessResult(operation, success.Result) ||
			success.Audit.Sequence == 0 || success.ProjectionCursor.StreamEpoch == 0 ||
			success.ProjectionCursor.EventSequence == 0 || !validText(success.CorrelationID, 80) ||
			!canonicalBytes(payload, success) {
			return nil, errors.New("invalid canonical command success")
		}
		return nil, nil
	}
	var failure failureEnvelope
	if err := json.Unmarshal(payload, &failure, json.RejectUnknownMembers(true)); err != nil ||
		failure.CommandID != commandID || !commandIDPattern.MatchString(failure.CommandID) ||
		!validFailureCode(failure.Error.Code) || !validText(failure.Error.Message, 1000) ||
		!validText(failure.CorrelationID, 80) || !validFailureDetails(failure.Error.Details) ||
		!canonicalBytes(payload, failure) {
		return nil, errors.New("invalid canonical command failure")
	}
	var reasons []domain.RejectionCode
	if failure.Error.Details != nil {
		reasons = slices.Clone(failure.Error.Details.Reasons)
	}
	return NewError(failure.Error.Code, failure.Error.Message, failure.Error.Retryable, reasons, nil), nil
}

func canonicalBytes(payload []byte, value any) bool {
	encoded, err := json.Marshal(value)
	return err == nil && bytes.Equal(payload, encoded)
}

func validOperation(operation Operation) bool {
	switch operation {
	case SubmitHumanReportOperation, AcceptInitialSpecificationOperation, ProposeSpecificationOperation, CreateProjectOperation, CreateWorkItemOperation, MarkReadyOperation, DispatchRunOperation,
		SubmitCandidateOperation, PublishReviewOperation, PublishEvidenceOperation, ApproveSubjectOperation,
		RequestQAOperation, RequestCancelOperation, RequestReworkOperation, CompleteWorkItemOperation:
		return true
	default:
		return false
	}
}

func validSuccessResult(operation Operation, result successResult) bool {
	if operation != SubmitHumanReportOperation && (result.ReportID != "" || result.ReportKind != "") {
		return false
	}
	if operation != AcceptInitialSpecificationOperation && (result.AcceptedRevisionDigest != "" || result.AcceptanceSubjectDigest != "") {
		return false
	}
	if operation != ProposeSpecificationOperation && operation != AcceptInitialSpecificationOperation && (result.ProposalDigest != "" || result.GraphDigest != "" || result.ObjectFormat != "" || result.CommitOID != "") {
		return false
	}
	if operation != RequestReworkOperation && (result.Reason != "" || result.SubjectDigest != "") {
		return false
	}
	projectValid := projectIDPattern.MatchString(string(result.ProjectID))
	workItemValid := workItemIDPattern.MatchString(string(result.WorkItemID))
	switch operation {
	case SubmitHumanReportOperation:
		return result.Type == "HumanReportSubmitted" && projectValid && workItemValid && runIDPattern.MatchString(string(result.RunID)) && result.Version > 0 && port.ValidHumanReportID(result.ReportID) && (result.ReportKind == "review" && result.Phase == domain.PhaseReview || result.ReportKind == "evidence" && (result.Phase == domain.PhaseReview || result.Phase == domain.PhaseQA))
	case AcceptInitialSpecificationOperation:
		validDigest := func(s string) bool {
			d, e := domain.ParseDigest(strings.TrimPrefix(s, "sha256:"))
			return e == nil && !d.IsZero() && canonicalSHA256(d) == s
		}
		return result.Type == "InitialSpecificationAccepted" && projectValid && result.WorkItemID == "" && result.RunID == "" && result.Phase == "" && result.Version > 0 && result.ObjectFormat == "" && result.CommitOID == "" && validDigest(result.ProposalDigest) && validDigest(result.GraphDigest) && validDigest(result.AcceptedRevisionDigest) && validDigest(result.AcceptanceSubjectDigest)
	case ProposeSpecificationOperation:
		_, oidErr := specification.ParseObjectID(specification.ObjectFormat(result.ObjectFormat), result.CommitOID)
		pd, pe := domain.ParseDigest(strings.TrimPrefix(result.ProposalDigest, "sha256:"))
		gd, ge := domain.ParseDigest(strings.TrimPrefix(result.GraphDigest, "sha256:"))
		return result.Type == "SpecificationProposed" && projectValid && result.WorkItemID == "" && result.RunID == "" && result.Phase == "" && result.Version > 0 && pe == nil && ge == nil && !pd.IsZero() && !gd.IsZero() && canonicalSHA256(pd) == result.ProposalDigest && canonicalSHA256(gd) == result.GraphDigest && oidErr == nil
	case CreateProjectOperation:
		return result.Type == "ProjectCreated" && projectValid && result.WorkItemID == "" && result.RunID == "" &&
			result.Version > 0 && result.Phase == ""
	case CreateWorkItemOperation:
		return result.Type == "WorkItemCreated" && projectValid && workItemValid && result.RunID == "" &&
			result.Version > 0 && result.Phase == domain.PhaseDraft
	case MarkReadyOperation:
		return result.Type == "WorkItemReady" && projectValid && workItemValid && result.RunID == "" &&
			result.Version > 0 && result.Phase == domain.PhaseReady
	case DispatchRunOperation:
		return result.Type == "RunDispatched" && projectValid && workItemValid &&
			runIDPattern.MatchString(string(result.RunID)) && result.Version > 0 && result.Phase == domain.PhaseDeveloping
	case SubmitCandidateOperation:
		return result.Type == "CandidateSubmitted" && projectValid && workItemValid &&
			runIDPattern.MatchString(string(result.RunID)) && result.Version > 0 && result.Phase == domain.PhaseReview
	case PublishReviewOperation:
		return result.Type == "FixtureReviewPublished" && projectValid && workItemValid &&
			runIDPattern.MatchString(string(result.RunID)) && result.Version > 0 && result.Phase == domain.PhaseReview
	case PublishEvidenceOperation:
		return result.Type == "FixtureEvidencePublished" && projectValid && workItemValid &&
			runIDPattern.MatchString(string(result.RunID)) && result.Version > 0 &&
			(result.Phase == domain.PhaseReview || result.Phase == domain.PhaseQA)
	case ApproveSubjectOperation:
		return result.Type == "SubjectApproved" && projectValid && workItemValid && result.RunID == "" &&
			result.Version > 0 && (result.Phase == domain.PhaseReview || result.Phase == domain.PhaseQA)
	case RequestQAOperation:
		return result.Type == "QARequested" && projectValid && workItemValid && result.RunID == "" && result.Version > 0 && result.Phase == domain.PhaseQA
	case RequestCancelOperation:
		return result.Type == "CancellationRequested" && projectValid && workItemValid &&
			runIDPattern.MatchString(string(result.RunID)) && result.Version > 0 && (result.Phase == domain.PhaseDeveloping || result.Phase == domain.PhaseReview || result.Phase == domain.PhaseQA)
	case RequestReworkOperation:
		subject, err := domain.ParseDigest(strings.TrimPrefix(result.SubjectDigest, "sha256:"))
		return result.Type == "ReworkRequested" && projectValid && workItemValid && result.RunID == "" && result.Version > 0 &&
			result.Phase == domain.PhaseDeveloping && ValidReworkReason(result.Reason) && err == nil && !subject.IsZero() && canonicalSHA256(subject) == result.SubjectDigest
	case CompleteWorkItemOperation:
		return result.Type == "WorkItemCompleted" && projectValid && workItemValid && result.RunID == "" &&
			result.Version > 0 && result.Phase == domain.PhaseDone
	default:
		return false
	}
}

func validFailureCode(code string) bool {
	switch code {
	case CodeInvalidRequest, CodeUnauthenticated, CodePermissionDenied, CodeNotFound, CodeVersionConflict,
		CodeIdempotencyConflict, CodeIdempotencyExpired, CodeStaleSubject, CodeImpactPlanStale,
		CodeLifecycleRejected, CodeDoneGateUnsatisfied, CodeCapabilityUnsupported, CodeOutcomeUnknown,
		CodeStorageCorruption, CodeProjectionUnavailable:
		return true
	default:
		return false
	}
}

func validFailureDetails(details *failureDetails) bool {
	return details == nil || len(details.Reasons) > 0 && validReasons(details.Reasons)
}

func validReasons(reasons []domain.RejectionCode) bool {
	if len(reasons) > 32 {
		return false
	}
	seen := make(map[domain.RejectionCode]struct{}, len(reasons))
	for _, reason := range reasons {
		if !validRejectionCode(reason) {
			return false
		}
		if _, duplicate := seen[reason]; duplicate {
			return false
		}
		seen[reason] = struct{}{}
	}
	return true
}

func validRejectionCode(code domain.RejectionCode) bool {
	switch code {
	case domain.CodePhaseNotQA, domain.CodeActiveBlocker, domain.CodeActiveOrUnknownRun,
		domain.CodeCandidateMissing, domain.CodeCandidateUnavailable, domain.CodeSubjectStale,
		domain.CodeReviewMissing, domain.CodeReviewRejected, domain.CodeEvidenceMissing,
		domain.CodeEvidenceNonpassing, domain.CodeEvidenceStale, domain.CodeEvidenceUnavailable,
		domain.CodeVerifierNotIndependent, domain.CodeApprovalMissing, domain.CodeApprovalExpired,
		domain.CodeVersionConflict, domain.CodeIdempotencyConflict, domain.CodeIdempotencyExpired,
		domain.CodeInvalidTransition, domain.CodeAcceptedACMissing, domain.CodeSpecificationInvalid,
		domain.CodeExplicitStartRequired, domain.CodeReworkReasonMissing, domain.CodeReopenReasonMissing,
		domain.CodeRunIdentityReused, domain.CodeCompletionRecordMissing:
		return true
	default:
		return false
	}
}
