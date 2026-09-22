package domain

import (
	"errors"
	"maps"
	"slices"
)

type Phase string

const (
	PhaseDraft      Phase = "Draft"
	PhaseReady      Phase = "Ready"
	PhaseDeveloping Phase = "Developing"
	PhaseReview     Phase = "Review"
	PhaseQA         Phase = "QA"
	PhaseDone       Phase = "Done"
	PhaseCanceled   Phase = "Canceled"
)

type WorkCondition string

const (
	ConditionBlocked        WorkCondition = "Blocked"
	ConditionDoneStale      WorkCondition = "Done-Stale"
	ConditionActiveRun      WorkCondition = "ActiveRun"
	ConditionOutcomeUnknown WorkCondition = "OutcomeUnknown"
)

type RejectionCode string

const (
	CodePhaseNotQA              RejectionCode = "phase_not_qa"
	CodeActiveBlocker           RejectionCode = "active_blocker"
	CodeActiveOrUnknownRun      RejectionCode = "active_or_unknown_run"
	CodeCandidateMissing        RejectionCode = "candidate_missing"
	CodeCandidateUnavailable    RejectionCode = "candidate_unavailable"
	CodeSubjectStale            RejectionCode = "subject_stale"
	CodeReviewMissing           RejectionCode = "review_missing"
	CodeReviewRejected          RejectionCode = "review_rejected"
	CodeEvidenceMissing         RejectionCode = "evidence_missing"
	CodeEvidenceNonpassing      RejectionCode = "evidence_nonpassing"
	CodeEvidenceStale           RejectionCode = "evidence_stale"
	CodeEvidenceUnavailable     RejectionCode = "evidence_unavailable"
	CodeVerifierNotIndependent  RejectionCode = "verifier_not_independent"
	CodeApprovalMissing         RejectionCode = "approval_missing"
	CodeApprovalExpired         RejectionCode = "approval_expired"
	CodeVersionConflict         RejectionCode = "version_conflict"
	CodeIdempotencyConflict     RejectionCode = "idempotency_conflict"
	CodeIdempotencyExpired      RejectionCode = "idempotency_expired"
	CodeInvalidTransition       RejectionCode = "invalid_transition"
	CodeAcceptedACMissing       RejectionCode = "accepted_ac_missing"
	CodeSpecificationInvalid    RejectionCode = "specification_invalid"
	CodeExplicitStartRequired   RejectionCode = "explicit_start_required"
	CodeReworkReasonMissing     RejectionCode = "rework_reason_missing"
	CodeReopenReasonMissing     RejectionCode = "reopen_reason_missing"
	CodeRunIdentityReused       RejectionCode = "run_identity_reused"
	CodeCompletionRecordMissing RejectionCode = "completion_record_id_missing"
)

type Rejection struct {
	Code RejectionCode
}

func (rejection Rejection) Error() string { return string(rejection.Code) }

type Blocker struct {
	ID     BlockerID
	Reason string
}

type WorkItem struct {
	id        WorkItemID
	projectID ProjectID
	phase     Phase
	version   uint64
	blockers  map[BlockerID]Blocker
}

func NewWorkItem(id WorkItemID, projectID ProjectID, phase Phase, version uint64) (WorkItem, error) {
	if !validStableID(string(id)) || !validStableID(string(projectID)) || version == 0 || !phase.Valid() || phase == PhaseDone {
		return WorkItem{}, errors.New("invalid work item")
	}
	return WorkItem{id: id, projectID: projectID, phase: phase, version: version, blockers: map[BlockerID]Blocker{}}, nil
}

func (phase Phase) Valid() bool {
	return phase == PhaseDraft || phase == PhaseReady || phase == PhaseDeveloping ||
		phase == PhaseReview || phase == PhaseQA || phase == PhaseDone || phase == PhaseCanceled
}

func (item WorkItem) ID() WorkItemID       { return item.id }
func (item WorkItem) ProjectID() ProjectID { return item.projectID }
func (item WorkItem) Phase() Phase         { return item.phase }
func (item WorkItem) Version() uint64      { return item.version }

func (item WorkItem) Blockers() []Blocker {
	ids := slices.Sorted(maps.Keys(item.blockers))
	result := make([]Blocker, 0, len(ids))
	for _, id := range ids {
		result = append(result, item.blockers[id])
	}
	return result
}

func (item WorkItem) Conditions(doneStale, activeRun, outcomeUnknown bool) []WorkCondition {
	conditions := make([]WorkCondition, 0, 4)
	if len(item.blockers) > 0 {
		conditions = append(conditions, ConditionBlocked)
	}
	if doneStale {
		conditions = append(conditions, ConditionDoneStale)
	}
	if activeRun {
		conditions = append(conditions, ConditionActiveRun)
	}
	if outcomeUnknown {
		conditions = append(conditions, ConditionOutcomeUnknown)
	}
	return conditions
}

func (item WorkItem) AddBlocker(expectedVersion uint64, blocker Blocker) (WorkItem, error) {
	if expectedVersion != item.version {
		return item, Rejection{Code: CodeVersionConflict}
	}
	if !validStableID(string(blocker.ID)) || blocker.Reason == "" {
		return item, errors.New("invalid blocker")
	}
	next := item.clone()
	next.blockers[blocker.ID] = blocker
	next.version++
	return next, nil
}

func (item WorkItem) RemoveBlocker(expectedVersion uint64, blockerID BlockerID) (WorkItem, error) {
	if expectedVersion != item.version {
		return item, Rejection{Code: CodeVersionConflict}
	}
	if _, exists := item.blockers[blockerID]; !exists {
		return item, errors.New("blocker not found")
	}
	next := item.clone()
	delete(next.blockers, blockerID)
	next.version++
	return next, nil
}

type TransitionGuards struct {
	ExpectedVersion             uint64
	HasAcceptedAC               bool
	SpecificationValid          bool
	ExplicitStart               bool
	RunStartAcknowledged        bool
	HasCurrentCandidate         bool
	RequiredReviewsApproved     bool
	ReworkReason                string
	ReopenReason                string
	FinalizeCancellationAllowed bool
}

func (item WorkItem) Transition(target Phase, guards TransitionGuards) (WorkItem, error) {
	if guards.ExpectedVersion != item.version {
		return item, Rejection{Code: CodeVersionConflict}
	}
	if !target.Valid() {
		return item, Rejection{Code: CodeInvalidTransition}
	}

	rejection := item.transitionRejection(target, guards)
	if rejection != "" {
		return item, Rejection{Code: rejection}
	}

	next := item.clone()
	next.phase = target
	next.version++
	return next, nil
}

func (item WorkItem) transitionRejection(target Phase, guards TransitionGuards) RejectionCode {
	switch {
	case item.phase == PhaseDraft && target == PhaseReady:
		if !guards.HasAcceptedAC {
			return CodeAcceptedACMissing
		}
		if !guards.SpecificationValid {
			return CodeSpecificationInvalid
		}
		return ""
	case item.phase == PhaseReady && target == PhaseDeveloping:
		if len(item.blockers) > 0 {
			return CodeActiveBlocker
		}
		if !guards.ExplicitStart && !guards.RunStartAcknowledged {
			return CodeExplicitStartRequired
		}
		return ""
	case item.phase == PhaseDeveloping && target == PhaseReview:
		if !guards.HasCurrentCandidate {
			return CodeCandidateMissing
		}
		return ""
	case item.phase == PhaseReview && target == PhaseQA:
		if !guards.RequiredReviewsApproved {
			return CodeReviewMissing
		}
		return ""
	case (item.phase == PhaseReview || item.phase == PhaseQA) && target == PhaseDeveloping:
		if guards.ReworkReason == "" {
			return CodeReworkReasonMissing
		}
		return ""
	case target == PhaseDone:
		return CodeInvalidTransition
	case item.phase == PhaseDone && (target == PhaseDraft || target == PhaseReady):
		if guards.ReopenReason == "" {
			return CodeReopenReasonMissing
		}
		return ""
	case item.phase != PhaseDone && item.phase != PhaseCanceled && target == PhaseCanceled:
		if !guards.FinalizeCancellationAllowed {
			return CodeActiveOrUnknownRun
		}
		return ""
	default:
		return CodeInvalidTransition
	}
}

func (item WorkItem) clone() WorkItem {
	item.blockers = maps.Clone(item.blockers)
	return item
}

type RunState string

const (
	RunDispatchRequested RunState = "DispatchRequested"
	RunRunning           RunState = "Running"
	RunSucceeded         RunState = "Succeeded"
	RunFailed            RunState = "Failed"
	RunNeedsReconcile    RunState = "NeedsReconcile"
	RunOutcomeUnknown    RunState = "OutcomeUnknown"
)

type Run struct {
	id          RunID
	workItemID  WorkItemID
	inputDigest Digest
	state       RunState
	attempt     uint64
}

func NewRun(id RunID, workItemID WorkItemID, inputDigest Digest) (Run, error) {
	if !validStableID(string(id)) || !validStableID(string(workItemID)) || inputDigest.IsZero() {
		return Run{}, errors.New("invalid run")
	}
	return Run{id: id, workItemID: workItemID, inputDigest: inputDigest, state: RunDispatchRequested, attempt: 1}, nil
}

func RetryRun(previous Run, newID RunID) (Run, error) {
	if !validStableID(string(newID)) || newID == previous.id {
		return Run{}, Rejection{Code: CodeRunIdentityReused}
	}
	return Run{
		id:          newID,
		workItemID:  previous.workItemID,
		inputDigest: previous.inputDigest,
		state:       RunDispatchRequested,
		attempt:     previous.attempt + 1,
	}, nil
}

func (run Run) ID() RunID              { return run.id }
func (run Run) WorkItemID() WorkItemID { return run.workItemID }
func (run Run) InputDigest() Digest    { return run.inputDigest }
func (run Run) State() RunState        { return run.state }
func (run Run) Attempt() uint64        { return run.attempt }
