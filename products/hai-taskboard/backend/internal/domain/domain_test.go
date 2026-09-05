package domain

import (
	"crypto/sha256"
	"encoding/hex"
	json "encoding/json"
	"slices"
	"testing"
	"time"
)

func TestCompletionSubject_CanonicalDigest(t *testing.T) {
	config := subjectConfig(7)
	config.RequiredACRevisions = []ACRevisionBinding{
		{ACID: "AC-02", RevisionDigest: HashString("ac-2")},
		{ACID: "AC-01", RevisionDigest: HashString("ac-1")},
	}
	subject, err := NewCompletionSubject(config)
	if err != nil {
		t.Fatal(err)
	}

	expected := "{" +
		"\"accepted_graph_revision_digest\":\"" + HashString("graph").String() + "\"," +
		"\"candidate_digest\":\"" + HashString("candidate").String() + "\"," +
		"\"candidate_id\":\"candidate-1\"," +
		"\"completion_recipe_digest\":\"" + HashString("recipe").String() + "\"," +
		"\"integration_base_digest\":\"" + HashString("base").String() + "\"," +
		"\"policy_revision_digest\":\"" + HashString("policy").String() + "\"," +
		"\"project_id\":\"project-1\"," +
		"\"required_ac_revisions\":[" +
		"{\"ac_id\":\"AC-01\",\"ac_revision_digest\":\"" + HashString("ac-1").String() + "\"}," +
		"{\"ac_id\":\"AC-02\",\"ac_revision_digest\":\"" + HashString("ac-2").String() + "\"}]," +
		"\"run_id\":\"run-1\"," +
		"\"run_input_digest\":\"" + HashString("input").String() + "\"," +
		"\"work_item_id\":\"item-1\"," +
		"\"work_item_version\":7}"
	if actual := string(subject.CanonicalJSON()); actual != expected {
		t.Fatalf("canonical JSON mismatch\nactual:   %s\nexpected: %s", actual, expected)
	}
	expectedDigest := sha256.Sum256([]byte(expected))
	if actual := subject.Digest().String(); actual != hex.EncodeToString(expectedDigest[:]) {
		t.Fatalf("digest = %s, want %x", actual, expectedDigest)
	}

	config.RequiredACRevisions[0].ACID = "mutated-input"
	returned := subject.RequiredACRevisions()
	returned[0].ACID = "mutated-output"
	if actual := string(subject.CanonicalJSON()); actual != expected {
		t.Fatal("subject changed through a caller-owned slice")
	}
}

func TestCompletionSubject_HostileIDIsValidJSONAndRoundTrips(t *testing.T) {
	config := subjectConfig(3)
	config.WorkItemID = WorkItemID("item-\"quoted\\path-☃")
	subject, err := NewCompletionSubject(config)
	if err != nil {
		t.Fatal(err)
	}
	encoded := subject.CanonicalJSON()
	if !json.Valid(encoded) {
		t.Fatalf("canonical bytes are not valid JSON: %q", encoded)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["work_item_id"] != string(config.WorkItemID) {
		t.Fatalf("work_item_id = %q", decoded["work_item_id"])
	}

	config.WorkItemID = WorkItemID("item\ncontrol")
	if _, err := NewCompletionSubject(config); err == nil {
		t.Fatal("control character in stable ID was accepted")
	}
}

func TestWorkItemTransitions_Table(t *testing.T) {
	tests := []struct {
		name     string
		from     Phase
		to       Phase
		guards   TransitionGuards
		wantCode RejectionCode
	}{
		{"draft-ready", PhaseDraft, PhaseReady, TransitionGuards{HasAcceptedAC: true, SpecificationValid: true}, ""},
		{"draft-missing-ac", PhaseDraft, PhaseReady, TransitionGuards{SpecificationValid: true}, CodeAcceptedACMissing},
		{"draft-invalid-spec", PhaseDraft, PhaseReady, TransitionGuards{HasAcceptedAC: true}, CodeSpecificationInvalid},
		{"ready-developing-explicit", PhaseReady, PhaseDeveloping, TransitionGuards{ExplicitStart: true}, ""},
		{"ready-developing-ack", PhaseReady, PhaseDeveloping, TransitionGuards{RunStartAcknowledged: true}, ""},
		{"ready-needs-start", PhaseReady, PhaseDeveloping, TransitionGuards{}, CodeExplicitStartRequired},
		{"developing-review", PhaseDeveloping, PhaseReview, TransitionGuards{HasCurrentCandidate: true}, ""},
		{"success-alone-not-review", PhaseDeveloping, PhaseReview, TransitionGuards{}, CodeCandidateMissing},
		{"review-qa", PhaseReview, PhaseQA, TransitionGuards{RequiredReviewsApproved: true}, ""},
		{"review-qa-missing-review", PhaseReview, PhaseQA, TransitionGuards{}, CodeReviewMissing},
		{"review-rework", PhaseReview, PhaseDeveloping, TransitionGuards{ReworkReason: "finding"}, ""},
		{"qa-rework", PhaseQA, PhaseDeveloping, TransitionGuards{ReworkReason: "finding"}, ""},
		{"rework-needs-reason", PhaseQA, PhaseDeveloping, TransitionGuards{}, CodeReworkReasonMissing},
		{"qa-done-direct-denied", PhaseQA, PhaseDone, TransitionGuards{}, CodeInvalidTransition},
		{"done-reopen-draft", PhaseDone, PhaseDraft, TransitionGuards{ReopenReason: "new work"}, ""},
		{"done-reopen-ready", PhaseDone, PhaseReady, TransitionGuards{ReopenReason: "new work"}, ""},
		{"done-reopen-needs-reason", PhaseDone, PhaseDraft, TransitionGuards{}, CodeReopenReasonMissing},
		{"cancel-finalized", PhaseDeveloping, PhaseCanceled, TransitionGuards{FinalizeCancellationAllowed: true}, ""},
		{"cancel-unknown-denied", PhaseDeveloping, PhaseCanceled, TransitionGuards{}, CodeActiveOrUnknownRun},
		{"canceled-terminal", PhaseCanceled, PhaseDraft, TransitionGuards{}, CodeInvalidTransition},
		{"illegal-skip", PhaseDraft, PhaseQA, TransitionGuards{}, CodeInvalidTransition},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			item := workItemForTransitionTest(t, test.from, 9)
			test.guards.ExpectedVersion = 9
			next, err := item.Transition(test.to, test.guards)
			if test.wantCode == "" {
				if err != nil {
					t.Fatal(err)
				}
				if next.Phase() != test.to || next.Version() != 10 {
					t.Fatalf("transition result = (%s,%d)", next.Phase(), next.Version())
				}
				return
			}
			assertRejectionCode(t, err, test.wantCode)
			if next.Phase() != test.from || next.Version() != 9 {
				t.Fatal("rejected transition mutated the aggregate")
			}
		})
	}
}

func TestBlockers_AreOrthogonalSet(t *testing.T) {
	item, _ := NewWorkItem("item-1", "project-1", PhaseReview, 1)
	item, err := item.AddBlocker(1, Blocker{ID: "b-2", Reason: "second"})
	if err != nil {
		t.Fatal(err)
	}
	item, err = item.AddBlocker(2, Blocker{ID: "b-1", Reason: "first"})
	if err != nil {
		t.Fatal(err)
	}
	item, err = item.RemoveBlocker(3, "b-1")
	if err != nil {
		t.Fatal(err)
	}
	if item.Phase() != PhaseReview {
		t.Fatalf("phase changed to %s", item.Phase())
	}
	blockers := item.Blockers()
	if len(blockers) != 1 || blockers[0].ID != "b-2" {
		t.Fatalf("remaining blockers = %#v", blockers)
	}
	if conditions := item.Conditions(false, false, false); !slices.Equal(conditions, []WorkCondition{ConditionBlocked}) {
		t.Fatalf("conditions = %v", conditions)
	}
}

func TestWorkItemTransition_VersionAndBlockerRejectWithoutMutation(t *testing.T) {
	item, _ := NewWorkItem("item-1", "project-1", PhaseReady, 1)
	blocked, err := item.AddBlocker(1, Blocker{ID: "scope", Reason: "scope unresolved"})
	if err != nil {
		t.Fatal(err)
	}
	next, err := blocked.Transition(PhaseDeveloping, TransitionGuards{ExpectedVersion: 2, ExplicitStart: true})
	assertRejectionCode(t, err, CodeActiveBlocker)
	if next.Phase() != PhaseReady || len(next.Blockers()) != 1 {
		t.Fatal("blocker rejection mutated aggregate")
	}
	next, err = blocked.Transition(PhaseDeveloping, TransitionGuards{ExpectedVersion: 1, ExplicitStart: true})
	assertRejectionCode(t, err, CodeVersionConflict)
	if next.Version() != 2 {
		t.Fatal("version rejection mutated aggregate")
	}
}

func TestRetry_CreatesNewRun(t *testing.T) {
	first, err := NewRun("run-1", "item-1", HashString("input"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := RetryRun(first, "run-2")
	if err != nil {
		t.Fatal(err)
	}
	if second.ID() == first.ID() || second.Attempt() != 2 || second.InputDigest() != first.InputDigest() {
		t.Fatalf("invalid retry: %#v", second)
	}
	_, err = RetryRun(first, first.ID())
	assertRejectionCode(t, err, CodeRunIdentityReused)
}

func TestCompleteWorkItem_AllRequiredEvidence(t *testing.T) {
	input := validCompletionInput(t)
	result, err := CompleteWorkItem(input)
	if err != nil {
		t.Fatal(err)
	}
	if result.WorkItem.Phase() != PhaseDone || result.WorkItem.Version() != input.WorkItem.Version()+1 {
		t.Fatalf("completed item = (%s,%d)", result.WorkItem.Phase(), result.WorkItem.Version())
	}
	if result.Record.ID() == "" || result.Record.SubjectDigest() != input.RequestedSubject.Digest() ||
		result.Record.WorkItemID() != result.WorkItem.ID() || result.Record.ResultVersion() != result.WorkItem.Version() {
		t.Fatalf("completion record = %#v", result.Record)
	}
	if input.WorkItem.Phase() != PhaseQA {
		t.Fatal("value operation mutated original WorkItem")
	}
}

func TestCompleteWorkItem_RejectsEveryNonPassingEvidenceState(t *testing.T) {
	tests := []struct {
		name   string
		code   RejectionCode
		change func(*testing.T, *CompletionInput)
	}{
		{"Missing", CodeEvidenceMissing, func(t *testing.T, input *CompletionInput) { input.Evidence = nil }},
		{"Failed", CodeEvidenceNonpassing, evidenceStateMutation(EvidenceFailed)},
		{"Skipped", CodeEvidenceNonpassing, evidenceStateMutation(EvidenceSkipped)},
		{"NotRun", CodeEvidenceNonpassing, evidenceStateMutation(EvidenceNotRun)},
		{"Unknown", CodeEvidenceNonpassing, evidenceStateMutation(EvidenceUnknown)},
		{"Error", CodeEvidenceNonpassing, evidenceStateMutation(EvidenceError)},
		{"Inconclusive", CodeEvidenceNonpassing, evidenceStateMutation(EvidenceInconclusive)},
		{"Stale", CodeEvidenceStale, func(t *testing.T, input *CompletionInput) {
			input.Evidence = []Evidence{newEvidence(t, input.RequestedSubject.Digest(), EvidencePassed, EvidenceStale, EvidencePresent, "independent")}
		}},
		{"Superseded", CodeEvidenceStale, func(t *testing.T, input *CompletionInput) {
			input.Evidence = []Evidence{newEvidence(t, input.RequestedSubject.Digest(), EvidencePassed, EvidenceSuperseded, EvidencePresent, "independent")}
		}},
		{"Unavailable", CodeEvidenceUnavailable, func(t *testing.T, input *CompletionInput) {
			input.Evidence = []Evidence{newEvidence(t, input.RequestedSubject.Digest(), EvidencePassed, EvidenceCurrent, EvidenceUnavailable, "independent")}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := validCompletionInput(t)
			test.change(t, &input)
			_, err := CompleteWorkItem(input)
			assertGateContains(t, err, test.code)
			if input.WorkItem.Phase() != PhaseQA {
				t.Fatal("failed gate mutated WorkItem")
			}
		})
	}
}

func evidenceStateMutation(state EvidenceState) func(*testing.T, *CompletionInput) {
	return func(t *testing.T, input *CompletionInput) {
		input.Evidence = []Evidence{newEvidence(t, input.RequestedSubject.Digest(), state, EvidenceCurrent, EvidencePresent, "independent")}
	}
}

func TestCompleteWorkItem_NegativeGateMatrix(t *testing.T) {
	tests := []struct {
		name   string
		code   RejectionCode
		mutate func(*testing.T, *CompletionInput)
	}{
		{"phase", CodePhaseNotQA, func(t *testing.T, input *CompletionInput) {
			input.WorkItem, _ = NewWorkItem("item-1", "project-1", PhaseReview, 5)
		}},
		{"version", CodeVersionConflict, func(t *testing.T, input *CompletionInput) { input.ExpectedVersion-- }},
		{"blocker", CodeActiveBlocker, func(t *testing.T, input *CompletionInput) {
			input.WorkItem, _ = input.WorkItem.AddBlocker(5, Blocker{ID: "b", Reason: "blocked"})
			input.ExpectedVersion = 6
		}},
		{"active-run", CodeActiveOrUnknownRun, func(t *testing.T, input *CompletionInput) { input.ActiveOrUnknownRun = true }},
		{"candidate-missing", CodeCandidateMissing, func(t *testing.T, input *CompletionInput) { input.CandidatePresent = false }},
		{"candidate-unavailable", CodeCandidateUnavailable, func(t *testing.T, input *CompletionInput) { input.CandidateAvailable = false }},
		{"review-missing", CodeReviewMissing, func(t *testing.T, input *CompletionInput) { input.Review = nil }},
		{"review-other-subject", CodeReviewMissing, func(t *testing.T, input *CompletionInput) {
			review, _ := NewReview("review-2", HashString("other-subject"), ReviewApproved, "reviewer", true)
			input.Review = &review
		}},
		{"review-rejected", CodeReviewRejected, func(t *testing.T, input *CompletionInput) {
			review, _ := NewReview("review-2", input.RequestedSubject.Digest(), ReviewRejected, "reviewer", true)
			input.Review = &review
		}},
		{"review-not-independent", CodeVerifierNotIndependent, func(t *testing.T, input *CompletionInput) {
			review, _ := NewReview("review-2", input.RequestedSubject.Digest(), ReviewApproved, "reviewer", false)
			input.Review = &review
		}},
		{"evidence-missing", CodeEvidenceMissing, func(t *testing.T, input *CompletionInput) { input.Evidence = nil }},
		{"evidence-stale", CodeEvidenceStale, func(t *testing.T, input *CompletionInput) {
			input.Evidence = []Evidence{newEvidence(t, input.RequestedSubject.Digest(), EvidencePassed, EvidenceStale, EvidencePresent, "independent")}
		}},
		{"evidence-unavailable", CodeEvidenceUnavailable, func(t *testing.T, input *CompletionInput) {
			input.Evidence = []Evidence{newEvidence(t, input.RequestedSubject.Digest(), EvidencePassed, EvidenceCurrent, EvidenceUnavailable, "independent")}
		}},
		{"self-verifier", CodeVerifierNotIndependent, func(t *testing.T, input *CompletionInput) {
			input.Evidence = []Evidence{newEvidence(t, input.RequestedSubject.Digest(), EvidencePassed, EvidenceCurrent, EvidencePresent, "producer")}
		}},
		{"approval-missing", CodeApprovalMissing, func(t *testing.T, input *CompletionInput) { input.Approval = nil }},
		{"approval-other-command", CodeApprovalMissing, func(t *testing.T, input *CompletionInput) {
			approval, _ := NewApproval("approval-2", input.RequestedSubject.Digest(), CommandKind("OtherCommand"), "operator", input.Now.Add(time.Hour))
			input.Approval = &approval
		}},
		{"approval-expired", CodeApprovalExpired, func(t *testing.T, input *CompletionInput) {
			approval, _ := NewApproval("approval-2", input.RequestedSubject.Digest(), CommandCompleteWorkItem, "operator", input.Now)
			input.Approval = &approval
		}},
		{"completion-record-id", CodeCompletionRecordMissing, func(t *testing.T, input *CompletionInput) { input.RecordID = "" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := validCompletionInput(t)
			test.mutate(t, &input)
			_, err := CompleteWorkItem(input)
			assertGateContains(t, err, test.code)
		})
	}
}

func TestCompleteWorkItem_RejectsSubjectTOCTOU(t *testing.T) {
	input := validCompletionInput(t)
	changed, err := NewCompletionSubject(subjectConfig(5))
	if err != nil {
		t.Fatal(err)
	}
	changedConfig := subjectConfig(5)
	changedConfig.PolicyRevisionDigest = HashString("new-policy")
	changed, err = NewCompletionSubject(changedConfig)
	if err != nil {
		t.Fatal(err)
	}
	input.CurrentSubject = changed
	_, err = CompleteWorkItem(input)
	assertGateContains(t, err, CodeSubjectStale)
	if input.WorkItem.Phase() != PhaseQA {
		t.Fatal("TOCTOU rejection mutated item")
	}
}

func TestCompleteWorkItem_PreservesHistoryOnReopenAndStale(t *testing.T) {
	input := validCompletionInput(t)
	completed, err := CompleteWorkItem(input)
	if err != nil {
		t.Fatal(err)
	}
	changedConfig := subjectConfig(5)
	changedConfig.RequiredACRevisions[0].RevisionDigest = HashString("changed-ac")
	changed, err := NewCompletionSubject(changedConfig)
	if err != nil {
		t.Fatal(err)
	}
	if CompletionApplicability(completed.Record, changed) != DoneStale || completed.WorkItem.Phase() != PhaseDone {
		t.Fatal("changed inputs did not preserve historical Done as stale")
	}
	reopened, err := completed.WorkItem.Transition(PhaseDraft, TransitionGuards{
		ExpectedVersion: completed.WorkItem.Version(), ReopenReason: "new accepted inputs",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Phase() != PhaseDraft || completed.Record.SubjectDigest() != input.RequestedSubject.Digest() {
		t.Fatal("reopen rewrote completion history")
	}
}

func TestCandidatePublication_RejectsStaleRunInput(t *testing.T) {
	if err := ValidateCandidatePublication(HashString("current"), HashString("stale")); err == nil {
		t.Fatal("stale candidate publication accepted")
	} else {
		assertRejectionCode(t, err, CodeSubjectStale)
	}
}

func TestCommand_IdempotencySameRequestAndConflict(t *testing.T) {
	scope := IdempotencyScope{Principal: "operator", ProjectID: "project-1", Command: CommandCompleteWorkItem, Key: "key-1"}
	record := NewIdempotencyRecord(scope, HashString("request"), HashString("result"), false)
	decision, result, err := CheckIdempotency(&record, scope, HashString("request"))
	if err != nil || decision != IdempotencyReplay || result != HashString("result") {
		t.Fatalf("replay = (%s,%s,%v)", decision, result, err)
	}
	_, _, err = CheckIdempotency(&record, scope, HashString("different"))
	assertRejectionCode(t, err, CodeIdempotencyConflict)
	expired := NewIdempotencyRecord(scope, HashString("request"), HashString("result"), true)
	_, _, err = CheckIdempotency(&expired, scope, HashString("request"))
	assertRejectionCode(t, err, CodeIdempotencyExpired)
	decision, _, err = CheckIdempotency(nil, scope, HashString("request"))
	if err != nil || decision != IdempotencyNew {
		t.Fatalf("new decision = %s, %v", decision, err)
	}
}

func subjectConfig(version uint64) CompletionSubjectConfig {
	return CompletionSubjectConfig{
		ProjectID: "project-1", WorkItemID: "item-1", WorkItemVersion: version,
		CandidateID: "candidate-1", CandidateDigest: HashString("candidate"),
		RunID: "run-1", RunInputDigest: HashString("input"),
		RequiredACRevisions:         []ACRevisionBinding{{ACID: "AC-01", RevisionDigest: HashString("ac-1")}},
		AcceptedGraphRevisionDigest: HashString("graph"), PolicyRevisionDigest: HashString("policy"),
		CompletionRecipeDigest: HashString("recipe"), IntegrationBaseDigest: HashString("base"),
	}
}

func workItemForTransitionTest(t *testing.T, phase Phase, version uint64) WorkItem {
	t.Helper()
	if phase == PhaseDone {
		return WorkItem{
			id: "item-1", projectID: "project-1", phase: PhaseDone,
			version: version, blockers: map[BlockerID]Blocker{},
		}
	}
	item, err := NewWorkItem("item-1", "project-1", phase, version)
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func validCompletionInput(t *testing.T) CompletionInput {
	t.Helper()
	item, err := NewWorkItem("item-1", "project-1", PhaseQA, 5)
	if err != nil {
		t.Fatal(err)
	}
	subject, err := NewCompletionSubject(subjectConfig(5))
	if err != nil {
		t.Fatal(err)
	}
	review, err := NewReview("review-1", subject.Digest(), ReviewApproved, "reviewer", true)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	approval, err := NewApproval("approval-1", subject.Digest(), CommandCompleteWorkItem, "operator", now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	return CompletionInput{
		WorkItem: item, ExpectedVersion: 5, RequestedSubject: subject, CurrentSubject: subject,
		CandidatePresent: true, CandidateAvailable: true,
		RequiredChecks: []CheckRequirement{
			{
				CheckID: "unit", VerifierClass: "independent", Independent: true,
				ProhibitedVerifierActor: "producer", ProhibitedVerifierRunRole: "producer",
			},
			{CheckID: "contract", VerifierClass: "independent"},
		},
		Evidence: []Evidence{
			newEvidence(t, subject.Digest(), EvidencePassed, EvidenceCurrent, EvidencePresent, "independent"),
			newEvidenceFor(t, "evidence-2", "contract", subject.Digest(), EvidencePassed, EvidenceCurrent, EvidencePresent, "independent"),
		},
		Review: &review, ApprovalRequired: true, Approval: &approval, Now: now, RecordID: "completion-1",
	}
}

func newEvidence(t *testing.T, subject Digest, state EvidenceState, applicability EvidenceApplicability, availability EvidenceAvailability, role string) Evidence {
	return newEvidenceFor(t, "evidence-1", "unit", subject, state, applicability, availability, role)
}

func newEvidenceFor(t *testing.T, id EvidenceID, checkID CheckID, subject Digest, state EvidenceState, applicability EvidenceApplicability, availability EvidenceAvailability, role string) Evidence {
	t.Helper()
	evidence, err := NewEvidence(EvidenceConfig{
		ID: id, SubjectDigest: subject, CheckID: checkID, State: state,
		Applicability: applicability, Availability: availability,
		VerifierActor: ActorID(role), VerifierRole: role, VerifierClass: "independent",
	})
	if err != nil {
		t.Fatal(err)
	}
	return evidence
}

func assertRejectionCode(t *testing.T, err error, want RejectionCode) {
	t.Helper()
	rejection, ok := err.(Rejection)
	if !ok || rejection.Code != want {
		t.Fatalf("error = %#v, want rejection %s", err, want)
	}
}

func assertGateContains(t *testing.T, err error, want RejectionCode) {
	t.Helper()
	gateError, ok := err.(GateError)
	if !ok {
		t.Fatalf("error = %#v, want GateError containing %s", err, want)
	}
	if !slices.Contains(gateError.Codes(), want) {
		t.Fatalf("codes = %v, want %s", gateError.Codes(), want)
	}
}
