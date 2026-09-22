package integration_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

const (
	projectID         = domain.ProjectID("prj_01ARZ3NDEK")
	workItemID        = domain.WorkItemID("wi_01ARZ3NDEK")
	dispatchedRunID   = domain.RunID("run_01ARZ3NDEK")
	operatorID        = domain.ActorID("operator")
	dispatchCommandID = "cmd_01ARZ3NDEQ"
)

var fixedTime = time.Date(2026, time.September, 10, 12, 0, 0, 123, time.UTC)

func TestVerticalFake_CompletionAndResponseLoss(t *testing.T) {
	const candidateID = domain.CandidateID("candidate-1")
	candidateBytes := []byte("candidate-v1")
	scenario := mustScenario(t, "vertical-success", []fake.Capability{fake.CapabilityStartAck}, []fake.Step{
		{Tick: 0, Kind: fake.ObservationDispatchReceived, Message: "received"},
		{Tick: 1, Kind: fake.ObservationStartAcknowledged, Message: "started"},
		{Tick: 2, Kind: fake.ObservationTerminalSuccess, Message: "succeeded", Artifact: &fake.Artifact{
			Name: "candidate/result.txt", MediaType: "text/plain", Bytes: candidateBytes,
		}},
	})
	fixture := newDispatchedFixture(t, scenario)

	dispatchBeforeReplay, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	dispatchProjectionCount := fixture.projections.count()
	recovered := recoverCommandResult(t, fixture.service, fixture.store, dispatchCommand(scenario.ID()))
	if _, err := command.DecodeCanonicalResult(recovered, dispatchCommandID, command.DispatchRunOperation); err != nil {
		t.Fatalf("recovered dispatch result is not canonical: %v", err)
	}
	if !bytes.Contains(recovered, []byte(dispatchedRunID)) {
		t.Fatalf("recovered dispatch result does not name %s: %s", dispatchedRunID, recovered)
	}
	dispatchAfterReplay, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if dispatchAfterReplay != dispatchBeforeReplay || fixture.projections.count() != dispatchProjectionCount || fixture.ids.count(port.IDRun) != 1 {
		t.Fatalf("dispatch replay mutated authority: before=%#v after=%#v projections=(%d,%d) Run IDs=%d", dispatchBeforeReplay, dispatchAfterReplay, dispatchProjectionCount, fixture.projections.count(), fixture.ids.count(port.IDRun))
	}
	if fixture.fakeDispatches != 0 || fixture.staging.count() != 0 || fixture.artifacts.count() != 0 {
		t.Fatalf("dispatch replay executed Fake/staging/object writes = (%d,%d,%d)", fixture.fakeDispatches, fixture.staging.count(), fixture.artifacts.count())
	}
	item, err := fixture.store.LoadWorkItem(t.Context(), projectID, workItemID)
	if err != nil {
		t.Fatal(err)
	}
	if item.Phase() != domain.PhaseDeveloping || item.Version() != 3 {
		t.Fatalf("dispatched work item = (%s,%d), want (Developing,3)", item.Phase(), item.Version())
	}

	run := claimAndStartFake(t, &fixture, "worker-completion")
	terminal, err := run.session.Poll(t.Context(), fake.TickRequest{Fence: run.fence, Tick: 2})
	if err != nil {
		t.Fatal(err)
	}
	publishFakeObservations(t, &fixture, run.envelope.Fence, run.worker, terminal)
	snapshot := run.worker.Snapshot()
	if snapshot.Lifecycle != fake.LifecycleSucceeded || snapshot.SideEffectOutcome != fake.SideEffectConfirmed ||
		snapshot.NextSequence != 4 || len(snapshot.Accepted) != 3 || len(snapshot.Rejections) != 0 ||
		len(run.session.Transcript()) != 3 || !bytes.Equal(snapshot.Accepted[2].ArtifactBytes, candidateBytes) {
		t.Fatalf("completed Fake worker/session = snapshot %#v transcript %#v", snapshot, run.session.Transcript())
	}
	finished, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Run.ObservedState != "Succeeded" || finished.Run.ReconciliationState != "None" ||
		finished.Run.SideEffectOutcome != "Confirmed" || finished.Outbox.State != "Acknowledged" ||
		finished.Lease.Fence != run.envelope.Fence {
		t.Fatalf("completed application authority = %#v", finished)
	}
	candidateDigest := domain.HashBytes(candidateBytes)
	outcome, err := fixture.service.SubmitCandidate(t.Context(), operatorID, command.SubmitCandidate{
		Metadata:  commandMetadata("cmd_01ARZ3NDER", "00000000-0000-4000-8000-000000000005", 3),
		ProjectID: projectID, WorkItemID: workItemID, RunID: dispatchedRunID,
		Candidate: command.Candidate{
			ID: candidateID, RunID: dispatchedRunID, Digest: candidateDigest,
			InputSubjectDigest: run.envelope.Fence.InputDigest, CreatedAt: fixedTime,
			Artifacts: []command.ArtifactLocator{{
				Digest: candidateDigest, MediaType: "text/plain", ByteLength: uint64(len(candidateBytes)), Availability: "Present",
			}},
		},
	})
	mustSucceed(t, outcome, err)
	subject := prospectiveQASubject(t, &fixture, candidateID, dispatchedRunID)
	outcome, err = fixture.service.PublishFixtureReview(t.Context(), operatorID, command.PublishFixtureReview{
		Metadata:  commandMetadata("cmd_01ARZ3NDES", "00000000-0000-4000-8000-000000000006", 4),
		ProjectID: projectID, RunID: dispatchedRunID, LeaseEpoch: run.envelope.Fence.Epoch,
		RestoreGeneration: run.envelope.Fence.RestoreGeneration,
		Review: command.Review{
			ID: "review-1", SubjectDigest: subject.Digest(), ReviewerID: operatorID,
			ReviewerClass: "independent", Verdict: "Approved", CreatedAt: fixedTime,
		},
	})
	mustSucceed(t, outcome, err)
	outcome, err = fixture.service.PublishFixtureEvidence(t.Context(), operatorID, command.PublishFixtureEvidence{
		Metadata:  commandMetadata("cmd_01ARZ3NDET", "00000000-0000-4000-8000-000000000007", 4),
		ProjectID: projectID, RunID: dispatchedRunID, LeaseEpoch: run.envelope.Fence.Epoch,
		RestoreGeneration: run.envelope.Fence.RestoreGeneration,
		Evidence: command.Evidence{
			ID: "evidence-1", SubjectDigest: subject.Digest(), ACID: "AC-1", ACRevisionDigest: fixture.acDigest,
			ObservationVerdict: "Passing", ReviewDisposition: "Accepted", Applicability: "Fresh", MaterialAvailability: "Present",
			VerifierID: operatorID, VerifierClass: "independent", RecipeDigest: fixture.policy.RecipeDigest,
			EnvironmentDigest: fixture.policy.Checks["AC-1"].EnvironmentDigest, ObservedAt: fixedTime,
			Report: command.ArtifactLocator{
				Digest: candidateDigest, MediaType: "text/plain", ByteLength: uint64(len(candidateBytes)), Availability: "Present",
			},
		},
	})
	mustSucceed(t, outcome, err)
	outcome, err = fixture.service.ApproveSubject(t.Context(), operatorID, command.ApproveSubject{
		Metadata:  commandMetadata("cmd_01ARZ3NDEV", "00000000-0000-4000-8000-000000000008", 4),
		ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidateID,
		RequestID: "approval-1", SubjectDigest: subject.Digest(), Decision: "Approved",
	})
	mustSucceed(t, outcome, err)
	outcome, err = fixture.service.RequestQA(t.Context(), operatorID, command.RequestQA{
		Metadata:  commandMetadata("cmd_01ARZ3NDEW", "00000000-0000-4000-8000-000000000009", 4),
		ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidateID, SubjectDigest: subject.Digest(),
	})
	mustSucceed(t, outcome, err)
	complete := command.CompleteWorkItem{
		Metadata:  commandMetadata("cmd_01ARZ3NDEX", "00000000-0000-4000-8000-000000000010", 5),
		ProjectID: projectID, WorkItemID: workItemID, Subject: subject,
	}
	// The first successful completion response is deliberately discarded.
	lost, err := fixture.service.CompleteWorkItem(t.Context(), operatorID, complete)
	mustSucceed(t, lost, err)

	item, err = fixture.store.LoadWorkItem(t.Context(), projectID, workItemID)
	if err != nil || item.Phase() != domain.PhaseDone || item.Version() != 6 {
		t.Fatalf("completed work item = (%#v,%v)", item, err)
	}
	beforeCompletionReplay, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	projectionCount := fixture.projections.count()
	stagingCount, artifactCount, fakeDispatchCount := fixture.staging.count(), fixture.artifacts.count(), fixture.fakeDispatches
	completionBytes := loadCommandResultHTTP(t, fixture.service, fixture.store, complete.CommandID)
	if _, err := command.DecodeCanonicalResult(completionBytes, complete.CommandID, command.CompleteWorkItemOperation); err != nil {
		t.Fatalf("recovered completion result is not canonical: %v", err)
	}
	replayed, err := fixture.service.CompleteWorkItem(t.Context(), operatorID, complete)
	if err != nil || !replayed.Replayed || !bytes.Equal(replayed.Payload, completionBytes) {
		t.Fatalf("completion replay = (%#v,%v), want byte-exact %q", replayed, err, completionBytes)
	}
	afterCompletionReplay, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if afterCompletionReplay != beforeCompletionReplay || fixture.projections.count() != projectionCount ||
		fixture.staging.count() != stagingCount || fixture.artifacts.count() != artifactCount ||
		fixture.fakeDispatches != fakeDispatchCount || fixture.ids.count(port.IDRun) != 1 {
		t.Fatalf("completion replay mutated durable/recorder state: authority=(%#v,%#v) projections=(%d,%d) staging=(%d,%d) artifacts=(%d,%d) Fake=(%d,%d) Run IDs=%d", beforeCompletionReplay, afterCompletionReplay, projectionCount, fixture.projections.count(), stagingCount, fixture.staging.count(), artifactCount, fixture.artifacts.count(), fakeDispatchCount, fixture.fakeDispatches, fixture.ids.count(port.IDRun))
	}
	material := loadCompletionMaterial(t, &fixture, candidateID, dispatchedRunID, subject.Digest())
	if material.WorkItem.Phase() != domain.PhaseDone || material.WorkItem.Version() != 6 ||
		!material.CandidatePresent || !material.CandidateAvailable || material.Candidate.ID != candidateID ||
		material.Candidate.ProjectID != projectID || material.Candidate.RunID != dispatchedRunID ||
		material.Candidate.Digest != candidateDigest || material.Candidate.InputSubjectDigest != run.envelope.Fence.InputDigest ||
		!material.RunPresent || material.Run.ID != dispatchedRunID || material.Run.ProjectID != projectID ||
		material.Run.InputDigest != run.envelope.Fence.InputDigest || material.Run.AdapterID != fake.AdapterID ||
		material.Run.AdapterVersion != fake.AdapterVersion || material.Run.ScenarioID != scenario.ID() ||
		material.Run.ObservedState != "Succeeded" || material.ActiveOrUnknownRun ||
		material.GraphRevisionDigest != fixture.graphDigest || len(material.RequiredACRevisions) != 1 ||
		material.RequiredACRevisions[0].ACID != "AC-1" || material.RequiredACRevisions[0].RevisionDigest != fixture.acDigest ||
		len(material.Artifacts) != 1 || material.Artifacts[0].Digest != candidateDigest || material.Artifacts[0].MediaType != "text/plain" ||
		material.Artifacts[0].ByteLength != uint64(len(candidateBytes)) || material.Artifacts[0].Availability != "Present" ||
		len(material.Evidence) != 1 || material.Evidence[0].ID != "evidence-1" || material.Evidence[0].SubjectDigest != subject.Digest() ||
		material.Evidence[0].ACID != "AC-1" || material.Evidence[0].ACRevisionDigest != fixture.acDigest ||
		material.Evidence[0].Verdict != "Passed" || material.Evidence[0].Applicability != "Current" || material.Evidence[0].Availability != "Present" ||
		material.Evidence[0].VerifierClass != "independent" || material.Evidence[0].VerifierActor != operatorID ||
		material.Evidence[0].VerifierRole != "independent" || material.Evidence[0].RecipeDigest != fixture.policy.RecipeDigest ||
		material.Evidence[0].EnvironmentDigest != fixture.policy.Checks["AC-1"].EnvironmentDigest || material.Evidence[0].ArtifactDigest != candidateDigest ||
		len(material.Reviews) != 1 || material.Reviews[0].ID != "review-1" || material.Reviews[0].ProjectID != projectID ||
		material.Reviews[0].SubjectDigest != subject.Digest() || material.Reviews[0].Verdict != "Approved" ||
		material.Reviews[0].Reviewer != operatorID || !material.Reviews[0].Independent ||
		len(material.Approvals) != 1 || material.Approvals[0].ID != "approval-1" || material.Approvals[0].ProjectID != projectID ||
		material.Approvals[0].SubjectDigest != subject.Digest() || material.Approvals[0].CommandKind != string(domain.CommandCompleteWorkItem) ||
		material.Approvals[0].Actor != operatorID || material.Approvals[0].ExpiresAtNS <= fixedTime.UnixNano() {
		t.Fatalf("completed typed material = %#v", material)
	}
	if fixture.fakeDispatches != 1 || fixture.staging.count() != 1 || fixture.artifacts.count() != 1 {
		t.Fatalf("completion execution counts Fake/staging/object = (%d,%d,%d), want (1,1,1)", fixture.fakeDispatches, fixture.staging.count(), fixture.artifacts.count())
	}
}

func TestRunLease_RejectsStaleEpochPublication(t *testing.T) {
	const staleCandidateID = domain.CandidateID("candidate-stale")
	staleBytes := []byte("stale-epoch-result")
	scenario := mustScenario(t, "lease-stale", []fake.Capability{fake.CapabilityStartAck}, []fake.Step{
		{Tick: 0, Kind: fake.ObservationDispatchReceived},
		{Tick: 1, Kind: fake.ObservationStartAcknowledged},
		{Tick: 2, Kind: fake.ObservationTerminalSuccess, Artifact: &fake.Artifact{
			Name: "candidate/stale.txt", MediaType: "text/plain", Bytes: staleBytes,
		}},
	})
	fixture := newDispatchedFixture(t, scenario)
	run := claimAndStartFake(t, &fixture, "worker-old")
	oldSnapshot := run.worker.Snapshot()
	if oldSnapshot.Lifecycle != fake.LifecycleRunning || oldSnapshot.NextSequence != 3 || len(oldSnapshot.Accepted) != 2 {
		t.Fatalf("old-N Fake prefix = %#v", oldSnapshot)
	}
	atEpochN, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if atEpochN.Lease.Fence != run.envelope.Fence || atEpochN.Run.ObservedState != "Running" || atEpochN.Outbox.State != "Acknowledged" {
		t.Fatalf("persisted epoch-N authority = %#v", atEpochN)
	}
	fixture.clock.Set(time.Unix(0, atEpochN.Lease.DeadlineNS+1).UTC())
	successor, err := fixture.service.ClaimExpiredRunForReconciliation(t.Context(), "reconciler", service.ClaimReconciliationRequest{
		PreviousFence: run.envelope.Fence, Successor: "reconciler", LeaseDuration: time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	if successor.Lease.Fence.Epoch != run.envelope.Fence.Epoch+1 || successor.Lease.Fence.Holder != "reconciler" ||
		successor.Outbox.ID != atEpochN.Outbox.ID || successor.Outbox.State != atEpochN.Outbox.State ||
		successor.Run.ObservedState != atEpochN.Run.ObservedState || successor.Run.ReconciliationState != "NeedsReconcile" ||
		successor.Run.SideEffectOutcome != "OutcomeUnknown" || successor.ProjectionCount != atEpochN.ProjectionCount+1 ||
		successor.AuditCount != atEpochN.AuditCount+1 {
		t.Fatalf("reconciliation-only epoch N+1 = %#v; epoch N = %#v", successor, atEpochN)
	}
	materialBefore := loadCompletionMaterial(t, &fixture, staleCandidateID, dispatchedRunID, domain.HashString("stale-subject"))
	if materialBefore.CandidatePresent || materialBefore.RunPresent ||
		!materialBefore.ActiveOrUnknownRun || len(materialBefore.Evidence) != 0 || len(materialBefore.Reviews) != 0 ||
		len(materialBefore.Approvals) != 0 || len(materialBefore.Artifacts) != 0 {
		t.Fatalf("pre-stale completion material = %#v", materialBefore)
	}

	oldTerminal, err := run.session.Poll(t.Context(), fake.TickRequest{Fence: run.fence, Tick: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(oldTerminal) != 1 || oldTerminal[0].Kind != fake.ObservationTerminalSuccess || !bytes.Equal(oldTerminal[0].ArtifactBytes, staleBytes) {
		t.Fatalf("old-N terminal observation = %#v", oldTerminal)
	}
	if err := run.worker.Accept(oldTerminal[0]); err != nil {
		t.Fatalf("formerly valid old-N Fake session rejected its own terminal observation: %v", err)
	}
	publication, err := fixture.applicationObservation(run.envelope.Fence, oldTerminal[0])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.PublishRunObservation(t.Context(), run.envelope.Fence.Holder, publication); !errors.Is(err, port.ErrFenceRejected) {
		t.Fatalf("application old-N terminal publication error = %v", err)
	}
	afterPublication, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if afterPublication.Run != successor.Run || afterPublication.Outbox != successor.Outbox || afterPublication.Lease != successor.Lease ||
		afterPublication.ProjectionCount != successor.ProjectionCount || afterPublication.AuditCount != successor.AuditCount+1 {
		t.Fatalf("stale publication mutation: successor=%#v after=%#v", successor, afterPublication)
	}
	staleDigest := domain.HashBytes(staleBytes)
	_, err = fixture.service.SubmitCandidate(t.Context(), operatorID, command.SubmitCandidate{
		Metadata:  commandMetadata("cmd_01ARZ3NDER", "00000000-0000-4000-8000-000000000005", 3),
		ProjectID: projectID, WorkItemID: workItemID, RunID: dispatchedRunID,
		Candidate: command.Candidate{
			ID: staleCandidateID, RunID: dispatchedRunID, Digest: staleDigest,
			InputSubjectDigest: run.envelope.Fence.InputDigest, CreatedAt: fixedTime,
			Artifacts: []command.ArtifactLocator{{
				Digest: staleDigest, MediaType: "text/plain", ByteLength: uint64(len(staleBytes)), Availability: "Present",
			}},
		},
	})
	failure, typed := errors.AsType[*command.Error](err)
	if !typed || failure.Code != command.CodeLifecycleRejected {
		t.Fatalf("stale Candidate submission error = %v", err)
	}
	afterCandidate, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if afterCandidate != afterPublication {
		t.Fatalf("rejected stale Candidate mutated Run authority: before=%#v after=%#v", afterPublication, afterCandidate)
	}
	materialAfter := loadCompletionMaterial(t, &fixture, staleCandidateID, dispatchedRunID, domain.HashString("stale-subject"))
	if materialAfter.CandidatePresent != materialBefore.CandidatePresent || materialAfter.CandidateAvailable != materialBefore.CandidateAvailable ||
		materialAfter.Run != materialBefore.Run || materialAfter.RunPresent != materialBefore.RunPresent ||
		materialAfter.ActiveOrUnknownRun != materialBefore.ActiveOrUnknownRun ||
		materialAfter.WorkItem.Phase() != materialBefore.WorkItem.Phase() || materialAfter.WorkItem.Version() != materialBefore.WorkItem.Version() ||
		materialAfter.GraphRevisionDigest != materialBefore.GraphRevisionDigest ||
		len(materialAfter.Evidence) != len(materialBefore.Evidence) || len(materialAfter.Reviews) != len(materialBefore.Reviews) ||
		len(materialAfter.Approvals) != len(materialBefore.Approvals) || len(materialAfter.Artifacts) != len(materialBefore.Artifacts) {
		t.Fatalf("stale path changed completion material: before=%#v after=%#v", materialBefore, materialAfter)
	}
	beforeRedispatch := afterCandidate
	if _, err := fixture.service.ClaimDispatch(t.Context(), "redispatcher", service.ClaimDispatchRequest{
		ProjectID: projectID, RunID: dispatchedRunID, Holder: "redispatcher",
		ExpectedRestoreGeneration: successor.RestoreGeneration, LeaseDuration: time.Minute,
	}); !errors.Is(err, port.ErrNoPendingDispatch) {
		t.Fatalf("stale path allowed redispatch: %v", err)
	}
	afterRedispatch, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	item, err := fixture.store.LoadWorkItem(t.Context(), projectID, workItemID)
	if err != nil || item.Phase() != domain.PhaseDeveloping || item.Version() != 3 || afterRedispatch != beforeRedispatch {
		t.Fatalf("stale path final state item=(%#v,%v) authority=(%#v,%#v)", item, err, beforeRedispatch, afterRedispatch)
	}
	oldAfter := run.worker.Snapshot()
	if oldAfter.Lifecycle != fake.LifecycleSucceeded || oldAfter.SideEffectOutcome != fake.SideEffectConfirmed ||
		oldAfter.Redispatches != 0 || len(oldAfter.Accepted) != 3 || len(oldAfter.Rejections) != 0 ||
		len(run.session.Transcript()) != 3 || fixture.fakeDispatches != 1 || fixture.staging.count() != 1 ||
		fixture.artifacts.count() != 1 || fixture.ids.count(port.IDRun) != 1 {
		t.Fatalf("independent old-N Fake/recorder state = snapshot %#v transcript %#v Fake/staging/object/Run=(%d,%d,%d,%d)", oldAfter, run.session.Transcript(), fixture.fakeDispatches, fixture.staging.count(), fixture.artifacts.count(), fixture.ids.count(port.IDRun))
	}
}

func TestCancel_UnknownStopIsNotCanceled(t *testing.T) {
	scenario := mustScenario(t, "cancel-unknown", []fake.Capability{fake.CapabilityLookup, fake.CapabilityStartAck}, []fake.Step{
		{Tick: 0, Kind: fake.ObservationDispatchReceived},
		{Tick: 1, Kind: fake.ObservationStartAcknowledged},
		{Tick: 2, Kind: fake.ObservationTimeout},
		{Tick: 3, Kind: fake.ObservationLookupUnknown},
	})
	fixture := newDispatchedFixture(t, scenario)
	run := claimAndStartFake(t, &fixture, "worker-current")
	outcome, err := fixture.service.RequestCancellation(t.Context(), operatorID, command.RequestCancellation{
		Metadata:  commandMetadata("cmd_01ARZ3NDER", "00000000-0000-4000-8000-000000000005", 3),
		ProjectID: projectID, WorkItemID: workItemID, RunID: dispatchedRunID, Reason: "operator requested stop",
	})
	mustSucceed(t, outcome, err)
	requested, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if requested.Run.DesiredAction != "CancelRequested" || requested.Run.ObservedState != "Running" ||
		requested.Run.SideEffectOutcome == "Confirmed" || requested.Outbox.State == "Pending" ||
		requested.Lease.Fence != run.envelope.Fence {
		t.Fatalf("persisted cancellation intent = %#v", requested)
	}
	if err := run.worker.RequestCancellation(run.fence); err != nil {
		t.Fatalf("Fake cancellation request: %v", err)
	}
	timedOut, err := run.session.Poll(t.Context(), fake.TickRequest{Fence: run.fence, Tick: 2})
	if err != nil {
		t.Fatal(err)
	}
	publishFakeObservations(t, &fixture, run.envelope.Fence, run.worker, timedOut)
	lookup, err := run.session.Lookup(t.Context(), fake.TickRequest{Fence: run.fence, Tick: 3})
	if err != nil {
		t.Fatal(err)
	}
	publishFakeObservations(t, &fixture, run.envelope.Fence, run.worker, lookup)

	snapshot := run.worker.Snapshot()
	transcript := run.session.Transcript()
	if !snapshot.CancelRequested || snapshot.Lifecycle != fake.LifecycleNeedsReconcile ||
		snapshot.SideEffectOutcome != fake.SideEffectUnknown || snapshot.Redispatches != 0 ||
		len(snapshot.Accepted) != 4 || len(snapshot.Rejections) != 0 || len(transcript) != 4 ||
		transcript[2].Kind != fake.ObservationTimeout || transcript[3].Kind != fake.ObservationLookupUnknown {
		t.Fatalf("cancel-unknown Fake snapshot/transcript = %#v / %#v", snapshot, transcript)
	}
	unknown, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if unknown.Run.DesiredAction != "CancelRequested" || unknown.Run.DispatchState != "Acknowledged" ||
		unknown.Run.ObservedState != "Unknown" || unknown.Run.ReconciliationState != "NeedsReconcile" ||
		unknown.Run.SideEffectOutcome != "OutcomeUnknown" || unknown.Outbox.ID != requested.Outbox.ID ||
		unknown.Outbox.State == "Pending" || unknown.Outbox.ClaimEpoch != run.envelope.Fence.Epoch ||
		unknown.Lease.Fence != run.envelope.Fence {
		t.Fatalf("persisted cancel-unknown authority = %#v", unknown)
	}
	item, err := fixture.store.LoadWorkItem(t.Context(), projectID, workItemID)
	if err != nil || item.Phase() != domain.PhaseDeveloping || item.Phase() == domain.PhaseDone ||
		item.Phase() == domain.PhaseCanceled || item.Version() != 3 {
		t.Fatalf("cancel-unknown work item = (%#v,%v)", item, err)
	}
	material := loadCompletionMaterial(t, &fixture, "candidate-absent", dispatchedRunID, domain.HashString("cancel-unknown-subject"))
	if material.CandidatePresent || material.CandidateAvailable || material.RunPresent || !material.ActiveOrUnknownRun ||
		material.WorkItem.Phase() != domain.PhaseDeveloping || material.WorkItem.Version() != 3 ||
		len(material.Evidence) != 0 || len(material.Reviews) != 0 || len(material.Approvals) != 0 || len(material.Artifacts) != 0 {
		t.Fatalf("cancel-unknown completion material = %#v", material)
	}
	projectionCount := fixture.projections.count()
	if _, err := fixture.service.ClaimDispatch(t.Context(), "redispatcher", service.ClaimDispatchRequest{
		ProjectID: projectID, RunID: dispatchedRunID, Holder: "redispatcher",
		ExpectedRestoreGeneration: unknown.RestoreGeneration, LeaseDuration: time.Minute,
	}); !errors.Is(err, port.ErrNoPendingDispatch) {
		t.Fatalf("cancel-unknown path allowed redispatch: %v", err)
	}
	afterRedispatch, err := fixture.service.ReadRunAuthority(t.Context(), projectID, dispatchedRunID)
	if err != nil {
		t.Fatal(err)
	}
	if afterRedispatch != unknown || fixture.projections.count() != projectionCount || fixture.ids.count(port.IDRun) != 1 ||
		fixture.fakeDispatches != 1 || fixture.staging.count() != 0 || fixture.artifacts.count() != 0 {
		t.Fatalf("cancel-unknown retry/recorder state authority=(%#v,%#v) projections=(%d,%d) Run/Fake/staging/object=(%d,%d,%d,%d)", unknown, afterRedispatch, projectionCount, fixture.projections.count(), fixture.ids.count(port.IDRun), fixture.fakeDispatches, fixture.staging.count(), fixture.artifacts.count())
	}
}

type dispatchedFixture struct {
	service        *service.Service
	store          *sqlite.Store
	adapter        *fake.Adapter
	staging        *stagingWriter
	artifacts      *artifactStore
	projections    *projectionRecorder
	clock          *testClock
	ids            *deterministicIDs
	acDigest       domain.Digest
	graphDigest    domain.Digest
	policy         service.CompletionPolicy
	fakeDispatches int
}

func newDispatchedFixture(t *testing.T, scenario fake.Scenario) dispatchedFixture {
	t.Helper()
	root := t.TempDir()
	clock := &testClock{now: fixedTime}
	store, err := sqlite.OpenAtRootWithClock(t.Context(), root, filepath.Join(root, "taskboard.db"), clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("close SQLite: %v", err)
		}
	})

	staging := &stagingWriter{root: filepath.Join(root, "staging")}
	adapter, err := fake.NewAdapter(scenario.Capabilities(), []fake.Scenario{scenario}, staging)
	if err != nil {
		t.Fatal(err)
	}
	projections := &projectionRecorder{}
	ids := newDeterministicIDs()
	artifacts := &artifactStore{root: filepath.Join(root, "objects")}
	policy := service.CompletionPolicy{
		RevisionDigest: domain.HashString("policy-v1"), RecipeDigest: domain.HashString("recipe-v1"),
		ApprovalRequired: true,
		Checks: map[domain.ACID]service.VerificationRule{
			"AC-1": {VerifierClass: "independent", Independent: true, EnvironmentDigest: domain.HashString("environment-v1")},
		},
	}
	application, err := service.New(store, clock, ids, adapter, artifacts, projections, service.Config{
		Operator: operatorID, IdempotencyTTL: time.Hour, Specification: validSpecification{},
		Completion: policy,
	})
	if err != nil {
		t.Fatal(err)
	}

	outcome, err := application.CreateProject(t.Context(), operatorID, command.CreateProject{
		Metadata:  commandMetadata("cmd_01ARZ3NDEK", "00000000-0000-4000-8000-000000000001", 0),
		ProjectID: projectID, Name: "Taskboard", RepositoryRoot: root, ApprovedRef: "main",
	})
	mustSucceed(t, outcome, err)
	acDigest := domain.HashString("AC-1-revision-v1")
	graphDigest := domain.HashString("dependency-graph-v1")
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		if err := tx.StoreACRevision(t.Context(), port.ACRevision{
			ID: "acr_01ARZ3NDEK", ProjectID: projectID, ACID: "AC-1", Digest: acDigest,
			Content: []byte("candidate is independently verified"), CreatedAtNS: fixedTime.UnixNano(),
		}); err != nil {
			return err
		}
		return tx.StoreDependencyRevision(t.Context(), port.DependencyRevision{
			ProjectID: projectID, Digest: graphDigest, Content: []byte("accepted dependency graph"), CreatedAtNS: fixedTime.UnixNano(),
		})
	}); err != nil {
		t.Fatalf("seed accepted AC revision through persistence port: %v", err)
	}
	outcome, err = application.CreateWorkItem(t.Context(), operatorID, command.CreateWorkItem{
		Metadata:  commandMetadata("cmd_01ARZ3NDEM", "00000000-0000-4000-8000-000000000002", 0),
		ProjectID: projectID, WorkItemID: workItemID, Title: "Vertical slice", Goal: "Prove the Fake path",
		OwnerID: operatorID, RequiredACRevisions: []command.ACRevision{{ACID: "AC-1", RevisionDigest: acDigest}},
	})
	mustSucceed(t, outcome, err)
	outcome, err = application.MarkReady(t.Context(), operatorID, command.MarkReady{
		Metadata:  commandMetadata("cmd_01ARZ3NDEP", "00000000-0000-4000-8000-000000000003", 1),
		ProjectID: projectID, WorkItemID: workItemID,
	})
	mustSucceed(t, outcome, err)
	// Deliberately discard the first successful response. The caller recovers it
	// from the accepted immutable command-result boundary before retrying.
	outcome, err = application.DispatchRun(t.Context(), operatorID, dispatchCommand(scenario.ID()))
	mustSucceed(t, outcome, err)

	return dispatchedFixture{
		service: application, store: store, adapter: adapter, staging: staging, artifacts: artifacts,
		projections: projections, clock: clock, ids: ids, acDigest: acDigest, graphDigest: graphDigest,
		policy: policy,
	}
}

func recoverCommandResult(t *testing.T, application *service.Service, store *sqlite.Store, dispatch command.DispatchRun) []byte {
	t.Helper()
	recovered := loadCommandResultHTTP(t, application, store, dispatch.CommandID)
	replayed, err := application.DispatchRun(t.Context(), operatorID, dispatch)
	if err != nil {
		t.Fatalf("replay dispatch: %v", err)
	}
	if !replayed.Replayed || !bytes.Equal(replayed.Payload, recovered) {
		t.Fatalf("dispatch replay = (replayed %t, %q), want byte-exact %q", replayed.Replayed, replayed.Payload, recovered)
	}
	return recovered
}

func loadCommandResultHTTP(t *testing.T, application *service.Service, store *sqlite.Store, commandID string) []byte {
	t.Helper()
	results := httpapi.UnitCommandResults{Unit: store}
	server, err := httpapi.NewServer(application, results, unavailableProjections{}, testAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(projectID)+"/commands/"+commandID, nil)
	request.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: "session-token"})
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("recover command result %s: status=%d body=%s", commandID, response.Code, response.Body.Bytes())
	}
	return bytes.Clone(response.Body.Bytes())
}

func dispatchCommand(scenarioID string) command.DispatchRun {
	return command.DispatchRun{
		Metadata:  commandMetadata(dispatchCommandID, "00000000-0000-4000-8000-000000000004", 2),
		ProjectID: projectID, WorkItemID: workItemID, AdapterID: fake.AdapterID, ScenarioID: scenarioID,
	}
}

func commandMetadata(commandID, key string, expectedVersion uint64) command.Metadata {
	return command.Metadata{
		CommandID: commandID, IdempotencyKey: key, ExpectedVersion: expectedVersion,
		IssuedAt: fixedTime, CorrelationID: "t087",
	}
}

func mustSucceed(t *testing.T, outcome command.Outcome, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("command failed: %v; payload=%s", err, outcome.Payload)
	}
	if len(outcome.Payload) == 0 || outcome.Replayed {
		t.Fatalf("new command outcome = %#v", outcome)
	}
}

func mustScenario(t *testing.T, id string, capabilities []fake.Capability, steps []fake.Step) fake.Scenario {
	t.Helper()
	scenario, err := fake.NewScenario(id, capabilities, steps)
	if err != nil {
		t.Fatal(err)
	}
	return scenario
}

type claimedFakeRun struct {
	envelope port.ExecutorEnvelope
	fence    fake.Fence
	worker   *fake.Worker
	session  *fake.Session
}

func claimAndStartFake(t *testing.T, fixture *dispatchedFixture, holder domain.ActorID) claimedFakeRun {
	t.Helper()
	envelope, err := fixture.service.ClaimDispatch(t.Context(), holder, service.ClaimDispatchRequest{
		ProjectID: projectID, RunID: dispatchedRunID, Holder: holder,
		ExpectedRestoreGeneration: 1, LeaseDuration: time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	fence := fakeFence(envelope.Fence)
	worker, err := fake.NewWorker(fence)
	if err != nil {
		t.Fatal(err)
	}
	session, observations, err := fixture.adapter.Dispatch(t.Context(), fake.DispatchRequest{Fence: fence, ScenarioID: envelope.ScenarioID})
	if err != nil {
		t.Fatal(err)
	}
	fixture.fakeDispatches++
	publishFakeObservations(t, fixture, envelope.Fence, worker, observations)
	observations, err = session.Poll(t.Context(), fake.TickRequest{Fence: fence, Tick: 1})
	if err != nil {
		t.Fatal(err)
	}
	publishFakeObservations(t, fixture, envelope.Fence, worker, observations)
	return claimedFakeRun{envelope: envelope, fence: fence, worker: worker, session: session}
}

func publishFakeObservations(t *testing.T, fixture *dispatchedFixture, bound port.RunFence, worker *fake.Worker, observations []fake.Observation) {
	t.Helper()
	for _, observation := range observations {
		if err := worker.Accept(observation); err != nil {
			t.Fatalf("Fake worker rejected %s: %v", observation.Kind, err)
		}
		publication, err := fixture.applicationObservation(bound, observation)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fixture.service.PublishRunObservation(t.Context(), bound.Holder, publication); err != nil {
			t.Fatalf("application rejected translated %s: %v", observation.Kind, err)
		}
	}
}

func (fixture *dispatchedFixture) applicationObservation(bound port.RunFence, observation fake.Observation) (service.RunObservation, error) {
	if observation.Fence != fakeFence(bound) {
		return service.RunObservation{}, errors.New("Fake observation escaped its immutable executor envelope")
	}
	kind, err := applicationObservationKind(observation.Kind)
	if err != nil {
		return service.RunObservation{}, err
	}
	translated := service.RunObservation{
		Fence: bound, Kind: kind, ArtifactDigest: observation.ArtifactDigest,
		ArtifactBytes: bytes.Clone(observation.ArtifactBytes),
	}
	if observation.ArtifactName != "" {
		mediaType, ok := fixture.staging.mediaType(observation.Fence.RunID, observation.ArtifactName, observation.ArtifactDigest)
		if !ok {
			return service.RunObservation{}, errors.New("Fake artifact lacks a matching staging record")
		}
		translated.ArtifactMediaType = mediaType
	}
	return translated, nil
}

func applicationObservationKind(kind fake.ObservationKind) (service.RunObservationKind, error) {
	switch kind {
	case fake.ObservationDispatchReceived:
		return service.ObservationDispatchReceived, nil
	case fake.ObservationStartAcknowledged:
		return service.ObservationStartAcknowledged, nil
	case fake.ObservationStartLost:
		return service.ObservationStartLost, nil
	case fake.ObservationHeartbeat:
		return service.ObservationHeartbeat, nil
	case fake.ObservationCheckpoint:
		return service.ObservationCheckpoint, nil
	case fake.ObservationTerminalSuccess:
		return service.ObservationTerminalSuccess, nil
	case fake.ObservationTerminalFailure:
		return service.ObservationTerminalFailure, nil
	case fake.ObservationTimeout:
		return service.ObservationTimeout, nil
	case fake.ObservationLookupRunning:
		return service.ObservationLookupRunning, nil
	case fake.ObservationLookupUnknown:
		return service.ObservationLookupUnknown, nil
	case fake.ObservationCancelAcknowledged:
		return service.ObservationCancelAcknowledged, nil
	case fake.ObservationUnknownOutcome:
		return service.ObservationUnknownOutcome, nil
	case fake.ObservationLateResult:
		return service.ObservationLateResult, nil
	case fake.ObservationStalePublication:
		return service.ObservationStalePublication, nil
	default:
		return "", fmt.Errorf("unsupported Fake observation kind %q", kind)
	}
}

func fakeFence(fence port.RunFence) fake.Fence {
	return fake.Fence{
		RunID: fence.RunID, InputDigest: fence.InputDigest, LeaseHolder: string(fence.Holder),
		LeaseEpoch: fence.Epoch, RestoreGeneration: fence.RestoreGeneration,
	}
}

func loadCompletionMaterial(t *testing.T, fixture *dispatchedFixture, candidateID domain.CandidateID, runID domain.RunID, subject domain.Digest) port.CompletionMaterial {
	t.Helper()
	var material port.CompletionMaterial
	err := fixture.store.Within(t.Context(), func(tx port.Transaction) error {
		var err error
		material, err = tx.LoadCompletionMaterial(t.Context(), port.CompletionMaterialQuery{
			ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidateID, RunID: runID,
			SubjectDigest: subject, GraphRevisionDigest: fixture.graphDigest,
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return material
}

func prospectiveQASubject(t *testing.T, fixture *dispatchedFixture, candidateID domain.CandidateID, runID domain.RunID) domain.CompletionSubject {
	t.Helper()
	material := loadCompletionMaterial(t, fixture, candidateID, runID, domain.HashString("prospective-subject-read"))
	if !material.CandidatePresent || !material.CandidateAvailable || !material.RunPresent || material.ActiveOrUnknownRun ||
		material.WorkItem.Phase() != domain.PhaseReview || material.GraphRevisionDigest != fixture.graphDigest {
		t.Fatalf("persisted prospective-QA material = %#v", material)
	}
	revisions := make([]domain.ACRevisionBinding, len(material.RequiredACRevisions))
	for index, revision := range material.RequiredACRevisions {
		revisions[index] = domain.ACRevisionBinding{ACID: revision.ACID, RevisionDigest: revision.RevisionDigest}
	}
	subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{
		ProjectID: projectID, WorkItemID: workItemID, WorkItemVersion: material.WorkItem.Version() + 1,
		CandidateID: material.Candidate.ID, CandidateDigest: material.Candidate.Digest,
		RunID: material.Run.ID, RunInputDigest: material.Run.InputDigest,
		RequiredACRevisions: revisions, AcceptedGraphRevisionDigest: material.GraphRevisionDigest,
		PolicyRevisionDigest: fixture.policy.RevisionDigest, CompletionRecipeDigest: fixture.policy.RecipeDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	return subject
}

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (clock *testClock) Now() time.Time {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	return clock.now
}

func (clock *testClock) Set(now time.Time) {
	clock.mu.Lock()
	defer clock.mu.Unlock()
	clock.now = now
}

type deterministicIDs struct {
	mu     sync.Mutex
	counts map[port.IDKind]uint64
}

func newDeterministicIDs() *deterministicIDs {
	return &deterministicIDs{counts: make(map[port.IDKind]uint64)}
}

func (source *deterministicIDs) Next(kind port.IDKind) (string, error) {
	source.mu.Lock()
	defer source.mu.Unlock()
	source.counts[kind]++
	if kind == port.IDRun {
		if source.counts[kind] != 1 {
			return "", fmt.Errorf("unexpected second Run ID allocation")
		}
		return string(dispatchedRunID), nil
	}
	return fmt.Sprintf("t047-%s-%d", kind, source.counts[kind]), nil
}

func (source *deterministicIDs) count(kind port.IDKind) uint64 {
	source.mu.Lock()
	defer source.mu.Unlock()
	return source.counts[kind]
}

type validSpecification struct{}

func (validSpecification) ValidFor(domain.ProjectID, domain.WorkItemID, []port.ACRequirement) bool {
	return true
}

type projectionRecorder struct {
	mu          sync.Mutex
	projections []port.CommittedProjection
}

func (recorder *projectionRecorder) PublishCommitted(_ context.Context, projection port.CommittedProjection) error {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	recorder.projections = append(recorder.projections, projection.Clone())
	return nil
}

func (recorder *projectionRecorder) count() int {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	return len(recorder.projections)
}

type stagingCall struct {
	runID     domain.RunID
	name      string
	mediaType string
	digest    domain.Digest
}

type stagingWriter struct {
	mu    sync.Mutex
	root  string
	calls []stagingCall
}

func (writer *stagingWriter) Stage(_ context.Context, runID domain.RunID, name, mediaType string, content []byte) (domain.Digest, error) {
	path := filepath.Join(writer.root, string(runID), name)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return domain.Digest{}, err
	}
	if err := os.WriteFile(path, bytes.Clone(content), 0o600); err != nil {
		return domain.Digest{}, err
	}
	digest := domain.HashBytes(content)
	writer.mu.Lock()
	defer writer.mu.Unlock()
	writer.calls = append(writer.calls, stagingCall{runID: runID, name: name, mediaType: mediaType, digest: digest})
	return digest, nil
}

func (writer *stagingWriter) count() int {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return len(writer.calls)
}

func (writer *stagingWriter) mediaType(runID domain.RunID, name string, digest domain.Digest) (string, bool) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	for _, call := range writer.calls {
		if call.runID == runID && call.name == name && call.digest == digest {
			return call.mediaType, true
		}
	}
	return "", false
}

type artifactStore struct {
	mu       sync.Mutex
	root     string
	putCalls int
}

func (store *artifactStore) Put(_ context.Context, source io.Reader) (domain.Digest, uint64, error) {
	content, err := io.ReadAll(source)
	if err != nil {
		return domain.Digest{}, 0, err
	}
	digest := domain.HashBytes(content)
	if err := os.MkdirAll(store.root, 0o700); err != nil {
		return domain.Digest{}, 0, err
	}
	if err := os.WriteFile(filepath.Join(store.root, digest.String()), content, 0o600); err != nil {
		return domain.Digest{}, 0, err
	}
	store.mu.Lock()
	store.putCalls++
	store.mu.Unlock()
	return digest, uint64(len(content)), nil
}

func (store *artifactStore) Open(_ context.Context, digest domain.Digest) (io.ReadCloser, error) {
	return os.Open(filepath.Join(store.root, digest.String()))
}

func (store *artifactStore) count() int {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.putCalls
}

type testAuthority struct{}

func (testAuthority) Authenticate(context.Context, string) (httpapi.Session, error) {
	return httpapi.Session{ID: "t047-session", Principal: operatorID}, nil
}

func (testAuthority) AuthorizeProject(context.Context, httpapi.Session, domain.ProjectID) error {
	return nil
}

func (testAuthority) AuthorizeCommandResult(context.Context, httpapi.Session, domain.ProjectID, string) error {
	return nil
}

func (testAuthority) Revoked(httpapi.Session) <-chan struct{} { return nil }

type unavailableProjections struct{}

func (unavailableProjections) Snapshot(context.Context, domain.ProjectID) (httpapi.ProjectionSnapshot, error) {
	return httpapi.ProjectionSnapshot{}, errors.New("unused projection snapshot")
}

func (unavailableProjections) Replay(context.Context, domain.ProjectID, port.Cursor) (httpapi.ProjectionReplay, error) {
	return httpapi.ProjectionReplay{}, errors.New("unused projection replay")
}
