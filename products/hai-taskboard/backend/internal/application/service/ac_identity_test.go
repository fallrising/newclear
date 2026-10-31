package service

import (
	"bytes"
	"context"
	"database/sql"
	json "encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

// The test store survives rebuilding the service and reopening SQLite. It does
// not replace the production artifact adapter's separate confinement tests.
type identityArtifacts struct{ root string }

type identityNoArtifactIO struct{ t *testing.T }

func (a identityNoArtifactIO) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	a.t.Fatal("recorded replay attempted artifact write")
	return domain.Digest{}, 0, nil
}
func (a identityNoArtifactIO) Open(context.Context, domain.Digest) (io.ReadCloser, error) {
	a.t.Fatal("recorded replay attempted artifact read")
	return nil, nil
}

func (a identityArtifacts) Put(_ context.Context, r io.Reader) (domain.Digest, uint64, error) {
	b, err := io.ReadAll(r)
	if err != nil {
		return domain.Digest{}, 0, err
	}
	d := domain.HashBytes(b)
	return d, uint64(len(b)), os.WriteFile(filepath.Join(a.root, d.String()), b, 0600)
}
func (a identityArtifacts) Open(_ context.Context, d domain.Digest) (io.ReadCloser, error) {
	return os.Open(filepath.Join(a.root, d.String()))
}
func (a identityArtifacts) Stage(ctx context.Context, _ domain.RunID, _, _ string, b []byte) (domain.Digest, error) {
	d, _, err := a.Put(ctx, bytes.NewReader(b))
	return d, err
}

func identityDurableCounts(t *testing.T, db *sql.DB) []int {
	t.Helper()
	counts := initialCounts(t, db)
	for _, table := range []string{"human_reports", "reviews", "evidence", "artifacts", "completion_records", "approval_consumptions", "outbox"} {
		var n int
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		counts = append(counts, n)
	}
	return counts
}

func TestACIdentity_InvalidInitialHasNoWrites(t *testing.T) {
	for i, id := range []string{"illegal space", "illegal\u00a0space", "illegal\u3000space", "illegal/slash", `illegal\slash`} {
		t.Run(fmt.Sprintf("invalid-%d", i), func(t *testing.T) {
			svc, _, db, q := initialFixture(t)
			q.ACContents[0].ACID = domain.ACID(id)
			before := identityDurableCounts(t, db)
			_, err := svc.AcceptInitialSpecification(t.Context(), operator, q)
			assertCommandError(t, err, command.CodeInvalidRequest)
			if !reflect.DeepEqual(before, identityDurableCounts(t, db)) {
				t.Fatal("invalid accepted identity wrote rows")
			}
		})
	}
}

func TestAcceptedACIdentity_EvidenceAndCompletionBoundary(t *testing.T) {
	for _, tc := range []struct{ name, id string }{{"ascii81", strings.Repeat("a", 81)}, {"ascii120", strings.Repeat("a", 120)}, {"unicode120", strings.Repeat("界", 40)}} {
		t.Run(tc.name, func(t *testing.T) {
			ac := domain.ACID(tc.id)
			// This helper actually invokes ProposeSpecification against authenticated
			// immutable Git objects. Acceptance below uses the real HTTP/service path.
			svc, store, db, accept := initialFixtureContentAC(t, initialContent, ac)
			artifacts := identityArtifacts{root: t.TempDir()}
			svc.artifacts = artifacts
			svc.config.Completion.ApprovalRequired = false
			rule := VerificationRule{VerifierClass: "human", Independent: true, ProhibitedVerifierRunRole: "producer", EnvironmentDigest: domain.HashString(port.FakeEnvironmentProfile)}
			svc.config.Completion.Checks = map[domain.ACID]VerificationRule{ac: rule}
			server := func() *httpapi.Server {
				h, err := httpapi.NewServer(svc, httpapi.UnitCommandResults{Unit: store}, httpapi.PersistedProjections{Store: store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
				if err != nil {
					t.Fatal(err)
				}
				return h
			}
			path := "/api/v1/projects/" + string(projectID) + "/commands"
			post := func(body []byte) []byte {
				r := initialHTTPRequest(server(), http.MethodPost, path, body, true, true)
				if r.Code != http.StatusOK {
					t.Fatalf("HTTP command %d: %s", r.Code, r.Body)
				}
				return bytes.Clone(r.Body.Bytes())
			}
			wire := func(n int, version uint64, operation string, payload any) []byte {
				m := initialMetadata(n, version)
				b, err := json.Marshal(map[string]any{"command_id": m.CommandID, "idempotency_key": m.IdempotencyKey, "operation": operation, "expected_version": version, "issued_at": m.IssuedAt.Format(time.RFC3339Nano), "payload": payload})
				if err != nil {
					t.Fatal(err)
				}
				return b
			}
			acceptedBody := initialHTTPBody(t, accept)
			// Valid long IDs do not acquire a trusted rule from the local profile.
			// invalid_request is unrecorded, so the identical intent may succeed
			// only after the explicitly configured exact test policy is restored.
			svc.config.Completion.Checks = map[domain.ACID]VerificationRule{"local": rule}
			beforePolicy := identityDurableCounts(t, db)
			denied := initialHTTPRequest(server(), http.MethodPost, path, acceptedBody, true, true)
			var rejection struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(denied.Body.Bytes(), &rejection); err != nil || denied.Code != http.StatusBadRequest || rejection.Error.Code != command.CodeInvalidRequest {
				t.Fatalf("local-only policy admitted long AC: %d %s %v", denied.Code, denied.Body, err)
			}
			if !reflect.DeepEqual(beforePolicy, identityDurableCounts(t, db)) {
				t.Fatal("missing exact policy rule changed selected durable state")
			}
			svc.config.Completion.Checks = map[domain.ACID]VerificationRule{ac: rule}
			accepted := post(acceptedBody)
			if _, err := svc.MarkReady(t.Context(), operator, command.MarkReady{Metadata: initialMetadata(50, 2), ProjectID: projectID, WorkItemID: workItemID}); err != nil {
				t.Fatal(err)
			}
			run := dispatchAccepted(t, svc, db, command.DispatchRun{Metadata: initialMetadata(51, 3), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"})
			envelope, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(run))
			if err != nil {
				t.Fatal(err)
			}
			scenario, err := fake.NewScenario("success", []fake.Capability{fake.CapabilityStartAck}, []fake.Step{{Tick: 0, Kind: fake.ObservationDispatchReceived}, {Tick: 1, Kind: fake.ObservationStartAcknowledged}, {Tick: 2, Kind: fake.ObservationTerminalSuccess, Artifact: &fake.Artifact{Name: "candidate.txt", MediaType: "text/plain", Bytes: []byte("candidate")}}})
			if err != nil {
				t.Fatal(err)
			}
			adapter, err := fake.NewAdapter([]fake.Capability{fake.CapabilityStartAck}, []fake.Scenario{scenario}, artifacts)
			if err != nil {
				t.Fatal(err)
			}
			fence := fake.Fence{RunID: run, InputDigest: envelope.Fence.InputDigest, LeaseHolder: string(envelope.Fence.Holder), LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration}
			session, observations, err := adapter.Dispatch(t.Context(), fake.DispatchRequest{Fence: fence, ScenarioID: "success"})
			if err != nil {
				t.Fatal(err)
			}
			publish := func(observations []fake.Observation) {
				for _, o := range observations {
					v := RunObservation{Fence: envelope.Fence, Kind: RunObservationKind(o.Kind), ArtifactDigest: o.ArtifactDigest, ArtifactBytes: o.ArtifactBytes}
					if len(v.ArtifactBytes) > 0 {
						v.ArtifactMediaType = "text/plain"
					}
					if _, err := svc.PublishRunObservation(t.Context(), "worker", v); err != nil {
						t.Fatal(err)
					}
				}
			}
			publish(observations)
			for tick := uint64(1); tick <= 2; tick++ {
				observations, err = session.Poll(t.Context(), fake.TickRequest{Fence: fence, Tick: tick})
				if err != nil {
					t.Fatal(err)
				}
				publish(observations)
			}
			if len(session.Transcript()) != 3 {
				t.Fatal("Fake transcript differs")
			}
			candidate := command.SubmitCandidate{Metadata: initialMetadata(60, 4), ProjectID: projectID, WorkItemID: workItemID, RunID: run, Candidate: command.Candidate{ID: "candidate-identity", RunID: run, Digest: domain.HashString("candidate"), InputSubjectDigest: envelope.Fence.InputDigest, CreatedAt: fixedTime(), Artifacts: []command.ArtifactLocator{{Digest: domain.HashString("candidate"), MediaType: "text/plain", ByteLength: 9, Availability: "Present"}}}}
			if _, err = svc.SubmitCandidate(t.Context(), operator, candidate); err != nil {
				t.Fatal(err)
			}
			preparation, err := svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, candidate.Candidate.ID)
			if err != nil {
				t.Fatal(err)
			}
			var prep struct {
				ExpectedVersion uint64         `json:"expected_version"`
				Subject         map[string]any `json:"completion_subject"`
				Digest          string         `json:"completion_subject_digest"`
			}
			if err = json.Unmarshal(preparation, &prep); err != nil {
				t.Fatal(err)
			}
			subject, err := domain.ParseDigest(strings.TrimPrefix(prep.Digest, "sha256:"))
			if err != nil {
				t.Fatal(err)
			}
			human := command.SubmitHumanReport{Metadata: initialMetadata(61, prep.ExpectedVersion), ProjectID: projectID, WorkItemID: workItemID, RunID: run, ReportID: "report_0000000061", SubjectDigest: subject, LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration, Kind: "evidence", MediaType: "text/plain", Content: "evidence", Evidence: &command.HumanEvidenceIntent{ACID: ac, ACRevisionDigest: domain.HashBytes(initialContent), RecipeDigest: svc.config.Completion.RecipeDigest, EnvironmentDigest: rule.EnvironmentDigest, Verdict: "Passing"}}
			for _, invalid := range []string{"illegal space", "illegal\u00a0space", "illegal\u3000space", "illegal/slash", `illegal\slash`} {
				bad := human
				bad.Evidence = new(*human.Evidence)
				bad.Evidence.ACID = domain.ACID(invalid)
				before := identityDurableCounts(t, db)
				_, err := svc.SubmitHumanReport(t.Context(), operator, bad)
				assertCommandError(t, err, command.CodeInvalidRequest)
				if !reflect.DeepEqual(before, identityDurableCounts(t, db)) {
					t.Fatal("invalid human identity wrote rows")
				}
			}
			reportPayload := func(id, kind, content string) map[string]any {
				return map[string]any{"work_item_id": workItemID, "run_id": run, "report_id": id, "completion_subject_digest": prep.Digest, "lease_epoch": envelope.Fence.Epoch, "restore_generation": envelope.Fence.RestoreGeneration, "kind": kind, "media_type": "text/plain", "content": content}
			}
			rp := reportPayload("report_0000000062", "review", "Independent review")
			rp["review"] = map[string]any{"verdict": "Approved"}
			post(wire(62, prep.ExpectedVersion, "SubmitHumanReport", rp))
			ep := reportPayload(human.ReportID, "evidence", human.Content)
			ep["evidence"] = map[string]any{"ac_id": ac, "ac_revision_digest": "sha256:" + human.Evidence.ACRevisionDigest.String(), "recipe_digest": "sha256:" + human.Evidence.RecipeDigest.String(), "environment_digest": "sha256:" + human.Evidence.EnvironmentDigest.String(), "verdict": "Passing"}
			evidenceBody := wire(61, prep.ExpectedVersion, "SubmitHumanReport", ep)
			evidence := post(evidenceBody)
			fixture := command.PublishFixtureEvidence{Metadata: initialMetadata(63, prep.ExpectedVersion), ProjectID: projectID, RunID: run, LeaseEpoch: envelope.Fence.Epoch, RestoreGeneration: envelope.Fence.RestoreGeneration, Evidence: command.Evidence{ID: "fixture-identity", SubjectDigest: subject, ACID: ac, ACRevisionDigest: human.Evidence.ACRevisionDigest, ObservationVerdict: "Passing", ReviewDisposition: "Accepted", Applicability: "Fresh", MaterialAvailability: "Present", VerifierID: operator, VerifierClass: "human", RecipeDigest: human.Evidence.RecipeDigest, EnvironmentDigest: rule.EnvironmentDigest, ObservedAt: fixedTime(), Report: command.ArtifactLocator{Digest: domain.HashString(human.Content), MediaType: human.MediaType, ByteLength: uint64(len(human.Content)), Availability: "Present"}}}
			if _, err = svc.PublishFixtureEvidence(t.Context(), operator, fixture); err != nil {
				t.Fatalf("lawful long fixture evidence: %v", err)
			}
			// The version check records before AC membership. This creates a real
			// historical failure whose exact retry must bypass authority and byte I/O.
			legacy := fixture
			legacy.Metadata = initialMetadata(64, prep.ExpectedVersion+1)
			legacy.Evidence.ID = "legacy-identity"
			legacy.Evidence.ACID = "legacy space/slash"
			failed, err := svc.PublishFixtureEvidence(t.Context(), operator, legacy)
			assertCommandError(t, err, command.CodeVersionConflict)
			before := identityDurableCounts(t, db)
			svc.artifacts = identityNoArtifactIO{t: t}
			delete(svc.config.Completion.Checks, ac)
			replay, err := svc.PublishFixtureEvidence(t.Context(), operator, legacy)
			assertCommandError(t, err, command.CodeVersionConflict)
			if !replay.Replayed || !bytes.Equal(failed.Payload, replay.Payload) || !reflect.DeepEqual(before, identityDurableCounts(t, db)) {
				t.Fatal("legacy fixture failure replay changed")
			}
			svc.config.Completion.Checks[ac] = rule
			svc.artifacts = artifacts
			post(wire(65, prep.ExpectedVersion, "RequestQA", map[string]any{"work_item_id": workItemID, "candidate_id": candidate.Candidate.ID, "completion_subject_digest": prep.Digest}))
			doneBody := wire(66, prep.ExpectedVersion+1, "CompleteWorkItem", map[string]any{"work_item_id": workItemID, "completion_subject": prep.Subject})
			done := post(doneBody)
			item, err := store.LoadWorkItem(t.Context(), projectID, workItemID)
			if err != nil || item.Phase() != domain.PhaseDone {
				t.Fatal("not Done", err)
			}
			var storedAC string
			if err = db.QueryRow("SELECT ac_id FROM evidence WHERE evidence_id=?", human.ReportID).Scan(&storedAC); err != nil || storedAC != tc.id {
				t.Fatal("stored AC identity changed", err)
			}
			counts := identityDurableCounts(t, db)
			var seq int
			var name, filename string
			if err = db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &filename); err != nil {
				t.Fatal(err)
			}
			if err = store.Close(); err != nil {
				t.Fatal(err)
			}
			store, err = sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(filename), filename, fixedTime)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			// Reconstruct the application with the explicit same trusted test policy.
			svc, err = New(store, svc.clock, svc.ids, executorStub{declaration: svc.executorDeclaration}, identityArtifacts{root: artifacts.root}, httpapi.NewHub(), svc.config)
			if err != nil {
				t.Fatal(err)
			}
			for _, retry := range []struct{ body, want []byte }{{acceptedBody, accepted}, {evidenceBody, evidence}, {doneBody, done}} {
				if got := post(retry.body); !bytes.Equal(got, retry.want) {
					t.Fatal("restart changed recorded response")
				}
			}
			if !reflect.DeepEqual(counts, identityDurableCounts(t, db)) {
				t.Fatal("restart replay changed counts")
			}
			_, body, err := svc.ReadHumanReport(t.Context(), operator, projectID, human.ReportID)
			if err != nil || string(body) != human.Content {
				t.Fatal("restart lost human report bytes", err)
			}
			t.Logf("%s AC bytes=%d: real proposal/HTTP acceptance/Fake/human evidence/fixture evidence/HTTP Done and restart replay passed", tc.name, len(tc.id))
		})
	}
}
