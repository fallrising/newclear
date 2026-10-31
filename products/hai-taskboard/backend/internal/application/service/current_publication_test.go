package service

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/testfixture"
)

func acceptedSucceededInput(t *testing.T) (*Service, *sqlite.Store, *sql.DB, port.ExecutorEnvelope, command.SubmitCandidate) {
	return acceptedSucceededInputPolicy(t, nil)
}

func acceptedSucceededInputPolicy(t *testing.T, profile *port.PolicyProfile) (*Service, *sqlite.Store, *sql.DB, port.ExecutorEnvelope, command.SubmitCandidate) {
	t.Helper()
	svc, store, db, dispatch := acceptedReadyInputPolicy(t, profile)
	svc.artifacts = currentArtifacts{}
	rule := svc.config.Completion.Checks["AC-A"]
	rule.VerifierClass = "independent"
	rule.Independent = true
	svc.config.Completion.Checks["AC-A"] = rule
	id := dispatchAccepted(t, svc, db, dispatch)
	envelope, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id))
	if err != nil {
		t.Fatal(err)
	}

	scenario, err := fake.NewScenario("success", []fake.Capability{fake.CapabilityStartAck}, []fake.Step{{Tick: 0, Kind: fake.ObservationDispatchReceived}, {Tick: 1, Kind: fake.ObservationStartAcknowledged}, {Tick: 2, Kind: fake.ObservationTerminalSuccess, Artifact: &fake.Artifact{Name: "candidate.txt", MediaType: "text/plain", Bytes: []byte("candidate")}}})
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := fake.NewAdapter([]fake.Capability{fake.CapabilityStartAck}, []fake.Scenario{scenario}, currentArtifacts{})
	if err != nil {
		t.Fatal(err)
	}
	fence := fake.Fence{RunID: id, InputDigest: envelope.Fence.InputDigest, LeaseHolder: string(envelope.Fence.Holder), LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration}
	session, observations, err := adapter.Dispatch(t.Context(), fake.DispatchRequest{Fence: fence, ScenarioID: "success"})
	if err != nil {
		t.Fatal(err)
	}
	publish := func(observations []fake.Observation) {
		for _, observation := range observations {
			value := RunObservation{Fence: envelope.Fence, Kind: RunObservationKind(observation.Kind), ArtifactDigest: observation.ArtifactDigest, ArtifactBytes: observation.ArtifactBytes}
			if len(value.ArtifactBytes) > 0 {
				value.ArtifactMediaType = "text/plain"
			}
			if _, err := svc.PublishRunObservation(t.Context(), "worker", value); err != nil {
				t.Fatal(err)
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
	if len(session.Transcript()) != 3 {
		t.Fatal("Fake did not finish exactly one scripted run")
	}

	q := command.SubmitCandidate{Metadata: initialMetadata(60, 4), ProjectID: projectID, WorkItemID: workItemID, RunID: id,
		Candidate: command.Candidate{ID: "candidate-current", RunID: id, Digest: domain.HashString("candidate"), InputSubjectDigest: envelope.Fence.InputDigest, CreatedAt: fixedTime(),
			Artifacts: []command.ArtifactLocator{{Digest: domain.HashString("candidate"), MediaType: "text/plain", ByteLength: 9, Availability: "Present"}}}}
	return svc, store, db, envelope, q
}

type currentArtifacts struct{}

func (currentArtifacts) Put(_ context.Context, r io.Reader) (domain.Digest, uint64, error) {
	b, err := io.ReadAll(r)
	return domain.HashBytes(b), uint64(len(b)), err
}
func (currentArtifacts) Open(_ context.Context, d domain.Digest) (io.ReadCloser, error) {
	for _, content := range []string{"candidate", "supplement"} {
		if d == domain.HashString(content) {
			return io.NopCloser(bytes.NewBufferString(content)), nil
		}
	}
	return nil, port.ErrNotFound
}

func TestAdmission_StalePublicationAndReusePreserveHistory(t *testing.T) {
	svc, _, db, _, q := acceptedSucceededInput(t)
	svc.config.Completion.ApprovalRequired = !svc.config.Completion.ApprovalRequired
	if _, err := svc.SubmitCandidate(t.Context(), operator, q); err == nil {
		t.Fatal("stale successful Run granted Candidate authority")
	}
	var candidates int
	var phase string
	if err := db.QueryRow("SELECT count(*) FROM candidates").Scan(&candidates); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT phase FROM work_items").Scan(&phase); err != nil {
		t.Fatal(err)
	}
	if candidates != 0 || phase != "Developing" {
		t.Fatalf("stale publication mutated history: candidates=%d phase=%s", candidates, phase)
	}
}

type currentFlow struct {
	svc       *Service
	store     *sqlite.Store
	db        *sql.DB
	candidate command.SubmitCandidate
	review    command.PublishFixtureReview
	evidence  command.PublishFixtureEvidence
	approval  command.ApproveSubject
	qa        command.RequestQA
	complete  command.CompleteWorkItem
}

func acceptedCurrentFlow(t *testing.T, stage int) currentFlow {
	return acceptedCurrentFlowPolicy(t, stage, nil)
}

func acceptedCurrentFlowPolicy(t *testing.T, stage int, profile *port.PolicyProfile) currentFlow {
	t.Helper()
	svc, store, db, envelope, candidate := acceptedSucceededInputPolicy(t, profile)
	f := currentFlow{svc: svc, store: store, db: db, candidate: candidate}
	if stage == 0 {
		return f
	}
	if _, err := svc.SubmitCandidate(t.Context(), operator, candidate); err != nil {
		t.Fatal(err)
	}
	var subject domain.CompletionSubject
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		material, _, err := svc.currentCompletionMaterial(t.Context(), tx, port.CompletionMaterialQuery{ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidate.Candidate.ID})
		if err != nil {
			return err
		}
		subject, err = preparationSubject(material, svc.completionFor(projectID))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	f.review = command.PublishFixtureReview{Metadata: initialMetadata(61, 5), ProjectID: projectID, RunID: candidate.RunID, LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration, Review: command.Review{ID: "review-current", SubjectDigest: subject.Digest(), ReviewerID: operator, ReviewerClass: "independent", Verdict: "Approved", CreatedAt: fixedTime()}}
	f.evidence = command.PublishFixtureEvidence{Metadata: initialMetadata(62, 5), ProjectID: projectID, RunID: candidate.RunID, LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration, Evidence: command.Evidence{ID: "evidence-current", SubjectDigest: subject.Digest(), ACID: "AC-A", ACRevisionDigest: domain.HashBytes(initialContent), ObservationVerdict: "Passing", ReviewDisposition: "Accepted", Applicability: "Fresh", MaterialAvailability: "Present", VerifierID: operator, VerifierClass: svc.completionFor(projectID).Checks["AC-A"].VerifierClass, RecipeDigest: svc.completionFor(projectID).RecipeDigest, EnvironmentDigest: svc.completionFor(projectID).Checks["AC-A"].EnvironmentDigest, ObservedAt: fixedTime(), Report: candidate.Candidate.Artifacts[0]}}
	f.approval = command.ApproveSubject{Metadata: initialMetadata(63, 5), ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidate.Candidate.ID, RequestID: "approval-current", SubjectDigest: subject.Digest(), Decision: "Approved"}
	f.qa = command.RequestQA{Metadata: initialMetadata(64, 5), ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidate.Candidate.ID, SubjectDigest: subject.Digest()}
	f.complete = command.CompleteWorkItem{Metadata: initialMetadata(65, 6), ProjectID: projectID, WorkItemID: workItemID, Subject: subject}
	for i := 1; i < stage; i++ {
		if _, err := f.call(t, i); err != nil {
			t.Fatalf("advance %d: %v", i, err)
		}
	}
	return f
}
func (f currentFlow) call(t *testing.T, stage int) (command.Outcome, error) {
	t.Helper()
	switch stage {
	case 0:
		return f.svc.SubmitCandidate(t.Context(), operator, f.candidate)
	case 1:
		return f.svc.PublishFixtureReview(t.Context(), operator, f.review)
	case 2:
		return f.svc.PublishFixtureEvidence(t.Context(), operator, f.evidence)
	case 3:
		return f.svc.ApproveSubject(t.Context(), operator, f.approval)
	case 4:
		return f.svc.RequestQA(t.Context(), operator, f.qa)
	default:
		return f.svc.CompleteWorkItem(t.Context(), operator, f.complete)
	}
}
func currentHistoryCounts(t *testing.T, db *sql.DB) []int {
	t.Helper()
	var counts []int
	for _, table := range []string{"candidates", "candidate_artifacts", "reviews", "evidence", "approvals", "completion_records", "approval_consumptions", "completion_record_evidence", "completion_record_reviews", "completion_record_approvals", "artifacts", "audit_groups", "audit_entries", "projection_events", "runs", "run_input_envelopes", "run_output_artifacts", "accepted_spec_revisions", "accepted_work_item_bindings"} {
		var n int
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		counts = append(counts, n)
	}
	var version int
	if err := db.QueryRow("SELECT version FROM work_items").Scan(&version); err != nil {
		t.Fatal(err)
	}
	return append(counts, version)
}
func TestAdmission_CurrentAcceptedInputsReachDoneAndReplay(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	original, err := f.call(t, 5)
	if err != nil {
		t.Fatal(err)
	}
	var phase string
	if err := f.db.QueryRow("SELECT phase FROM work_items").Scan(&phase); err != nil || phase != "Done" {
		t.Fatal(phase, err)
	}
	for _, q := range []string{"DROP TRIGGER run_input_envelopes_no_delete", "DELETE FROM run_input_envelopes", "DELETE FROM work_item_spec_heads", "DROP TRIGGER run_output_artifacts_no_delete", "DELETE FROM run_output_artifacts"} {
		if _, err := f.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	var seq int
	var name, path string
	if err := f.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	if err := f.store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	f.svc.unit = reopened
	before := currentHistoryCounts(t, f.db)
	f.svc.artifacts = rejectCurrentArtifacts{t: t}
	for stage := range 6 {
		replay, err := f.call(t, stage)
		if err != nil || !replay.Replayed {
			t.Fatalf("legacy exact replay %d: %v", stage, err)
		}
		if stage == 5 && !bytes.Equal(replay.Payload, original.Payload) {
			t.Fatal("changed replay bytes")
		}
	}
	if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
		t.Fatal("replay changed history")
	}
}

type rejectCurrentArtifacts struct{ t *testing.T }

func (a rejectCurrentArtifacts) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	a.t.Fatal("replay writes artifact")
	return domain.Digest{}, 0, port.ErrNotFound
}
func (a rejectCurrentArtifacts) Open(context.Context, domain.Digest) (io.ReadCloser, error) {
	a.t.Fatal("replay reads artifact")
	return nil, port.ErrNotFound
}

func TestAdmission_AllPublicationConsumersRejectStaleInputs(t *testing.T) {
	for stage := range 6 {
		for _, kind := range []string{"policy", "recipe", "environment", "missing_environment", "class", "independent", "actor", "role", "approval", "base", "adapter", "scenario", "missing_heads", "legacy", "canonical", "partial_requirements", "outbox"} {
			t.Run(fmt.Sprintf("%d/%s", stage, kind), func(t *testing.T) {
				f := acceptedCurrentFlow(t, stage)
				rule := f.svc.config.Completion.Checks["AC-A"]
				var statements []string
				switch kind {
				case "policy":
					f.svc.config.Completion.RevisionDigest = domain.HashString("changed")
				case "recipe":
					f.svc.config.Completion.RecipeDigest = domain.HashString("changed")
				case "environment":
					rule.EnvironmentDigest = domain.HashString("changed")
				case "missing_environment":
					rule.EnvironmentDigest = domain.Digest{}
				case "class":
					rule.VerifierClass = "changed"
				case "independent":
					rule.Independent = !rule.Independent
				case "actor":
					rule.ProhibitedVerifierActor = "changed"
				case "role":
					rule.ProhibitedVerifierRunRole = "changed"
				case "approval":
					f.svc.config.Completion.ApprovalRequired = !f.svc.config.Completion.ApprovalRequired
				case "base":
					f.svc.config.Completion.IntegrationBaseDigest = domain.HashString("changed")
				case "adapter":
					f.svc.executorDeclaration.AdapterVersion = "2"
				case "scenario":
					f.svc.executorDeclaration.Scenarios = []string{"other"}
				case "missing_heads":
					statements = []string{"DELETE FROM work_item_spec_heads"}
				case "legacy":
					statements = []string{"DROP TRIGGER run_input_envelopes_no_delete", "DELETE FROM run_input_envelopes"}
				case "canonical":
					statements = []string{"DROP TRIGGER run_input_envelopes_no_update", "UPDATE run_input_envelopes SET canonical_content=x'7b7d'"}
				case "partial_requirements":
					statements = []string{"DELETE FROM current_ac_requirements"}
				case "outbox":
					statements = []string{"DROP TRIGGER outbox_immutable_identity_update", "UPDATE outbox SET payload_digest='" + domain.HashString("changed").String() + "'"}
				}
				f.svc.config.Completion.Checks["AC-A"] = rule
				for _, q := range statements {
					if _, err := f.db.Exec(q); err != nil {
						t.Fatal(err)
					}
				}
				before := currentHistoryCounts(t, f.db)
				if _, err := f.call(t, stage); err == nil {
					t.Fatal("stale input granted authority")
				}
				if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
					t.Fatal("stale rejection changed history")
				}
			})
		}
	}
}

func (currentArtifacts) Stage(_ context.Context, _ domain.RunID, _, _ string, b []byte) (domain.Digest, error) {
	return domain.HashBytes(b), nil
}

// These four cases explicitly model already-verified successor heads at the port;
// they are not SQL acceptance or activation evidence.
func TestAdmission_ModeledCurrentSemanticChangesRejectAllConsumers(t *testing.T) {
	for stage := range 6 {
		for _, kind := range []string{"binding", "graph", "ac_revision", "ac_set"} {
			t.Run(fmt.Sprintf("%d/%s", stage, kind), func(t *testing.T) {
				f := acceptedCurrentFlow(t, stage)
				var view port.CurrentSpecification
				if err := f.store.Within(t.Context(), func(tx port.Transaction) error {
					var err error
					view, err = tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), projectID, workItemID)
					return err
				}); err != nil {
					t.Fatal(err)
				}
				switch kind {
				case "binding":
					view.BindingDigest = domain.HashString("new verified binding")
				case "graph":
					view.GraphRevisionDigest = domain.HashString("new verified graph")
				case "ac_revision":
					view.Requirements[0].RevisionDigest = domain.HashString("new verified AC")
				case "ac_set":
					view.Requirements = append(view.Requirements, port.ACRequirement{ProjectID: projectID, WorkItemID: workItemID, ACID: "AC-B", RevisionDigest: domain.HashString("new verified AC")})
					f.svc.config.Completion.Checks["AC-B"] = f.svc.config.Completion.Checks["AC-A"]
				}
				f.svc.unit = testfixture.VerifiedInputUnit{Base: f.store, View: view}
				before := currentHistoryCounts(t, f.db)
				if _, err := f.call(t, stage); err == nil {
					t.Fatal("modeled stale input accepted")
				}
				if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
					t.Fatal("stale modeled input changed history")
				}
			})
		}
	}
}

type changingCurrentArtifacts struct {
	base  port.ArtifactStore
	after func()
}

func (a changingCurrentArtifacts) Put(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
	return a.base.Put(ctx, r)
}
func (a changingCurrentArtifacts) Open(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
	r, err := a.base.Open(ctx, d)
	if err != nil {
		return nil, err
	}
	return afterCurrentClose{ReadCloser: r, after: a.after}, nil
}

type afterCurrentClose struct {
	io.ReadCloser
	after func()
}

func (r afterCurrentClose) Close() error { err := r.ReadCloser.Close(); r.after(); return err }
func TestAdmission_RechecksCurrentInputsAfterOutsideLockBytes(t *testing.T) {
	for _, stage := range []int{0, 2, 5} {
		for _, kind := range []string{"policy_semantics", "accepted_head_identity"} {
			t.Run(fmt.Sprintf("%d/%s", stage, kind), func(t *testing.T) {
				f := acceptedCurrentFlow(t, stage)
				before := currentHistoryCounts(t, f.db)
				changed := false
				f.svc.artifacts = changingCurrentArtifacts{base: f.svc.artifacts, after: func() {
					if changed {
						return
					}
					changed = true
					if kind == "policy_semantics" {
						f.svc.config.Completion.ApprovalRequired = !f.svc.config.Completion.ApprovalRequired
					} else {
						if _, err := f.db.Exec("UPDATE work_item_spec_heads SET head_version=head_version+1"); err != nil {
							t.Fatal(err)
						}
					}
				}}
				if _, err := f.call(t, stage); err == nil {
					t.Fatal("changed preflight accepted")
				}
				if !changed {
					t.Fatal("no byte read")
				}
				if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
					t.Fatal("TOCTOU committed partial publication")
				}
			})
		}
	}
}

func TestAdmission_PublicationWritesRollback(t *testing.T) {
	for stage, tables := range [][]string{{"candidates", "candidate_artifacts", "work_items"}, {"reviews"}, {"artifacts", "evidence"}, {"approvals"}, {"work_items"}, {"completion_records", "approval_consumptions", "completion_record_evidence", "completion_record_reviews", "completion_record_approvals", "work_items"}} {
		for _, table := range append(tables, "audit_entries", "projection_events", "command_results", "idempotency_records") {
			t.Run(fmt.Sprintf("%d/%s", stage, table), func(t *testing.T) {
				f := acceptedCurrentFlow(t, stage)
				if table == "artifacts" {
					locator := command.ArtifactLocator{Digest: domain.HashString("supplement"), MediaType: "text/plain", ByteLength: 10, Availability: "Present"}
					if stage == 0 {
						f.candidate.Candidate.Artifacts = append(f.candidate.Candidate.Artifacts, locator)
					} else {
						f.evidence.Evidence.Report = locator
					}
				}
				before := currentHistoryCounts(t, f.db)
				action := "INSERT"
				if table == "work_items" {
					action = "UPDATE"
				}
				if _, err := f.db.Exec("CREATE TRIGGER publication_fault BEFORE " + action + " ON " + table + " BEGIN SELECT RAISE(ABORT,'publication fault'); END"); err != nil {
					t.Fatal(err)
				}
				if _, err := f.call(t, stage); err == nil {
					t.Fatal("injected write fault accepted")
				}
				if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
					t.Fatal("fault left partial authority")
				}
			})
		}
	}
}

type publicationPostwriteUnit struct {
	base  port.UnitOfWork
	stage int
	after func() error
}

func (u publicationPostwriteUnit) Within(ctx context.Context, f func(port.Transaction) error) error {
	return u.base.Within(ctx, func(tx port.Transaction) error {
		return f(publicationPostwriteTransaction{AuthorityTransaction: tx.(port.AuthorityTransaction), current: tx.(port.CurrentInputTransaction), outputs: tx.(port.RunOutputTransaction), stage: u.stage, after: u.after})
	})
}

type publicationPostwriteTransaction struct {
	port.AuthorityTransaction
	current port.CurrentInputTransaction
	outputs port.RunOutputTransaction
	stage   int
	after   func() error
}

func (tx publicationPostwriteTransaction) LoadRunOutputs(ctx context.Context, p domain.ProjectID, r domain.RunID) ([]port.RunOutput, error) {
	return tx.outputs.LoadRunOutputs(ctx, p, r)
}
func (tx publicationPostwriteTransaction) StoreRunOutput(ctx context.Context, w port.RunOutputWrite) error {
	return tx.outputs.StoreRunOutput(ctx, w)
}
func (tx publicationPostwriteTransaction) LoadCurrentSpecification(ctx context.Context, p domain.ProjectID, w domain.WorkItemID) (port.CurrentSpecification, error) {
	return tx.current.LoadCurrentSpecification(ctx, p, w)
}
func (tx publicationPostwriteTransaction) LoadRunInput(ctx context.Context, p domain.ProjectID, r domain.RunID) (port.RunInputEnvelope, error) {
	return tx.current.LoadRunInput(ctx, p, r)
}
func (tx publicationPostwriteTransaction) StoreRunInput(ctx context.Context, v port.RunInputEnvelope) error {
	return tx.current.StoreRunInput(ctx, v)
}
func (tx publicationPostwriteTransaction) StoreCandidate(ctx context.Context, v port.Candidate) error {
	if err := tx.AuthorityTransaction.StoreCandidate(ctx, v); err != nil {
		return err
	}
	if tx.stage == 0 {
		return tx.after()
	}
	return nil
}
func (tx publicationPostwriteTransaction) StoreEvidence(ctx context.Context, v port.Evidence) error {
	if err := tx.AuthorityTransaction.StoreEvidence(ctx, v); err != nil {
		return err
	}
	if tx.stage == 2 {
		return tx.after()
	}
	return nil
}
func (tx publicationPostwriteTransaction) StoreCompletion(ctx context.Context, v port.Completion) error {
	if err := tx.AuthorityTransaction.StoreCompletion(ctx, v); err != nil {
		return err
	}
	if tx.stage == 5 {
		return tx.after()
	}
	return nil
}
func TestAdmission_PublicationPostwriteRecordableAndCancellationRollback(t *testing.T) {
	for _, stage := range []int{0, 2, 5} {
		for _, kind := range []string{"recordable", "cancellation"} {
			t.Run(fmt.Sprintf("%d/%s", stage, kind), func(t *testing.T) {
				f := acceptedCurrentFlow(t, stage)
				before := currentHistoryCounts(t, f.db)
				var results int
				if err := f.db.QueryRow("SELECT count(*) FROM command_results").Scan(&results); err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				f.svc.unit = publicationPostwriteUnit{base: f.store, stage: stage, after: func() error {
					if kind == "cancellation" {
						cancel()
						return ctx.Err()
					}
					return command.NewError(command.CodeLifecycleRejected, "postwrite test fault", false, nil, nil)
				}}
				// f.call uses t.Context; the injected cancellation error must itself roll back.
				if _, err := f.call(t, stage); err == nil {
					t.Fatal("postwrite error accepted")
				} else if kind == "cancellation" && !errors.Is(err, context.Canceled) {
					t.Fatalf("lost cancellation: %v", err)
				}
				if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
					t.Fatal("postwrite failure retained authority")
				}
				var after int
				if err := f.db.QueryRow("SELECT count(*) FROM command_results").Scan(&after); err != nil {
					t.Fatal(err)
				}
				if after != results {
					t.Fatal("postwrite typed error committed a result")
				}
			})
		}
	}
}

func TestAdmission_PublicationArtifactMetadataSnapshotChange(t *testing.T) {
	for _, stage := range []int{0, 2} {
		t.Run(fmt.Sprint(stage), func(t *testing.T) {
			f := acceptedCurrentFlow(t, stage)
			locator := command.ArtifactLocator{Digest: domain.HashString("supplement"), MediaType: "text/plain", ByteLength: 10, Availability: "Present"}
			if stage == 0 {
				locator = f.candidate.Candidate.Artifacts[0]
			} else {
				f.evidence.Evidence.Report = locator
			}
			var changedCounts []int
			changed := false
			f.svc.artifacts = changingCurrentArtifacts{base: f.svc.artifacts, after: func() {
				if changed {
					return
				}
				changed = true
				if stage == 0 {
					for _, statement := range []string{"DROP TRIGGER artifacts_immutable_update", "UPDATE artifacts SET media_type='application/octet-stream'"} {
						if _, err := f.db.Exec(statement); err != nil {
							t.Fatal(err)
						}
					}
				} else if err := f.store.Within(t.Context(), func(tx port.Transaction) error {
					return tx.StoreArtifact(t.Context(), port.Artifact{Digest: locator.Digest, MediaType: locator.MediaType, ByteLength: locator.ByteLength, StorageKey: artifactStorageKey(locator.Digest), Availability: "Present"})
				}); err != nil {
					t.Fatal(err)
				}
				changedCounts = currentHistoryCounts(t, f.db)
			}}
			if _, err := f.call(t, stage); err == nil {
				t.Fatal("metadata changed during byte preflight was accepted")
			} else {
				assertCommandError(t, err, command.CodeStaleSubject)
			}
			if !changed || !reflect.DeepEqual(changedCounts, currentHistoryCounts(t, f.db)) {
				t.Fatal("metadata TOCTOU retained partial publication")
			}
		})
	}
}
