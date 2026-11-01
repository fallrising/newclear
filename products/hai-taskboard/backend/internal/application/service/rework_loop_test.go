package service

import (
	"bytes"
	"database/sql"
	json "encoding/json/v2"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

// stepClock is a deterministic clock that tests advance explicitly.
type stepClock struct{ now time.Time }

func (c *stepClock) Now() time.Time { return c.now }

type reworkRun struct {
	id       domain.RunID
	envelope port.ExecutorEnvelope
}

// reworkFixture is a real SQLite/Fake/HTTP accepted two-AC workflow with
// human-only independent verification and no Approval requirement.
type reworkFixture struct {
	svc       *Service
	store     *sqlite.Store
	db        *sql.DB
	h         http.Handler
	clock     *stepClock
	artifacts identityArtifacts
	acs       []domain.ACID
	env       domain.Digest
	runs      []reworkRun
	next      int
}

var reworkRecipe = domain.HashString("initial recipe")

func newReworkFixture(t *testing.T) *reworkFixture {
	t.Helper()
	acs := []domain.ACID{"AC-A", "AC-B"}
	svc, store, db, accept := initialFixtureContentACs(t, initialContent, acs)
	f := &reworkFixture{svc: svc, store: store, db: db, acs: acs, env: domain.HashString("rework environment"), next: 100}
	rules := []port.RunInputVerificationRule{}
	for _, ac := range acs {
		rules = append(rules, port.RunInputVerificationRule{ACID: ac, VerifierClass: "human", Independent: true, ProhibitedVerifierRunRole: "producer", EnvironmentDigest: f.env.String()})
	}
	profile, err := port.NewPolicyProfile(port.PolicyProfileMaterial{Schema: 1, ProjectID: projectID, RecipeDigest: reworkRecipe.String(), IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}, Rules: rules})
	if err != nil {
		t.Fatal(err)
	}
	svc.config.ProjectPolicies = map[domain.ProjectID]port.PolicyProfile{projectID: profile}
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
	f.artifacts = identityArtifacts{root: t.TempDir()}
	svc.artifacts = f.artifacts
	f.clock = &stepClock{now: fixedTime()}
	svc.clock = f.clock
	if _, err = svc.MarkReady(t.Context(), operator, command.MarkReady{Metadata: initialMetadata(50, 2), ProjectID: projectID, WorkItemID: workItemID}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.DispatchRun(t.Context(), operator, command.DispatchRun{Metadata: initialMetadata(51, 3), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"}); err != nil {
		t.Fatal(err)
	}
	f.h, err = httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	f.execute(t, f.latestRunID(t), "candidate-a", true)
	return f
}

func (f *reworkFixture) meta() command.Metadata {
	f.next++
	return initialMetadata(f.next, f.version(nil))
}

func (f *reworkFixture) version(t *testing.T) uint64 {
	var v uint64
	if err := f.db.QueryRow("SELECT version FROM work_items").Scan(&v); err != nil && t != nil {
		t.Fatal(err)
	}
	return v
}

func (f *reworkFixture) phase(t *testing.T) string {
	t.Helper()
	var p string
	if err := f.db.QueryRow("SELECT phase FROM work_items").Scan(&p); err != nil {
		t.Fatal(err)
	}
	return p
}

func (f *reworkFixture) latestRunID(t *testing.T) domain.RunID {
	t.Helper()
	var id domain.RunID
	if err := f.db.QueryRow("SELECT run_id FROM runs ORDER BY created_at_ns DESC, run_id DESC LIMIT 1").Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// execute claims and drives one Fake Run to success or failure.
func (f *reworkFixture) execute(t *testing.T, id domain.RunID, output string, success bool) {
	t.Helper()
	envelope, err := f.svc.ClaimDispatch(t.Context(), "worker", claimInput(id))
	if err != nil {
		t.Fatal(err)
	}
	terminal := fake.Step{Tick: 2, Kind: fake.ObservationTerminalSuccess, Artifact: &fake.Artifact{Name: "candidate.txt", MediaType: "text/plain", Bytes: []byte(output)}}
	if !success {
		terminal = fake.Step{Tick: 2, Kind: fake.ObservationTerminalFailure}
	}
	scenario, err := fake.NewScenario("success", []fake.Capability{fake.CapabilityStartAck}, []fake.Step{{Tick: 0, Kind: fake.ObservationDispatchReceived}, {Tick: 1, Kind: fake.ObservationStartAcknowledged}, terminal})
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := fake.NewAdapter([]fake.Capability{fake.CapabilityStartAck}, []fake.Scenario{scenario}, f.artifacts)
	if err != nil {
		t.Fatal(err)
	}
	fence := fake.Fence{RunID: id, InputDigest: envelope.Fence.InputDigest, LeaseHolder: string(envelope.Fence.Holder), LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration}
	session, observations, err := adapter.Dispatch(t.Context(), fake.DispatchRequest{Fence: fence, ScenarioID: "success"})
	if err != nil {
		t.Fatal(err)
	}
	for tick := uint64(0); ; tick++ {
		for _, o := range observations {
			v := RunObservation{Fence: envelope.Fence, Kind: RunObservationKind(o.Kind), ArtifactDigest: o.ArtifactDigest, ArtifactBytes: o.ArtifactBytes}
			if len(v.ArtifactBytes) > 0 {
				v.ArtifactMediaType = "text/plain"
			}
			if _, err = f.svc.PublishRunObservation(t.Context(), "worker", v); err != nil {
				t.Fatal(err)
			}
		}
		if tick == 2 {
			break
		}
		if observations, err = session.Poll(t.Context(), fake.TickRequest{Fence: fence, Tick: tick + 1}); err != nil {
			t.Fatal(err)
		}
	}
	f.runs = append(f.runs, reworkRun{id: id, envelope: envelope})
}

func (f *reworkFixture) submit(run reworkRun, candidate domain.CandidateID, output string) command.SubmitCandidate {
	return command.SubmitCandidate{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, RunID: run.id, Candidate: command.Candidate{ID: candidate, RunID: run.id, Digest: domain.HashString(output), InputSubjectDigest: run.envelope.Fence.InputDigest, CreatedAt: fixedTime(), Artifacts: []command.ArtifactLocator{{Digest: domain.HashString(output), MediaType: "text/plain", ByteLength: uint64(len(output)), Availability: "Present"}}}}
}

// subject is the authoritative preparation subject for a current Candidate.
func (f *reworkFixture) subject(t *testing.T, candidate domain.CandidateID) domain.CompletionSubject {
	t.Helper()
	var s domain.CompletionSubject
	if err := f.store.Within(t.Context(), func(tx port.Transaction) error {
		m, _, err := f.svc.currentCompletionMaterial(t.Context(), tx, port.CompletionMaterialQuery{ProjectID: projectID, WorkItemID: workItemID, CandidateID: candidate})
		if err != nil {
			return err
		}
		s, err = preparationSubject(m, f.svc.completionFor(projectID))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return s
}

// impersonate builds the subject an older Candidate would have at the current
// item version and AC set: exactly the hole a current-Candidate rule closes.
func impersonate(t *testing.T, current domain.CompletionSubject, candidate domain.CandidateID, digest domain.Digest, run reworkRun) domain.CompletionSubject {
	t.Helper()
	s, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: current.ProjectID(), WorkItemID: current.WorkItemID(), WorkItemVersion: current.WorkItemVersion(), CandidateID: candidate, CandidateDigest: digest, RunID: run.id, RunInputDigest: run.envelope.Fence.InputDigest, RequiredACRevisions: current.RequiredACRevisions(), AcceptedGraphRevisionDigest: current.GraphRevisionDigest(), PolicyRevisionDigest: current.PolicyRevisionDigest(), CompletionRecipeDigest: current.RecipeDigest()})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func (f *reworkFixture) report(run reworkRun, subject domain.Digest, kind string, ac domain.ACID, verdict string) command.SubmitHumanReport {
	m := f.meta()
	q := command.SubmitHumanReport{Metadata: m, ProjectID: projectID, WorkItemID: workItemID, RunID: run.id, ReportID: fmt.Sprintf("report_%010d", f.next), SubjectDigest: subject, LeaseEpoch: run.envelope.Fence.Epoch, RestoreGeneration: run.envelope.Fence.RestoreGeneration, Kind: kind, MediaType: "text/plain", Content: "human report"}
	if kind == "review" {
		q.Review = &command.HumanReviewIntent{Verdict: verdict}
	} else {
		q.Evidence = &command.HumanEvidenceIntent{ACID: ac, ACRevisionDigest: domain.HashBytes(initialContent), RecipeDigest: reworkRecipe, EnvironmentDigest: f.env, Verdict: verdict}
	}
	return q
}

func (f *reworkFixture) post(t *testing.T, operation command.Operation, version uint64, payload any, key int) *httptest.ResponseRecorder {
	t.Helper()
	m := initialMetadata(key, version)
	body, err := json.Marshal(map[string]any{"command_id": m.CommandID, "idempotency_key": m.IdempotencyKey, "issued_at": m.IssuedAt.UTC().Format(time.RFC3339Nano), "expected_version": version, "operation": string(operation), "payload": payload})
	if err != nil {
		t.Fatal(err)
	}
	return initialHTTPRequest(f.h, http.MethodPost, "/api/v1/projects/"+string(projectID)+"/commands", body, true, true)
}

func (f *reworkFixture) rework(t *testing.T, subject domain.Digest, reason string, key int) *httptest.ResponseRecorder {
	t.Helper()
	return f.post(t, "RequestRework", f.version(t), map[string]any{"work_item_id": string(workItemID), "subject_digest": "sha256:" + subject.String(), "reason": reason}, key)
}

func (f *reworkFixture) dispatch(t *testing.T) (command.Outcome, error) {
	t.Helper()
	return f.svc.DispatchRun(t.Context(), operator, command.DispatchRun{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"})
}

type reworkFailure struct {
	OK    bool `json:"ok"`
	Error struct {
		Code      string `json:"code"`
		Retryable bool   `json:"retryable"`
		Details   *struct {
			Reasons []string `json:"reasons"`
		} `json:"details"`
	} `json:"error"`
	Result struct {
		Type          string `json:"type"`
		Phase         string `json:"phase"`
		Version       uint64 `json:"version"`
		Reason        string `json:"reason"`
		SubjectDigest string `json:"subject_digest"`
	} `json:"result"`
}

func decodeRework(t *testing.T, body []byte) reworkFailure {
	t.Helper()
	var r reworkFailure
	if err := json.Unmarshal(body, &r, json.RejectUnknownMembers(false)); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return r
}

func outcomeCode(t *testing.T, out command.Outcome, err error) reworkFailure {
	t.Helper()
	if err == nil {
		t.Fatalf("command unexpectedly succeeded: %s", out.Payload)
	}
	if len(out.Payload) == 0 {
		var failure *command.Error
		if e, ok := err.(*command.Error); ok {
			failure = e
		} else {
			t.Fatalf("unrecorded error: %v", err)
		}
		r := reworkFailure{}
		r.Error.Code, r.Error.Retryable = failure.Code, failure.Retryable
		return r
	}
	return decodeRework(t, out.Payload)
}

// domainSnapshot excludes only the two command-bookkeeping tables that every
// recordable refusal writes and returns their counts separately.
func domainSnapshot(t *testing.T, db *sql.DB) ([]byte, [2]int) {
	t.Helper()
	var counts [2]int
	for i, table := range []string{"command_results", "idempotency_records"} {
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&counts[i]); err != nil {
			t.Fatal(err)
		}
	}
	snapshot := preparationDatabaseSnapshot(t, db)
	var all map[string]any
	if err := json.Unmarshal(snapshot, &all); err != nil {
		t.Fatal(err)
	}
	delete(all, "command_results")
	delete(all, "idempotency_records")
	out, err := json.Marshal(all, json.Deterministic(true))
	if err != nil {
		t.Fatal(err)
	}
	return out, counts
}

func expectRefusal(t *testing.T, f *reworkFixture, recorded bool, call func() (int, reworkFailure), status int, code string, reasons ...string) {
	t.Helper()
	before, counts := domainSnapshot(t, f.db)
	gotStatus, got := call()
	if gotStatus != 0 && gotStatus != status || got.Error.Code != code {
		t.Fatalf("got %d %+v, want %d %s", gotStatus, got, status, code)
	}
	if len(reasons) > 0 && (got.Error.Details == nil || !slices.Equal(got.Error.Details.Reasons, reasons)) {
		t.Fatalf("reasons %+v, want %v", got.Error.Details, reasons)
	}
	after, afterCounts := domainSnapshot(t, f.db)
	want := counts
	if recorded {
		want = [2]int{counts[0] + 1, counts[1] + 1}
	}
	if !bytes.Equal(before, after) || afterCounts != want {
		t.Fatalf("refusal wrote domain rows or wrong bookkeeping: %v -> %v", counts, afterCounts)
	}
}

func httpRefusal(t *testing.T, r *httptest.ResponseRecorder) (int, reworkFailure) {
	t.Helper()
	return r.Code, decodeRework(t, r.Body.Bytes())
}

func TestRequestRework_GuardsAndHistory(t *testing.T) {
	historyTables := func(t *testing.T, db *sql.DB) string {
		t.Helper()
		var b strings.Builder
		for _, table := range []string{"reviews", "evidence", "approvals", "candidates", "runs", "completion_records", "human_reports"} {
			rows, err := db.Query("SELECT * FROM " + table + " ORDER BY rowid")
			if err != nil {
				t.Fatal(err)
			}
			cols, _ := rows.Columns()
			for rows.Next() {
				values := make([]any, len(cols))
				ptrs := make([]any, len(cols))
				for i := range values {
					ptrs[i] = &values[i]
				}
				if err = rows.Scan(ptrs...); err != nil {
					t.Fatal(err)
				}
				fmt.Fprintf(&b, "%s%v\n", table, values)
			}
			rows.Close()
		}
		return b.String()
	}
	for _, phase := range []string{"Review", "QA"} {
		t.Run("success_from_"+phase, func(t *testing.T) {
			f := newReworkFixture(t)
			run := f.runs[0]
			if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(run, "candidate-a", "candidate-a")); err != nil {
				t.Fatal(err)
			}
			s := f.subject(t, "candidate-a")
			if phase == "QA" {
				for _, ac := range f.acs {
					if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(run, s.Digest(), "evidence", ac, "Passing")); err != nil {
						t.Fatal(err)
					}
				}
				if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(run, s.Digest(), "review", "", "Approved")); err != nil {
					t.Fatal(err)
				}
				if _, err := f.svc.RequestQA(t.Context(), operator, command.RequestQA{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-a", SubjectDigest: s.Digest()}); err != nil {
					t.Fatal(err)
				}
				s = f.subject(t, "candidate-a")
			}
			history := historyTables(t, f.db)
			version := f.version(t)
			reason := "Needs a smaller diff.\n\tSee 界 notes"
			r := f.rework(t, s.Digest(), reason, 300)
			got := decodeRework(t, r.Body.Bytes())
			if r.Code != 200 || got.Result.Type != "ReworkRequested" || got.Result.Phase != "Developing" || got.Result.Version != version+1 || got.Result.Reason != reason || got.Result.SubjectDigest != "sha256:"+s.Digest().String() {
				t.Fatalf("rework %d %s", r.Code, r.Body)
			}
			if f.phase(t) != "Developing" || f.version(t) != version+1 || historyTables(t, f.db) != history {
				t.Fatal("rework changed history or did not transition")
			}
			replay := f.post(t, "RequestRework", version, map[string]any{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.Digest().String(), "reason": reason}, 300)
			if replay.Code != 200 || !bytes.Contains(replay.Body.Bytes(), []byte(`"reason"`)) {
				t.Fatalf("replay %d %s", replay.Code, replay.Body)
			}
			conflict := f.post(t, "RequestRework", version, map[string]any{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.Digest().String(), "reason": "different"}, 300)
			if conflict.Code != 409 || decodeRework(t, conflict.Body.Bytes()).Error.Code != "idempotency_conflict" {
				t.Fatalf("idempotency conflict %d %s", conflict.Code, conflict.Body)
			}
		})
	}
	t.Run("refusals", func(t *testing.T) {
		f := newReworkFixture(t)
		run := f.runs[0]
		subject := domain.HashString("not current")
		expectRefusal(t, f, true, func() (int, reworkFailure) { return httpRefusal(t, f.rework(t, subject, "too early", 310)) }, 422, "lifecycle_rejected", "invalid_transition")
		if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(run, "candidate-a", "candidate-a")); err != nil {
			t.Fatal(err)
		}
		s := f.subject(t, "candidate-a").Digest()
		expectRefusal(t, f, true, func() (int, reworkFailure) {
			return httpRefusal(t, f.post(t, "RequestRework", f.version(t)-1, map[string]any{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String(), "reason": "old"}, 311))
		}, 409, "version_conflict")
		expectRefusal(t, f, true, func() (int, reworkFailure) { return httpRefusal(t, f.rework(t, subject, "wrong subject", 312)) }, 409, "stale_subject", "subject_stale")
		for i, payload := range []map[string]any{
			{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String(), "reason": ""},
			{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String(), "reason": "bell\a"},
			{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String(), "reason": "nul\x00"},
			{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String(), "reason": strings.Repeat("界", 2001)},
			{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String()},
			{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String(), "reason": "ok", "extra": true},
		} {
			expectRefusal(t, f, false, func() (int, reworkFailure) {
				return httpRefusal(t, f.post(t, "RequestRework", f.version(t), payload, 320+i))
			}, 400, "invalid_request")
		}
		expectRefusal(t, f, false, func() (int, reworkFailure) {
			return httpRefusal(t, f.post(t, "RequestRework", 0, map[string]any{"work_item_id": string(workItemID), "subject_digest": "sha256:" + s.String(), "reason": "zero"}, 330))
		}, 400, "invalid_request")
		expectRefusal(t, f, false, func() (int, reworkFailure) {
			return httpRefusal(t, f.post(t, "RequestRework", f.version(t), map[string]any{"work_item_id": "wi_01HABCDEFGZ", "subject_digest": "sha256:" + s.String(), "reason": "missing"}, 331))
		}, 404, "not_found")
		other := initialHTTPRequest(f.h, http.MethodPost, "/api/v1/projects/prj_01HABCDEFGJ/commands", []byte(`{}`), true, true)
		if other.Code != 404 {
			t.Fatalf("cross-project %d %s", other.Code, other.Body)
		}
		ok := f.rework(t, s, strings.Repeat("界", 2000), 332)
		if ok.Code != 200 {
			t.Fatalf("2000 code-point reason %d %s", ok.Code, ok.Body)
		}
	})
}

func TestDispatchRun_RedispatchFromDeveloping(t *testing.T) {
	reworked := func(t *testing.T) *reworkFixture {
		f := newReworkFixture(t)
		if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(f.runs[0], "candidate-a", "candidate-a")); err != nil {
			t.Fatal(err)
		}
		if r := f.rework(t, f.subject(t, "candidate-a").Digest(), "rework", 400); r.Code != 200 {
			t.Fatalf("rework %d %s", r.Code, r.Body)
		}
		return f
	}
	succeeds := func(t *testing.T, f *reworkFixture) {
		t.Helper()
		version := f.version(t)
		f.clock.now = f.clock.now.Add(time.Second)
		if _, err := f.dispatch(t); err != nil {
			t.Fatal(err)
		}
		var runs, attempt int
		if err := f.db.QueryRow("SELECT count(*), max(attempt) FROM runs").Scan(&runs, &attempt); err != nil {
			t.Fatal(err)
		}
		if runs != len(f.runs)+1 || attempt != 1 || f.phase(t) != "Developing" || f.version(t) != version+1 {
			t.Fatalf("redispatch runs=%d attempt=%d phase=%s", runs, attempt, f.phase(t))
		}
	}
	t.Run("after_rework", func(t *testing.T) { succeeds(t, reworked(t)) })
	t.Run("succeeded_without_candidate", func(t *testing.T) { succeeds(t, newReworkFixture(t)) })
	t.Run("after_failed_run", func(t *testing.T) {
		f := newReworkFixture(t)
		f.clock.now = f.clock.now.Add(time.Second)
		if _, err := f.dispatch(t); err != nil {
			t.Fatal(err)
		}
		f.execute(t, f.latestRunID(t), "", false)
		succeeds(t, f)
	})
	t.Run("strict_order_and_replay", func(t *testing.T) {
		f := reworked(t)
		key := f.next + 1
		var first reworkFailure
		expectRefusal(t, f, true, func() (int, reworkFailure) {
			out, err := f.dispatch(t)
			first = outcomeCode(t, out, err)
			return 0, first
		}, 422, "lifecycle_rejected")
		if !first.Error.Retryable {
			t.Fatal("clock refusal must be retryable")
		}
		f.clock.now = f.clock.now.Add(time.Second)
		replay, err := f.svc.DispatchRun(t.Context(), operator, command.DispatchRun{Metadata: initialMetadata(key, f.version(t)), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"})
		if err == nil || !replay.Replayed {
			t.Fatal("same key must replay the recorded refusal")
		}
		f.clock.now = f.clock.now.Add(-time.Hour)
		expectRefusal(t, f, true, func() (int, reworkFailure) { out, err := f.dispatch(t); return 0, outcomeCode(t, out, err) }, 422, "lifecycle_rejected")
		f.clock.now = f.clock.now.Add(2 * time.Hour)
		succeeds(t, f)
	})
	t.Run("active_run", func(t *testing.T) {
		f := reworked(t)
		succeeds(t, f)
		f.clock.now = f.clock.now.Add(time.Second)
		expectRefusal(t, f, true, func() (int, reworkFailure) { out, err := f.dispatch(t); return 0, outcomeCode(t, out, err) }, 422, "lifecycle_rejected", "active_or_unknown_run")
	})
	// Schema-valid injected states; no lawful writer reaches each of them here.
	for _, tc := range []struct{ name, sql, code, reason string }{
		{"cancel_requested_failed", "UPDATE runs SET observed_state='Failed', desired_action='CancelRequested'", "lifecycle_rejected", ""},
		{"needs_reconcile", "UPDATE runs SET reconciliation_state='NeedsReconcile'", "lifecycle_rejected", "active_or_unknown_run"},
		{"outcome_unknown", "UPDATE runs SET side_effect_outcome='OutcomeUnknown'", "lifecycle_rejected", "active_or_unknown_run"},
		{"blocker", "INSERT INTO work_item_blockers(project_id, work_item_id, blocker_id, reason) SELECT project_id, work_item_id, 'blk_1', 'waiting' FROM work_items", "lifecycle_rejected", "active_blocker"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := reworked(t)
			injectRunState(t, f.db, tc.sql)
			f.clock.now = f.clock.now.Add(time.Second)
			reasons := []string{}
			if tc.reason != "" {
				reasons = append(reasons, tc.reason)
			}
			expectRefusal(t, f, true, func() (int, reworkFailure) { out, err := f.dispatch(t); return 0, outcomeCode(t, out, err) }, 422, tc.code, reasons...)
		})
	}
	t.Run("retry_of_run_id", func(t *testing.T) {
		f := reworked(t)
		f.clock.now = f.clock.now.Add(time.Second)
		expectRefusal(t, f, true, func() (int, reworkFailure) {
			out, err := f.svc.DispatchRun(t.Context(), operator, command.DispatchRun{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success", RetryOfRunID: f.runs[0].id})
			return 0, outcomeCode(t, out, err)
		}, 422, "lifecycle_rejected")
	})
	t.Run("review_phase", func(t *testing.T) {
		f := newReworkFixture(t)
		if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(f.runs[0], "candidate-a", "candidate-a")); err != nil {
			t.Fatal(err)
		}
		f.clock.now = f.clock.now.Add(time.Second)
		expectRefusal(t, f, true, func() (int, reworkFailure) { out, err := f.dispatch(t); return 0, outcomeCode(t, out, err) }, 422, "lifecycle_rejected", "invalid_transition")
	})
}

// discoveredCount returns the material-index Run and Candidate counts.
func discoveredCount(t *testing.T, h http.Handler) [2]int {
	t.Helper()
	r := initialHTTPRequest(h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/work-items/"+string(workItemID)+"/material-index", nil, true, false)
	var w discoveredMaterial
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &w) != nil {
		t.Fatalf("material discovery %d %s", r.Code, r.Body)
	}
	return [2]int{len(w.Runs), len(w.Candidates)}
}

func injectRunState(t *testing.T, db *sql.DB, statement string) {
	t.Helper()
	rows, err := db.Query("SELECT name FROM sqlite_schema WHERE type='trigger' AND (tbl_name='runs' OR tbl_name='work_item_blockers')")
	if err != nil {
		t.Fatal(err)
	}
	var triggers []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		triggers = append(triggers, name)
	}
	rows.Close()
	for _, name := range triggers {
		if _, err = db.Exec(`DROP TRIGGER "` + name + `"`); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(statement); err != nil {
		t.Fatal(err)
	}
}

// candidateB reworks Candidate A after ChangesRequested and produces Candidate B on Run 2.
func candidateB(t *testing.T) (*reworkFixture, domain.CompletionSubject) {
	t.Helper()
	f := newReworkFixture(t)
	runA := f.runs[0]
	if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(runA, "candidate-a", "candidate-a")); err != nil {
		t.Fatal(err)
	}
	sA := f.subject(t, "candidate-a")
	for _, ac := range f.acs {
		if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runA, sA.Digest(), "evidence", ac, "Passing")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runA, sA.Digest(), "review", "", "ChangesRequested")); err != nil {
		t.Fatal(err)
	}
	if r := f.rework(t, sA.Digest(), "changes requested", 500); r.Code != 200 {
		t.Fatalf("rework %d %s", r.Code, r.Body)
	}
	f.clock.now = f.clock.now.Add(time.Second)
	if _, err := f.dispatch(t); err != nil {
		t.Fatal(err)
	}
	f.execute(t, f.latestRunID(t), "candidate-b", true)
	return f, sA
}

func TestCurrentCandidate_LatestRunOnly(t *testing.T) {
	f, sA := candidateB(t)
	runA, runB := f.runs[0], f.runs[1]
	expectRefusal(t, f, true, func() (int, reworkFailure) {
		out, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(runA, "candidate-a2", "candidate-a"))
		return 0, outcomeCode(t, out, err)
	}, 422, "lifecycle_rejected")
	if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(runB, "candidate-b", "candidate-b")); err != nil {
		t.Fatal(err)
	}
	sB := f.subject(t, "candidate-b")
	fakeA := impersonate(t, sB, "candidate-a", domain.HashString("candidate-a"), runA)
	for _, digest := range []domain.Digest{sA.Digest(), fakeA.Digest()} {
		calls := map[string]func() (command.Outcome, error){
			"human_evidence": func() (command.Outcome, error) {
				return f.svc.SubmitHumanReport(t.Context(), operator, f.report(runA, digest, "evidence", "AC-A", "Passing"))
			},
			"human_review": func() (command.Outcome, error) {
				return f.svc.SubmitHumanReport(t.Context(), operator, f.report(runA, digest, "review", "", "Approved"))
			},
			"fixture_review": func() (command.Outcome, error) {
				return f.svc.PublishFixtureReview(t.Context(), operator, command.PublishFixtureReview{Metadata: f.meta(), ProjectID: projectID, RunID: runA.id, LeaseEpoch: runA.envelope.Fence.Epoch, RestoreGeneration: runA.envelope.Fence.RestoreGeneration, Review: command.Review{ID: domain.ReviewID(fmt.Sprintf("review-%d", f.next)), SubjectDigest: digest, ReviewerID: operator, ReviewerClass: "independent", Verdict: "Approved", CreatedAt: fixedTime()}})
			},
			"approve": func() (command.Outcome, error) {
				return f.svc.ApproveSubject(t.Context(), operator, command.ApproveSubject{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-a", RequestID: fmt.Sprintf("approval-%d", f.next), SubjectDigest: digest, Decision: "Approved"})
			},
			"request_qa": func() (command.Outcome, error) {
				return f.svc.RequestQA(t.Context(), operator, command.RequestQA{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-a", SubjectDigest: digest})
			},
		}
		for name, call := range calls {
			t.Run(name, func(t *testing.T) {
				// Human report refusals happen before command bookkeeping.
				recorded := !strings.HasPrefix(name, "human_")
				expectRefusal(t, f, recorded, func() (int, reworkFailure) { out, err := call(); return 0, outcomeCode(t, out, err) }, 409, "stale_subject")
			})
		}
	}
	expectRefusal(t, f, true, func() (int, reworkFailure) {
		out, err := f.svc.CompleteWorkItem(t.Context(), operator, command.CompleteWorkItem{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, Subject: fakeA})
		return 0, outcomeCode(t, out, err)
	}, 409, "stale_subject")
	expectRefusal(t, f, true, func() (int, reworkFailure) { return httpRefusal(t, f.rework(t, fakeA.Digest(), "old candidate", 520)) }, 409, "stale_subject", "subject_stale")
	base := "/api/v1/projects/" + string(projectID) + "/work-items/" + string(workItemID) + "/candidates/candidate-a/"
	for _, path := range []string{"completion-preparation", "verified-coverage"} {
		if r := initialHTTPRequest(f.h, http.MethodGet, base+path, nil, true, false); r.Code != 409 || !strings.Contains(r.Body.String(), "stale_subject") {
			t.Fatalf("%s for older Candidate: %d %s", path, r.Code, r.Body)
		}
	}
	if n := discoveredCount(t, f.h); n != [2]int{2, 2} {
		t.Fatalf("history discovery lost older Run/Candidate: %v", n)
	}
	if r := initialHTTPRequest(f.h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/work-items/"+string(workItemID)+"/runs/"+string(runA.id)+"/outputs", nil, true, false); r.Code != 200 {
		t.Fatalf("older Run outputs %d %s", r.Code, r.Body)
	}
	// A second rework leaves Run 2 latest with its Candidate; no second Candidate.
	if r := f.rework(t, sB.Digest(), "again", 521); r.Code != 200 {
		t.Fatalf("second rework %d %s", r.Code, r.Body)
	}
	expectRefusal(t, f, true, func() (int, reworkFailure) {
		out, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(runB, "candidate-b2", "candidate-b"))
		return 0, outcomeCode(t, out, err)
	}, 422, "lifecycle_rejected")
}

func TestReworkLoop_CandidateBCannotUseCandidateAEvidence(t *testing.T) {
	f, sA := candidateB(t)
	runA, runB := f.runs[0], f.runs[1]
	if r := f.post(t, command.SubmitCandidateOperation, f.version(t), map[string]any{"work_item_id": string(workItemID), "run_id": string(runB.id), "candidate": map[string]any{"candidate_id": "candidate-b", "run_id": string(runB.id), "candidate_digest": "sha256:" + domain.HashString("candidate-b").String(), "input_subject_digest": "sha256:" + runB.envelope.Fence.InputDigest.String(), "created_at": fixedTime().Format(time.RFC3339Nano), "artifact_manifest": []any{map[string]any{"sha256": "sha256:" + domain.HashString("candidate-b").String(), "media_type": "text/plain", "byte_length": 11, "availability": "Present"}}}}, 600); r.Code != 200 {
		t.Fatalf("submit B %d %s", r.Code, r.Body)
	}
	prepared := func() map[string]any {
		t.Helper()
		r := initialHTTPRequest(f.h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/work-items/"+string(workItemID)+"/candidates/candidate-b/completion-preparation", nil, true, false)
		if r.Code != 200 {
			t.Fatalf("preparation %d %s", r.Code, r.Body)
		}
		var v map[string]any
		if err := json.Unmarshal(r.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	complete := func(key int) (int, reworkFailure) {
		r := f.post(t, command.CompleteWorkItemOperation, f.version(t), map[string]any{"work_item_id": string(workItemID), "completion_subject": prepared()["completion_subject"]}, key)
		return httpRefusal(t, r)
	}
	// In Review the preparation subject is prospective (version+1), so the
	// existing gate classifies the attempt as stale before QA.
	expectRefusal(t, f, true, func() (int, reworkFailure) { return complete(601) }, 409, "stale_subject")
	sB := f.subject(t, "candidate-b")
	// A producer-class reviewer cannot approve its own Candidate.
	expectRefusal(t, f, false, func() (int, reworkFailure) {
		out, err := f.svc.PublishFixtureReview(t.Context(), operator, command.PublishFixtureReview{Metadata: f.meta(), ProjectID: projectID, RunID: runB.id, LeaseEpoch: runB.envelope.Fence.Epoch, RestoreGeneration: runB.envelope.Fence.RestoreGeneration, Review: command.Review{ID: "review-producer", SubjectDigest: sB.Digest(), ReviewerID: operator, ReviewerClass: "producer", Verdict: "Approved", CreatedAt: fixedTime()}})
		return 0, outcomeCode(t, out, err)
	}, 0, "permission_denied")
	if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runB, sB.Digest(), "review", "", "Approved")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RequestQA(t.Context(), operator, command.RequestQA{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-b", SubjectDigest: sB.Digest()}); err != nil {
		t.Fatal(err)
	}
	// Only A-bound Evidence exists for every AC.
	expectRefusal(t, f, true, func() (int, reworkFailure) { return complete(602) }, 422, "done_gate_unsatisfied", "evidence_missing")
	sB = f.subject(t, "candidate-b")
	if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runB, sB.Digest(), "evidence", "AC-A", "Passing")); err != nil {
		t.Fatal(err)
	}
	// One of two required ACs still lacks B-bound Evidence.
	expectRefusal(t, f, true, func() (int, reworkFailure) { return complete(603) }, 422, "done_gate_unsatisfied", "evidence_missing")
	// A forged non-operator principal cannot submit verification.
	self := f.report(runB, sB.Digest(), "evidence", "AC-B", "Passing")
	expectRefusal(t, f, false, func() (int, reworkFailure) {
		out, err := f.svc.SubmitHumanReport(t.Context(), "worker", self)
		return 0, outcomeCode(t, out, err)
	}, 0, "permission_denied")
	if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runB, sB.Digest(), "evidence", "AC-B", "Passing")); err != nil {
		t.Fatal(err)
	}
	if code, got := complete(604); code != 200 || got.Result.Phase != "Done" {
		t.Fatalf("B completion %d %+v", code, got)
	}
	var joined, aJoined int
	if err := f.db.QueryRow("SELECT count(*) FROM completion_record_evidence").Scan(&joined); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT count(*) FROM completion_record_evidence ce JOIN evidence e ON e.project_id=ce.project_id AND e.evidence_id=ce.evidence_id WHERE e.completion_subject_digest=?", sA.Digest().String()).Scan(&aJoined); err != nil {
		t.Fatal(err)
	}
	var aVerdicts string
	if err := f.db.QueryRow("SELECT group_concat(verdict) FROM (SELECT verdict FROM reviews WHERE completion_subject_digest=? ORDER BY review_id)", sA.Digest().String()).Scan(&aVerdicts); err != nil {
		t.Fatal(err)
	}
	if joined != 2 || aJoined != 0 || aVerdicts != "Rejected" {
		t.Fatalf("completion joins %d (A %d), A verdicts %q", joined, aJoined, aVerdicts)
	}
	// Restart preserves history and replays the original completion result.
	var seq int
	var name, path string
	if err := f.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	before, _ := domainSnapshot(t, f.db)
	if err := f.store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	f.svc.unit = reopened
	f.store = reopened
	f.h, err = httpapi.NewServer(f.svc, httpapi.UnitCommandResults{Unit: reopened}, httpapi.PersistedProjections{Store: reopened}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	replay := initialHTTPRequest(f.h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/commands/"+initialMetadata(604, 0).CommandID, nil, true, false)
	if replay.Code != 200 || !strings.Contains(replay.Body.String(), "WorkItemCompleted") {
		t.Fatalf("replay after restart %d %s", replay.Code, replay.Body)
	}
	after, _ := domainSnapshot(t, f.db)
	if !bytes.Equal(before, after) || discoveredCount(t, f.h) != [2]int{2, 2} {
		t.Fatal("restart changed history")
	}
	_ = runA
}
