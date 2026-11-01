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

const preparationPath = "/api/v1/projects/prj_01ARZ3NDEK/work-items/wi_01ARZ3NDEK/candidates/candidate-1/completion-preparation"

type preparationReader struct {
	commandStub
	data  []byte
	err   error
	reads int
}

func (s *preparationReader) DescribeCompletion(_ context.Context, a domain.ActorID, p domain.ProjectID, w domain.WorkItemID, c domain.CandidateID) ([]byte, error) {
	s.reads++
	if a != "actor" || p != testProjectID || w != "wi_01ARZ3NDEK" || c != "candidate-1" {
		return nil, port.ErrNotFound
	}
	return s.data, s.err
}
func preparationServer(t *testing.T, c CommandService, a *authorityStub) *Server {
	t.Helper()
	if a == nil {
		a = &authorityStub{}
	}
	s, e := NewServer(c, &resultStub{}, &projectionStub{}, a, NewHub(), Config{Origin: "https://taskboard.test"})
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func preparationRequest(t *testing.T, s *Server, path string, session bool) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	if session {
		addSession(r)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func validPreparationFixture(t *testing.T) []byte {
	t.Helper()
	d := "sha256:" + domain.HashString("material").String()
	s := completionSubjectWire{ProjectID: string(testProjectID), WorkItemID: "wi_01ARZ3NDEK", WorkItemVersion: 6, CandidateID: "candidate-1", CandidateDigest: d, RunID: "run_01ARZ3NDEK", RunInputDigest: d, RequiredACRevisions: []acRevisionWire{{ACID: "AC-A", RevisionDigest: d}}, AcceptedGraphRevisionDigest: d, PolicyRevisionDigest: d, CompletionRecipeDigest: d}
	subject, e := s.domainValue()
	if e != nil {
		t.Fatal(e)
	}
	data, e := json.Marshal(completionPreparationWire{ExpectedVersion: 5, Phase: "Review", Subject: s, Digest: "sha256:" + subject.Digest().String(), LeaseEpoch: 1, RestoreGeneration: 1, ApprovalRequired: false, Rules: []completionPreparationRule{{ACID: "AC-A", VerifierClass: "human", Independent: false, Environment: d}}})
	if e != nil {
		t.Fatal(e)
	}
	return data
}
func TestCompletionPreparationHTTP_AuthScopeAndNoStore(t *testing.T) {
	for _, tc := range []struct {
		name, path         string
		session, forbidden bool
		status, reads      int
	}{
		{"anonymous", preparationPath, false, false, 401, 0}, {"forbidden", preparationPath, true, true, 404, 0}, {"valid", preparationPath, true, false, 200, 1},
		{"item", strings.Replace(preparationPath, "wi_01ARZ3NDEK", "wi_01ARZ3NDEM", 1), true, false, 404, 1},
		{"candidate", strings.Replace(preparationPath, "candidate-1", "other", 1), true, false, 404, 1},
		{"bad_id", strings.Replace(preparationPath, "wi_01ARZ3NDEK", "invalid", 1), true, false, 404, 0},
		{"project_dot", strings.Replace(preparationPath, "prj_01ARZ3NDEK", ".", 1), true, false, 404, 0},
		{"item_dot", strings.Replace(preparationPath, "wi_01ARZ3NDEK", "..", 1), true, false, 404, 0},
		{"dot", strings.Replace(preparationPath, "candidate-1", ".", 1), true, false, 404, 0}, {"dotdot", strings.Replace(preparationPath, "candidate-1", "..", 1), true, false, 404, 0},
		{"long", strings.Replace(preparationPath, "candidate-1", strings.Repeat("a", 81), 1), true, false, 404, 0},
		{"encoded", strings.Replace(preparationPath, "candidate-1", "candidate%2D1", 1), true, false, 400, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &preparationReader{data: validPreparationFixture(t)}
			a := &authorityStub{}
			if tc.forbidden {
				a.projectErr = ErrPermissionDenied
			}
			w := preparationRequest(t, preparationServer(t, c, a), tc.path, tc.session)
			if w.Code != tc.status || c.reads != tc.reads || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status %d reads %d %s", w.Code, c.reads, w.Body)
			}
		})
	}
}
func TestCompletionPreparationHTTP_StrictBoundsAndCapability(t *testing.T) {
	w := preparationRequest(t, preparationServer(t, &commandStub{}, nil), preparationPath, true)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "projection_unavailable") {
		t.Fatal(w.Code, w.Body)
	}
	good := string(validPreparationFixture(t))
	cases := map[string]string{"valid": good, "empty": "", "null": "null", "extra": strings.Replace(good, `"phase":`, `"extra":1,"phase":`, 1), "duplicate": strings.Replace(good, `"approval_required":false`, `"approval_required":false,"approval_required":false`, 1), "nested_extra": strings.Replace(good, `"verifier_class":`, `"extra":1,"verifier_class":`, 1), "zero": strings.Replace(good, `"lease_epoch":1`, `"lease_epoch":0`, 1), "overflow": strings.Replace(good, `"restore_generation":1`, `"restore_generation":9223372036854775808`, 1), "phase": strings.Replace(good, `"phase":"Review"`, `"phase":"Done"`, 1), "scope": strings.Replace(good, `"candidate_id":"candidate-1"`, `"candidate_id":"other"`, 1), "digest": strings.Replace(good, `"completion_subject_digest":"sha256:`, `"completion_subject_digest":"sha256:0`, 1), "oversized": strings.Repeat(" ", 1<<20) + good, "class_empty": strings.Replace(good, `"verifier_class":"human"`, `"verifier_class":""`, 1), "class_long": strings.Replace(good, `"verifier_class":"human"`, `"verifier_class":"`+strings.Repeat("a", 129)+`"`, 1), "actor_bad": strings.Replace(good, `"prohibited_verifier_actor":""`, `"prohibited_verifier_actor":"a/b"`, 1), "environment_zero": strings.Replace(good, `"environment_digest":"sha256:`+domain.HashString("material").String()+`"`, `"environment_digest":"sha256:`+strings.Repeat("0", 64)+`"`, 1)}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			c := &preparationReader{data: []byte(data)}
			w := preparationRequest(t, preparationServer(t, c, nil), preparationPath, true)
			want := 503
			if name == "valid" {
				want = 200
			}
			if w.Code != want || want == 503 && !strings.Contains(w.Body.String(), "storage_corruption") {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
	// Every required field at every nesting level rejects absent and explicit null,
	// including false booleans and empty optional-constraint strings.
	var raw map[string]any
	if e := json.Unmarshal([]byte(good), &raw); e != nil {
		t.Fatal(e)
	}
	var visit func(map[string]any, string)
	visit = func(obj map[string]any, prefix string) {
		for key, value := range obj {
			for _, null := range []bool{false, true} {
				if null {
					obj[key] = nil
				} else {
					delete(obj, key)
				}
				data, e := json.Marshal(raw)
				if e != nil {
					t.Fatal(e)
				}
				if validCompletionPreparation(data, testProjectID, "wi_01ARZ3NDEK", "candidate-1") {
					t.Fatalf("accepted absent/null %s.%s null=%v", prefix, key, null)
				}
				obj[key] = value
			}
			switch child := value.(type) {
			case map[string]any:
				visit(child, prefix+"."+key)
			case []any:
				for i, v := range child {
					if m, ok := v.(map[string]any); ok {
						visit(m, fmt.Sprintf("%s.%s[%d]", prefix, key, i))
					}
				}
			}
		}
	}
	visit(raw, "root")
	for _, value := range []string{"A", strings.Repeat("a", 80), "._-"} {
		if !validPreparationCandidate(value) {
			t.Fatal(value)
		}
	}
	for _, value := range []string{".", "..", "a/b", "a b", "界"} {
		if validPreparationCandidate(value) {
			t.Fatal(value)
		}
	}
	for _, value := range []string{strings.Repeat("界", 40), strings.Repeat("a", 120)} {
		if !validInitialACID(value) {
			t.Fatal(value)
		}
	}
	for _, value := range []string{strings.Repeat("a", 128), strings.Repeat("界", 42)} {
		if !preparationRuleText(value, true) {
			t.Fatal(value)
		}
	}
}
func TestCompletionPreparationHTTP_SanitizedErrors(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{port.ErrNotFound, 404, "not_found"}, {port.ErrRunLifecycle, 422, "lifecycle_rejected"}, {domain.StorageCorruptionError{Reason: "/private/leak"}, 503, "storage_corruption"}, {errors.New("/private/leak"), 503, "projection_unavailable"}, {context.Canceled, 503, "projection_unavailable"}, {command.NewError(command.CodeStaleSubject, "/private/leak", false, nil, port.ErrNotFound), 409, "stale_subject"}, {command.NewError(command.CodePolicyRejected, "/private/leak", false, nil, nil), 409, "policy_rejected"},
	} {
		c := &preparationReader{err: tc.err}
		w := preparationRequest(t, preparationServer(t, c, nil), preparationPath, true)
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "private") || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
	}
}

func TestCompletionPreparationHTTP_VersionAndCollectionBoundaries(t *testing.T) {
	var wire completionPreparationWire
	if err := json.Unmarshal(validPreparationFixture(t), &wire); err != nil {
		t.Fatal(err)
	}
	encode := func() []byte {
		bindings := make([]domain.ACRevisionBinding, len(wire.Subject.RequiredACRevisions))
		for i, ac := range wire.Subject.RequiredACRevisions {
			bindings[i] = domain.ACRevisionBinding{ACID: domain.ACID(ac.ACID), RevisionDigest: completionDigest(ac.RevisionDigest)}
		}
		s := wire.Subject
		subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: testProjectID, WorkItemID: "wi_01ARZ3NDEK", WorkItemVersion: s.WorkItemVersion, CandidateID: "candidate-1", CandidateDigest: completionDigest(s.CandidateDigest), RunID: domain.RunID(s.RunID), RunInputDigest: completionDigest(s.RunInputDigest), RequiredACRevisions: bindings, AcceptedGraphRevisionDigest: completionDigest(s.AcceptedGraphRevisionDigest), PolicyRevisionDigest: completionDigest(s.PolicyRevisionDigest), CompletionRecipeDigest: completionDigest(s.CompletionRecipeDigest)})
		if err != nil {
			t.Fatal(err)
		}
		wire.Digest = "sha256:" + subject.Digest().String()
		data, err := json.Marshal(wire)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	wire.Phase = "QA"
	wire.ExpectedVersion = 1<<63 - 2
	wire.Subject.WorkItemVersion = wire.ExpectedVersion
	wire.LeaseEpoch = 1<<63 - 1
	wire.RestoreGeneration = 1<<63 - 1
	if !validCompletionPreparation(encode(), testProjectID, "wi_01ARZ3NDEK", "candidate-1") {
		t.Fatal("legal maximum rejected")
	}
	wire.ExpectedVersion = 1<<63 - 1
	wire.Subject.WorkItemVersion = wire.ExpectedVersion
	if validCompletionPreparation(encode(), testProjectID, "wi_01ARZ3NDEK", "candidate-1") {
		t.Fatal("maximum version overflow accepted")
	}
	wire.ExpectedVersion = 5
	wire.Subject.WorkItemVersion = 5
	ac, rule := wire.Subject.RequiredACRevisions[0], wire.Rules[0]
	wire.Subject.RequiredACRevisions = nil
	wire.Rules = nil
	for i := range 1024 {
		a, r := ac, rule
		a.ACID = fmt.Sprintf("AC-%04d", i)
		r.ACID = a.ACID
		wire.Subject.RequiredACRevisions = append(wire.Subject.RequiredACRevisions, a)
		wire.Rules = append(wire.Rules, r)
	}
	if !validCompletionPreparation(encode(), testProjectID, "wi_01ARZ3NDEK", "candidate-1") {
		t.Fatal("1024 records rejected")
	}
	wire.Rules[1] = wire.Rules[0]
	data, _ := json.Marshal(wire)
	if validCompletionPreparation(data, testProjectID, "wi_01ARZ3NDEK", "candidate-1") {
		t.Fatal("duplicate rule accepted")
	}
	wire.Rules[1].ACID = wire.Subject.RequiredACRevisions[1].ACID
	wire.Subject.RequiredACRevisions[0], wire.Subject.RequiredACRevisions[1] = wire.Subject.RequiredACRevisions[1], wire.Subject.RequiredACRevisions[0]
	data, _ = json.Marshal(wire)
	if validCompletionPreparation(data, testProjectID, "wi_01ARZ3NDEK", "candidate-1") {
		t.Fatal("unordered ACs accepted")
	}
}
