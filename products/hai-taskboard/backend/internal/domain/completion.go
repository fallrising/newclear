package domain

import (
	"errors"
	"slices"
	"strings"
	"time"
)

type EvidenceState string

const (
	EvidencePassed       EvidenceState = "Passed"
	EvidenceFailed       EvidenceState = "Failed"
	EvidenceSkipped      EvidenceState = "Skipped"
	EvidenceNotRun       EvidenceState = "NotRun"
	EvidenceUnknown      EvidenceState = "Unknown"
	EvidenceError        EvidenceState = "Error"
	EvidenceInconclusive EvidenceState = "Inconclusive"
)

type EvidenceApplicability string

const (
	EvidenceCurrent    EvidenceApplicability = "Current"
	EvidenceStale      EvidenceApplicability = "Stale"
	EvidenceSuperseded EvidenceApplicability = "Superseded"
)

type EvidenceAvailability string

const (
	EvidencePresent     EvidenceAvailability = "Present"
	EvidenceUnavailable EvidenceAvailability = "Unavailable"
)

type EvidenceConfig struct {
	ID            EvidenceID
	SubjectDigest Digest
	CheckID       CheckID
	State         EvidenceState
	Applicability EvidenceApplicability
	Availability  EvidenceAvailability
	VerifierActor ActorID
	VerifierRole  string
	VerifierClass string
}

type Evidence struct {
	id            EvidenceID
	subjectDigest Digest
	checkID       CheckID
	state         EvidenceState
	applicability EvidenceApplicability
	availability  EvidenceAvailability
	verifierActor ActorID
	verifierRole  string
	verifierClass string
}

func NewEvidence(config EvidenceConfig) (Evidence, error) {
	if !validStableID(string(config.ID)) || config.SubjectDigest.IsZero() || !validStableID(string(config.CheckID)) ||
		!validStableID(string(config.VerifierActor)) || config.VerifierRole == "" || config.VerifierClass == "" ||
		!config.State.valid() || !config.Applicability.valid() || !config.Availability.valid() {
		return Evidence{}, errors.New("invalid evidence")
	}
	return Evidence{
		id: config.ID, subjectDigest: config.SubjectDigest, checkID: config.CheckID,
		state: config.State, applicability: config.Applicability, availability: config.Availability,
		verifierActor: config.VerifierActor, verifierRole: config.VerifierRole, verifierClass: config.VerifierClass,
	}, nil
}

func (state EvidenceState) valid() bool {
	return state == EvidencePassed || state == EvidenceFailed || state == EvidenceSkipped ||
		state == EvidenceNotRun || state == EvidenceUnknown || state == EvidenceError || state == EvidenceInconclusive
}

func (applicability EvidenceApplicability) valid() bool {
	return applicability == EvidenceCurrent || applicability == EvidenceStale || applicability == EvidenceSuperseded
}

func (availability EvidenceAvailability) valid() bool {
	return availability == EvidencePresent || availability == EvidenceUnavailable
}

func (evidence Evidence) ID() EvidenceID                       { return evidence.id }
func (evidence Evidence) SubjectDigest() Digest                { return evidence.subjectDigest }
func (evidence Evidence) CheckID() CheckID                     { return evidence.checkID }
func (evidence Evidence) State() EvidenceState                 { return evidence.state }
func (evidence Evidence) Applicability() EvidenceApplicability { return evidence.applicability }
func (evidence Evidence) Availability() EvidenceAvailability   { return evidence.availability }
func (evidence Evidence) VerifierActor() ActorID               { return evidence.verifierActor }
func (evidence Evidence) VerifierRole() string                 { return evidence.verifierRole }
func (evidence Evidence) VerifierClass() string                { return evidence.verifierClass }

type ReviewVerdict string

const (
	ReviewApproved ReviewVerdict = "Approved"
	ReviewRejected ReviewVerdict = "Rejected"
)

type Review struct {
	id            ReviewID
	subjectDigest Digest
	verdict       ReviewVerdict
	reviewer      ActorID
	independent   bool
}

func NewReview(id ReviewID, subjectDigest Digest, verdict ReviewVerdict, reviewer ActorID, independent bool) (Review, error) {
	if !validStableID(string(id)) || subjectDigest.IsZero() || !validStableID(string(reviewer)) || (verdict != ReviewApproved && verdict != ReviewRejected) {
		return Review{}, errors.New("invalid review")
	}
	return Review{id: id, subjectDigest: subjectDigest, verdict: verdict, reviewer: reviewer, independent: independent}, nil
}

func (review Review) ID() ReviewID           { return review.id }
func (review Review) SubjectDigest() Digest  { return review.subjectDigest }
func (review Review) Verdict() ReviewVerdict { return review.verdict }
func (review Review) Reviewer() ActorID      { return review.reviewer }
func (review Review) Independent() bool      { return review.independent }

type Approval struct {
	id            ApprovalID
	subjectDigest Digest
	command       CommandKind
	actor         ActorID
	expiresAt     time.Time
}

func NewApproval(id ApprovalID, subjectDigest Digest, command CommandKind, actor ActorID, expiresAt time.Time) (Approval, error) {
	if !validStableID(string(id)) || subjectDigest.IsZero() || command == "" || !validStableID(string(actor)) || expiresAt.IsZero() {
		return Approval{}, errors.New("invalid approval")
	}
	return Approval{id: id, subjectDigest: subjectDigest, command: command, actor: actor, expiresAt: expiresAt}, nil
}

func (approval Approval) ID() ApprovalID        { return approval.id }
func (approval Approval) SubjectDigest() Digest { return approval.subjectDigest }
func (approval Approval) Command() CommandKind  { return approval.command }
func (approval Approval) Actor() ActorID        { return approval.actor }
func (approval Approval) ExpiresAt() time.Time  { return approval.expiresAt }

type CheckRequirement struct {
	CheckID                   CheckID
	VerifierClass             string
	Independent               bool
	ProhibitedVerifierActor   ActorID
	ProhibitedVerifierRunRole string
}

type CompletionInput struct {
	WorkItem           WorkItem
	ExpectedVersion    uint64
	RequestedSubject   CompletionSubject
	CurrentSubject     CompletionSubject
	CandidatePresent   bool
	CandidateAvailable bool
	ActiveOrUnknownRun bool
	RequiredChecks     []CheckRequirement
	Evidence           []Evidence
	Review             *Review
	ApprovalRequired   bool
	Approval           *Approval
	Now                time.Time
	RecordID           CompletionRecordID
}

type GateError struct {
	codes []RejectionCode
}

func (gateError GateError) Error() string {
	parts := make([]string, len(gateError.codes))
	for index, code := range gateError.codes {
		parts[index] = string(code)
	}
	return "completion rejected: " + strings.Join(parts, ",")
}

func (gateError GateError) Codes() []RejectionCode { return slices.Clone(gateError.codes) }

type CompletionRecord struct {
	id            CompletionRecordID
	workItemID    WorkItemID
	subjectDigest Digest
	resultVersion uint64
}

func (record CompletionRecord) ID() CompletionRecordID { return record.id }
func (record CompletionRecord) WorkItemID() WorkItemID { return record.workItemID }
func (record CompletionRecord) SubjectDigest() Digest  { return record.subjectDigest }
func (record CompletionRecord) ResultVersion() uint64  { return record.resultVersion }

type CompletionResult struct {
	WorkItem WorkItem
	Record   CompletionRecord
}

// CompleteWorkItem is an atomic value operation: either it returns both the
// next aggregate and its immutable proof, or it returns neither.
func CompleteWorkItem(input CompletionInput) (CompletionResult, error) {
	codes := EvaluateCompletion(input)
	if len(codes) > 0 {
		return CompletionResult{}, GateError{codes: codes}
	}

	next := input.WorkItem.clone()
	next.phase = PhaseDone
	next.version++
	record := CompletionRecord{
		id: input.RecordID, workItemID: next.id,
		subjectDigest: input.RequestedSubject.Digest(), resultVersion: next.version,
	}
	return CompletionResult{WorkItem: next, Record: record}, nil
}

func EvaluateCompletion(input CompletionInput) []RejectionCode {
	codes := make([]RejectionCode, 0)
	add := func(code RejectionCode) {
		if !slices.Contains(codes, code) {
			codes = append(codes, code)
		}
	}

	if input.WorkItem.phase != PhaseQA {
		add(CodePhaseNotQA)
	}
	if input.ExpectedVersion != input.WorkItem.version {
		add(CodeVersionConflict)
	}
	if len(input.WorkItem.blockers) > 0 {
		add(CodeActiveBlocker)
	}
	if input.ActiveOrUnknownRun {
		add(CodeActiveOrUnknownRun)
	}
	if !input.CandidatePresent {
		add(CodeCandidateMissing)
	} else if !input.CandidateAvailable {
		add(CodeCandidateUnavailable)
	}
	requestedDigest := input.RequestedSubject.Digest()
	if requestedDigest != input.CurrentSubject.Digest() ||
		input.RequestedSubject.ProjectID() != input.WorkItem.projectID ||
		input.RequestedSubject.WorkItemID() != input.WorkItem.id ||
		input.RequestedSubject.WorkItemVersion() != input.WorkItem.version {
		add(CodeSubjectStale)
	}

	if input.Review == nil || input.Review.subjectDigest != requestedDigest {
		add(CodeReviewMissing)
	} else {
		if input.Review.verdict != ReviewApproved {
			add(CodeReviewRejected)
		}
		if !input.Review.independent {
			add(CodeVerifierNotIndependent)
		}
	}

	for _, requirement := range input.RequiredChecks {
		matching := make([]Evidence, 0)
		for _, evidence := range input.Evidence {
			if evidence.checkID == requirement.CheckID && evidence.subjectDigest == requestedDigest &&
				evidence.verifierClass == requirement.VerifierClass {
				matching = append(matching, evidence)
			}
		}
		if len(matching) == 0 {
			add(CodeEvidenceMissing)
			continue
		}
		for _, evidence := range matching {
			if evidence.availability != EvidencePresent {
				add(CodeEvidenceUnavailable)
			}
			if evidence.applicability != EvidenceCurrent {
				add(CodeEvidenceStale)
			}
			if evidence.state != EvidencePassed {
				add(CodeEvidenceNonpassing)
			}
			if requirement.Independent &&
				((requirement.ProhibitedVerifierActor != "" && evidence.verifierActor == requirement.ProhibitedVerifierActor) ||
					(requirement.ProhibitedVerifierRunRole != "" && evidence.verifierRole == requirement.ProhibitedVerifierRunRole)) {
				add(CodeVerifierNotIndependent)
			}
		}
	}

	if input.ApprovalRequired {
		if input.Approval == nil || input.Approval.subjectDigest != requestedDigest ||
			input.Approval.command != CommandCompleteWorkItem {
			add(CodeApprovalMissing)
		} else if !input.Approval.expiresAt.After(input.Now) {
			add(CodeApprovalExpired)
		}
	}
	if input.RecordID == "" {
		add(CodeCompletionRecordMissing)
	}

	return codes
}

type DoneApplicability string

const (
	DoneCurrent DoneApplicability = "Current"
	DoneStale   DoneApplicability = "Stale"
)

func CompletionApplicability(record CompletionRecord, current CompletionSubject) DoneApplicability {
	if record.subjectDigest == current.Digest() {
		return DoneCurrent
	}
	return DoneStale
}

func ValidateCandidatePublication(currentRunInput, publicationRunInput Digest) error {
	if currentRunInput != publicationRunInput {
		return Rejection{Code: CodeSubjectStale}
	}
	return nil
}
