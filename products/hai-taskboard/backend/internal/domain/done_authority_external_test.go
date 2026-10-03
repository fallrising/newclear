package domain_test

import (
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestPublicDoneAuthorityBoundary(t *testing.T) {
	direct, err := domain.NewWorkItem("item-1", "project-1", domain.PhaseDone, 1)
	if err == nil || direct.Phase() == domain.PhaseDone {
		t.Fatalf("public constructor yielded Done: item=%#v error=%v", direct, err)
	}

	qa, err := domain.NewWorkItem("item-1", "project-1", domain.PhaseQA, 5)
	if err != nil {
		t.Fatal(err)
	}
	direct, err = qa.Transition(domain.PhaseDone, domain.TransitionGuards{
		ExpectedVersion:             qa.Version(),
		HasAcceptedAC:               true,
		SpecificationValid:          true,
		ExplicitStart:               true,
		RunStartAcknowledged:        true,
		HasCurrentCandidate:         true,
		RequiredReviewsApproved:     true,
		ReworkReason:                "caller-controlled",
		ReopenReason:                "caller-controlled",
		FinalizeCancellationAllowed: true,
	})
	if err == nil || direct.Phase() == domain.PhaseDone || qa.Phase() != domain.PhaseQA {
		t.Fatalf("public transition yielded Done: original=%s result=%s error=%v", qa.Phase(), direct.Phase(), err)
	}

	subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{
		ProjectID: "project-1", WorkItemID: "item-1", WorkItemVersion: qa.Version(),
		CandidateID: "candidate-1", CandidateDigest: domain.HashString("candidate"),
		RunID: "run-1", RunInputDigest: domain.HashString("input"),
		RequiredACRevisions:         []domain.ACRevisionBinding{{ACID: "AC-01", RevisionDigest: domain.HashString("ac-1")}},
		AcceptedGraphRevisionDigest: domain.HashString("graph"),
		PolicyRevisionDigest:        domain.HashString("policy"),
		CompletionRecipeDigest:      domain.HashString("recipe"),
	})
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := domain.NewEvidence(domain.EvidenceConfig{
		ID: "evidence-1", SubjectDigest: subject.Digest(), CheckID: "unit",
		State: domain.EvidencePassed, Applicability: domain.EvidenceCurrent,
		Availability: domain.EvidencePresent, VerifierActor: "verifier",
		VerifierRole: "independent", VerifierClass: "independent",
	})
	if err != nil {
		t.Fatal(err)
	}
	review, err := domain.NewReview("review-1", subject.Digest(), domain.ReviewApproved, "reviewer", true)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	approval, err := domain.NewApproval(
		"approval-1", subject.Digest(), domain.CommandCompleteWorkItem, "operator", now.Add(time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}

	result, err := domain.CompleteWorkItem(domain.CompletionInput{
		WorkItem: qa, ExpectedVersion: qa.Version(), RequestedSubject: subject, CurrentSubject: subject,
		CandidatePresent: true, CandidateAvailable: true,
		RequiredChecks: []domain.CheckRequirement{{CheckID: "unit", VerifierClass: "independent"}},
		Evidence:       []domain.Evidence{evidence}, Review: &review,
		ApprovalRequired: true, Approval: &approval, Now: now, RecordID: "completion-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.WorkItem.Phase() != domain.PhaseDone || result.Record.ID() == "" ||
		result.Record.SubjectDigest() != subject.Digest() || result.Record.WorkItemID() != result.WorkItem.ID() {
		t.Fatalf("gated completion did not return exact-subject item and record together: %#v", result)
	}
}
