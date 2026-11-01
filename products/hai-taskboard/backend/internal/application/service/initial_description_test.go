package service

import (
	"bytes"
	"context"
	"encoding/base64"
	json "encoding/json/v2"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

type initialHTTPAuthority struct{}

func (initialHTTPAuthority) Authenticate(context.Context, string) (httpapi.Session, error) {
	return httpapi.Session{ID: "initial", Principal: operator}, nil
}
func (initialHTTPAuthority) AuthorizeProject(_ context.Context, _ httpapi.Session, p domain.ProjectID) error {
	if p != projectID {
		return httpapi.ErrPermissionDenied
	}
	return nil
}
func (a initialHTTPAuthority) AuthorizeCommandResult(c context.Context, s httpapi.Session, p domain.ProjectID, _ string) error {
	return a.AuthorizeProject(c, s, p)
}
func (initialHTTPAuthority) Revoked(httpapi.Session) <-chan struct{} { return nil }
func TestAdmission_InitialAcceptanceHTTP(t *testing.T) {
	svc, store, db, q := initialFixture(t)
	server, e := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if e != nil {
		t.Fatal(e)
	}
	approved, e := svc.config.RepositoryAuthority.Lookup(projectID, "binding")
	if e != nil {
		t.Fatal(e)
	}
	proposalBody := fmt.Sprintf(`{"command_id":"cmd_01HABCDEF50","idempotency_key":"00000000-0000-4000-8000-000000000050","operation":"ProposeSpecification","expected_version":1,"issued_at":%q,"payload":{"repository_binding_id":"binding","binding_version":1,"binding_digest":"sha256:%s","ref":"refs/heads/main","manifest_path":"manifest.json"}}`, fixedTime().UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), approved.Binding.Digest.String())
	proposed := initialHTTPRequest(server, http.MethodPost, "/api/v1/projects/"+string(projectID)+"/commands", []byte(proposalBody), true, true)
	if proposed.Code != 200 || !bytes.Contains(proposed.Body.Bytes(), []byte("sha256:"+q.ProposalDigest.String())) {
		t.Fatalf("HTTP proposal %d %s", proposed.Code, proposed.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(projectID)+"/proposals/sha256:"+q.ProposalDigest.String()+"/initial-acceptance", nil)
	request.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: "token"})
	before := initialCounts(t, db)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("lawful authenticated preparation unavailable: %d %s", response.Code, response.Body.String())
	}
	if !reflect.DeepEqual(before, initialCounts(t, db)) {
		t.Fatal("preparation wrote durable state")
	}
	var snapshot InitialAcceptanceDescription
	if e = json.Unmarshal(response.Body.Bytes(), &snapshot, json.RejectUnknownMembers(true)); e != nil {
		t.Fatal(e)
	}
	if snapshot.AcceptanceSubjectDigest != "sha256:"+q.AcceptanceSubjectDigest.String() || snapshot.ProposalDigest != "sha256:"+q.ProposalDigest.String() || snapshot.PolicyRevisionDigest != "sha256:"+q.PolicyRevisionDigest.String() || snapshot.ExpectedVersion != 1 || !reflect.DeepEqual(snapshot.WorkItems, q.WorkItems) || len(snapshot.ACRevisions) != 1 || snapshot.ACRevisions[0].RevisionDigest != "sha256:"+domain.HashBytes(initialContent).String() {
		t.Fatalf("snapshot mismatch: %+v", snapshot)
	}
	body := initialHTTPBody(t, q)
	post := func(body []byte) *httptest.ResponseRecorder {
		return initialHTTPRequest(server, http.MethodPost, "/api/v1/projects/"+string(projectID)+"/commands", body, true, true)
	}
	accepted := post(body)
	if accepted.Code != 200 {
		t.Fatalf("accept: %d %s", accepted.Code, accepted.Body.String())
	}
	counts := initialCounts(t, db)
	if counts[1] != 1 || counts[5] != 1 || counts[6] != 1 || counts[7] != 1 || counts[12] != 0 || counts[14] != 2 || counts[15] != 2 {
		t.Fatalf("accept counts %v", counts)
	}
	var phase string
	if e = db.QueryRow("SELECT phase FROM work_items").Scan(&phase); e != nil || phase != "Draft" {
		t.Fatalf("phase %s %v", phase, e)
	}
	lookup := initialHTTPRequest(server, http.MethodGet, "/api/v1/projects/"+string(projectID)+"/commands/"+q.CommandID, nil, true, false)
	if lookup.Code != 200 || !bytes.Equal(lookup.Body.Bytes(), accepted.Body.Bytes()) {
		t.Fatalf("result lookup %d %s", lookup.Code, lookup.Body.String())
	}
	if got := initialHTTPRequest(server, http.MethodGet, request.URL.Path, nil, true, false); got.Code != 404 {
		t.Fatal("already accepted project prepared")
	}
	svc.config.RepositoryAuthority = nil
	replay := post(body)
	if replay.Code != 200 || !bytes.Equal(replay.Body.Bytes(), accepted.Body.Bytes()) {
		t.Fatalf("replay after revocation %d %s", replay.Code, replay.Body.String())
	}
	changed := bytes.Replace(body, []byte(base64.StdEncoding.EncodeToString(initialContent)), []byte(base64.StdEncoding.EncodeToString([]byte("changed"))), 1)
	if got := post(changed); got.Code != 409 {
		t.Fatalf("same-key changed-content status %d", got.Code)
	}
	if !reflect.DeepEqual(counts, initialCounts(t, db)) {
		t.Fatal("replay/query mutated state")
	}
}

func initialHTTPBody(t *testing.T, q command.AcceptInitialSpecification) []byte {
	t.Helper()
	payload := map[string]any{"proposal_digest": "sha256:" + q.ProposalDigest.String(), "policy_revision_digest": "sha256:" + q.PolicyRevisionDigest.String(), "acceptance_subject_digest": "sha256:" + q.AcceptanceSubjectDigest.String(), "work_items": q.WorkItems, "ac_contents": q.ACContents}
	body, e := json.Marshal(map[string]any{"command_id": q.CommandID, "idempotency_key": q.IdempotencyKey, "operation": "AcceptInitialSpecification", "expected_version": q.ExpectedVersion, "issued_at": q.IssuedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), "payload": payload})
	if e != nil {
		t.Fatal(e)
	}
	return body
}
func initialHTTPRequest(server http.Handler, method, path string, body []byte, auth, origin bool) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if auth {
		request.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: "token"})
	}
	if origin {
		request.Header.Set("Origin", "https://taskboard.test")
	}
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}
func TestAdmission_InitialAcceptanceHTTPNegative(t *testing.T) {
	for _, kind := range []string{"unauthenticated", "origin", "wrong_project", "missing", "null", "duplicate_field", "unknown_field", "duplicate_item", "duplicate_ac", "missing_content", "null_content", "base64_unpadded", "base64_newline", "base64_noncanonical", "base64_data_uri", "too_many_items", "too_many_acs", "total_content", "oversized_content", "oversized_body", "version_zero", "version_overflow", "stale_item", "wrong_content", "extra_ac", "subject"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			server, e := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
			if e != nil {
				t.Fatal(e)
			}
			body := string(initialHTTPBody(t, q))
			auth, origin := true, true
			path := "/api/v1/projects/" + string(projectID) + "/commands"
			switch kind {
			case "unauthenticated":
				auth = false
			case "origin":
				origin = false
			case "wrong_project":
				path = "/api/v1/projects/prj_01HABCDEFGJ/commands"
			case "missing":
				body = strings.Replace(body, `"work_items":`, `"ignored":`, 1)
			case "null":
				body = strings.Replace(body, `"work_items":[`, `"work_items":null,"ignored":[`, 1)
			case "duplicate_field":
				body = strings.Replace(body, `"payload":{`, `"payload":{"proposal_digest":"sha256:`+q.ProposalDigest.String()+`",`, 1)
			case "unknown_field":
				body = strings.Replace(body, `"payload":{`, `"payload":{"approval":true,`, 1)
			case "duplicate_item":
				item := fmt.Sprintf(`{"work_item_id":%q,"expected_version":1}`, workItemID)
				body = strings.Replace(body, `"work_items":[`, `"work_items":[`+item+`,`, 1)
			case "duplicate_ac":
				ac := fmt.Sprintf(`{"ac_id":"AC-A","content":%q}`, base64.StdEncoding.EncodeToString(initialContent))
				body = strings.Replace(body, `"ac_contents":[`, `"ac_contents":[`+ac+`,`, 1)
			case "missing_content":
				body = strings.Replace(body, `"content":`, `"ignored":`, 1)
			case "null_content":
				body = strings.Replace(body, `"content":"`+base64.StdEncoding.EncodeToString(initialContent)+`"`, `"content":null`, 1)
			case "base64_unpadded":
				body = strings.Replace(body, base64.StdEncoding.EncodeToString(initialContent), "YQ", 1)
			case "base64_newline":
				body = strings.Replace(body, base64.StdEncoding.EncodeToString(initialContent), `YQ==\n`, 1)
			case "base64_data_uri":
				body = strings.Replace(body, base64.StdEncoding.EncodeToString(initialContent), "data:text/plain;base64,YQ==", 1)
			case "too_many_items":
				item := fmt.Sprintf(`{"work_item_id":%q,"expected_version":1},`, workItemID)
				body = strings.Replace(body, `"work_items":[`, `"work_items":[`+strings.Repeat(item, 256), 1)
			case "too_many_acs":
				body = strings.Replace(body, `"ac_contents":[`, `"ac_contents":[`+strings.Repeat(`{"ac_id":"AC-EXTRA","content":"YQ=="},`, 256), 1)
			case "total_content":
				extra := ""
				for i := range 9 {
					extra += fmt.Sprintf(`{"ac_id":"AC-EXTRA-%d","content":%q},`, i, base64.StdEncoding.EncodeToString(make([]byte, 64<<10)))
				}
				body = strings.Replace(body, `"ac_contents":[`, `"ac_contents":[`+extra, 1)
			case "base64_noncanonical":
				body = strings.Replace(body, base64.StdEncoding.EncodeToString(initialContent), "YR==", 1)
			case "oversized_content":
				body = strings.Replace(body, base64.StdEncoding.EncodeToString(initialContent), base64.StdEncoding.EncodeToString(make([]byte, 65537)), 1)
			case "oversized_body":
				body = strings.Repeat(" ", 1<<20) + body
			case "version_zero":
				body = strings.ReplaceAll(body, `"expected_version":1`, `"expected_version":0`)
			case "version_overflow":
				body = strings.ReplaceAll(body, `"expected_version":1`, `"expected_version":9223372036854775807`)
			case "stale_item":
				if _, e = db.Exec("UPDATE work_items SET version=2"); e != nil {
					t.Fatal(e)
				}
			case "wrong_content":
				body = strings.Replace(body, base64.StdEncoding.EncodeToString(initialContent), "YQ==", 1)
			case "extra_ac":
				body = strings.Replace(body, `"ac_contents":[`, `"ac_contents":[{"ac_id":"AC-EXTRA","content":"YQ=="},`, 1)
			case "subject":
				body = strings.Replace(body, q.AcceptanceSubjectDigest.String(), domain.HashString("wrong").String(), 1)
			}
			before := initialCounts(t, db)
			got := initialHTTPRequest(server, http.MethodPost, path, []byte(body), auth, origin)
			if got.Code == 200 {
				t.Fatalf("negative accepted %s", got.Body.String())
			}
			after := initialCounts(t, db)
			for i := range before {
				if i == 8 || i == 9 {
					continue
				}
				if before[i] != after[i] {
					t.Fatalf("negative mutation %v -> %v", before, after)
				}
			}
		})
	}
}
func TestInitialAcceptanceDescription_GuardsAndReadOnly(t *testing.T) {
	for _, kind := range []string{"positive", "unknown", "revoked", "wrong_actor", "recipe", "policy_rule", "head", "phase", "run", "corrupt_proposal", "multiple_sorted"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			actor := operator
			switch kind {
			case "multiple_sorted":
				svc, _, db, q = initialFixtureContent(t, initialContent, "wi_01HABCDEFGJ")
			case "unknown":
				q.ProposalDigest = domain.HashString("unknown")
			case "revoked":
				svc.config.RepositoryAuthority = nil
			case "wrong_actor":
				actor = "other"
			case "recipe":
				svc.config.Completion.RecipeDigest = domain.HashString("changed")
			case "policy_rule":
				delete(svc.config.Completion.Checks, "AC-A")
			case "head":
				if _, e := svc.AcceptInitialSpecification(t.Context(), operator, q); e != nil {
					t.Fatal(e)
				}
			case "phase":
				if _, e := db.Exec("UPDATE work_items SET phase='Ready'"); e != nil {
					t.Fatal(e)
				}
			case "run":
				if e := store.Within(t.Context(), func(tx port.Transaction) error {
					return tx.CreateRun(t.Context(), port.Run{ID: "run_01HABCDEFGH", ProjectID: projectID, WorkItemID: workItemID, InputDigest: domain.HashString("historical"), AdapterID: "fake/v1", AdapterVersion: "1", ScenarioID: "test", Attempt: 1, DesiredAction: "Dispatch", DispatchState: "Pending", ObservedState: "Unknown", ReconciliationState: "None", SideEffectOutcome: "NotApplicable", CreatedAtNS: 1})
				}); e != nil {
					t.Fatal(e)
				}
			case "corrupt_proposal":
				if _, e := db.Exec("DROP TRIGGER specification_proposals_immutable_update"); e != nil {
					t.Fatal(e)
				}
				if _, e := db.Exec("UPDATE specification_proposals SET canonical_content=x'7b7d'"); e != nil {
					t.Fatal(e)
				}
			}
			before := initialCounts(t, db)
			body, e := svc.DescribeInitialAcceptance(t.Context(), actor, projectID, q.ProposalDigest)
			if kind == "positive" || kind == "multiple_sorted" {
				if e != nil {
					t.Fatal(e)
				}
				var got InitialAcceptanceDescription
				if e = json.Unmarshal(body, &got); e != nil {
					t.Fatal(e)
				}
				if got.AcceptanceSubjectDigest != "sha256:"+q.AcceptanceSubjectDigest.String() {
					t.Fatal("wrong subject")
				}
			} else if e == nil {
				t.Fatalf("guard allowed %s", kind)
			}
			if !reflect.DeepEqual(before, initialCounts(t, db)) {
				t.Fatal("description mutated durable state")
			}
		})
	}
}

func TestAdmission_InitialAcceptanceHTTPEmptyContent(t *testing.T) {
	svc, store, _, q := initialFixtureContent(t, []byte{})
	server, e := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if e != nil {
		t.Fatal(e)
	}
	got := initialHTTPRequest(server, http.MethodPost, "/api/v1/projects/"+string(projectID)+"/commands", initialHTTPBody(t, q), true, true)
	if got.Code != 200 {
		t.Fatalf("legitimate empty content rejected %d %s", got.Code, got.Body.String())
	}
}
func TestAdmission_InitialAcceptanceHTTPEmptyDraft(t *testing.T) {
	for _, kind := range []string{"empty", "nonempty", "missing", "null"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, _ := initialFixture(t)
			server, e := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
			if e != nil {
				t.Fatal(e)
			}
			revisions := `,"required_ac_revisions":[]`
			if kind == "missing" {
				revisions = ""
			}
			if kind == "null" {
				revisions = `,"required_ac_revisions":null`
			}
			if kind == "nonempty" {
				if e := store.Within(t.Context(), func(tx port.Transaction) error {
					return tx.StoreACRevision(t.Context(), port.ACRevision{ID: "legacy-control", ProjectID: projectID, ACID: "AC-LEGACY", Digest: domain.HashString("legacy"), Content: []byte("legacy"), CreatedAtNS: 1})
				}); e != nil {
					t.Fatal(e)
				}
				revisions = `,"required_ac_revisions":[{"ac_id":"AC-LEGACY","revision_digest":"sha256:` + domain.HashString("legacy").String() + `"}]`
			}
			body := fmt.Sprintf(`{"command_id":"cmd_01HABCDEF40","idempotency_key":"00000000-0000-4000-8000-000000000040","operation":"CreateWorkItem","expected_version":0,"issued_at":%q,"payload":{"work_item_id":"wi_01HABCDEFGJ","title":"Draft","goal":"Explicit bootstrap","owner_id":"operator"%s}}`, fixedTime().UTC().Format("2006-01-02T15:04:05.999999999Z07:00"), revisions)
			before := initialCounts(t, db)
			got := initialHTTPRequest(server, http.MethodPost, "/api/v1/projects/"+string(projectID)+"/commands", []byte(body), true, true)
			if kind == "missing" || kind == "null" {
				if got.Code != 400 || !reflect.DeepEqual(before, initialCounts(t, db)) {
					t.Fatalf("invalid array %d %s", got.Code, got.Body.String())
				}
				return
			}
			if got.Code != 200 {
				t.Fatalf("explicit array %d %s", got.Code, got.Body.String())
			}
			var phase string
			if e = db.QueryRow("SELECT phase FROM work_items WHERE work_item_id='wi_01HABCDEFGJ'").Scan(&phase); e != nil || phase != "Draft" {
				t.Fatalf("draft %s %v", phase, e)
			}
			var n int
			if e = db.QueryRow("SELECT count(*) FROM runs").Scan(&n); e != nil || n != 0 {
				t.Fatal("bootstrap created Run")
			}
		})
	}
}

func TestAdmission_InitialAcceptanceHTTPPreparationUnavailable(t *testing.T) {
	for _, kind := range []string{"unauthenticated", "wrong_project", "unknown_proposal", "malformed_digest", "revoked"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			server, e := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
			if e != nil {
				t.Fatal(e)
			}
			project := projectID
			digest := "sha256:" + q.ProposalDigest.String()
			auth := true
			want := 404
			switch kind {
			case "unauthenticated":
				auth = false
				want = 401
			case "wrong_project":
				project = "prj_01HABCDEFGJ"
			case "unknown_proposal":
				digest = "sha256:" + domain.HashString("unknown").String()
			case "malformed_digest":
				digest = q.ProposalDigest.String()
			case "revoked":
				svc.config.RepositoryAuthority = nil
			}
			before := initialCounts(t, db)
			got := initialHTTPRequest(server, http.MethodGet, "/api/v1/projects/"+string(project)+"/proposals/"+digest+"/initial-acceptance", nil, auth, false)
			if got.Code != want {
				t.Fatalf("status %d %s", got.Code, got.Body.String())
			}
			if !reflect.DeepEqual(before, initialCounts(t, db)) {
				t.Fatal("negative preparation mutated state")
			}
		})
	}
}
