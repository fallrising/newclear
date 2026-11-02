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
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

// completeA drives Candidate A on the first Run through independent human
// Review/Evidence, QA and explicit completion, returning its QA subject.
func completeA(t *testing.T, f *reworkFixture) domain.CompletionSubject {
	t.Helper()
	run := f.runs[0]
	if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(run, "candidate-a", "candidate-a")); err != nil {
		t.Fatal(err)
	}
	s := f.subject(t, "candidate-a")
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
	if _, err := f.svc.CompleteWorkItem(t.Context(), operator, command.CompleteWorkItem{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, Subject: s}); err != nil {
		t.Fatal(err)
	}
	if f.phase(t) != "Done" {
		t.Fatal("Candidate A did not complete")
	}
	return s
}

func (f *reworkFixture) reopen(t *testing.T, target, reason string, key int) *httptest.ResponseRecorder {
	t.Helper()
	return f.post(t, "ReopenWorkItem", f.version(t), map[string]any{"work_item_id": string(workItemID), "target_phase": target, "reason": reason}, key)
}

// completionHistory dumps every completion, verification and Run history row.
func completionHistory(t *testing.T, db *sql.DB) string {
	t.Helper()
	var b strings.Builder
	for _, table := range []string{"completion_records", "completion_record_evidence", "completion_record_reviews", "completion_record_approvals", "approval_consumptions", "reviews", "evidence", "approvals", "candidates", "runs", "human_reports"} {
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

func resultKeys(t *testing.T, body []byte) []string {
	t.Helper()
	var v struct {
		Result map[string]any `json:"result"`
	}
	if err := json.Unmarshal(body, &v, json.RejectUnknownMembers(false)); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(v.Result))
	for k := range v.Result {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func TestReopenWorkItem_GuardsAndHistory(t *testing.T) {
	for _, target := range []string{"Ready", "Draft"} {
		t.Run("success_to_"+target, func(t *testing.T) {
			f := newReworkFixture(t)
			completeA(t, f)
			history := completionHistory(t, f.db)
			version := f.version(t)
			reason := "Follow-up scope.\n\tSee 界 notes"
			r := f.reopen(t, target, reason, 300)
			got := decodeRework(t, r.Body.Bytes())
			if r.Code != 200 || got.Result.Type != "WorkItemReopened" || got.Result.Phase != target || got.Result.Version != version+1 || got.Result.Reason != reason {
				t.Fatalf("reopen %d %s", r.Code, r.Body)
			}
			if keys := resultKeys(t, r.Body.Bytes()); !slices.Equal(keys, []string{"phase", "project_id", "reason", "type", "version", "work_item_id"}) {
				t.Fatalf("result shape %v", keys)
			}
			if f.phase(t) != target || f.version(t) != version+1 || completionHistory(t, f.db) != history {
				t.Fatal("reopen changed history or did not transition")
			}
			payload := map[string]any{"work_item_id": string(workItemID), "target_phase": target, "reason": reason}
			replay := f.post(t, "ReopenWorkItem", version, payload, 300)
			if replayed := decodeRework(t, replay.Body.Bytes()); replay.Code != 200 || replayed.Result != got.Result {
				t.Fatalf("replay %d %s", replay.Code, replay.Body)
			}
			payload["reason"] = "different"
			conflict := f.post(t, "ReopenWorkItem", version, payload, 300)
			if conflict.Code != 409 || decodeRework(t, conflict.Body.Bytes()).Error.Code != "idempotency_conflict" {
				t.Fatalf("idempotency conflict %d %s", conflict.Code, conflict.Body)
			}
		})
	}
	t.Run("wrong_phase", func(t *testing.T) {
		f := newReworkFixture(t)
		expectRefusal(t, f, true, func() (int, reworkFailure) { return httpRefusal(t, f.reopen(t, "Ready", "not done", 310)) }, 422, "lifecycle_rejected", "invalid_transition")
		run := f.runs[0]
		if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(run, "candidate-a", "candidate-a")); err != nil {
			t.Fatal(err)
		}
		expectRefusal(t, f, true, func() (int, reworkFailure) { return httpRefusal(t, f.reopen(t, "Draft", "in review", 311)) }, 422, "lifecycle_rejected", "invalid_transition")
		for i, phase := range []string{"Ready", "Canceled"} {
			// Schema-valid injected phases; the lawful paths to them are covered elsewhere.
			if _, err := f.db.Exec("UPDATE work_items SET phase=? WHERE work_item_id=?", phase, workItemID); err != nil {
				t.Fatal(err)
			}
			expectRefusal(t, f, true, func() (int, reworkFailure) { return httpRefusal(t, f.reopen(t, "Ready", "not done", 312+i)) }, 422, "lifecycle_rejected", "invalid_transition")
		}
	})
	t.Run("refusals_after_done", func(t *testing.T) {
		f := newReworkFixture(t)
		completeA(t, f)
		valid := func() map[string]any {
			return map[string]any{"work_item_id": string(workItemID), "target_phase": "Ready", "reason": "ok"}
		}
		expectRefusal(t, f, true, func() (int, reworkFailure) {
			return httpRefusal(t, f.post(t, "ReopenWorkItem", f.version(t)-1, valid(), 320))
		}, 409, "version_conflict")
		bad := []map[string]any{}
		for _, change := range []func(map[string]any){
			func(p map[string]any) { p["target_phase"] = "Developing" },
			func(p map[string]any) { p["target_phase"] = "Done" },
			func(p map[string]any) { delete(p, "target_phase") },
			func(p map[string]any) { p["reason"] = "" },
			func(p map[string]any) { p["reason"] = "bell\a" },
			func(p map[string]any) { p["reason"] = "nul\x00" },
			func(p map[string]any) { p["reason"] = strings.Repeat("界", 2001) },
			func(p map[string]any) { delete(p, "reason") },
			func(p map[string]any) { p["extra"] = true },
		} {
			p := valid()
			change(p)
			bad = append(bad, p)
		}
		for i, payload := range bad {
			expectRefusal(t, f, false, func() (int, reworkFailure) {
				return httpRefusal(t, f.post(t, "ReopenWorkItem", f.version(t), payload, 330+i))
			}, 400, "invalid_request")
		}
		expectRefusal(t, f, false, func() (int, reworkFailure) {
			return httpRefusal(t, f.post(t, "ReopenWorkItem", 0, valid(), 350))
		}, 400, "invalid_request")
		missing := valid()
		missing["work_item_id"] = "wi_01HABCDEFGZ"
		expectRefusal(t, f, false, func() (int, reworkFailure) {
			return httpRefusal(t, f.post(t, "ReopenWorkItem", f.version(t), missing, 351))
		}, 404, "not_found")
		if other := initialHTTPRequest(f.h, http.MethodPost, "/api/v1/projects/prj_01HABCDEFGJ/commands", []byte(`{}`), true, true); other.Code != 404 {
			t.Fatalf("cross-project %d %s", other.Code, other.Body)
		}
		// A changed policy makes the current input unresolvable: Ready is
		// refused without writes, Draft remains available.
		original := f.svc.config.ProjectPolicies[projectID]
		f.svc.config.ProjectPolicies = map[domain.ProjectID]port.PolicyProfile{projectID: changedPolicy(t, f)}
		expectRefusal(t, f, true, func() (int, reworkFailure) { return httpRefusal(t, f.reopen(t, "Ready", "policy moved", 352)) }, 422, "lifecycle_rejected")
		if r := f.reopen(t, "Draft", strings.Repeat("界", 2000), 353); r.Code != 200 || f.phase(t) != "Draft" {
			t.Fatalf("Draft reopen with changed policy %d %s", r.Code, r.Body)
		}
		f.svc.config.ProjectPolicies = map[domain.ProjectID]port.PolicyProfile{projectID: original}
	})
}

func changedPolicy(t *testing.T, f *reworkFixture) port.PolicyProfile {
	t.Helper()
	rules := []port.RunInputVerificationRule{}
	for _, ac := range f.acs {
		rules = append(rules, port.RunInputVerificationRule{ACID: ac, VerifierClass: "human", Independent: true, ProhibitedVerifierRunRole: "producer", EnvironmentDigest: f.env.String()})
	}
	profile, err := port.NewPolicyProfile(port.PolicyProfileMaterial{Schema: 1, ProjectID: projectID, RecipeDigest: domain.HashString("changed recipe").String(), IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}, Rules: rules})
	if err != nil {
		t.Fatal(err)
	}
	return profile
}

func TestDispatchRun_FromReadyWithRunHistory(t *testing.T) {
	reopened := func(t *testing.T) *reworkFixture {
		f := newReworkFixture(t)
		completeA(t, f)
		if r := f.reopen(t, "Ready", "next scope", 400); r.Code != 200 {
			t.Fatalf("reopen %d %s", r.Code, r.Body)
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
		if runs != 2 || attempt != 1 || f.phase(t) != "Developing" || f.version(t) != version+1 {
			t.Fatalf("dispatch after reopen runs=%d attempt=%d phase=%s", runs, attempt, f.phase(t))
		}
	}
	t.Run("dispatches_once", func(t *testing.T) { succeeds(t, reopened(t)) })
	t.Run("strict_order_and_replay", func(t *testing.T) {
		f := reopened(t)
		key := f.next + 1
		var first reworkFailure
		// The clock still equals the first Run's created_at_ns.
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
		expectRefusal(t, f, true, func() (int, reworkFailure) {
			f.next++
			out, err := f.svc.DispatchRun(t.Context(), operator, command.DispatchRun{Metadata: initialMetadata(f.next, f.version(t)-1), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"})
			return 0, outcomeCode(t, out, err)
		}, 409, "version_conflict")
		f.clock.now = f.clock.now.Add(2 * time.Hour)
		succeeds(t, f)
	})
	t.Run("blocker", func(t *testing.T) {
		f := reopened(t)
		injectRunState(t, f.db, "INSERT INTO work_item_blockers(project_id, work_item_id, blocker_id, reason) SELECT project_id, work_item_id, 'blk_1', 'waiting' FROM work_items")
		f.clock.now = f.clock.now.Add(time.Second)
		expectRefusal(t, f, true, func() (int, reworkFailure) { out, err := f.dispatch(t); return 0, outcomeCode(t, out, err) }, 422, "lifecycle_rejected", "active_blocker")
	})
}

func TestReopen_SecondCompletionUsesOnlyNewCandidate(t *testing.T) {
	f := newReworkFixture(t)
	sA := completeA(t, f)
	runA := f.runs[0]
	firstVersion := f.version(t)
	if r := f.reopen(t, "Draft", "second iteration", 600); r.Code != 200 {
		t.Fatalf("reopen %d %s", r.Code, r.Body)
	}
	f.clock.now = f.clock.now.Add(time.Second)
	expectRefusal(t, f, true, func() (int, reworkFailure) { out, err := f.dispatch(t); return 0, outcomeCode(t, out, err) }, 422, "lifecycle_rejected", "invalid_transition")
	// Neither the old Candidate nor its subject can act while not in Review/QA.
	expectRefusal(t, f, true, func() (int, reworkFailure) {
		out, err := f.svc.RequestQA(t.Context(), operator, command.RequestQA{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-a", SubjectDigest: sA.Digest()})
		return 0, outcomeCode(t, out, err)
	}, 422, "lifecycle_rejected")
	if _, err := f.svc.MarkReady(t.Context(), operator, command.MarkReady{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.dispatch(t); err != nil {
		t.Fatal(err)
	}
	f.execute(t, f.latestRunID(t), "candidate-b", true)
	runB := f.runs[1]
	expectRefusal(t, f, true, func() (int, reworkFailure) {
		out, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(runA, "candidate-a2", "candidate-a"))
		return 0, outcomeCode(t, out, err)
	}, 422, "lifecycle_rejected")
	if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(runB, "candidate-b", "candidate-b")); err != nil {
		t.Fatal(err)
	}
	sB := f.subject(t, "candidate-b")
	fakeA := impersonate(t, sB, "candidate-a", domain.HashString("candidate-a"), runA)
	expectRefusal(t, f, false, func() (int, reworkFailure) {
		out, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runA, fakeA.Digest(), "evidence", "AC-A", "Passing"))
		return 0, outcomeCode(t, out, err)
	}, 409, "stale_subject")
	if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runB, sB.Digest(), "review", "", "Approved")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RequestQA(t.Context(), operator, command.RequestQA{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-b", SubjectDigest: sB.Digest()}); err != nil {
		t.Fatal(err)
	}
	sB = f.subject(t, "candidate-b")
	complete := func() (command.Outcome, error) {
		return f.svc.CompleteWorkItem(t.Context(), operator, command.CompleteWorkItem{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, Subject: sB})
	}
	// Only A-bound Evidence exists.
	expectRefusal(t, f, true, func() (int, reworkFailure) { out, err := complete(); return 0, outcomeCode(t, out, err) }, 422, "done_gate_unsatisfied", "evidence_missing")
	for _, ac := range f.acs {
		if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runB, sB.Digest(), "evidence", ac, "Passing")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := complete(); err != nil || f.phase(t) != "Done" {
		t.Fatalf("B completion: %v phase %s", err, f.phase(t))
	}
	var versions string
	if err := f.db.QueryRow("SELECT group_concat(result_work_item_version) FROM (SELECT result_work_item_version FROM completion_records ORDER BY result_work_item_version)").Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != fmt.Sprintf("%d,%d", firstVersion, f.version(t)) {
		t.Fatalf("completion record versions %q", versions)
	}
	var bJoinsA int
	if err := f.db.QueryRow("SELECT count(*) FROM completion_records c JOIN completion_record_evidence ce ON ce.project_id=c.project_id AND ce.completion_record_id=c.completion_record_id JOIN evidence e ON e.project_id=ce.project_id AND e.evidence_id=ce.evidence_id WHERE c.result_work_item_version=? AND e.completion_subject_digest=?", f.version(t), sA.Digest().String()).Scan(&bJoinsA); err != nil || bJoinsA != 0 {
		t.Fatalf("second completion joined A evidence: %d %v", bJoinsA, err)
	}
	detail := func() int {
		t.Helper()
		r := initialHTTPRequest(f.h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/work-items/"+string(workItemID), nil, true, false)
		var w struct {
			CompletionRecords []any `json:"completion_records"`
		}
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &w, json.RejectUnknownMembers(false)) != nil {
			t.Fatalf("detail %d %s", r.Code, r.Body)
		}
		return len(w.CompletionRecords)
	}
	if n := detail(); n != 2 {
		t.Fatalf("detail completion records %d", n)
	}
	// Restart preserves both completions and the reopen result.
	var seq int
	var name, path string
	if err := f.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	before, _ := domainSnapshot(t, f.db)
	if err := f.store.Close(); err != nil {
		t.Fatal(err)
	}
	reopenedStore, err := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopenedStore.Close() })
	f.svc.unit = reopenedStore
	f.store = reopenedStore
	f.h, err = httpapi.NewServer(f.svc, httpapi.UnitCommandResults{Unit: reopenedStore}, httpapi.PersistedProjections{Store: reopenedStore}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	replay := initialHTTPRequest(f.h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/commands/"+initialMetadata(600, 0).CommandID, nil, true, false)
	if replay.Code != 200 || !strings.Contains(replay.Body.String(), `"WorkItemReopened"`) || !strings.Contains(replay.Body.String(), "second iteration") {
		t.Fatalf("reopen replay after restart %d %s", replay.Code, replay.Body)
	}
	after, _ := domainSnapshot(t, f.db)
	if !bytes.Equal(before, after) || detail() != 2 {
		t.Fatal("restart changed history")
	}
}
