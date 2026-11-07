package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type humanCommandOnlyUnit struct{}

func (humanCommandOnlyUnit) Within(_ context.Context, f func(port.Transaction) error) error {
	return f(humanCommandOnlyTransaction{})
}

type humanCommandOnlyTransaction struct{ port.Transaction }

func (humanCommandOnlyTransaction) LoadIdempotency(context.Context, domain.ActorID, domain.ProjectID, string, string) (port.Idempotency, error) {
	return port.Idempotency{}, port.ErrNotFound
}

type humanCapabilityClock struct{}

func (humanCapabilityClock) Now() time.Time { return time.Unix(10, 0).UTC() }
func TestHumanReport_CommandPersistenceCapability(t *testing.T) {
	s := &Service{unit: humanCommandOnlyUnit{}, clock: humanCapabilityClock{}, config: Config{Operator: "operator"}}
	v := command.SubmitHumanReport{Metadata: command.Metadata{CommandID: "cmd_0000000001", IdempotencyKey: "00000000-0000-4000-8000-000000000001", ExpectedVersion: 1, IssuedAt: time.Unix(1, 0).UTC(), CorrelationID: "test"}, ProjectID: "prj_0000000001", WorkItemID: "wi_0000000001", RunID: "run_0000000001", ReportID: "report_0000000001", SubjectDigest: domain.HashString("subject"), LeaseEpoch: 1, RestoreGeneration: 1, Kind: "review", MediaType: "text/plain", Content: "report", Review: &command.HumanReviewIntent{Verdict: "Approved"}}
	_, err := s.SubmitHumanReport(t.Context(), "operator", v)
	e, ok := errors.AsType[*command.Error](err)
	if !ok || e.Code != command.CodeCapabilityUnsupported || e.Retryable {
		t.Fatal("missing command persistence capability misclassified", err)
	}
	_, err = s.DescribeHumanReport(t.Context(), "operator", v.ProjectID, v.ReportID)
	e, ok = errors.AsType[*command.Error](err)
	if !ok || e.Code != command.CodeProjectionUnavailable {
		t.Fatal("read capability convention changed", err)
	}
}

func TestHumanReport_AdmissionBudgets(t *testing.T) {
	s := &Service{config: Config{Completion: CompletionPolicy{RecipeDigest: domain.HashString("recipe"), Checks: map[domain.ACID]VerificationRule{"ac": {VerifierClass: "human", EnvironmentDigest: domain.HashString("env")}}}}}
	v := command.SubmitHumanReport{Kind: "review", SubjectDigest: domain.HashString("subject")}
	artifact := func(id string, n uint64) port.Artifact {
		d := domain.HashString(id)
		return port.Artifact{Digest: d, ByteLength: n, MediaType: "text/plain", StorageKey: artifactStorageKey(d), Availability: "Present"}
	}
	proposed := artifact("new", 1)
	for _, tc := range []struct {
		name      string
		configure func(*port.CompletionMaterial, *command.SubmitHumanReport, *int)
		want      bool
	}{
		{"report-at-limit", func(_ *port.CompletionMaterial, _ *command.SubmitHumanReport, n *int) { *n = 1023 }, true},
		{"report-over", func(_ *port.CompletionMaterial, _ *command.SubmitHumanReport, n *int) { *n = 1024 }, false},
		{"review-at-limit", func(m *port.CompletionMaterial, _ *command.SubmitHumanReport, _ *int) {
			m.Reviews = make([]port.Review, 1023)
		}, true},
		{"review-over", func(m *port.CompletionMaterial, _ *command.SubmitHumanReport, _ *int) {
			m.Reviews = make([]port.Review, 1024)
		}, false},
		{"evidence-at-limit", func(m *port.CompletionMaterial, v *command.SubmitHumanReport, _ *int) {
			v.Kind = "evidence"
			m.Evidence = make([]port.Evidence, 1023)
			m.Artifacts = make([]port.Artifact, 1023)
		}, true},
		{"evidence-over", func(m *port.CompletionMaterial, v *command.SubmitHumanReport, _ *int) {
			v.Kind = "evidence"
			m.Evidence = make([]port.Evidence, 1024)
		}, false},
		{"artifact-collection-over", func(m *port.CompletionMaterial, v *command.SubmitHumanReport, _ *int) {
			v.Kind = "evidence"
			m.Artifacts = make([]port.Artifact, 1024)
		}, false},
		{"unique-at-limit", func(m *port.CompletionMaterial, _ *command.SubmitHumanReport, _ *int) {
			for i := range 1024 {
				m.CandidateArtifacts = append(m.CandidateArtifacts, artifact(fmt.Sprint(i), 1))
			}
		}, true},
		{"unique-over", func(m *port.CompletionMaterial, v *command.SubmitHumanReport, _ *int) {
			v.Kind = "evidence"
			for i := range 1024 {
				m.CandidateArtifacts = append(m.CandidateArtifacts, artifact(fmt.Sprint(i), 1))
			}
		}, false},
		{"review-excluded-from-bytes", func(m *port.CompletionMaterial, _ *command.SubmitHumanReport, _ *int) {
			for i := range 5 {
				m.CandidateArtifacts = append(m.CandidateArtifacts, artifact(fmt.Sprint(i), 10<<20))
			}
		}, true},
		{"bytes-at-limit", func(m *port.CompletionMaterial, v *command.SubmitHumanReport, _ *int) {
			v.Kind = "evidence"
			for i := range 5 {
				n := uint64(10 << 20)
				if i == 4 {
					n--
				}
				m.CandidateArtifacts = append(m.CandidateArtifacts, artifact(fmt.Sprint(i), n))
			}
		}, true},
		{"bytes-over", func(m *port.CompletionMaterial, v *command.SubmitHumanReport, _ *int) {
			v.Kind = "evidence"
			for i := range 5 {
				m.CandidateArtifacts = append(m.CandidateArtifacts, artifact(fmt.Sprint(i), 10<<20))
			}
		}, false},
		{"deduplicated-bytes", func(m *port.CompletionMaterial, v *command.SubmitHumanReport, _ *int) {
			v.Kind = "evidence"
			for range 6 {
				m.CandidateArtifacts = append(m.CandidateArtifacts, artifact("same", 10<<20))
			}
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := port.CompletionMaterial{}
			c := v
			n := 0
			tc.configure(&m, &c, &n)
			err := s.humanReportAdmission(m, c, proposed, n)
			if (err == nil) != tc.want {
				t.Fatalf("admission error=%v want acceptance=%v", err, tc.want)
			}
		})
	}
	// The exact integrity predicate skips failed/unbound historical reports.
	for _, eligible := range []bool{false, true} {
		m := port.CompletionMaterial{RequiredACRevisions: []port.ACRequirement{{ACID: "ac", RevisionDigest: domain.HashString("ac")}}}
		for i := range 6 {
			a := artifact(fmt.Sprint(i), 10<<20)
			m.Artifacts = append(m.Artifacts, a)
			verdict := "Failed"
			if eligible {
				verdict = "Passed"
			}
			m.Evidence = append(m.Evidence, port.Evidence{ACID: "ac", ACRevisionDigest: domain.HashString("ac"), SubjectDigest: v.SubjectDigest, VerifierClass: "human", Verdict: verdict, Applicability: "Current", Availability: "Present", RecipeDigest: s.config.Completion.RecipeDigest, EnvironmentDigest: domain.HashString("env"), ArtifactDigest: a.Digest})
		}
		if err := s.humanReportAdmission(m, v, proposed, 0); (err == nil) == eligible {
			t.Fatal("eligibility differs from completion integrity", eligible, err)
		}
	}
}

type humanReadUnit struct {
	report port.HumanReport
	reads  int
	locked bool
	second func(*port.HumanReport) error
}

func (u *humanReadUnit) Within(ctx context.Context, f func(port.Transaction) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	u.locked = true
	defer func() { u.locked = false }()
	return f(humanReadTransaction{unit: u})
}

type humanReadTransaction struct {
	port.Transaction
	unit *humanReadUnit
}

func (t humanReadTransaction) LoadHumanReport(_ context.Context, p domain.ProjectID, id string) (port.HumanReport, error) {
	t.unit.reads++
	r := t.unit.report
	if p != r.ProjectID || id != r.ID {
		return port.HumanReport{}, port.ErrNotFound
	}
	if t.unit.reads == 2 && t.unit.second != nil {
		if err := t.unit.second(&r); err != nil {
			return port.HumanReport{}, err
		}
	}
	return r, nil
}
func (humanReadTransaction) StoreHumanReport(context.Context, port.HumanReport) error {
	return errors.New("unexpected write")
}
func (humanReadTransaction) HumanReportIDExists(context.Context, domain.ProjectID, string) (bool, error) {
	return false, errors.New("unexpected mutation preflight")
}
func (humanReadTransaction) CountHumanReports(context.Context, domain.ProjectID, domain.Digest) (int, error) {
	return 0, errors.New("unexpected mutation preflight")
}

type humanReadArtifacts struct {
	port.ArtifactStore
	open func(context.Context, domain.Digest) (io.ReadCloser, error)
}

func (a humanReadArtifacts) Open(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
	return a.open(ctx, d)
}

type humanReadCloser struct {
	io.Reader
	close func() error
}

func (r humanReadCloser) Close() error {
	if r.close != nil {
		return r.close()
	}
	return nil
}

func TestHumanReport_ReadSnapshotAndCancellation(t *testing.T) {
	d := domain.HashString("report")
	for _, kind := range []string{"valid", "changed-association", "missing-after-open", "canceled-close", "unauthorized", "short", "close-error"} {
		t.Run(kind, func(t *testing.T) {
			u := &humanReadUnit{report: port.HumanReport{ProjectID: "prj_0000000001", WorkItemID: "wi_0000000001", RunID: "run_0000000001", ID: "report_0000000001", Kind: "review", Actor: "operator", CreatedAtNS: 42, SubjectDigest: domain.HashString("subject"), LeaseEpoch: 1, RestoreGeneration: 1, Artifact: port.Artifact{Digest: d, MediaType: "text/plain", ByteLength: 6, Availability: "Present", StorageKey: "sha256:" + d.String()}}}
			switch kind {
			case "changed-association":
				u.second = func(r *port.HumanReport) error { r.Actor = "different"; return nil }
			case "missing-after-open":
				u.second = func(*port.HumanReport) error { return port.ErrNotFound }
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			opens := 0
			a := humanReadArtifacts{open: func(context.Context, domain.Digest) (io.ReadCloser, error) {
				opens++
				if u.locked {
					t.Fatal("byte I/O held transaction")
				}
				text := "report"
				if kind == "short" {
					text = "short"
				}
				return humanReadCloser{Reader: strings.NewReader(text), close: func() error {
					if kind == "canceled-close" {
						cancel()
					}
					if kind == "close-error" {
						return errors.New("private close")
					}
					return nil
				}}, nil
			}}
			s := &Service{unit: u, artifacts: a, config: Config{Operator: "operator"}}
			actor := domain.ActorID("operator")
			if kind == "unauthorized" {
				actor = "forged"
			}
			_, body, err := s.ReadHumanReport(ctx, actor, u.report.ProjectID, u.report.ID)
			if kind == "valid" {
				if err != nil || string(body) != "report" || opens != 1 || u.reads != 2 {
					t.Fatal(err, opens, u.reads)
				}
				return
			}
			if err == nil || body != nil {
				t.Fatal("fault returned bytes", err)
			}
			if kind == "unauthorized" && (opens != 0 || u.reads != 0) {
				t.Fatal("unauthorized I/O")
			}
			if kind == "canceled-close" {
				e, ok := errors.AsType[*command.Error](err)
				if !ok || e.Code != command.CodeProjectionUnavailable {
					t.Fatal("cancellation lost precedence", err)
				}
			}
		})
	}
}
