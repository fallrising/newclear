package service

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

type coverageCountingExecutor struct {
	declaration port.ExecutorDeclaration
	calls       int
}

func (e *coverageCountingExecutor) Declaration() port.ExecutorDeclaration {
	e.calls++
	return e.declaration
}

// All accepted state is produced by commands against authenticated Git objects;
// the multi-AC case never installs accepted heads directly in SQL.
func TestVerifiedCoverage_AcceptedMultiACHTTPAndRestart(t *testing.T) {
	testAcceptedMultiACHTTPAndRestart(t, false)
}

// The index variant shares lawful accepted/Fake/human-report setup with the
// original coverage oracle; only material discovery and its extra assertions differ.
func testAcceptedMultiACHTTPAndRestart(t *testing.T, discover bool) {
	t.Helper()
	acs := []domain.ACID{"AC-A", domain.ACID(strings.Repeat("界", 40))}
	svc, store, db, accept := initialFixtureContentACs(t, initialContent, acs)
	environment := domain.HashString("selected coverage environment")
	rules := []port.RunInputVerificationRule{}
	for _, ac := range acs {
		rules = append(rules, port.RunInputVerificationRule{ACID: ac, VerifierClass: "human", Independent: true, ProhibitedVerifierRunRole: "producer", EnvironmentDigest: environment.String()})
	}
	profile, err := port.NewPolicyProfile(port.PolicyProfileMaterial{Schema: 1, ProjectID: projectID, RecipeDigest: domain.HashString("initial recipe").String(), ApprovalRequired: false, IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}, Rules: rules})
	if err != nil {
		t.Fatal(err)
	}
	svc.config.ProjectPolicies = map[domain.ProjectID]port.PolicyProfile{projectID: profile, "other-project": serviceProfile(t, "other-project", "AC-A")}
	poisonDefault(svc)
	accept.PolicyRevisionDigest = profile.Digest()
	if err = store.Within(t.Context(), func(tx port.Transaction) error {
		p, e := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), projectID, accept.ProposalDigest)
		if e != nil {
			return e
		}
		_, accept.AcceptanceSubjectDigest, e = port.CanonicalInitialAcceptanceSubject(port.NewInitialAcceptanceSubject(projectID, 1, p, accept.PolicyRevisionDigest, accept.WorkItems))
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.AcceptInitialSpecification(t.Context(), operator, accept); err != nil {
		t.Fatal(err)
	}
	artifacts := identityArtifacts{root: t.TempDir()}
	svc.artifacts = artifacts
	if _, err = svc.MarkReady(t.Context(), operator, command.MarkReady{Metadata: initialMetadata(50, 2), ProjectID: projectID, WorkItemID: workItemID}); err != nil {
		t.Fatal(err)
	}
	run := dispatchAccepted(t, svc, db, command.DispatchRun{Metadata: initialMetadata(51, 3), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"})
	envelope, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(run))
	if err != nil {
		t.Fatal(err)
	}
	scenario, err := fake.NewScenario("success", []fake.Capability{fake.CapabilityStartAck}, []fake.Step{{Tick: 0, Kind: fake.ObservationDispatchReceived}, {Tick: 1, Kind: fake.ObservationStartAcknowledged}, {Tick: 2, Kind: fake.ObservationTerminalSuccess, Artifact: &fake.Artifact{Name: "candidate.txt", MediaType: "text/plain", Bytes: []byte("candidate")}}})
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := fake.NewAdapter([]fake.Capability{fake.CapabilityStartAck}, []fake.Scenario{scenario}, artifacts)
	if err != nil {
		t.Fatal(err)
	}
	fence := fake.Fence{RunID: run, InputDigest: envelope.Fence.InputDigest, LeaseHolder: string(envelope.Fence.Holder), LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration}
	session, observations, err := adapter.Dispatch(t.Context(), fake.DispatchRequest{Fence: fence, ScenarioID: "success"})
	if err != nil {
		t.Fatal(err)
	}
	publish := func(os []fake.Observation) {
		for _, o := range os {
			v := RunObservation{Fence: envelope.Fence, Kind: RunObservationKind(o.Kind), ArtifactDigest: o.ArtifactDigest, ArtifactBytes: o.ArtifactBytes}
			if len(v.ArtifactBytes) > 0 {
				v.ArtifactMediaType = "text/plain"
			}
			if _, e := svc.PublishRunObservation(t.Context(), "worker", v); e != nil {
				t.Fatal(e)
			}
		}
	}
	publish(observations)
	for tick := uint64(1); tick <= 2; tick++ {
		observations, err = session.Poll(t.Context(), fake.TickRequest{Fence: fence, Tick: tick})
		if err != nil {
			t.Fatal(err)
		}
		publish(observations)
	}
	candidate := command.SubmitCandidate{Metadata: initialMetadata(60, 4), ProjectID: projectID, WorkItemID: workItemID, RunID: run, Candidate: command.Candidate{ID: "candidate-multi", RunID: run, Digest: domain.HashString("candidate"), InputSubjectDigest: envelope.Fence.InputDigest, CreatedAt: fixedTime(), Artifacts: []command.ArtifactLocator{{Digest: domain.HashString("candidate"), MediaType: "text/plain", ByteLength: 9, Availability: "Present"}}}}
	if _, err = svc.SubmitCandidate(t.Context(), operator, candidate); err != nil {
		t.Fatal(err)
	}
	read := func() []byte {
		t.Helper()
		rowsBefore := preparationDatabaseSnapshot(t, db)
		idsBefore := maps.Clone(svc.ids.(*sequenceIDs).values)
		h, e := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
		if e != nil {
			t.Fatal(e)
		}
		lookup := "candidate-multi"
		if discover {
			index := readDiscoveredMaterial(t, h)
			if index.Accepted == nil || len(index.ACs) != len(acs) || index.ACs[1].ACID != string(acs[1]) {
				t.Fatalf("accepted discovery: %+v", index)
			}
			lookup = index.Candidates[0].ID
			candidate.Candidate.ID = domain.CandidateID(lookup)
			run = domain.RunID(index.Candidates[0].RunID)
			consumeDiscoveredMaterial(t, h, index)
		}
		r := initialHTTPRequest(h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/work-items/"+string(workItemID)+"/candidates/"+lookup+"/verified-coverage", nil, true, false)
		if r.Code != 200 {
			t.Fatalf("coverage HTTP %d: %s", r.Code, r.Body)
		}
		if !bytes.Equal(rowsBefore, preparationDatabaseSnapshot(t, db)) || !maps.Equal(idsBefore, svc.ids.(*sequenceIDs).values) {
			t.Fatal("discovery/linked reads wrote rows or allocated IDs")
		}
		return bytes.Clone(r.Body.Bytes())
	}
	var first coverageTestResponse
	if err = json.Unmarshal(read(), &first); err != nil {
		t.Fatal(err)
	}
	if len(first.Coverage) != 2 || first.Coverage[0].Covered || first.Coverage[1].Covered || first.Mode != "prospective_qa" {
		t.Fatalf("initial coverage: %+v", first)
	}
	subjectDigest, err := domain.ParseDigest(strings.TrimPrefix(first.Digest, "sha256:"))
	if err != nil {
		t.Fatal(err)
	}
	for i, ac := range acs {
		q := command.SubmitHumanReport{Metadata: initialMetadata(70+i, 5), ProjectID: projectID, WorkItemID: workItemID, RunID: run, ReportID: fmt.Sprintf("report_%010d", 70+i), SubjectDigest: subjectDigest, LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration, Kind: "evidence", MediaType: "text/plain", Content: "candidate", Evidence: &command.HumanEvidenceIntent{ACID: ac, ACRevisionDigest: domain.HashBytes(initialContent), RecipeDigest: domain.HashString("initial recipe"), EnvironmentDigest: environment, Verdict: "Passing"}}
		if _, err = svc.SubmitHumanReport(t.Context(), operator, q); err != nil {
			t.Fatal(err)
		}
	}
	review := command.SubmitHumanReport{Metadata: initialMetadata(72, 5), ProjectID: projectID, WorkItemID: workItemID, RunID: run, ReportID: "report_0000000072", SubjectDigest: subjectDigest, LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration, Kind: "review", MediaType: "text/plain", Content: "candidate", Review: &command.HumanReviewIntent{Verdict: "Approved"}}
	if _, err = svc.SubmitHumanReport(t.Context(), operator, review); err != nil {
		t.Fatal(err)
	}
	before := preparationDatabaseSnapshot(t, db)
	reviewBytes := read()
	var got coverageTestResponse
	if err = json.Unmarshal(reviewBytes, &got); err != nil {
		t.Fatal(err)
	}
	if !got.Coverage[0].Covered || !got.Coverage[1].Covered || got.Coverage[1].AC != string(acs[1]) || got.Eligibility.Evaluated || got.Digest != first.Digest {
		t.Fatalf("human coverage: %s", reviewBytes)
	}
	if !bytes.Equal(before, preparationDatabaseSnapshot(t, db)) {
		t.Fatal("GET wrote persisted rows")
	}
	var seq int
	var name, filename string
	if err = db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &filename); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(filename), filename, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	executor := &coverageCountingExecutor{declaration: svc.executorDeclaration}
	svc, err = New(store, svc.clock, svc.ids, executor, artifacts, httpapi.NewHub(), svc.config)
	if err != nil {
		t.Fatal(err)
	}
	// Reopening advances the stream epoch; the semantic coverage remains exact.
	if err = json.Unmarshal(read(), &got); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 1 {
		t.Fatalf("coverage called executor after constructor: %d", executor.calls)
	}
	if got.Digest != first.Digest || !got.Coverage[0].Covered || !got.Coverage[1].Covered {
		t.Fatalf("restart changed coverage: %+v", got)
	}
	if _, err = svc.RequestQA(t.Context(), operator, command.RequestQA{Metadata: initialMetadata(73, 5), ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidate.Candidate.ID, SubjectDigest: subjectDigest}); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(read(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Eligibility.Evaluated || !got.Eligibility.Satisfied || got.Mode != "current_qa" || got.Version != 6 {
		t.Fatalf("QA eligibility: %+v", got)
	}
	var subject domain.CompletionSubject
	if err = store.Within(t.Context(), func(tx port.Transaction) error {
		m, _, e := svc.currentCompletionMaterial(t.Context(), tx, port.CompletionMaterialQuery{ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidate.Candidate.ID})
		if e != nil {
			return e
		}
		subject, e = preparationSubject(m, svc.completionFor(projectID))
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.CompleteWorkItem(t.Context(), operator, command.CompleteWorkItem{Metadata: initialMetadata(74, 6), ProjectID: projectID, WorkItemID: workItemID, Subject: subject}); err != nil {
		t.Fatal(err)
	}
	item, err := store.LoadWorkItem(t.Context(), projectID, workItemID)
	if err != nil || item.Phase() != domain.PhaseDone {
		t.Fatal("explicit completion did not reach Done", err)
	}
	if discover {
		h, e := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
		if e != nil {
			t.Fatal(e)
		}
		if index := readDiscoveredMaterial(t, h); index.Phase != "Done" {
			t.Fatal("Done discovery lost guarded phase", index.Phase)
		}
	}
}

type coverageFailedUnit struct{ err error }

func (u coverageFailedUnit) Within(context.Context, func(port.Transaction) error) error { return u.err }

func TestVerifiedCoverage_FinalDBFailureAndRegressingCursor(t *testing.T) {
	for _, kind := range []string{"database", "cursor"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 5)
			fault := errors.New("injected final database fault")
			changed := false
			f.svc.artifacts = changingCurrentArtifacts{base: f.svc.artifacts, after: func() {
				if changed {
					return
				}
				changed = true
				if kind == "database" {
					f.svc.unit = coverageFailedUnit{fault}
				} else {
					coverageExec(t, f, "UPDATE instance_state SET next_event_sequence=next_event_sequence-1")
				}
			}}
			b, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
			if b != nil || err == nil || !changed {
				t.Fatalf("final %s accepted: %s %v", kind, b, err)
			}
			if kind == "database" {
				if !errors.Is(err, fault) {
					t.Fatalf("final unknown DB failure changed classification: %v", err)
				}
			} else {
				assertCommandError(t, err, command.CodeStaleSubject)
			}
		})
	}
}

func TestVerifiedCoverage_CorruptionPrecedesPolicyDrift(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	coverageExec(t, f, "DROP TRIGGER artifacts_immutable_update")
	coverageExec(t, f, "UPDATE artifacts SET storage_key='invalid'")
	f.svc.config.Completion.RevisionDigest = domain.HashString("changed policy")
	f.svc.artifacts = rejectCurrentArtifacts{t: t}
	b, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
	if b != nil || !errors.Is(err, domain.ErrStorageCorruption) {
		t.Fatalf("corrupt plus stale must be corruption: %s %v", b, err)
	}
}
