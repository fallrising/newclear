package domain

import (
	"slices"
	"testing"
)

func TestCoverageProjection_SharedPredicatePreservesCommandOrder(t *testing.T) {
	input := validCompletionInput(t)
	input.RecordID = ""
	if reasons := EvaluateCompletionEligibility(input); len(reasons) != 0 {
		t.Fatal(reasons)
	}
	if reasons := EvaluateCompletion(input); !slices.Equal(reasons, []RejectionCode{CodeCompletionRecordMissing}) {
		t.Fatal(reasons)
	}
	first := input.Evidence[0]
	first.state = EvidenceFailed
	second := first
	second.id = "second"
	second.state = EvidencePassed
	second.availability = EvidenceUnavailable
	second.applicability = EvidenceStale
	second.verifierRole = "producer"
	input.Evidence = append([]Evidence{first, second}, input.Evidence[1:]...)
	ids, reasons := EvaluateCheckRequirement(input.RequiredChecks[0], input.RequestedSubject.Digest(), input.Evidence)
	want := []RejectionCode{CodeEvidenceNonpassing, CodeEvidenceUnavailable, CodeEvidenceStale, CodeVerifierNotIndependent}
	if !slices.Equal(ids, []EvidenceID{first.id, second.id}) || !slices.Equal(reasons, want) || !slices.Equal(EvaluateCompletionEligibility(input), want) {
		t.Fatalf("per-evidence emission order changed: ids=%v reasons=%v eligibility=%v", ids, reasons, EvaluateCompletionEligibility(input))
	}
}
