package httpapi

import (
	"context"
	json "encoding/json/v2"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type humanReportStub struct {
	commandStub
	actor domain.ActorID
	value command.SubmitHumanReport
}

type humanReadStub struct {
	commandStub
	data    []byte
	report  port.HumanReport
	content []byte
	err     error
	calls   int
	after   func()
}

func (s *humanReadStub) DescribeHumanReport(context.Context, domain.ActorID, domain.ProjectID, string) ([]byte, error) {
	s.calls++
	if s.after != nil {
		s.after()
	}
	return s.data, s.err
}
func (s *humanReadStub) ReadHumanReport(context.Context, domain.ActorID, domain.ProjectID, string) (port.HumanReport, []byte, error) {
	s.calls++
	if s.after != nil {
		s.after()
	}
	return s.report, s.content, s.err
}
func humanReadFixture() *humanReadStub {
	d := domain.HashString("exact report")
	r := port.HumanReport{ProjectID: testProjectID, WorkItemID: "wi_01ARZ3NDEK", RunID: "run_01ARZ3NDEK", ID: "report_01ARZ3NDEK", Kind: "review", SubjectDigest: domain.HashString("subject"), Actor: "actor", CreatedAtNS: time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC).UnixNano(), LeaseEpoch: 1, RestoreGeneration: 1, Artifact: port.Artifact{Digest: d, MediaType: "text/plain", ByteLength: 12, Availability: "Present", StorageKey: "sha256:" + d.String()}}
	data := []byte(`{"project_id":"prj_01ARZ3NDEK","work_item_id":"wi_01ARZ3NDEK","run_id":"run_01ARZ3NDEK","report_id":"report_01ARZ3NDEK","kind":"review","completion_subject_digest":"sha256:` + r.SubjectDigest.String() + `","actor_id":"actor","created_at":"2026-10-31T00:00:00Z","lease_epoch":1,"restore_generation":1,"artifact":{"sha256":"sha256:` + d.String() + `","media_type":"text/plain","byte_length":12,"availability":"Present","href":"/api/v1/projects/prj_01ARZ3NDEK/human-reports/report_01ARZ3NDEK/content","disposition":"attachment"}}`)
	return &humanReadStub{data: data, report: r, content: []byte("exact report")}
}
func TestHumanReport_ReadHTTPBoundary(t *testing.T) {
	path := "/api/v1/projects/prj_01ARZ3NDEK/human-reports/report_01ARZ3NDEK"
	for _, suffix := range []string{"", "/content"} {
		for _, kind := range []string{"anonymous", "denied", "HEAD", "revoked", "canceled", "valid"} {
			t.Run(kind+suffix, func(t *testing.T) {
				s := humanReadFixture()
				a := &authorityStub{}
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				revoked := make(chan struct{})
				a.revoked = revoked
				method := "GET"
				want, calls := 200, 1
				switch kind {
				case "anonymous":
					want, calls = 401, 0
				case "denied":
					a.projectErr = ErrPermissionDenied
					want, calls = 404, 0
				case "HEAD":
					method = "HEAD"
					want, calls = 405, 0
				case "revoked":
					s.after = func() { close(revoked) }
					want = 401
				case "canceled":
					s.after = cancel
					want = 503
				}
				r := httptest.NewRequest(method, path+suffix, nil).WithContext(ctx)
				if kind != "anonymous" {
					addSession(r)
				}
				w := httptest.NewRecorder()
				preparationServer(t, s, a).ServeHTTP(w, r)
				if w.Code != want || s.calls != calls || want != 200 && strings.Contains(w.Body.String(), "exact report") {
					t.Fatal(w.Code, w.Body, s.calls)
				}
			})
		}
	}
	for _, bad := range []struct {
		path string
		code int
	}{{strings.Replace(path, "prj_01ARZ3NDEK", "..", 1), 404}, {strings.Replace(path, "report_01ARZ3NDEK", ".", 1), 404}, {strings.Replace(path, "report_", "report%5F", 1), 400}, {strings.Replace(path, "/human-reports/", "//human-reports/", 1), 400}, {path + "/", 404}} {
		s := humanReadFixture()
		w := preparationRequest(t, preparationServer(t, s, nil), bad.path, true)
		if w.Code != bad.code || s.calls != 0 || w.Header().Get("Location") != "" {
			t.Fatal(w.Code, w.Body, s.calls)
		}
	}
	good := string(humanReadFixture().data)
	for _, bad := range []string{"null", strings.Replace(good, `"lease_epoch":1`, `"lease_epoch":null`, 1), strings.Replace(good, `"lease_epoch":1,`, "", 1), strings.Replace(good, `"kind":"review"`, `"kind":"review","content":"private"`, 1), strings.Replace(good, `"kind":"review"`, `"kind":"review","kind":"review"`, 1), strings.Replace(good, "2026-10-31T00:00:00Z", "9999-10-31T00:00:00Z", 1), strings.Replace(good, `"media_type":"text/plain"`, `"media_type":"text/html"`, 1), strings.Replace(good, `"byte_length":12`, `"byte_length":65537`, 1)} {
		s := humanReadFixture()
		s.data = []byte(bad)
		w := preparationRequest(t, preparationServer(t, s, nil), path, true)
		if w.Code != 503 || strings.Contains(w.Body.String(), "private") {
			t.Fatal(w.Code, w.Body)
		}
	}
	for _, change := range []func(*humanReadStub){func(s *humanReadStub) { s.content = []byte("wrong") }, func(s *humanReadStub) { s.report.Artifact.ByteLength++ }, func(s *humanReadStub) { s.report.ProjectID = "other" }, func(s *humanReadStub) { s.report.Actor = "bad\nactor" }} {
		s := humanReadFixture()
		change(s)
		w := preparationRequest(t, preparationServer(t, s, nil), path+"/content", true)
		if w.Code != 503 || strings.Contains(w.Body.String(), "exact report") {
			t.Fatal(w.Code, w.Body)
		}
	}
}

func (s *humanReportStub) SubmitHumanReport(_ context.Context, a domain.ActorID, v command.SubmitHumanReport) (command.Outcome, error) {
	s.actor = a
	s.value = v
	return s.result()
}

func humanReportPayload() string {
	return `{"work_item_id":"wi_01ARZ3NDEK","run_id":"run_01ARZ3NDEK","report_id":"report_01ARZ3NDEK","completion_subject_digest":"sha256:` + strings.Repeat("a", 64) + `","lease_epoch":1,"restore_generation":1,"kind":"review","media_type":"text/plain","content":"Independent review\n","review":{"verdict":"Approved"}}`
}

func TestHumanReport_StrictHTTPBytesAndFields(t *testing.T) {
	base := humanReportPayload()
	for _, tc := range []struct{ name, content, want string }{
		{"pair", `"\ud83d\ude00"`, "😀"}, {"equivalent", `"\u0061\r\n"`, "a\r\n"}, {"whitespace", `" \n\t "`, " \n\t "}, {"max-escaped", `"` + strings.Repeat(`\u0001`, 65536) + `"`, strings.Repeat("\x01", 65536)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := strings.Replace(base, `"Independent review\n"`, tc.content, 1)
			s := &humanReportStub{commandStub: commandStub{outcome: command.Outcome{Payload: []byte(`{}`)}}}
			w := completionRequest(t, "SubmitHumanReport", b, s, nil)
			if w.Code != 200 || s.calls != 1 || s.actor != "actor" || s.value.Content != tc.want {
				t.Fatalf("status=%d calls=%d exact=%v %s", w.Code, s.calls, s.value.Content == tc.want, w.Body)
			}
		})
	}
	bad := []string{`"\ud800"`, `"\udc00"`, `"\u0000"`, `""`, `"` + strings.Repeat("a", 65537) + `"`, `"` + string([]byte{0xff}) + `"`}
	for i, content := range bad {
		t.Run(fmt.Sprint("bad-content-", i), func(t *testing.T) {
			s := &humanReportStub{}
			w := completionRequest(t, "SubmitHumanReport", strings.Replace(base, `"Independent review\n"`, content, 1), s, nil)
			if w.Code != 400 || s.calls != 0 {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
	var fields map[string]any
	if err := json.Unmarshal([]byte(base), &fields); err != nil {
		t.Fatal(err)
	}
	for field := range fields {
		for _, kind := range []string{"missing", "null", "unknown", "duplicate"} {
			t.Run(field+"-"+kind, func(t *testing.T) {
				var clone map[string]any
				_ = json.Unmarshal([]byte(base), &clone)
				switch kind {
				case "missing":
					delete(clone, field)
				case "null":
					clone[field] = nil
				case "unknown":
					clone["actor_id"] = "forged"
				}
				b, _ := json.Marshal(clone)
				if kind == "duplicate" {
					b = []byte(strings.Replace(string(b), `"`+field+`":`, `"`+field+`":null,"`+field+`":`, 1))
				}
				s := &humanReportStub{}
				w := completionRequest(t, "SubmitHumanReport", string(b), s, nil)
				if w.Code != 400 || s.calls != 0 {
					t.Fatal(w.Code, w.Body)
				}
			})
		}
	}
	for _, b := range []string{strings.Replace(base, `"review":{"verdict":"Approved"}`, `"review":{"verdict":null}`, 1), strings.Replace(base, `"review":{"verdict":"Approved"}`, `"review":{"verdict":"Approved","actor_id":"forged"}`, 1), strings.Replace(base, `"kind":"review"`, `"kind":"evidence"`, 1), strings.Replace(base, `"media_type":"text/plain"`, `"media_type":"text/html"`, 1), strings.Replace(base, `"lease_epoch":1`, `"lease_epoch":9223372036854775808`, 1)} {
		s := &humanReportStub{}
		w := completionRequest(t, "SubmitHumanReport", b, s, nil)
		if w.Code != 400 || s.calls != 0 {
			t.Fatal(w.Code, w.Body)
		}
	}
	for _, tc := range []struct {
		change func(*http.Request)
		want   int
	}{{func(r *http.Request) { r.Header.Del("Cookie") }, 401}, {func(r *http.Request) { r.Header.Set("Origin", "https://hostile.test") }, 403}} {
		s := &humanReportStub{}
		w := completionRequest(t, "SubmitHumanReport", base, s, tc.change)
		if w.Code != tc.want || s.calls != 0 {
			t.Fatal(w.Code, w.Body)
		}
	}
}

func TestHumanReport_CommandBoundary(t *testing.T) {
	// A valid human command must reach capability negotiation; treating the
	// operation as malformed is the missing behavior before implementation.
	w := completionRequest(t, "SubmitHumanReport", humanReportPayload(), &commandStub{}, nil)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "capability_unsupported") || !strings.Contains(w.Body.String(), `"retryable":false`) {
		t.Fatalf("valid human report must negotiate service capability: %d %s", w.Code, w.Body)
	}
	// The command interface may exist while its persistence capability does not.
	payload := []byte(`{"error":{"code":"capability_unsupported","retryable":false}}`)
	s := &humanReportStub{commandStub: commandStub{outcome: command.Outcome{Payload: payload}, err: command.NewError(command.CodeCapabilityUnsupported, "unsupported", false, nil, nil)}}
	w = completionRequest(t, "SubmitHumanReport", humanReportPayload(), s, nil)
	if w.Code != 503 || w.Body.String() != string(payload) {
		t.Fatal("service capability failure changed classification", w.Code, w.Body)
	}
	for _, suffix := range []string{"", "/content"} {
		w := preparationRequest(t, preparationServer(t, &commandStub{}, nil), "/api/v1/projects/prj_01ARZ3NDEK/human-reports/report_01ARZ3NDEK"+suffix, true)
		if w.Code != 503 || !strings.Contains(w.Body.String(), "projection_unavailable") {
			t.Fatal("read capability convention changed", w.Code, w.Body)
		}
	}
}
