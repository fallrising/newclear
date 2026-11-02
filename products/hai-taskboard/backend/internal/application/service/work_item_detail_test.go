package service

import (
	json "encoding/json/v2"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const detailOtherItem domain.WorkItemID = "wi_01HABCDEFGZ"

type detailWire struct {
	Kind    string `json:"kind"`
	Summary struct {
		WorkItemID string `json:"work_item_id"`
		Phase      string `json:"phase"`
	} `json:"summary"`
	Material struct {
		WorkItemID string `json:"work_item_id"`
		Runs       []any  `json:"runs"`
		Candidates []any  `json:"candidates"`
	} `json:"material"`
	Reviews []struct {
		ID            string  `json:"review_id"`
		Subject       string  `json:"completion_subject_digest"`
		Verdict       string  `json:"verdict"`
		HumanReportID *string `json:"human_report_id"`
	} `json:"reviews"`
	Evidence []struct {
		ID            string  `json:"evidence_id"`
		Subject       string  `json:"completion_subject_digest"`
		HumanReportID *string `json:"human_report_id"`
	} `json:"evidence"`
	Approvals []struct {
		ID                 string  `json:"approval_id"`
		Subject            string  `json:"subject_digest"`
		ConsumedAt         *string `json:"consumed_at"`
		CompletionRecordID *string `json:"completion_record_id"`
	} `json:"approvals"`
	CompletionRecords []struct {
		ID          string   `json:"completion_record_id"`
		EvidenceIDs []string `json:"evidence_ids"`
		ReviewIDs   []string `json:"review_ids"`
		ApprovalIDs []string `json:"approval_ids"`
	} `json:"completion_records"`
	Audit []struct {
		CommandID string  `json:"command_id"`
		Operation string  `json:"operation"`
		RunID     *string `json:"run_id"`
	} `json:"audit"`
}

func readDetail(t *testing.T, f *reworkFixture, item domain.WorkItemID) detailWire {
	t.Helper()
	r := initialHTTPRequest(f.h, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/work-items/"+string(item), nil, true, false)
	var w detailWire
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &w, json.RejectUnknownMembers(false)) != nil {
		t.Fatalf("detail %s: %d %s", item, r.Code, r.Body)
	}
	if w.Kind != "work_item_detail/v1" || w.Summary.WorkItemID != string(item) || w.Material.WorkItemID != string(item) {
		t.Fatalf("detail identity %+v", w)
	}
	return w
}

// storedIDs is the authoritative attribution oracle: rows whose subject was
// recorded by a command addressed to item, read straight from SQL.
func storedIDs(t *testing.T, f *reworkFixture, table, id, subject string, item domain.WorkItemID) []string {
	t.Helper()
	rows, err := f.db.Query(fmt.Sprintf(`SELECT DISTINCT x.%s FROM %s x JOIN audit_entries e ON e.project_id=x.project_id AND e.subject_digest=x.%s
JOIN audit_groups g ON g.project_id=e.project_id AND g.audit_group_id=e.audit_group_id JOIN command_results c ON c.project_id=g.project_id AND c.command_id=g.command_id
WHERE json_extract(c.result_payload,'$.result.work_item_id')=? ORDER BY x.%s`, id, table, subject, id), string(item))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			t.Fatal(err)
		}
		out = append(out, v)
	}
	return out
}

// detailFlow drives workItemID through rework A→B to Done with Approval, and
// detailOtherItem to Review with fixture-only Review, Evidence and Approval.
func detailFlow(t *testing.T) *reworkFixture {
	t.Helper()
	f := newReworkFixtureWith(t, true, detailOtherItem)
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
	runB := f.runs[1]
	if _, err := f.svc.SubmitCandidate(t.Context(), operator, f.submit(runB, "candidate-b", "candidate-b")); err != nil {
		t.Fatal(err)
	}
	sB := f.subject(t, "candidate-b")
	if _, err := f.svc.PublishFixtureReview(t.Context(), operator, command.PublishFixtureReview{Metadata: f.meta(), ProjectID: projectID, RunID: runB.id, LeaseEpoch: runB.envelope.Fence.Epoch, RestoreGeneration: runB.envelope.Fence.RestoreGeneration, Review: command.Review{ID: "review-b-fixture", SubjectDigest: sB.Digest(), ReviewerID: operator, ReviewerClass: "independent", Verdict: "Approved", CreatedAt: fixedTime()}}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runB, sB.Digest(), "review", "", "Approved")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RequestQA(t.Context(), operator, command.RequestQA{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-b", SubjectDigest: sB.Digest()}); err != nil {
		t.Fatal(err)
	}
	sB = f.subject(t, "candidate-b")
	if _, err := f.svc.ApproveSubject(t.Context(), operator, command.ApproveSubject{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, CandidateID: "candidate-b", RequestID: "approval-b", SubjectDigest: sB.Digest(), Decision: "Approved"}); err != nil {
		t.Fatal(err)
	}
	for _, ac := range f.acs {
		if _, err := f.svc.SubmitHumanReport(t.Context(), operator, f.report(runB, sB.Digest(), "evidence", ac, "Passing")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.svc.CompleteWorkItem(t.Context(), operator, command.CompleteWorkItem{Metadata: f.meta(), ProjectID: projectID, WorkItemID: workItemID, Subject: f.subject(t, "candidate-b")}); err != nil {
		t.Fatal(err)
	}
	if f.phase(t) != "Done" {
		t.Fatal("first item is not Done")
	}

	// The second item reaches Review with fixture-only verification material.
	meta := func() command.Metadata {
		var v uint64
		if err := f.db.QueryRow("SELECT version FROM work_items WHERE work_item_id=?", detailOtherItem).Scan(&v); err != nil {
			t.Fatal(err)
		}
		f.next++
		return initialMetadata(f.next, v)
	}
	if _, err := f.svc.MarkReady(t.Context(), operator, command.MarkReady{Metadata: meta(), ProjectID: projectID, WorkItemID: detailOtherItem}); err != nil {
		t.Fatal(err)
	}
	f.clock.now = f.clock.now.Add(time.Second)
	if _, err := f.svc.DispatchRun(t.Context(), operator, command.DispatchRun{Metadata: meta(), ProjectID: projectID, WorkItemID: detailOtherItem, AdapterID: "fake/v1", ScenarioID: "success"}); err != nil {
		t.Fatal(err)
	}
	f.execute(t, f.latestRunID(t), "candidate-c", true)
	runC := f.runs[2]
	submit := f.submit(runC, "candidate-c", "candidate-c")
	submit.Metadata, submit.WorkItemID = meta(), detailOtherItem
	if _, err := f.svc.SubmitCandidate(t.Context(), operator, submit); err != nil {
		t.Fatal(err)
	}
	var sC domain.CompletionSubject
	if err := f.store.Within(t.Context(), func(tx port.Transaction) error {
		m, _, err := f.svc.currentCompletionMaterial(t.Context(), tx, port.CompletionMaterialQuery{ProjectID: projectID, WorkItemID: detailOtherItem, CandidateID: "candidate-c"})
		if err != nil {
			return err
		}
		sC, err = preparationSubject(m, f.svc.completionFor(projectID))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PublishFixtureReview(t.Context(), operator, command.PublishFixtureReview{Metadata: meta(), ProjectID: projectID, RunID: runC.id, LeaseEpoch: runC.envelope.Fence.Epoch, RestoreGeneration: runC.envelope.Fence.RestoreGeneration, Review: command.Review{ID: "review-c-fixture", SubjectDigest: sC.Digest(), ReviewerID: operator, ReviewerClass: "independent", Verdict: "Approved", CreatedAt: fixedTime()}}); err != nil {
		t.Fatal(err)
	}
	policy := f.svc.completionFor(projectID)
	if _, err := f.svc.PublishFixtureEvidence(t.Context(), operator, command.PublishFixtureEvidence{Metadata: meta(), ProjectID: projectID, RunID: runC.id, LeaseEpoch: runC.envelope.Fence.Epoch, RestoreGeneration: runC.envelope.Fence.RestoreGeneration, Evidence: command.Evidence{ID: "evidence-c-fixture", SubjectDigest: sC.Digest(), ACID: "AC-A", ACRevisionDigest: domain.HashBytes(initialContent), ObservationVerdict: "Passing", ReviewDisposition: "Accepted", Applicability: "Fresh", MaterialAvailability: "Present", VerifierID: operator, VerifierClass: policy.Checks["AC-A"].VerifierClass, RecipeDigest: policy.RecipeDigest, EnvironmentDigest: policy.Checks["AC-A"].EnvironmentDigest, ObservedAt: fixedTime(), Report: submit.Candidate.Artifacts[0]}}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ApproveSubject(t.Context(), operator, command.ApproveSubject{Metadata: meta(), ProjectID: projectID, WorkItemID: detailOtherItem, CandidateID: "candidate-c", RequestID: "approval-c", SubjectDigest: sC.Digest(), Decision: "Approved"}); err != nil {
		t.Fatal(err)
	}
	return f
}

// TestWorkItemDetail_TruthfulShape is DTL-AC-02 for lawful rows: values equal the stored rows.
func TestWorkItemDetail_TruthfulShape(t *testing.T) {
	f := detailFlow(t)
	w := readDetail(t, f, workItemID)
	var verdicts, humanReviews []string
	for _, r := range w.Reviews {
		var stored, subject string
		if err := f.db.QueryRow("SELECT verdict,completion_subject_digest FROM reviews WHERE review_id=?", r.ID).Scan(&stored, &subject); err != nil {
			t.Fatal(err)
		}
		if stored != r.Verdict || "sha256:"+subject != r.Subject {
			t.Fatalf("review %s stored %s/%s wire %s/%s", r.ID, stored, subject, r.Verdict, r.Subject)
		}
		verdicts = append(verdicts, r.Verdict)
		if r.HumanReportID != nil {
			humanReviews = append(humanReviews, *r.HumanReportID)
		}
	}
	slices.Sort(verdicts)
	if !slices.Equal(verdicts, []string{"Approved", "Approved", "Rejected"}) || len(humanReviews) != 2 {
		t.Fatalf("reviews %v human %v", verdicts, humanReviews)
	}
	if len(w.Approvals) != 1 || w.Approvals[0].ID != "approval-b" || w.Approvals[0].ConsumedAt == nil || w.Approvals[0].CompletionRecordID == nil {
		t.Fatalf("approvals %+v", w.Approvals)
	}
	if len(w.CompletionRecords) != 1 || *w.Approvals[0].CompletionRecordID != w.CompletionRecords[0].ID {
		t.Fatalf("completion %+v", w.CompletionRecords)
	}
	c := w.CompletionRecords[0]
	for table, ids := range map[string][]string{"completion_record_evidence": c.EvidenceIDs, "completion_record_reviews": c.ReviewIDs, "completion_record_approvals": c.ApprovalIDs} {
		column := map[string]string{"completion_record_evidence": "evidence_id", "completion_record_reviews": "review_id", "completion_record_approvals": "approval_id"}[table]
		var joined string
		if err := f.db.QueryRow(fmt.Sprintf("SELECT group_concat(%s) FROM (SELECT %s FROM %s WHERE completion_record_id=? ORDER BY %s)", column, column, table, column), c.ID).Scan(&joined); err != nil {
			t.Fatal(err)
		}
		if joined != strings.Join(ids, ",") {
			t.Fatalf("%s stored %s wire %v", table, joined, ids)
		}
	}
}

// TestWorkItemDetail_AttributionAcrossItemsAndRework is DTL-AC-03.
func TestWorkItemDetail_AttributionAcrossItemsAndRework(t *testing.T) {
	f := detailFlow(t)
	first, second := readDetail(t, f, workItemID), readDetail(t, f, detailOtherItem)
	ids := func(w detailWire) (reviews, evidence, approvals []string) {
		for _, r := range w.Reviews {
			reviews = append(reviews, r.ID)
		}
		for _, e := range w.Evidence {
			evidence = append(evidence, e.ID)
		}
		for _, a := range w.Approvals {
			approvals = append(approvals, a.ID)
		}
		slices.Sort(reviews)
		slices.Sort(evidence)
		slices.Sort(approvals)
		return
	}
	for item, w := range map[domain.WorkItemID]detailWire{workItemID: first, detailOtherItem: second} {
		reviews, evidence, approvals := ids(w)
		if !slices.Equal(reviews, storedIDs(t, f, "reviews", "review_id", "completion_subject_digest", item)) ||
			!slices.Equal(evidence, storedIDs(t, f, "evidence", "evidence_id", "completion_subject_digest", item)) ||
			!slices.Equal(approvals, storedIDs(t, f, "approvals", "approval_id", "completion_subject_digest", item)) {
			t.Fatalf("%s attribution reviews %v evidence %v approvals %v", item, reviews, evidence, approvals)
		}
	}
	// Both Candidates' material appears under the reworked item; fixture-only
	// rows appear under the other item and nowhere else.
	reviews, evidence, approvals := ids(first)
	if len(reviews) != 3 || len(evidence) != 4 || len(approvals) != 1 || len(first.Material.Candidates) != 2 {
		t.Fatalf("first %v %v %v", reviews, evidence, approvals)
	}
	reviews, evidence, approvals = ids(second)
	if !slices.Equal(reviews, []string{"review-c-fixture"}) || !slices.Equal(evidence, []string{"evidence-c-fixture"}) || !slices.Equal(approvals, []string{"approval-c"}) || len(second.CompletionRecords) != 0 || second.Approvals[0].ConsumedAt != nil {
		t.Fatalf("second %v %v %v %+v", reviews, evidence, approvals, second.Approvals)
	}
	acceptance := initialMetadata(13, 1).CommandID
	operations := func(w detailWire) map[string]bool {
		seen := map[string]bool{}
		for _, a := range w.Audit {
			seen[a.CommandID] = true
			seen[a.Operation] = true
		}
		return seen
	}
	one, two := operations(first), operations(second)
	if !one[acceptance] || !two[acceptance] || !one["ClaimDispatch"] || !one["PublishRunObservation"] || !two["ClaimDispatch"] {
		t.Fatalf("audit coverage first %v second %v", one, two)
	}
	for _, a := range first.Audit {
		if a.RunID != nil && *a.RunID == string(f.runs[2].id) {
			t.Fatalf("second item's Run audit leaked into first: %+v", a)
		}
	}
	for _, a := range second.Audit {
		if a.RunID != nil && (*a.RunID == string(f.runs[0].id) || *a.RunID == string(f.runs[1].id)) {
			t.Fatalf("first item's Run audit leaked into second: %+v", a)
		}
	}
}
