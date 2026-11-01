package main

import (
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"testing"
)

// Reports below are explicitly synthetic human fixture reports, never task acceptance.
func TestRuntime_LocalPolicyV2IndependentHumanVerification(t *testing.T) {
	policy := localCompletionPolicy()
	rule := policy.Checks["local"]
	if policy.RevisionDigest != domain.HashString("local-policy-v2") || policy.RecipeDigest != domain.HashString("local-recipe-v1") || policy.ApprovalRequired || len(policy.Checks) != 1 || rule.VerifierClass != "human" || !rule.Independent || rule.ProhibitedVerifierRunRole != "producer" || rule.EnvironmentDigest != domain.HashString("local-fake-environment-v1") {
		t.Fatal("unsupported local policy", policy)
	}
	fixture := newWorkerFixture(t)
	if err := fixture.worker.scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	run := fixture.authority(t)
	var outputs []port.RunOutput
	var current port.CurrentSpecification
	if err := fixture.worker.store.Within(t.Context(), func(tx port.Transaction) error {
		var err error
		outputs, err = tx.(port.RunOutputTransaction).LoadRunOutputs(t.Context(), testProjectID, fixture.run)
		if err != nil {
			return err
		}
		current, err = tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), testProjectID, run.Run.WorkItemID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if len(outputs) != 1 {
		t.Fatal("missing actual Fake output")
	}
	metadata := func(n int) command.Metadata {
		return command.Metadata{CommandID: fmt.Sprintf("cmd_00000000%02d", n), IdempotencyKey: fmt.Sprintf("00000000-0000-4000-8000-%012d", n), ExpectedVersion: 5, IssuedAt: fixture.clock.Now(), CorrelationID: "synthetic-human-policy-fixture"}
	}
	a := outputs[0].Artifact
	locator := command.ArtifactLocator{Digest: a.Digest, MediaType: a.MediaType, ByteLength: a.ByteLength, Availability: a.Availability}
	candidate := command.SubmitCandidate{Metadata: metadata(60), ProjectID: testProjectID, WorkItemID: run.Run.WorkItemID, RunID: fixture.run, Candidate: command.Candidate{ID: "synthetic-candidate", RunID: fixture.run, Digest: a.Digest, InputSubjectDigest: run.Run.InputDigest, CreatedAt: fixture.clock.Now(), Artifacts: []command.ArtifactLocator{locator}}}
	candidate.ExpectedVersion = 4
	if _, err := fixture.worker.commands.SubmitCandidate(t.Context(), "operator", candidate); err != nil {
		t.Fatal(err)
	}
	revisions := make([]domain.ACRevisionBinding, len(current.Requirements))
	for i, r := range current.Requirements {
		revisions[i] = domain.ACRevisionBinding{ACID: r.ACID, RevisionDigest: r.RevisionDigest}
	}
	subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: testProjectID, WorkItemID: run.Run.WorkItemID, WorkItemVersion: 6, CandidateID: candidate.Candidate.ID, CandidateDigest: a.Digest, RunID: fixture.run, RunInputDigest: run.Run.InputDigest, RequiredACRevisions: revisions, AcceptedGraphRevisionDigest: current.GraphRevisionDigest, PolicyRevisionDigest: policy.RevisionDigest, CompletionRecipeDigest: policy.RecipeDigest})
	if err != nil {
		t.Fatal(err)
	}
	review := command.PublishFixtureReview{Metadata: metadata(61), ProjectID: testProjectID, RunID: fixture.run, LeaseEpoch: run.Lease.Fence.Epoch, RestoreGeneration: run.RestoreGeneration, Review: command.Review{ID: "synthetic-human-review", SubjectDigest: subject.Digest(), ReviewerID: "operator", ReviewerClass: "producer", Verdict: "Approved", CreatedAt: fixture.clock.Now()}}
	permissionDenied := func(err error) {
		t.Helper()
		e, ok := errors.AsType[*command.Error](err)
		if !ok || e.Code != command.CodePermissionDenied {
			t.Fatalf("independence guard did not reject: %v", err)
		}
	}
	_, err = fixture.worker.commands.PublishFixtureReview(t.Context(), "operator", review)
	permissionDenied(err)
	review.Metadata = metadata(62)
	review.Review.ReviewerClass = "human"
	if _, err := fixture.worker.commands.PublishFixtureReview(t.Context(), "operator", review); err != nil {
		t.Fatal(err)
	}
	evidence := command.PublishFixtureEvidence{Metadata: metadata(63), ProjectID: testProjectID, RunID: fixture.run, LeaseEpoch: run.Lease.Fence.Epoch, RestoreGeneration: run.RestoreGeneration, Evidence: command.Evidence{ID: "synthetic-human-report", SubjectDigest: subject.Digest(), ACID: "local", ACRevisionDigest: revisions[0].RevisionDigest, ObservationVerdict: "Passing", ReviewDisposition: "Accepted", Applicability: "Fresh", MaterialAvailability: "Present", VerifierID: "operator", VerifierClass: "producer", RecipeDigest: policy.RecipeDigest, EnvironmentDigest: rule.EnvironmentDigest, ObservedAt: fixture.clock.Now(), Report: locator}}
	_, err = fixture.worker.commands.PublishFixtureEvidence(t.Context(), "operator", evidence)
	permissionDenied(err)
	evidence.Metadata = metadata(64)
	evidence.Evidence.VerifierClass = "human"
	evidence.Evidence.VerifierID = run.Lease.Fence.Holder
	_, err = fixture.worker.commands.PublishFixtureEvidence(t.Context(), "operator", evidence)
	permissionDenied(err)
	evidence.Metadata = metadata(65)
	evidence.Evidence.VerifierID = "operator"
	evidence.Evidence.EnvironmentDigest = domain.HashString("wrong environment")
	_, err = fixture.worker.commands.PublishFixtureEvidence(t.Context(), "operator", evidence)
	permissionDenied(err)
	evidence.Metadata = metadata(66)
	evidence.Evidence.EnvironmentDigest = rule.EnvironmentDigest
	if _, err := fixture.worker.commands.PublishFixtureEvidence(t.Context(), "operator", evidence); err != nil {
		t.Fatal(err)
	}
	board, err := fixture.worker.store.ReadBoard(t.Context(), testProjectID)
	if err != nil || board.Items[0].Item.Phase() != domain.PhaseReview {
		t.Fatal("human fixture review/evidence implied Done", err)
	}
}
