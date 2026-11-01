package httpapi

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const coveragePath = "/api/v1/projects/prj_01ARZ3NDEK/work-items/wi_01ARZ3NDEK/candidates/candidate-1/verified-coverage"

type coverageReader struct{ preparationReader }

func (s *coverageReader) DescribeVerifiedCoverage(ctx context.Context, a domain.ActorID, p domain.ProjectID, w domain.WorkItemID, c domain.CandidateID) ([]byte, error) {
	return s.DescribeCompletion(ctx, a, p, w, c)
}
func coverageFixture(t *testing.T) []byte {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(validPreparationFixture(t), &m); err != nil {
		t.Fatal(err)
	}
	m["schema_version"], m["observation_only"], m["observed_at"] = 1, true, "2026-11-01T04:00:00Z"
	m["expected_version"], m["phase"], m["subject_mode"] = 6, "QA", "current_qa"
	m["cursor"] = map[string]any{"stream_epoch": 1, "event_sequence": 0}
	m["coverage"] = []any{map[string]any{"ac_id": "AC-A", "ac_revision_digest": m["completion_subject"].(map[string]any)["required_ac_revisions"].([]any)[0].(map[string]any)["revision_digest"], "covered": true, "matching_evidence_ids": []string{"evidence-1"}, "reasons": []string{}}}
	m["completion_eligibility"] = map[string]any{"evaluated": true, "satisfied": true, "reasons": []string{}}
	b, e := json.Marshal(m, json.Deterministic(true))
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func mutateCoverage(t *testing.T, b []byte, fn func(map[string]any)) []byte {
	t.Helper()
	var m map[string]any
	if e := json.Unmarshal(b, &m); e != nil {
		t.Fatal(e)
	}
	fn(m)
	out, e := json.Marshal(m, json.Deterministic(true))
	if e != nil {
		t.Fatal(e)
	}
	return out
}
func TestVerifiedCoverageHTTP_AuthScopeAndWireContract(t *testing.T) {
	good := coverageFixture(t)
	for _, tc := range []struct {
		name, path         string
		session, forbidden bool
		status, reads      int
	}{
		{"valid", coveragePath, true, false, 200, 1}, {"anonymous", coveragePath, false, false, 401, 0}, {"forbidden", coveragePath, true, true, 404, 0},
		{"wrong_item", strings.Replace(coveragePath, "wi_01ARZ3NDEK", "wi_01ARZ3NDEM", 1), true, false, 404, 1},
		{"bad_item", strings.Replace(coveragePath, "wi_01ARZ3NDEK", "invalid", 1), true, false, 404, 0},
		{"dot", strings.Replace(coveragePath, "candidate-1", ".", 1), true, false, 404, 0},
		{"dotdot", strings.Replace(coveragePath, "candidate-1", "..", 1), true, false, 404, 0},
		{"encoded", strings.Replace(coveragePath, "candidate-1", "candidate%2D1", 1), true, false, 400, 0},
		{"anonymous-query", coveragePath + "?subject=other", false, false, 400, 0}, {"query", coveragePath + "?subject=other", true, false, 400, 0}, {"empty_query", coveragePath + "?", true, false, 400, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &coverageReader{preparationReader{data: good}}
			a := &authorityStub{}
			if tc.forbidden {
				a.projectErr = ErrPermissionDenied
			}
			w := preparationRequest(t, preparationServer(t, c, a), tc.path, tc.session)
			if w.Code != tc.status || c.reads != tc.reads || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status%d reads%d body%s", w.Code, c.reads, w.Body)
			}
		})
	}
	t.Run("body_rejected", func(t *testing.T) {
		c := &coverageReader{preparationReader{data: good}}
		r := httptest.NewRequest(http.MethodGet, coveragePath, strings.NewReader("{}"))
		addSession(r)
		w := httptest.NewRecorder()
		preparationServer(t, c, nil).ServeHTTP(w, r)
		if w.Code != 400 || c.reads != 0 {
			t.Fatal(w.Code, c.reads)
		}
	})
	t.Run("capability", func(t *testing.T) {
		w := preparationRequest(t, preparationServer(t, &commandStub{}, nil), coveragePath, true)
		if w.Code != 503 || !strings.Contains(w.Body.String(), "projection_unavailable") {
			t.Fatal(w.Code, w.Body)
		}
	})
	cases := map[string][]byte{"valid": good, "oversize": append([]byte(strings.Repeat(" ", 1<<20)), good...), "null": []byte("null"), "duplicate": []byte(strings.Replace(string(good), `"observation_only":true`, `"observation_only":true,"observation_only":true`, 1))}
	mutations := map[string]func(map[string]any){
		"extra": func(m map[string]any) { m["extra"] = true }, "false_observation": func(m map[string]any) { m["observation_only"] = false }, "schema": func(m map[string]any) { m["schema_version"] = 2 },
		"mode": func(m map[string]any) { m["subject_mode"] = "prospective_qa" }, "timestamp": func(m map[string]any) { m["observed_at"] = "yesterday" },
		"epoch_zero":          func(m map[string]any) { m["lease_epoch"] = 0 },
		"generation_zero":     func(m map[string]any) { m["restore_generation"] = 0 },
		"epoch_overflow":      func(m map[string]any) { m["lease_epoch"] = uint64(1 << 63) },
		"generation_overflow": func(m map[string]any) { m["restore_generation"] = uint64(1 << 63) },
		"valid_max_fences": func(m map[string]any) {
			m["lease_epoch"] = uint64(1<<63 - 1)
			m["restore_generation"] = uint64(1<<63 - 1)
		},
		"cursor_negative": func(m map[string]any) { m["cursor"].(map[string]any)["event_sequence"] = -1 }, "cursor_zero_epoch": func(m map[string]any) { m["cursor"].(map[string]any)["stream_epoch"] = 0 },
		"empty_coverage": func(m map[string]any) { m["coverage"] = []any{} }, "wrong_revision": func(m map[string]any) {
			m["coverage"].([]any)[0].(map[string]any)["ac_revision_digest"] = "sha256:" + domain.HashString("other").String()
		},
		"covered_no_ids": func(m map[string]any) { m["coverage"].([]any)[0].(map[string]any)["matching_evidence_ids"] = []any{} },
		"duplicate_ids": func(m map[string]any) {
			m["coverage"].([]any)[0].(map[string]any)["matching_evidence_ids"] = []string{"a", "a"}
		},
		"unsorted_ids": func(m map[string]any) {
			m["coverage"].([]any)[0].(map[string]any)["matching_evidence_ids"] = []string{"b", "a"}
		},
		"long_id": func(m map[string]any) {
			m["coverage"].([]any)[0].(map[string]any)["matching_evidence_ids"] = []string{strings.Repeat("x", 121)}
		},
		"missing_with_ids": func(m map[string]any) {
			e := m["coverage"].([]any)[0].(map[string]any)
			e["covered"] = false
			e["reasons"] = []string{"evidence_missing"}
		},
		"unknown_reason": func(m map[string]any) {
			e := m["coverage"].([]any)[0].(map[string]any)
			e["covered"] = false
			e["reasons"] = []string{"invented"}
		},
		"uncovered_green_eligibility": func(m map[string]any) {
			e := m["coverage"].([]any)[0].(map[string]any)
			e["covered"] = false
			e["reasons"] = []string{"evidence_stale"}
		},
		"record_guard": func(m map[string]any) {
			e := m["completion_eligibility"].(map[string]any)
			e["satisfied"] = false
			e["reasons"] = []string{"completion_record_id_missing"}
		},
		"qa_unevaluated": func(m map[string]any) { m["completion_eligibility"].(map[string]any)["evaluated"] = false },
	}
	for name, fn := range mutations {
		cases[name] = mutateCoverage(t, good, fn)
	}
	cases["valid_review"] = mutateCoverage(t, good, func(m map[string]any) {
		m["expected_version"] = 5
		m["phase"] = "Review"
		m["subject_mode"] = "prospective_qa"
		m["completion_eligibility"] = map[string]any{"evaluated": false, "satisfied": false, "reasons": []string{"phase_not_qa"}}
	})
	cases["valid_uncovered"] = mutateCoverage(t, good, func(m map[string]any) {
		e := m["coverage"].([]any)[0].(map[string]any)
		e["covered"] = false
		e["reasons"] = []string{"evidence_unavailable", "evidence_stale"}
		m["completion_eligibility"] = map[string]any{"evaluated": true, "satisfied": false, "reasons": []string{"evidence_stale", "evidence_unavailable"}}
	})
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			c := &coverageReader{preparationReader{data: data}}
			w := preparationRequest(t, preparationServer(t, c, nil), coveragePath, true)
			want := 503
			if strings.HasPrefix(name, "valid") {
				want = 200
			}
			if w.Code != want || want == 503 && !strings.Contains(w.Body.String(), "storage_corruption") {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"stale", command.NewError(command.CodeStaleSubject, "secret", false, nil, nil), 409, "stale_subject"},
		{"policy", command.NewError(command.CodePolicyRejected, "secret", false, nil, nil), 409, "policy_rejected"},
		{"lifecycle", port.ErrRunLifecycle, 422, "lifecycle_rejected"}, {"missing", port.ErrNotFound, 404, "not_found"},
		{"corrupt", domain.StorageCorruptionError{Reason: "secret"}, 503, "storage_corruption"}, {"unknown", errors.New("secret"), 503, "projection_unavailable"}, {"cancel", context.Canceled, 503, "projection_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &coverageReader{preparationReader{err: tc.err}}
			w := preparationRequest(t, preparationServer(t, c, nil), coveragePath, true)
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "secret") {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
}

func TestVerifiedCoverageHTTP_RequiredFieldsAndByteBounds(t *testing.T) {
	good := coverageFixture(t)
	objects := map[string]func(map[string]any) map[string]any{
		"root":    func(m map[string]any) map[string]any { return m },
		"subject": func(m map[string]any) map[string]any { return m["completion_subject"].(map[string]any) },
		"ac": func(m map[string]any) map[string]any {
			return m["completion_subject"].(map[string]any)["required_ac_revisions"].([]any)[0].(map[string]any)
		},
		"rule":        func(m map[string]any) map[string]any { return m["verification_rules"].([]any)[0].(map[string]any) },
		"coverage":    func(m map[string]any) map[string]any { return m["coverage"].([]any)[0].(map[string]any) },
		"eligibility": func(m map[string]any) map[string]any { return m["completion_eligibility"].(map[string]any) },
		"cursor":      func(m map[string]any) map[string]any { return m["cursor"].(map[string]any) },
	}
	for name, object := range objects {
		var base map[string]any
		if err := json.Unmarshal(good, &base); err != nil {
			t.Fatal(err)
		}
		for key := range object(base) {
			for _, null := range []bool{false, true} {
				label := "missing"
				if null {
					label = "null"
				}
				t.Run(name+"/"+key+"/"+label, func(t *testing.T) {
					data := mutateCoverage(t, good, func(m map[string]any) {
						o := object(m)
						if null {
							o[key] = nil
						} else {
							delete(o, key)
						}
					})
					c := &coverageReader{preparationReader{data: data}}
					w := preparationRequest(t, preparationServer(t, c, nil), coveragePath, true)
					if w.Code != 503 || !strings.Contains(w.Body.String(), "storage_corruption") {
						t.Fatalf("%d %s", w.Code, w.Body)
					}
				})
			}
		}
	}
	for _, tc := range []struct {
		name, id string
		status   int
	}{
		{"unicode120", strings.Repeat("界", 40), 200}, {"ascii120", strings.Repeat("x", 120), 200},
		{"unicode123", strings.Repeat("界", 41), 503}, {"control", "a\nb", 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := mutateCoverage(t, good, func(m map[string]any) {
				m["coverage"].([]any)[0].(map[string]any)["matching_evidence_ids"] = []string{tc.id}
			})
			c := &coverageReader{preparationReader{data: data}}
			w := preparationRequest(t, preparationServer(t, c, nil), coveragePath, true)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}

func TestVerifiedCoverageHTTP_MaximumContractAndAggregateBounds(t *testing.T) {
	var w verifiedCoverageWire
	if err := json.Unmarshal(coverageFixture(t), &w); err != nil {
		t.Fatal(err)
	}
	baseAC, baseRule := w.Subject.RequiredACRevisions[0], w.Rules[0]
	w.Subject.RequiredACRevisions = nil
	w.Rules = nil
	w.Coverage = nil
	for i := range 256 {
		ac := baseAC
		ac.ACID = fmt.Sprintf("%03d", i) + strings.Repeat("界", 39)
		rule := baseRule
		rule.ACID = ac.ACID
		rule.VerifierClass = strings.Repeat("v", 128)
		rule.ProhibitedActor = strings.Repeat("a", 120)
		rule.ProhibitedRole = strings.Repeat("r", 128)
		ids := []string{}
		for j := range 4 {
			ids = append(ids, fmt.Sprintf("%04d", i*4+j)+strings.Repeat("界", 38)+"xx")
		}
		w.Subject.RequiredACRevisions = append(w.Subject.RequiredACRevisions, ac)
		w.Rules = append(w.Rules, rule)
		w.Coverage = append(w.Coverage, verifiedACWire{ACID: ac.ACID, Revision: ac.RevisionDigest, Covered: true, IDs: ids, Reasons: []string{}})
	}
	subject, err := w.Subject.domainValue()
	if err != nil {
		t.Fatal(err)
	}
	w.Digest = "sha256:" + subject.Digest().String()
	encode := func() []byte {
		t.Helper()
		b, e := json.Marshal(w)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	check := func(label string, b []byte, status int) {
		t.Helper()
		r := preparationRequest(t, preparationServer(t, &coverageReader{preparationReader{data: b}}, nil), coveragePath, true)
		if r.Code != status {
			t.Fatalf("%s status%d body%s", label, r.Code, r.Body)
		}
	}
	b := encode()
	if len(b) > 1<<20 {
		t.Fatalf("lawful maximum response %d exceeds bound", len(b))
	}
	check("maximum", b, 200)
	t.Logf("256 ACs /1024 maximum-length IDs encoded bytes=%d", len(b))
	w.Coverage[0].IDs = append(w.Coverage[0].IDs, strings.Repeat("z", 120))
	check("aggregate1025", encode(), 503)
	w.Coverage[0].IDs = w.Coverage[0].IDs[:4]
	w.Coverage = append(w.Coverage, w.Coverage[255])
	check("257AC", encode(), 503)
	check("exact-byte-limit", append(b, []byte(strings.Repeat(" ", (1<<20)-len(b)))...), 200)
	check("byte-limit-plus-one", append(b, []byte(strings.Repeat(" ", (1<<20)+1-len(b)))...), 503)
}

func TestVerifiedCoverageHTTP_SQLiteVersionBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, phase     string
		actual, subject uint64
		status          int
	}{
		{"qa-max", "QA", 1<<63 - 1, 1<<63 - 1, 200},
		{"review-last-prospective", "Review", 1<<63 - 2, 1<<63 - 1, 200},
		{"review-overflow", "Review", 1<<63 - 1, 1 << 63, 503},
		{"qa-overflow", "QA", 1 << 63, 1 << 63, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var w verifiedCoverageWire
			if err := json.Unmarshal(coverageFixture(t), &w); err != nil {
				t.Fatal(err)
			}
			w.ExpectedVersion = tc.actual
			w.Phase = tc.phase
			w.Subject.WorkItemVersion = tc.subject
			if tc.phase == "Review" {
				w.SubjectMode = "prospective_qa"
				w.Eligibility = coverageEligibilityWire{Reasons: []string{"phase_not_qa"}}
			}
			s := w.Subject
			d := domain.HashString("material")
			subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: testProjectID, WorkItemID: domain.WorkItemID(s.WorkItemID), WorkItemVersion: s.WorkItemVersion, CandidateID: domain.CandidateID(s.CandidateID), CandidateDigest: d, RunID: domain.RunID(s.RunID), RunInputDigest: d, RequiredACRevisions: []domain.ACRevisionBinding{{ACID: "AC-A", RevisionDigest: d}}, AcceptedGraphRevisionDigest: d, PolicyRevisionDigest: d, CompletionRecipeDigest: d})
			if err != nil {
				t.Fatal(err)
			}
			w.Digest = "sha256:" + subject.Digest().String()
			b, err := json.Marshal(w)
			if err != nil {
				t.Fatal(err)
			}
			r := preparationRequest(t, preparationServer(t, &coverageReader{preparationReader{data: b}}, nil), coveragePath, true)
			if r.Code != tc.status {
				t.Fatalf("status%d want%d: %s", r.Code, tc.status, r.Body)
			}
		})
	}
}
