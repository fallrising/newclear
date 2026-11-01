package httpapi

import (
	"context"
	json "encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type completionStub struct {
	commandStub
	actor domain.ActorID
	value any
}

func (s *completionStub) capture(a domain.ActorID, v any) (command.Outcome, error) {
	s.actor = a
	s.value = v
	return s.result()
}
func (s *completionStub) SubmitCandidate(_ context.Context, a domain.ActorID, v command.SubmitCandidate) (command.Outcome, error) {
	return s.capture(a, v)
}
func (s *completionStub) PublishFixtureReview(_ context.Context, a domain.ActorID, v command.PublishFixtureReview) (command.Outcome, error) {
	return s.capture(a, v)
}
func (s *completionStub) PublishFixtureEvidence(_ context.Context, a domain.ActorID, v command.PublishFixtureEvidence) (command.Outcome, error) {
	return s.capture(a, v)
}
func (s *completionStub) ApproveSubject(_ context.Context, a domain.ActorID, v command.ApproveSubject) (command.Outcome, error) {
	return s.capture(a, v)
}
func (s *completionStub) RequestQA(_ context.Context, a domain.ActorID, v command.RequestQA) (command.Outcome, error) {
	return s.capture(a, v)
}
func (s *completionStub) RequestCancellation(_ context.Context, a domain.ActorID, v command.RequestCancellation) (command.Outcome, error) {
	return s.capture(a, v)
}

func completionFixtures() map[string]string {
	d := "sha256:" + strings.Repeat("a", 64)
	artifact := `{"sha256":"` + d + `","media_type":"text/plain","byte_length":0,"availability":"Present"}`
	return map[string]string{
		"SubmitCandidate":        `{"work_item_id":"wi_01ARZ3NDEK","run_id":"run_01ARZ3NDEK","candidate":{"candidate_id":"candidate","run_id":"run_01ARZ3NDEK","candidate_digest":"` + d + `","input_subject_digest":"` + d + `","created_at":"2026-10-23T00:00:00Z","artifact_manifest":[` + artifact + `]}}`,
		"PublishFixtureReview":   `{"run_id":"run_01ARZ3NDEK","lease_epoch":1,"restore_generation":1,"review":{"review_id":"review","completion_subject_digest":"` + d + `","reviewer_id":"actor","reviewer_class":"human","verdict":"Approved","created_at":"2026-10-23T00:00:00Z"}}`,
		"PublishFixtureEvidence": `{"run_id":"run_01ARZ3NDEK","lease_epoch":1,"restore_generation":1,"evidence":{"evidence_id":"evidence","completion_subject_digest":"` + d + `","ac_id":"AC1","ac_revision_digest":"` + d + `","observation_verdict":"Passing","review_disposition":"Accepted","applicability":"Fresh","material_availability":"Present","verifier_id":"actor","verifier_class":"human","recipe_digest":"` + d + `","environment_digest":"` + d + `","observed_at":"2026-10-23T00:00:00Z","report":` + artifact + `}}`,
		"ApproveSubject":         `{"work_item_id":"wi_01ARZ3NDEK","candidate_id":"candidate","approval_request_id":"approval","subject_digest":"` + d + `","decision":"Approved"}`,
		"RequestQA":              `{"work_item_id":"wi_01ARZ3NDEK","candidate_id":"candidate","completion_subject_digest":"` + d + `"}`,
		"RequestCancellation":    `{"work_item_id":"wi_01ARZ3NDEK","run_id":"run_01ARZ3NDEK","reason":"operator intent"}`,
	}
}
func completionRequest(t *testing.T, operation, payload string, commands CommandService, mutate func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	s, err := NewServer(commands, &resultStub{}, &projectionStub{}, &authorityStub{}, NewHub(), Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	body := `{"command_id":"cmd_01ARZ3NDEK","idempotency_key":"d9428888-122b-11e1-b85c-61cd3cbb3210","operation":"` + operation + `","expected_version":1,"issued_at":"2026-10-23T00:00:00Z","payload":` + payload + `}`
	r := httptest.NewRequest("POST", "/api/v1/projects/"+string(testProjectID)+"/commands", strings.NewReader(body))
	addSession(r)
	r.Header.Set("Origin", "https://taskboard.test")
	r.Header.Set("Content-Type", "application/json")
	if mutate != nil {
		mutate(r)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestCompletionHTTP_SixExistingCommands(t *testing.T) {
	for operation, payload := range completionFixtures() {
		t.Run(operation, func(t *testing.T) {
			s := &completionStub{commandStub: commandStub{outcome: command.Outcome{Payload: []byte(`{"stored":"exact"}`)}}}
			for range 2 {
				w := completionRequest(t, operation, payload, s, nil)
				if w.Code != 200 || w.Body.String() != `{"stored":"exact"}` {
					t.Fatalf("status=%d body=%s", w.Code, w.Body)
				}
			}
			if s.calls != 2 || s.actor != "actor" || s.value == nil {
				t.Fatalf("adapter calls=%d actor=%q value=%v", s.calls, s.actor, s.value)
			}
		})
	}
}
func TestCompletionSubject_InvalidACNeverSucceeds(t *testing.T) {
	d := "sha256:" + strings.Repeat("a", 64)
	data := `{"project_id":"prj_01ARZ3NDEK","work_item_id":"wi_01ARZ3NDEK","work_item_version":1,"candidate_id":"candidate","candidate_digest":"` + d + `","run_id":"run_01ARZ3NDEK","run_input_digest":"` + d + `","required_ac_revisions":[{"ac_id":"bad/id","revision_digest":"` + d + `"}],"accepted_graph_revision_digest":"` + d + `","policy_revision_digest":"` + d + `","completion_recipe_digest":"` + d + `"}`
	type plain completionSubjectWire
	var raw plain
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		t.Fatal(err)
	}
	if _, err := completionSubjectWire(raw).domainValue(); err == nil {
		t.Fatal("invalid AC returned nil error")
	}
}

// Every required member at every nesting level must be present, non-null and
// correctly typed; doing this through the router also asserts zero service calls.
func TestCompletionHTTP_StrictNestedFields(t *testing.T) {
	for operation, payload := range completionFixtures() {
		var original map[string]any
		if err := json.Unmarshal([]byte(payload), &original); err != nil {
			t.Fatal(err)
		}
		var walk func(map[string]any, []string)
		walk = func(object map[string]any, path []string) {
			for key, value := range object {
				member := append(append([]string{}, path...), key)
				for _, kind := range []string{"missing", "null", "wrong_type", "case", "duplicate", "unknown"} {
					t.Run(operation+"/"+strings.Join(member, "/")+"/"+kind, func(t *testing.T) {
						var clone map[string]any
						_ = json.Unmarshal([]byte(payload), &clone)
						target := clone
						for _, part := range path {
							if part == "0" {
								continue
							}
							switch v := target[part].(type) {
							case map[string]any:
								target = v
							case []any:
								target = v[0].(map[string]any)
							}
						}
						switch kind {
						case "missing":
							delete(target, key)
						case "null":
							target[key] = nil
						case "wrong_type":
							target[key] = true
						case "case":
							target[strings.ToUpper(key)] = target[key]
							delete(target, key)
						case "unknown":
							target["extra"] = 1
						}
						b, _ := json.Marshal(clone)
						body := string(b)
						if kind == "duplicate" {
							needle, _ := json.Marshal(key)
							body = strings.Replace(body, string(needle)+":", string(needle)+":null,"+string(needle)+":", 1)
						}
						stub := &completionStub{}
						w := completionRequest(t, operation, body, stub, nil)
						if w.Code != 400 || stub.calls != 0 {
							t.Fatalf("status=%d calls=%d body=%s", w.Code, stub.calls, w.Body)
						}
					})
				}
				switch nested := value.(type) {
				case map[string]any:
					walk(nested, member)
				case []any:
					if len(nested) > 0 {
						if object, ok := nested[0].(map[string]any); ok {
							walk(object, append(member, "0"))
						}
					}
				}
			}
		}
		walk(original, nil)
	}
}
func TestCompletionHTTP_AuthOriginCapabilityAndExactOutcome(t *testing.T) {
	for operation, payload := range completionFixtures() {
		t.Run(operation, func(t *testing.T) {
			for _, tc := range []struct {
				name   string
				change func(*http.Request)
				want   int
			}{
				{"unauthenticated", func(r *http.Request) { r.Header.Del("Cookie") }, 401},
				{"wrong_origin", func(r *http.Request) { r.Header.Set("Origin", "https://evil.test") }, 403},
			} {
				t.Run(tc.name, func(t *testing.T) {
					s := &completionStub{}
					w := completionRequest(t, operation, payload, s, tc.change)
					if w.Code != tc.want || s.calls != 0 {
						t.Fatalf("status=%d calls=%d", w.Code, s.calls)
					}
				})
			}
			noCapability := &commandStub{}
			w := completionRequest(t, operation, payload, noCapability, nil)
			if w.Code != 503 || noCapability.calls != 0 {
				t.Fatal("missing capability did not fail closed")
			}
			s := &completionStub{commandStub: commandStub{outcome: command.Outcome{Payload: []byte(`{"guard":"original"}`)}, err: command.NewError(command.CodePermissionDenied, "guard", false, nil, nil)}}
			w = completionRequest(t, operation, payload, s, nil)
			if w.Code != 403 || w.Body.String() != `{"guard":"original"}` {
				t.Fatalf("outcome changed: %d %s", w.Code, w.Body)
			}
		})
	}
}
func TestCompletionHTTP_BoundsAndScope(t *testing.T) {
	fixtures := completionFixtures()
	cases := []struct{ operation, old, value string }{
		{"SubmitCandidate", `"run_id":"run_01ARZ3NDEK"`, `"run_id":"run_0000000001"`},
		{"SubmitCandidate", `"byte_length":0`, `"byte_length":10485761`},
		{"SubmitCandidate", `"byte_length":0`, `"byte_length":-1`},
		{"SubmitCandidate", `"availability":"Present"`, `"availability":"Present","href":"/api/v1/projects/prj_0000000001/artifacts/sha256:` + strings.Repeat("a", 64) + `"`},
		{"PublishFixtureReview", `"lease_epoch":1`, `"lease_epoch":9223372036854775808`},
		{"PublishFixtureReview", `"lease_epoch":1`, `"lease_epoch":1.5`},
		{"PublishFixtureReview", `"restore_generation":1`, `"restore_generation":0`},
		{"PublishFixtureReview", `"created_at":"2026-10-23T00:00:00Z"`, `"created_at":"2026-10-23T00:00:00+00:00"`},
		{"PublishFixtureEvidence", `"observed_at":"2026-10-23T00:00:00Z"`, `"observed_at":"yesterday"`},
		{"PublishFixtureEvidence", `"ac_id":"AC1"`, `"ac_id":"bad/id"`},
	}
	for i, c := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			s := &completionStub{}
			w := completionRequest(t, c.operation, strings.Replace(fixtures[c.operation], c.old, c.value, 1), s, nil)
			if w.Code != 400 || s.calls != 0 {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
	for operation, payload := range fixtures {
		for _, digest := range []string{strings.Repeat("a", 64), "SHA256:" + strings.Repeat("a", 64), "sha256:" + strings.Repeat("A", 64), "sha256:" + strings.Repeat("0", 64)} {
			if !strings.Contains(payload, "sha256:") {
				continue
			}
			s := &completionStub{}
			w := completionRequest(t, operation, strings.Replace(payload, "sha256:"+strings.Repeat("a", 64), digest, 1), s, nil)
			if w.Code != 400 || s.calls != 0 {
				t.Fatalf("digest %s: %d", operation, w.Code)
			}
		}
	}
	for _, size := range []int{0, 1024, 1025} {
		var object map[string]any
		_ = json.Unmarshal([]byte(fixtures["SubmitCandidate"]), &object)
		candidate := object["candidate"].(map[string]any)
		artifacts := make([]any, size)
		for i := range size {
			artifacts[i] = map[string]any{"sha256": "sha256:" + domain.HashString(fmt.Sprint(i)).String(), "media_type": "text/plain", "byte_length": 0, "availability": "Present"}
		}
		candidate["artifact_manifest"] = artifacts
		b, _ := json.Marshal(object)
		s := &completionStub{commandStub: commandStub{outcome: command.Outcome{Payload: []byte(`{}`)}}}
		w := completionRequest(t, "SubmitCandidate", string(b), s, nil)
		want := 400
		if size == 1024 {
			want = 200
		}
		if w.Code != want {
			t.Fatalf("manifest %d status=%d %s", size, w.Code, w.Body)
		}
	}
}
func TestCompletionSubject_AcceptedUTF8AndStrictWire(t *testing.T) {
	d := "sha256:" + strings.Repeat("a", 64)
	base := `{"project_id":"prj_01ARZ3NDEK","work_item_id":"wi_01ARZ3NDEK","work_item_version":1,"candidate_id":"candidate","candidate_digest":"` + d + `","run_id":"run_01ARZ3NDEK","run_input_digest":"` + d + `","required_ac_revisions":[{"ac_id":"AC1","revision_digest":"` + d + `"}],"accepted_graph_revision_digest":"` + d + `","policy_revision_digest":"` + d + `","completion_recipe_digest":"` + d + `"}`
	for _, id := range []string{strings.Repeat("界", 40), "驗收:criterion", strings.Repeat("a", 120)} {
		data := strings.Replace(base, "AC1", id, 1)
		var w completionSubjectWire
		if err := json.Unmarshal([]byte(data), &w); err != nil {
			t.Fatal(err)
		}
		subject, err := w.domainValue()
		if err != nil || string(subject.RequiredACRevisions()[0].ACID) != id {
			t.Fatalf("AC identity rejected %q %v", id, err)
		}
	}
	for _, data := range []string{strings.Replace(base, "AC1", strings.Repeat("界", 41), 1), strings.Replace(base, `"work_item_version":1`, `"work_item_version":null`, 1), strings.Replace(base, `"ac_id":"AC1",`, "", 1), strings.Replace(base, `"run_id":"run_01ARZ3NDEK",`, "", 1), strings.Replace(base, `"candidate_id":"candidate"`, `"candidate_id":null`, 1), strings.TrimSuffix(base, "}") + `,"integration_base_digest":null}`} {
		var w completionSubjectWire
		if json.Unmarshal([]byte(data), &w) == nil {
			t.Fatalf("invalid subject decoded %s", data)
		}
	}
}

func TestCompletionHTTP_WireMetadataAndCallerActor(t *testing.T) {
	for operation, payload := range completionFixtures() {
		for _, version := range []string{"null", "0", "-1", "1.1", "9223372036854775807", "18446744073709551615", `"1"`} {
			s := &completionStub{}
			w := completionRequest(t, operation, payload, s, func(r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				r.Body = io.NopCloser(strings.NewReader(strings.Replace(string(b), `"expected_version":1`, `"expected_version":`+version, 1)))
			})
			if w.Code != 400 || s.calls != 0 {
				t.Fatalf("%s version %s status %d", operation, version, w.Code)
			}
		}
	}
	for operation, payload := range completionFixtures() {
		if operation != "PublishFixtureReview" && operation != "PublishFixtureEvidence" {
			continue
		}
		s := &completionStub{commandStub: commandStub{outcome: command.Outcome{Payload: []byte(`{}`)}}}
		w := completionRequest(t, operation, strings.Replace(payload, `"actor"`, `"caller-asserted-identity"`, 1), s, nil)
		if w.Code != 200 || s.actor != "actor" {
			t.Fatalf("caller identity became trusted actor")
		}
		switch v := s.value.(type) {
		case command.PublishFixtureReview:
			if v.Review.ReviewerID != "caller-asserted-identity" {
				t.Fatal("review assertion rewritten")
			}
		case command.PublishFixtureEvidence:
			if v.Evidence.VerifierID != "caller-asserted-identity" {
				t.Fatal("evidence assertion rewritten")
			}
		}
	}
}
