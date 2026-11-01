package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	json "encoding/json/v2"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

func runtimePolicy(t *testing.T, project domain.ProjectID, acs []domain.ACID, approval bool) port.PolicyProfile {
	t.Helper()
	m := port.PolicyProfileMaterial{Schema: 1, ProjectID: project, RecipeDigest: domain.HashString("local-recipe-v1").String(), ApprovalRequired: approval, IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}}
	if approval {
		m.IntegrationBase = port.RunInputIntegrationBase{Applicability: "present", Digest: new(domain.HashString("integration base").String())}
	}
	for _, ac := range acs {
		m.Rules = append(m.Rules, port.RunInputVerificationRule{ACID: ac, VerifierClass: "human", Independent: true, ProhibitedVerifierRunRole: "producer", EnvironmentDigest: domain.HashString("human environment " + string(project)).String()})
	}
	p, e := port.NewPolicyProfile(m)
	if e != nil {
		t.Fatal(e)
	}
	return p
}
func policyDocument(t *testing.T, profiles ...port.PolicyProfile) []byte {
	t.Helper()
	values := make([]port.PolicyProfileMaterial, len(profiles))
	for i, p := range profiles {
		values[i] = p.Material()
	}
	b, e := json.Marshal(struct {
		Schema   int                          `json:"schema_version"`
		Profiles []port.PolicyProfileMaterial `json:"profiles"`
	}{1, values})
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestRuntimePolicyFile_Admission(t *testing.T) {
	root := privateTestRoot(t)
	path := filepath.Join(root, "policies.json")
	good := policyDocument(t, runtimePolicy(t, "project", []domain.ACID{"local"}, false))
	if got, e := loadPolicyProfiles(""); e != nil || got != nil {
		t.Fatal("unset selector", e)
	}
	if e := os.WriteFile(path, good, 0600); e != nil {
		t.Fatal(e)
	}
	if got, e := loadPolicyProfiles(path); e != nil || len(got) != 1 {
		t.Fatal("valid file", e)
	}
	padded := append(bytes.Clone(good), bytes.Repeat([]byte(" "), port.PolicyProfilesLimit-len(good))...)
	if e := os.WriteFile(path, padded, 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := loadPolicyProfiles(path); e != nil {
		t.Fatal("exact file boundary rejected", e)
	}
	if e := os.WriteFile(path, good, 0600); e != nil {
		t.Fatal(e)
	}

	for name, setup := range map[string]func() string{
		"mode": func() string { p := filepath.Join(root, "public"); _ = os.WriteFile(p, good, 0644); return p },
		"symlink": func() string {
			p := filepath.Join(root, "link")
			if e := os.Symlink(path, p); e != nil {
				t.Fatal(e)
			}
			return p
		},
		"parent-symlink": func() string {
			p := filepath.Join(privateTestRoot(t), "parent")
			if e := os.Symlink(root, p); e != nil {
				t.Fatal(e)
			}
			return filepath.Join(p, "policies.json")
		},
		"fifo": func() string {
			p := filepath.Join(root, "fifo")
			if e := syscall.Mkfifo(p, 0600); e != nil {
				t.Fatal(e)
			}
			return p
		},
		"directory": func() string { return root }, "relative": func() string { return "policies.json" },
		"hardlink": func() string {
			p := filepath.Join(root, "hardlink")
			target := filepath.Join(root, "target")
			_ = os.WriteFile(target, good, 0600)
			if e := os.Link(target, p); e != nil {
				t.Fatal(e)
			}
			return p
		},
		"oversize": func() string {
			p := filepath.Join(root, "large")
			_ = os.WriteFile(p, append(bytes.Clone(padded), byte(' ')), 0600)
			return p
		},
		"invalid": func() string {
			p := filepath.Join(root, "invalid")
			_ = os.WriteFile(p, []byte(`{"schema_version":1,"profiles":[]}`), 0600)
			return p
		},
	} {
		t.Run(name, func(t *testing.T) {
			p := setup()
			if _, e := loadPolicyProfiles(p); e == nil {
				t.Fatal("unsafe policy file admitted")
			} else if strings.Contains(e.Error(), root) {
				t.Fatal("private path disclosed")
			}
		})
	}
}

type policyRuntimeClient struct {
	runtime  *runningRuntime
	cancel   context.CancelFunc
	client   *http.Client
	config   runtimeConfig
	sequence *int
}

func startPolicyClient(t *testing.T, root, repositories, policies string, sequence *int) *policyRuntimeClient {
	t.Helper()
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	address := listener.Addr().String()
	config, e := loadRuntimeConfig(func(key string) string {
		return map[string]string{"HAI_TASKBOARD_DATA_ROOT": root, "HAI_TASKBOARD_LISTEN_ADDR": address, "HAI_TASKBOARD_ORIGIN": "http://" + address, "HAI_TASKBOARD_SESSION_TOKEN": testSessionToken, "HAI_TASKBOARD_APPROVED_REPOSITORIES_FILE": repositories, "HAI_TASKBOARD_COMPLETION_POLICIES_FILE": policies}[key]
	}, nil)
	if e != nil {
		listener.Close()
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(t.Context())
	running, e := startRuntime(ctx, config, listener)
	if e != nil {
		cancel()
		listener.Close()
		t.Fatal(e)
	}
	h := &policyRuntimeClient{running, cancel, &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 5 * time.Second}, config, sequence}
	t.Cleanup(func() { h.stop(t) })
	return h
}
func (h *policyRuntimeClient) stop(t *testing.T) {
	t.Helper()
	if h.runtime == nil {
		return
	}
	h.client.CloseIdleConnections()
	h.cancel()
	waitRuntime(t, h.runtime)
	h.runtime = nil
}
func (h *policyRuntimeClient) request(t *testing.T, method, path string, body []byte, status int) []byte {
	t.Helper()
	r, e := http.NewRequestWithContext(t.Context(), method, h.config.Origin+path, bytes.NewReader(body))
	if e != nil {
		t.Fatal(e)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", h.config.Origin)
	r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: testSessionToken})
	return requireHTTPBody(t, h.client, r, status)
}
func (h *policyRuntimeClient) wire(t *testing.T, version uint64, operation string, payload any) []byte {
	t.Helper()
	*h.sequence++
	b, e := json.Marshal(map[string]any{"command_id": fmt.Sprintf("cmd_%012d", *h.sequence), "idempotency_key": fmt.Sprintf("00000000-0000-4000-8000-%012d", *h.sequence), "operation": operation, "expected_version": version, "issued_at": time.Now().UTC().Format(time.RFC3339Nano), "payload": payload})
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func (h *policyRuntimeClient) command(t *testing.T, project domain.ProjectID, version uint64, operation string, payload any, status int) ([]byte, []byte) {
	t.Helper()
	b := h.wire(t, version, operation, payload)
	return h.request(t, "POST", "/api/v1/projects/"+string(project)+"/commands", b, status), b
}
func (h *policyRuntimeClient) createProject(t *testing.T, project domain.ProjectID) {
	t.Helper()
	*h.sequence++
	b, e := json.Marshal(map[string]any{"command_id": fmt.Sprintf("cmd_%012d", *h.sequence), "idempotency_key": fmt.Sprintf("00000000-0000-4000-8000-%012d", *h.sequence), "project_id": project, "expected_version": 0, "issued_at": time.Now().UTC().Format(time.RFC3339Nano), "name": "Policy fixture " + string(project), "repository": map[string]any{"root_hint": "/workspace/local", "approved_ref": "refs/heads/main"}})
	if e != nil {
		t.Fatal(e)
	}
	h.request(t, "POST", "/api/v1/projects", b, 200)
}
func policyGitRepository(t *testing.T, acs []domain.ACID) (string, string) {
	t.Helper()
	git, e := exec.LookPath("git")
	if e != nil {
		t.Fatal(e)
	}
	git, e = filepath.EvalSymlinks(git)
	if e != nil {
		t.Fatal(e)
	}
	root := privateTestRoot(t)
	run := func(args ...string) {
		t.Helper()
		c := exec.CommandContext(t.Context(), git, args...)
		c.Dir = root
		c.Env = []string{"PATH=/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid"}
		if out, e := c.CombinedOutput(); e != nil {
			t.Fatalf("fixture Git %v: %s", e, out)
		}
	}
	run("init", "--initial-branch=main")
	revisions := []map[string]any{}
	for _, ac := range acs {
		revisions = append(revisions, map[string]any{"ac_id": ac, "ac_revision_digest": domain.HashString("policy AC content").String()})
	}
	manifest, e := json.Marshal(map[string]any{"schema_version": 1, "nodes": []any{map[string]any{"id": "SPEC-A", "path": "a.md", "required": true, "work_item_ids": []string{"wi_0000000001"}, "required_ac_revisions": revisions, "recipe_digest": domain.HashString("local-recipe-v1").String()}}, "edges": []any{}})
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(root, "manifest.json"), manifest, 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(root, "a.md"), []byte("source\n"), 0600); e != nil {
		t.Fatal(e)
	}
	run("add", "manifest.json", "a.md")
	run("commit", "-m", "policy fixture")
	return git, filepath.Join(root, ".git")
}
func policyRegistry(t *testing.T, git, dir string, projects ...domain.ProjectID) string {
	t.Helper()
	entries := []any{}
	for _, id := range projects {
		var input map[string]any
		if e := json.Unmarshal(repositoryConfigBytes(t, git, dir), &input); e != nil {
			t.Fatal(e)
		}
		entry := input["repositories"].([]any)[0].(map[string]any)
		entry["project_id"] = id
		entries = append(entries, entry)
	}
	b, e := json.Marshal(map[string]any{"schema_version": 1, "repositories": entries})
	if e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(privateTestRoot(t), "repositories.json")
	if e = os.WriteFile(path, b, 0600); e != nil {
		t.Fatal(e)
	}
	return path
}
func policyCounts(t *testing.T, root string) []int {
	t.Helper()
	db, e := sql.Open("sqlite", filepath.Join(root, "state", "taskboard.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	counts := []int{}
	for _, table := range []string{"project_completion_policies", "accepted_spec_revisions", "run_input_envelopes", "runs", "outbox", "human_reports", "reviews", "evidence", "approval_consumptions", "completion_records", "command_results", "audit_entries", "projection_events"} {
		var n int
		if e = db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); e != nil {
			t.Fatal(e)
		}
		counts = append(counts, n)
	}
	return counts
}
func policyError(t *testing.T, data []byte, code string) {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if e := json.Unmarshal(data, &body); e != nil || body.Error.Code != code {
		t.Fatalf("wanted %s: %s (%v)", code, data, e)
	}
}

func TestRuntimePolicyProfiles_CompletionAndRestart(t *testing.T) {
	acs := []domain.ACID{"shared", domain.ACID(strings.Repeat("a", 81)), domain.ACID(strings.Repeat("b", 120)), domain.ACID(strings.Repeat("界", 40))}
	projects := []domain.ProjectID{testProjectID, "prj_0123456789ABCDEFGHJKMNPV"}
	profiles := []port.PolicyProfile{runtimePolicy(t, projects[0], acs, false), runtimePolicy(t, projects[1], acs, true)}
	git, dir := policyGitRepository(t, acs)
	registry := policyRegistry(t, git, dir, projects...)
	root := privateTestRoot(t)
	sequence := 1000
	h := startPolicyClient(t, root, registry, "", &sequence)
	for _, id := range projects {
		h.createProject(t, id)
		h.command(t, id, 0, "CreateWorkItem", map[string]any{"work_item_id": "wi_0000000001", "title": "Policy Draft", "goal": "Explicit policy", "owner_id": "local-operator", "required_ac_revisions": []any{}}, 200)
	}
	h.stop(t)
	policyFile := filepath.Join(privateTestRoot(t), "policies.json")
	if e := os.WriteFile(policyFile, policyDocument(t, profiles...), 0600); e != nil {
		t.Fatal(e)
	}
	h = startPolicyClient(t, root, registry, policyFile, &sequence)
	type replay struct {
		project      domain.ProjectID
		body, result []byte
	}
	replays := []replay{}
	for i, project := range projects {
		p := profiles[i]
		path := "/api/v1/projects/" + string(project)
		var binding struct {
			Digest string `json:"binding_digest"`
		}
		if e := json.Unmarshal(h.request(t, "GET", path+"/repository-bindings/binding", nil, 200), &binding); e != nil {
			t.Fatal(e)
		}
		proposed, _ := h.command(t, project, 1, "ProposeSpecification", map[string]any{"repository_binding_id": "binding", "binding_version": 1, "binding_digest": binding.Digest, "ref": "refs/heads/main", "manifest_path": "manifest.json"}, 200)
		var proposal struct {
			Result struct {
				Digest string `json:"proposal_digest"`
			} `json:"result"`
		}
		if e := json.Unmarshal(proposed, &proposal); e != nil {
			t.Fatal(e)
		}
		var initial struct {
			Version uint64                        `json:"expected_version"`
			Policy  string                        `json:"policy_revision_digest"`
			Subject string                        `json:"acceptance_subject_digest"`
			Items   []port.InitialWorkItemVersion `json:"work_items"`
		}
		if e := json.Unmarshal(h.request(t, "GET", path+"/proposals/"+proposal.Result.Digest+"/initial-acceptance", nil, 200), &initial); e != nil {
			t.Fatal(e)
		}
		if initial.Policy != "sha256:"+p.Digest().String() {
			t.Fatal("initial description used another policy")
		}
		contents := []any{}
		for _, ac := range acs {
			contents = append(contents, map[string]any{"ac_id": ac, "content": base64.StdEncoding.EncodeToString([]byte("policy AC content"))})
		}
		accepted, acceptBody := h.command(t, project, initial.Version, "AcceptInitialSpecification", map[string]any{"proposal_digest": proposal.Result.Digest, "policy_revision_digest": initial.Policy, "acceptance_subject_digest": initial.Subject, "work_items": initial.Items, "ac_contents": contents}, 200)
		replays = append(replays, replay{project, acceptBody, accepted})
		h.command(t, project, 2, "MarkReady", map[string]any{"work_item_id": "wi_0000000001"}, 200)
		dispatched, _ := h.command(t, project, 3, "DispatchRun", map[string]any{"work_item_id": "wi_0000000001", "adapter_id": "fake/v1", "scenario_id": "local-success"}, 200)
		var dispatch struct {
			Result struct {
				Run domain.RunID `json:"run_id"`
			} `json:"result"`
		}
		if e := json.Unmarshal(dispatched, &dispatch); e != nil {
			t.Fatal(e)
		}
		var run port.RunAuthority
		deadline := time.Now().Add(5 * time.Second)
		for {
			e := h.runtime.store.Within(t.Context(), func(tx port.Transaction) error {
				var e error
				run, e = tx.(port.AuthorityTransaction).LoadRunAuthority(t.Context(), project, dispatch.Result.Run)
				return e
			})
			if e != nil {
				t.Fatal(e)
			}
			if run.Run.ObservedState == "Succeeded" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("Fake worker did not finish", run.Run)
			}
			time.Sleep(10 * time.Millisecond)
		}
		if e := h.runtime.store.Within(t.Context(), func(tx port.Transaction) error {
			input, e := tx.(port.CurrentInputTransaction).LoadRunInput(t.Context(), project, run.Run.ID)
			if e == nil {
				m := input.Input.Material()
				if m.PolicyRevisionDigest != p.Digest().String() || m.ApprovalRequired != p.Material().ApprovalRequired || !reflect.DeepEqual(m.Rules, p.Material().Rules) {
					t.Fatal("dispatch/claim selected another policy")
				}
			}
			return e
		}); e != nil {
			t.Fatal(e)
		}
		candidateDigest := "sha256:" + domain.HashString("local fake result\n").String()
		candidate := "policy-candidate"
		h.command(t, project, 4, "SubmitCandidate", map[string]any{"work_item_id": "wi_0000000001", "run_id": run.Run.ID, "candidate": map[string]any{"candidate_id": candidate, "run_id": run.Run.ID, "candidate_digest": candidateDigest, "input_subject_digest": "sha256:" + run.Run.InputDigest.String(), "created_at": time.Now().UTC().Format(time.RFC3339Nano), "artifact_manifest": []any{map[string]any{"sha256": candidateDigest, "media_type": "text/plain", "byte_length": 18, "availability": "Present"}}}}, 200)
		var prep struct {
			Version  uint64           `json:"expected_version"`
			Subject  map[string]any   `json:"completion_subject"`
			Digest   string           `json:"completion_subject_digest"`
			Approval bool             `json:"approval_required"`
			Rules    []map[string]any `json:"verification_rules"`
		}
		if e := json.Unmarshal(h.request(t, "GET", path+"/work-items/wi_0000000001/candidates/"+candidate+"/completion-preparation", nil, 200), &prep); e != nil {
			t.Fatal(e)
		}
		if prep.Subject["policy_revision_digest"] != "sha256:"+p.Digest().String() || prep.Approval != p.Material().ApprovalRequired || len(prep.Rules) != len(acs) {
			t.Fatal("preparation policy mismatch")
		}
		if i == 1 && prep.Subject["integration_base_digest"] != "sha256:"+*p.Material().IntegrationBase.Digest {
			t.Fatal("present integration base lost")
		}
		report := func(id, kind, text string) map[string]any {
			return map[string]any{"work_item_id": "wi_0000000001", "run_id": run.Run.ID, "report_id": id, "completion_subject_digest": prep.Digest, "lease_epoch": run.Lease.Fence.Epoch, "restore_generation": run.RestoreGeneration, "kind": kind, "media_type": "text/plain", "content": text}
		}
		review := report("report_0000000001", "review", "Independent review")
		review["review"] = map[string]any{"verdict": "Approved"}
		h.command(t, project, prep.Version, "SubmitHumanReport", review, 200)
		for j, ac := range acs {
			text := fmt.Sprintf("Independent human verification %d", j)
			evidence := report(fmt.Sprintf("report_%012d", j+2), "evidence", text)
			intent := map[string]any{"ac_id": ac, "ac_revision_digest": "sha256:" + domain.HashString("policy AC content").String(), "recipe_digest": "sha256:" + p.Material().RecipeDigest, "environment_digest": "sha256:" + profiles[1-i].Material().Rules[0].EnvironmentDigest, "verdict": "Passing"}
			evidence["evidence"] = intent
			denied, _ := h.command(t, project, prep.Version, "SubmitHumanReport", evidence, 403)
			policyError(t, denied, "permission_denied")
			intent["environment_digest"] = "sha256:" + p.Material().Rules[0].EnvironmentDigest
			result, body := h.command(t, project, prep.Version, "SubmitHumanReport", evidence, 200)
			replays = append(replays, replay{project, body, result})
			if j == 0 {
				fixture := map[string]any{"run_id": run.Run.ID, "lease_epoch": run.Lease.Fence.Epoch, "restore_generation": run.RestoreGeneration, "evidence": map[string]any{"evidence_id": "human-fixture", "completion_subject_digest": prep.Digest, "ac_id": ac, "ac_revision_digest": intent["ac_revision_digest"], "observation_verdict": "Passing", "review_disposition": "Accepted", "applicability": "Fresh", "material_availability": "Present", "verifier_id": "local-operator", "verifier_class": "human", "recipe_digest": intent["recipe_digest"], "environment_digest": "sha256:" + profiles[1-i].Material().Rules[0].EnvironmentDigest, "observed_at": time.Now().UTC().Format(time.RFC3339Nano), "report": map[string]any{"sha256": "sha256:" + domain.HashString(text).String(), "media_type": "text/plain", "byte_length": len(text), "availability": "Present"}}}
				denied, _ := h.command(t, project, prep.Version, "PublishFixtureEvidence", fixture, 403)
				policyError(t, denied, "permission_denied")
				fixture["evidence"].(map[string]any)["environment_digest"] = intent["environment_digest"]
				h.command(t, project, prep.Version, "PublishFixtureEvidence", fixture, 200)
			}
		}
		h.command(t, project, prep.Version, "RequestQA", map[string]any{"work_item_id": "wi_0000000001", "candidate_id": candidate, "completion_subject_digest": prep.Digest}, 200)
		if i == 1 {
			denied, _ := h.command(t, project, prep.Version+1, "CompleteWorkItem", map[string]any{"work_item_id": "wi_0000000001", "completion_subject": prep.Subject}, 422)
			policyError(t, denied, "done_gate_unsatisfied")
			h.command(t, project, prep.Version+1, "ApproveSubject", map[string]any{"work_item_id": "wi_0000000001", "candidate_id": candidate, "approval_request_id": "approval-policy", "subject_digest": prep.Digest, "decision": "Approved"}, 200)
		}
		done, doneBody := h.command(t, project, prep.Version+1, "CompleteWorkItem", map[string]any{"work_item_id": "wi_0000000001", "completion_subject": prep.Subject}, 200)
		replays = append(replays, replay{project, doneBody, done})
		item, e := h.runtime.store.LoadWorkItem(t.Context(), project, "wi_0000000001")
		if e != nil || item.Phase() != domain.PhaseDone {
			t.Fatal("not Done", e)
		}
	}
	before := policyCounts(t, root)
	h.stop(t)
	h = startPolicyClient(t, root, registry, policyFile, &sequence)
	for _, r := range replays {
		got := h.request(t, "POST", "/api/v1/projects/"+string(r.project)+"/commands", r.body, 200)
		if !bytes.Equal(got, r.result) {
			t.Fatal("restart replay changed bytes")
		}
	}
	if !reflect.DeepEqual(before, policyCounts(t, root)) {
		t.Fatal("restart replay mutated rows")
	}
	config := h.config
	h.stop(t)
	for _, kind := range []string{"unset", "omitted", "changed"} {
		t.Run(kind, func(t *testing.T) {
			c := config
			if kind == "unset" {
				c.CompletionPoliciesFile = ""
			} else {
				entries := profiles
				if kind == "omitted" {
					entries = profiles[:1]
				} else {
					m := profiles[0].Material()
					m.Rules[0].EnvironmentDigest = domain.HashString("changed").String()
					changed, e := port.NewPolicyProfile(m)
					if e != nil {
						t.Fatal(e)
					}
					entries = []port.PolicyProfile{changed, profiles[1]}
				}
				if e := os.WriteFile(policyFile, policyDocument(t, entries...), 0600); e != nil {
					t.Fatal(e)
				}
			}
			if running, e := startRuntime(t.Context(), c, nil); e == nil {
				running.stopRuntime()
				waitRuntime(t, running)
				t.Fatal("incompatible startup admitted")
			}
			listener, e := net.Listen("tcp", c.ListenAddress)
			if e != nil {
				t.Fatal("failed startup retained listener", e)
			}
			listener.Close()
			if !reflect.DeepEqual(before, policyCounts(t, root)) {
				t.Fatal("failed startup wrote command/policy rows")
			}
		})
	}
}
