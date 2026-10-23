package main

import (
	"bytes"
	"context"
	"database/sql"
	json "encoding/json/v2"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/gitobject"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

const proposalManifest = `{"schema_version":1,"nodes":[{"id":"SPEC-A","path":"a.md","required":true,"work_item_ids":["wi_A"],"required_ac_revisions":[{"ac_id":"AC-A","ac_revision_digest":"1111111111111111111111111111111111111111111111111111111111111111"}],"recipe_digest":"2222222222222222222222222222222222222222222222222222222222222222"}],"edges":[]}`

type fixtureAuthority struct{ value port.ApprovedRepository }

func (a fixtureAuthority) Lookup(p domain.ProjectID, id string) (port.ApprovedRepository, error) {
	if p != a.value.Binding.ProjectID || id != a.value.Binding.ID {
		return port.ApprovedRepository{}, fmt.Errorf("unavailable")
	}
	return a.value, nil
}
func proposalGitFixture(t *testing.T) (string, string, string) {
	t.Helper()
	git, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	git, err = filepath.EvalSymlinks(git)
	if err != nil {
		t.Fatal(err)
	}
	root := privateTestRoot(t)
	run := func(args ...string) string {
		t.Helper()
		c := exec.CommandContext(t.Context(), git, args...)
		c.Dir = root
		c.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + root, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid"}
		out, e := c.CombinedOutput()
		if e != nil {
			t.Fatalf("fixture git failed: %v: %s", e, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("init", "--initial-branch=main")
	if err = os.WriteFile(filepath.Join(root, "manifest.json"), []byte(proposalManifest), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "a.md"), []byte("Committed source\n"), 0600); err != nil {
		t.Fatal(err)
	}
	run("add", "manifest.json", "a.md")
	run("commit", "-m", "fixture")
	return git, filepath.Join(root, ".git"), run("rev-parse", "HEAD")
}
func proposalComposition(t *testing.T, root string, authority port.RepositoryAuthority) (*sqlite.Store, *httpapi.Server) {
	t.Helper()
	store, err := sqlite.OpenAtRootWithClock(t.Context(), root, filepath.Join(root, "state.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	artifacts, err := newLocalArtifactStore(filepath.Join(root, "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close(); artifacts.Close() })
	auth, err := newLocalSessionAuthority(testSessionToken, "local-operator")
	if err != nil {
		t.Fatal(err)
	}
	fake, err := newLocalFakeAdapter()
	if err != nil {
		t.Fatal(err)
	}
	composed, err := Compose(Dependencies{Store: store, Executor: fake, Clock: systemClock{}, IDs: cryptoIDSource{}, Artifacts: artifacts, Projections: httpapi.PersistedProjections{Store: store}, Authority: auth, Application: service.Config{Operator: "local-operator", IdempotencyTTL: 24 * time.Hour, Specification: unavailableSpecification{}, RepositoryAuthority: authority, Completion: service.CompletionPolicy{RevisionDigest: domain.HashString("policy"), RecipeDigest: domain.HashString("recipe"), Checks: map[domain.ACID]service.VerificationRule{"local": {VerifierClass: "local"}}}}, HTTP: httpapi.Config{Origin: "http://127.0.0.1:18080"}})
	if err != nil {
		t.Fatal(err)
	}
	return store, composed.Handler
}
func proposalHTTP(t *testing.T, h http.Handler, method, path, body, token, origin string, status int) []byte {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:18080"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if token != "" {
		r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: token})
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != status {
		t.Fatalf("HTTP %s %s = %d want %d: %s", method, path, w.Code, status, w.Body.String())
	}
	return w.Body.Bytes()
}
func proposalBody(digest string) string {
	return fmt.Sprintf(`{"command_id":"cmd_0123456789ABCDEFGHJKMNPS","idempotency_key":"123e4567-e89b-42d3-a456-426614174001","operation":"ProposeSpecification","expected_version":1,"issued_at":"2026-01-01T00:00:00Z","payload":{"repository_binding_id":"binding","binding_version":1,"binding_digest":%q,"ref":"refs/heads/main","manifest_path":"manifest.json"}}`, digest)
}
func TestAdmission_HTTPCommand(t *testing.T) {
	git, gitDir, commit := proposalGitFixture(t)
	root := privateTestRoot(t)
	scratch := filepath.Join(root, "scratch")
	if err := os.Mkdir(scratch, 0700); err != nil {
		t.Fatal(err)
	}
	reader, err := gitobject.New(gitobject.Config{GitExecutable: git, GitDir: gitDir, ScratchDir: scratch, ObjectFormat: specification.SHA1, AllowedRefs: []string{"refs/heads/main"}})
	if err != nil {
		t.Fatal(err)
	}
	approved := port.ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: testProjectID, ID: "binding", Version: 1, ObjectFormat: specification.SHA1}, ConfigurationID: "approved-local", ApprovedBy: "local-operator", Refs: []string{"refs/heads/main"}, ManifestPaths: []string{"manifest.json"}, Reader: reader}
	canonical, digest, err := port.CanonicalRepositoryBinding(approved)
	if err != nil {
		t.Fatal(err)
	}
	approved.Binding.Digest = digest
	store, h := proposalComposition(t, root, fixtureAuthority{approved})
	origin := "http://127.0.0.1:18080"
	path := "/api/v1/projects/" + testProjectID
	proposalHTTP(t, h, "POST", "/api/v1/projects", testCreateBody, testSessionToken, origin, 200)
	body := proposalBody("sha256:" + digest.String())
	// Lawful positive: approved real Git proposal through authenticated HTTP.
	result := proposalHTTP(t, h, "POST", path+"/commands", body, testSessionToken, origin, 200)
	var decoded struct {
		Result struct {
			ProposalDigest string `json:"proposal_digest"`
			Commit         string `json:"commit_oid"`
		} `json:"result"`
	}
	if err = json.Unmarshal(result, &decoded); err != nil || decoded.Result.Commit != commit {
		t.Fatalf("result provenance: %s %v", result, err)
	}
	public := proposalHTTP(t, h, "GET", path+"/repository-bindings/binding", "", testSessionToken, "", 200)
	if !bytes.Contains(public, canonical) || bytes.Contains(public, []byte(gitDir)) || bytes.Contains(public, []byte(scratch)) {
		t.Fatalf("unsafe public binding: %s", public)
	}
	d, err := httpapi.DecodeSHA256(decoded.Result.ProposalDigest)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Within(t.Context(), func(tx port.Transaction) error {
		p, e := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), testProjectID, d)
		if e == nil && p.Commit().String() != commit {
			t.Fatal("stored provenance changed")
		}
		return e
	}); err != nil {
		t.Fatal(err)
	}
	// No source access on committed replay, including after ref movement/source loss.
	if err = os.WriteFile(filepath.Join(gitDir, "refs", "heads", "main"), []byte(strings.Repeat("1", 40)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if replay := proposalHTTP(t, h, "POST", path+"/commands", body, testSessionToken, origin, 200); !bytes.Equal(result, replay) {
		t.Fatal("ref-move replay changed")
	}
	if err = os.Rename(gitDir, gitDir+"-gone"); err != nil {
		t.Fatal(err)
	}
	if replay := proposalHTTP(t, h, "POST", path+"/commands", body, testSessionToken, origin, 200); !bytes.Equal(result, replay) {
		t.Fatal("source-loss replay changed")
	}
	proposalHTTP(t, h, "GET", path+"/commands/cmd_0123456789ABCDEFGHJKMNPS", "", testSessionToken, "", 200)
	replay, err := (httpapi.PersistedProjections{Store: store}).Replay(context.Background(), testProjectID, port.Cursor{Epoch: 1})
	if err != nil || len(replay.Events) != 2 || !bytes.Contains(replay.Events[1].Payload, []byte(`"event_type":"project.changed"`)) {
		t.Fatalf("SSE replay: %+v %v", replay, err)
	}
	for _, tc := range []struct {
		name, body, token, origin string
		status                    int
	}{{"unauthenticated", body, "", origin, 401}, {"origin", body, testSessionToken, "http://localhost:18080", 403}, {"unknown", strings.Replace(body, `"manifest_path":"manifest.json"`, `"manifest_path":"manifest.json","git_dir":"/private"`, 1), testSessionToken, origin, 400}, {"binding", strings.Replace(strings.Replace(body, "174001", "174002", 1), `"binding_version":1`, `"binding_version":2`, 1), testSessionToken, origin, 403}} {
		t.Run(tc.name, func(t *testing.T) {
			proposalHTTP(t, h, "POST", path+"/commands", tc.body, tc.token, tc.origin, tc.status)
		})
	}
	proposalHTTP(t, h, "GET", strings.Replace(path, "MNPR", "MNPV", 1)+"/repository-bindings/binding", "", testSessionToken, "", 404)
	assertProposalRuntimeRows(t, filepath.Join(root, "state.db"))
}

func assertProposalRuntimeRows(t *testing.T, database string) {
	t.Helper()
	db, err := sql.Open("sqlite", database)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for table, want := range map[string]int{"specification_proposals": 1, "repository_binding_versions": 1, "dependency_revisions": 1, "command_results": 2, "idempotency_records": 2, "audit_entries": 2, "projection_events": 2, "accepted_spec_revisions": 0, "project_spec_heads": 0, "work_item_spec_heads": 0, "current_ac_requirements": 0, "work_item_ac_requirements": 0, "runs": 0} {
		var got int
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&got); err != nil || got != want {
			t.Fatalf("%s = %d want %d: %v", table, got, want, err)
		}
	}
}
