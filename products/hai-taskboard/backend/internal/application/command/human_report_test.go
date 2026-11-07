package command

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func humanCommand() SubmitHumanReport {
	return SubmitHumanReport{Metadata: Metadata{CommandID: "cmd_01HABCDEFGH", IdempotencyKey: "00000000-0000-4000-8000-000000000001", ExpectedVersion: 4, IssuedAt: time.Unix(1, 0).UTC(), CorrelationID: "test"}, ProjectID: "prj_01HABCDEFGH", WorkItemID: "wi_01HABCDEFGH", RunID: "run_01HABCDEFGH", ReportID: "report_01HABCDEFGH", SubjectDigest: domain.HashString("subject"), LeaseEpoch: 1, RestoreGeneration: 1, Kind: "review", MediaType: "text/plain", Content: "exact\r\n", Review: &HumanReviewIntent{Verdict: "Approved"}}
}
func TestHumanReport_CanonicalReplayAndResultCompatibility(t *testing.T) {
	v := humanCommand()
	before, digest, err := CanonicalSubmitHumanReport(v)
	if err != nil {
		t.Fatal(err)
	}
	v.CorrelationID = "new"
	after, other, err := CanonicalSubmitHumanReport(v)
	if err != nil || !bytes.Equal(before, after) || digest != other {
		t.Fatal("correlation changed canonical intent")
	}
	for _, change := range []func(*SubmitHumanReport){func(v *SubmitHumanReport) { v.Content = "exact\n" }, func(v *SubmitHumanReport) { v.MediaType = "text/markdown" }, func(v *SubmitHumanReport) { v.SubjectDigest = domain.HashString("other") }, func(v *SubmitHumanReport) { v.Review = &HumanReviewIntent{Verdict: "ChangesRequested"} }} {
		c := v
		change(&c)
		_, got, err := CanonicalSubmitHumanReport(c)
		if err != nil || got == digest {
			t.Fatal("intent not bound", err)
		}
	}
	old := Result{Type: "ProjectCreated", ProjectID: v.ProjectID, Version: 1}
	b, err := CanonicalSuccess(v.Metadata, CreateProjectOperation, old, 1, port.Cursor{Epoch: 1, Sequence: 1})
	if err != nil || bytes.Contains(b, []byte("report_")) {
		t.Fatal("old result changed", err)
	}
	for _, field := range []string{"report_id", "report_kind"} {
		bad := strings.Replace(string(b), `"result":{`, `"result":{"`+field+`":"report_01HABCDEFGH",`, 1)
		if _, err := DecodeCanonicalResult([]byte(bad), v.CommandID, CreateProjectOperation); err == nil {
			t.Fatal("foreign report result field accepted")
		}
	}
	result := Result{Type: "HumanReportSubmitted", ReportID: v.ReportID, ReportKind: v.Kind, ProjectID: v.ProjectID, WorkItemID: v.WorkItemID, RunID: v.RunID, Version: 4, Phase: domain.PhaseReview}
	b, err = CanonicalSuccess(v.Metadata, SubmitHumanReportOperation, result, 1, port.Cursor{Epoch: 1, Sequence: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = DecodeCanonicalResult(b, v.CommandID, SubmitHumanReportOperation); err != nil {
		t.Fatal(err)
	}
}
