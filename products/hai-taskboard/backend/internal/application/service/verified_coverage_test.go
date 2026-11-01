package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"io"
	"io/fs"
	"slices"
	"strings"
	"time"

	json "encoding/json/v2"
	"maps"
	"reflect"
	"testing"
)

type coverageTestResponse struct {
	Version     uint64 `json:"expected_version"`
	Digest      string `json:"completion_subject_digest"`
	Mode        string `json:"subject_mode"`
	Observation bool   `json:"observation_only"`
	Coverage    []struct {
		AC      string   `json:"ac_id"`
		Covered bool     `json:"covered"`
		IDs     []string `json:"matching_evidence_ids"`
		Reasons []string `json:"reasons"`
	} `json:"coverage"`
	Eligibility struct {
		Evaluated bool     `json:"evaluated"`
		Satisfied bool     `json:"satisfied"`
		Reasons   []string `json:"reasons"`
	} `json:"completion_eligibility"`
}

func readTestCoverage(t *testing.T, f currentFlow) coverageTestResponse {
	t.Helper()
	b, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got coverageTestResponse
	if err = json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	return got
}
func TestVerifiedCoverage_ExactSubjectAndProjectPolicy(t *testing.T) {
	for _, stage := range []int{1, 3, 5} {
		f := acceptedCurrentFlow(t, stage)
		got := readTestCoverage(t, f)
		if got.Digest != "sha256:"+f.review.Review.SubjectDigest.String() || !got.Observation || len(got.Coverage) != 1 || got.Coverage[0].AC != "AC-A" || got.Coverage[0].Covered != (stage >= 3) {
			t.Fatalf("unexpected exact coverage: %+v", got)
		}
		if stage < 5 && (got.Mode != "prospective_qa" || got.Eligibility.Evaluated || got.Eligibility.Satisfied || !reflect.DeepEqual(got.Eligibility.Reasons, []string{"phase_not_qa"})) {
			t.Fatalf("Review eligibility: %+v", got)
		}
	}
}
func TestCoverageProjection_MatchesCurrentDonePredicate(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	got := readTestCoverage(t, f)
	if !got.Eligibility.Evaluated || !got.Eligibility.Satisfied || !got.Coverage[0].Covered || len(got.Coverage[0].IDs) != 1 {
		t.Fatalf("coverage and Done disagree: %+v", got)
	}
	if _, err := f.call(t, 5); err != nil {
		t.Fatal(err)
	}
}
func TestVerifiedCoverage_NoWritesOrAllocatedIDs(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	before := preparationDatabaseSnapshot(t, f.db)
	ids := f.svc.ids.(*sequenceIDs)
	original := maps.Clone(ids.values)
	readTestCoverage(t, f)
	readTestCoverage(t, f)
	if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) || !maps.Equal(original, ids.values) {
		t.Fatal("observation wrote history or allocated IDs")
	}
}
func TestVerifiedCoverage_RevalidatesAfterExternalIO(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	changed := false
	f.svc.artifacts = changingCurrentArtifacts{base: f.svc.artifacts, after: func() {
		if changed {
			return
		}
		changed = true
		if _, err := f.db.Exec("UPDATE work_items SET version=version+1"); err != nil {
			t.Fatal(err)
		}
	}}
	if got, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID); err == nil || got != nil || !changed {
		t.Fatalf("drift was not revalidated: changed=%v err=%v", changed, err)
	}
}

func coverageExec(t *testing.T, f currentFlow, query string, args ...any) {
	t.Helper()
	if _, err := f.db.Exec(query, args...); err != nil {
		t.Fatal(query, err)
	}
}

func TestVerifiedCoverage_EvidenceVetoesAndExactSelection(t *testing.T) {
	for _, tc := range []struct {
		name, update string
		want         []string
		matching     bool
	}{
		{"failed", "verdict='Failed'", []string{"evidence_nonpassing"}, true},
		{"skipped", "verdict='Skipped'", []string{"evidence_nonpassing"}, true},
		{"notrun", "verdict='NotRun'", []string{"evidence_nonpassing"}, true},
		{"unknown", "verdict='Unknown'", []string{"evidence_nonpassing"}, true},
		{"error", "verdict='Error'", []string{"evidence_nonpassing"}, true},
		{"inconclusive", "verdict='Inconclusive'", []string{"evidence_nonpassing"}, true},
		{"stale", "applicability='Stale'", []string{"evidence_stale"}, true},
		{"superseded", "applicability='Superseded'", []string{"evidence_stale"}, true},
		{"unavailable", "availability='Unavailable'", []string{"evidence_unavailable"}, true},
		{"revision", "ac_revision_digest='" + domain.HashString("other revision").String() + "'", []string{"evidence_missing"}, false},
		{"class", "verifier_class='other'", []string{"evidence_missing"}, false},
		{"subject", "completion_subject_digest='" + domain.HashString("other").String() + "'", []string{"evidence_missing"}, false},
		{"recipe", "recipe_digest='" + domain.HashString("other").String() + "'", []string{"evidence_stale"}, true},
		{"environment", "environment_digest='" + domain.HashString("other").String() + "'", []string{"evidence_stale"}, true},
		{"independence", "verifier_role='producer'", []string{"verifier_not_independent"}, true},
		{"all", "availability='Unavailable',applicability='Stale',verdict='Failed',verifier_role='producer'", []string{"evidence_unavailable", "evidence_stale", "evidence_nonpassing", "verifier_not_independent"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := serviceProfile(t, projectID, "AC-A")
			f := acceptedCurrentFlowPolicy(t, 5, &p)
			coverageExec(t, f, "DROP TRIGGER evidence_immutable_update")
			coverageExec(t, f, "UPDATE evidence SET "+tc.update)
			got := readTestCoverage(t, f)
			if got.Coverage[0].Covered || !reflect.DeepEqual(got.Coverage[0].Reasons, tc.want) || (len(got.Coverage[0].IDs) > 0) != tc.matching || got.Eligibility.Satisfied {
				t.Fatalf("wrong veto: %+v", got)
			}
			for _, reason := range tc.want {
				if !slices.Contains(got.Eligibility.Reasons, reason) {
					t.Fatalf("eligibility lost %s: %+v", reason, got)
				}
			}
		})
	}
	t.Run("mixed-pass-fail-and-history", func(t *testing.T) {
		f := acceptedCurrentFlow(t, 5)
		coverageExec(t, f, `INSERT INTO evidence SELECT project_id,'second',completion_subject_digest,ac_id,ac_revision_digest,'Failed',applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest,artifact_digest FROM evidence`)
		coverageExec(t, f, `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1025) INSERT INTO evidence SELECT project_id,'historic-'||x,?,ac_id,ac_revision_digest,verdict,applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest,artifact_digest FROM evidence,n WHERE evidence_id='evidence-current'`, domain.HashString("other subject").String())
		got := readTestCoverage(t, f)
		if got.Coverage[0].Covered || !reflect.DeepEqual(got.Coverage[0].IDs, []string{"evidence-current", "second"}) || !reflect.DeepEqual(got.Coverage[0].Reasons, []string{"evidence_nonpassing"}) {
			t.Fatalf("all-match veto/history filter: %+v", got)
		}
	})
}

type coverageArtifacts struct {
	base port.ArtifactStore
	open func(context.Context, domain.Digest) (io.ReadCloser, error)
}

func (a coverageArtifacts) Put(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
	return a.base.Put(ctx, r)
}
func (a coverageArtifacts) Open(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
	return a.open(ctx, d)
}

func TestVerifiedCoverage_BytesInReviewAndUnavailableCandidate(t *testing.T) {
	for _, review := range []bool{true, false} {
		for _, missingBinding := range []bool{true, false} {
			for _, kind := range []string{"pass", "missing", "typed", "tamper", "short", "unknown", "read-error"} {
				t.Run(fmt.Sprintf("review=%t/binding=%t/%s", review, missingBinding, kind), func(t *testing.T) {
					stage := 5
					if review {
						stage = 3
					}
					f := acceptedCurrentFlow(t, stage)
					if missingBinding {
						coverageExec(t, f, "DROP TRIGGER candidate_artifacts_immutable_delete")
						coverageExec(t, f, "DELETE FROM candidate_artifacts")
					}
					opens := 0
					base := f.svc.artifacts
					f.svc.artifacts = coverageArtifacts{base: base, open: func(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
						opens++
						switch kind {
						case "missing":
							return nil, fmt.Errorf("missing: %w", fs.ErrNotExist)
						case "typed":
							return nil, port.ErrArtifactUnavailable
						case "tamper":
							return io.NopCloser(strings.NewReader("tampered!")), nil
						case "short":
							return io.NopCloser(strings.NewReader("tiny")), nil
						case "unknown":
							return nil, errors.New("disk fault")
						case "read-error":
							return io.NopCloser(coverageReadError{}), nil
						default:
							return base.Open(ctx, d)
						}
					}}
					b, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
					if kind == "unknown" || kind == "read-error" {
						if err == nil || b != nil {
							t.Fatal("unknown I/O became unavailable")
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					var got coverageTestResponse
					if err = json.Unmarshal(b, &got); err != nil {
						t.Fatal(err)
					}
					if opens != 1 || got.Coverage[0].Covered != (kind == "pass") {
						t.Fatalf("unverified or duplicate I/O: opens=%d response=%s", opens, b)
					}
					if !review && missingBinding && !slices.Contains(got.Eligibility.Reasons, "candidate_unavailable") {
						t.Fatalf("missing binding ignored: %s", b)
					}
				})
			}
		}
	}
}

type coverageReadError struct{}

func (coverageReadError) Read([]byte) (int, error) { return 0, errors.New("injected read I/O") }

func TestVerifiedCoverage_ProjectPolicyAndHumanReports(t *testing.T) {
	p := serviceProfile(t, projectID, "AC-A")
	f := acceptedCurrentFlowPolicy(t, 1, &p)
	poisonDefault(f.svc)
	f.svc.config.ProjectPolicies["other-project"] = serviceProfile(t, "other-project", "AC-A")
	q := command.SubmitHumanReport{Metadata: initialMetadata(200, 5), ProjectID: projectID, WorkItemID: workItemID, RunID: f.candidate.RunID, ReportID: "report_0000000200", SubjectDigest: f.review.Review.SubjectDigest, LeaseEpoch: f.review.LeaseEpoch, RestoreGeneration: f.review.RestoreGeneration, Kind: "evidence", MediaType: "text/plain", Content: "candidate", Evidence: &command.HumanEvidenceIntent{ACID: "AC-A", ACRevisionDigest: domain.HashBytes(initialContent), RecipeDigest: domain.HashString("initial recipe"), EnvironmentDigest: domain.HashString("selected environment " + string(projectID)), Verdict: "Passing"}}
	if _, err := f.svc.SubmitHumanReport(t.Context(), operator, q); err != nil {
		t.Fatal(err)
	}
	got := readTestCoverage(t, f)
	if !got.Coverage[0].Covered || !reflect.DeepEqual(got.Coverage[0].IDs, []string{q.ReportID}) {
		t.Fatalf("selected sealed report: %+v", got)
	}
	delete(f.svc.config.ProjectPolicies, projectID)
	_, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
	assertCommandError(t, err, command.CodeStaleSubject)
}

func TestVerifiedCoverage_IncompletePolicyBeforeIO(t *testing.T) {
	for _, kind := range []string{"missing-rule", "empty-class", "empty-environment"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 5)
			rule := f.svc.config.Completion.Checks["AC-A"]
			switch kind {
			case "missing-rule":
				delete(f.svc.config.Completion.Checks, "AC-A")
			case "empty-class":
				rule.VerifierClass = ""
				f.svc.config.Completion.Checks["AC-A"] = rule
			default:
				rule.EnvironmentDigest = domain.Digest{}
				f.svc.config.Completion.Checks["AC-A"] = rule
			}
			f.svc.artifacts = rejectCurrentArtifacts{t: t}
			_, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
			assertCommandError(t, err, command.CodePolicyRejected)
		})
	}
}

func TestVerifiedCoverage_RevalidationMatrix(t *testing.T) {
	for _, kind := range []string{"policy", "head", "evidence-field", "evidence-count", "review", "approval", "lease", "restore", "epoch", "sequence", "complete", "missing", "corrupt", "unknown-io-drift", "expiry"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 5)
			changed := false
			mutate := func() {
				if changed {
					return
				}
				changed = true
				switch kind {
				case "policy":
					delete(f.svc.config.Completion.Checks, "AC-A")
				case "head":
					coverageExec(t, f, "UPDATE work_item_spec_heads SET head_version=head_version+1")
				case "evidence-field":
					coverageExec(t, f, "DROP TRIGGER evidence_immutable_update")
					coverageExec(t, f, "UPDATE evidence SET verdict='Failed'")
				case "evidence-count":
					coverageExec(t, f, `INSERT INTO evidence SELECT project_id,'additional',completion_subject_digest,ac_id,ac_revision_digest,verdict,applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest,artifact_digest FROM evidence`)
				case "review":
					coverageExec(t, f, "DROP TRIGGER reviews_immutable_update")
					coverageExec(t, f, "UPDATE reviews SET verdict='Rejected'")
				case "approval":
					coverageExec(t, f, "DROP TRIGGER approvals_immutable_update")
					coverageExec(t, f, "UPDATE approvals SET expires_at_ns=expires_at_ns+1")
				case "lease":
					coverageExec(t, f, "UPDATE run_leases SET epoch=epoch+1")
				case "restore":
					coverageExec(t, f, "UPDATE instance_state SET restore_generation=restore_generation+1")
				case "epoch":
					coverageExec(t, f, "UPDATE instance_state SET stream_epoch=stream_epoch+1")
				case "sequence":
					coverageExec(t, f, "UPDATE instance_state SET next_event_sequence=next_event_sequence+1")
				case "complete":
					if _, err := f.call(t, 5); err != nil {
						t.Fatal(err)
					}
				case "missing":
					coverageExec(t, f, "DROP TRIGGER candidates_immutable_delete")
					coverageExec(t, f, "DELETE FROM candidates")
				case "corrupt":
					coverageExec(t, f, "DROP TRIGGER evidence_immutable_update")
					coverageExec(t, f, "UPDATE evidence SET verifier_actor=char(1)")
				case "unknown-io-drift":
					coverageExec(t, f, "UPDATE work_items SET version=version+1")
				case "expiry":
					f.svc.clock = fixedClock{now: fixedTime().Add(48 * time.Hour)}
				}
			}
			base := f.svc.artifacts
			f.svc.artifacts = changingCurrentArtifacts{base: base, after: mutate}
			if kind == "unknown-io-drift" {
				f.svc.artifacts = coverageArtifacts{base: base, open: func(context.Context, domain.Digest) (io.ReadCloser, error) {
					mutate()
					return nil, errors.New("disk fault")
				}}
			}
			b, err := f.svc.DescribeVerifiedCoverage(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
			if !changed {
				t.Fatal("no external I/O")
			}
			if kind == "sequence" || kind == "expiry" {
				if err != nil {
					t.Fatal(err)
				}
				var got coverageTestResponse
				if err = json.Unmarshal(b, &got); err != nil {
					t.Fatal(err)
				}
				if kind == "expiry" && !slices.Contains(got.Eligibility.Reasons, "approval_expired") {
					t.Fatal("expiry sampled before I/O", string(b))
				}
				return
			}
			if kind == "corrupt" {
				if _, ok := errors.AsType[domain.StorageCorruptionError](err); !ok {
					t.Fatal("corruption precedence", err)
				}
				return
			}
			assertCommandError(t, err, command.CodeStaleSubject)
		})
	}
}

func TestVerifiedCoverage_CancellationAndNoFinalRead(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	f.svc.artifacts = coverageArtifacts{base: f.svc.artifacts, open: func(context.Context, domain.Digest) (io.ReadCloser, error) {
		cancel()
		f.svc.unit = nil
		return nil, ctx.Err()
	}}
	if b, err := f.svc.DescribeVerifiedCoverage(ctx, operator, projectID, workItemID, f.candidate.Candidate.ID); b != nil || !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestVerifiedCoverage_AttemptBudgetsAndDeduplication(t *testing.T) {
	for _, kind := range []string{"objects", "bytes", "small-after-overflow", "metadata", "duplicate-failure"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 5)
			snapshot, err := f.svc.readCoverageSnapshot(t.Context(), projectID, workItemID, f.candidate.Candidate.ID)
			if err != nil {
				t.Fatal(err)
			}
			snapshot.Material.Evidence = nil
			snapshot.Material.Artifacts = nil
			count := 7
			if kind == "objects" {
				count = 1024
			}
			if kind == "duplicate-failure" {
				count = 2
			}
			artifacts := make([]port.Artifact, count)
			for i := range artifacts {
				d := domain.HashString(fmt.Sprint(i))
				artifacts[i] = port.Artifact{Digest: d, ByteLength: 1, StorageKey: artifactStorageKey(d), Availability: "Present", MediaType: "text/plain"}
			}
			slices.SortFunc(artifacts, func(a, b port.Artifact) int { return strings.Compare(a.Digest.String(), b.Digest.String()) })
			expected := count
			switch kind {
			case "bytes":
				for i := range artifacts {
					artifacts[i].ByteLength = 10 << 20
				}
				expected = 5
			case "small-after-overflow":
				for i := range 4 {
					artifacts[i].ByteLength = 10 << 20
				}
				artifacts[4].ByteLength = 9 << 20
				artifacts[5].ByteLength = 2 << 20
				artifacts[6].ByteLength = 1 << 20
				expected = 6
			case "metadata":
				artifacts[0].StorageKey = "wrong"
				expected = 0
			case "duplicate-failure":
				artifacts[1] = artifacts[0]
				expected = 1
			}
			snapshot.Material.CandidateArtifacts = artifacts
			calls := 0
			f.svc.artifacts = coverageArtifacts{base: f.svc.artifacts, open: func(context.Context, domain.Digest) (io.ReadCloser, error) {
				calls++
				return nil, port.ErrArtifactUnavailable
			}}
			_, err = f.svc.verifyCoverageMaterial(t.Context(), snapshot)
			if calls != expected {
				t.Fatalf("attempt budget %s: calls=%d want=%d", kind, calls, expected)
			}
			if kind == "metadata" {
				if _, ok := errors.AsType[domain.StorageCorruptionError](err); !ok {
					t.Fatal(err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestVerifiedCoverage_IndependentEligibilityReasons(t *testing.T) {
	for _, tc := range []struct{ name, query, want string }{
		{"blocker", `INSERT INTO work_item_blockers(project_id,work_item_id,blocker_id,reason) SELECT project_id,work_item_id,'block','waiting' FROM work_items`, "active_blocker"},
		{"another-run", `INSERT INTO runs SELECT project_id,'another-run',work_item_id,input_digest,adapter_id,adapter_version,scenario_id,attempt,desired_action,dispatch_state,'Unknown',reconciliation_state,side_effect_outcome,created_at_ns FROM runs`, "active_or_unknown_run"},
		{"review", `INSERT INTO reviews SELECT project_id,'zz-review',completion_subject_digest,'Rejected',reviewer_id,independent,created_at_ns+1 FROM reviews`, "review_rejected"},
		{"approval-actor", `DROP TRIGGER approvals_immutable_update; UPDATE approvals SET actor_id='different-actor'`, "approval_missing"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 5)
			coverageExec(t, f, tc.query)
			got := readTestCoverage(t, f)
			if !got.Coverage[0].Covered || got.Eligibility.Satisfied || !slices.Contains(got.Eligibility.Reasons, tc.want) {
				t.Fatalf("independent eligibility: %+v", got)
			}
		})
	}
}

type coverageBoundedArtifacts struct {
	t            *testing.T
	boundedCalls int
	bytesRead    int
}

func (a *coverageBoundedArtifacts) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	a.t.Fatal("unexpected write")
	return domain.Digest{}, 0, nil
}
func (a *coverageBoundedArtifacts) Open(context.Context, domain.Digest) (io.ReadCloser, error) {
	a.t.Fatal("coverage used pre-reading unbounded adapter opener")
	return nil, nil
}
func (a *coverageBoundedArtifacts) OpenBounded(_ context.Context, _ domain.Digest, declared uint64) (io.ReadCloser, error) {
	a.boundedCalls++
	if declared != 9 {
		a.t.Fatal(declared)
	}
	return &coverageCountingReader{Reader: strings.NewReader("candidate"), count: &a.bytesRead}, nil
}

type coverageCountingReader struct {
	io.Reader
	count *int
}

func (r *coverageCountingReader) Read(b []byte) (int, error) {
	n, err := r.Reader.Read(b)
	*r.count += n
	return n, err
}
func (*coverageCountingReader) Close() error { return nil }
func TestVerifiedCoverage_BoundedAdapterReadsOnce(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	a := &coverageBoundedArtifacts{t: t}
	f.svc.artifacts = a
	got := readTestCoverage(t, f)
	if !got.Eligibility.Satisfied || a.boundedCalls != 1 || a.bytesRead != 9 {
		t.Fatalf("bounded reads=%d bytes=%d coverage=%+v", a.boundedCalls, a.bytesRead, got)
	}
}
