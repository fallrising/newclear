package main

import (
	"bytes"
	"context"
	"database/sql"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

func runtimeHumanFixture(t *testing.T) (*workerFixture, command.SubmitHumanReport) {
	t.Helper()
	f := newWorkerFixture(t)
	if err := f.worker.scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	a := f.authority(t)
	digest := domain.HashString("local fake result\n")
	m := command.Metadata{CommandID: "cmd_0000000040", IdempotencyKey: "00000000-0000-4000-8000-000000000040", ExpectedVersion: 4, IssuedAt: f.clock.Now(), CorrelationID: "report"}
	_, err := f.worker.commands.SubmitCandidate(t.Context(), "operator", command.SubmitCandidate{Metadata: m, ProjectID: testProjectID, WorkItemID: "wi_0000000001", RunID: f.run, Candidate: command.Candidate{ID: "candidate-report", RunID: f.run, Digest: digest, InputSubjectDigest: a.Run.InputDigest, CreatedAt: f.clock.Now(), Artifacts: []command.ArtifactLocator{{Digest: digest, MediaType: "text/plain", ByteLength: 18, Availability: "Present"}}}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := f.worker.commands.DescribeCompletion(t.Context(), "operator", testProjectID, "wi_0000000001", "candidate-report")
	if err != nil {
		t.Fatal(err)
	}
	var prep struct {
		ExpectedVersion uint64 `json:"expected_version"`
		Digest          string `json:"completion_subject_digest"`
	}
	if err = json.Unmarshal(data, &prep); err != nil {
		t.Fatal(err)
	}
	subject, err := domain.ParseDigest(strings.TrimPrefix(prep.Digest, "sha256:"))
	if err != nil {
		t.Fatal(err)
	}
	m.CommandID = "cmd_0000000050"
	m.IdempotencyKey = "00000000-0000-4000-8000-000000000050"
	m.ExpectedVersion = prep.ExpectedVersion
	return f, command.SubmitHumanReport{Metadata: m, ProjectID: testProjectID, WorkItemID: "wi_0000000001", RunID: f.run, ReportID: "report_0000000050", SubjectDigest: subject, LeaseEpoch: a.Lease.Fence.Epoch, RestoreGeneration: a.RestoreGeneration, Kind: "review", MediaType: "text/markdown", Content: "# Independent review\r\nLooks correct.\n", Review: &command.HumanReviewIntent{Verdict: "Approved"}}
}
func runtimeHumanEvidence(t *testing.T, f *workerFixture, v command.SubmitHumanReport) command.SubmitHumanReport {
	t.Helper()
	var m port.CurrentSpecification
	if err := f.worker.store.Within(t.Context(), func(tx port.Transaction) error {
		var err error
		m, err = tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), v.ProjectID, v.WorkItemID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	v.Kind = "evidence"
	v.Review = nil
	v.Evidence = &command.HumanEvidenceIntent{ACID: "local", ACRevisionDigest: m.Requirements[0].RevisionDigest, RecipeDigest: domain.HashString("local-recipe-v1"), EnvironmentDigest: domain.HashString(port.FakeEnvironmentProfile), Verdict: "Passing"}
	return v
}
func runtimeHumanHTTP(t *testing.T, f *workerFixture, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	authority, err := newLocalSessionAuthority(testSessionToken, "operator")
	if err != nil {
		t.Fatal(err)
	}
	server, err := httpapi.NewServer(f.worker.commands, httpapi.UnitCommandResults{Unit: f.worker.store}, httpapi.PersistedProjections{Store: f.worker.store}, authority, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: testSessionToken})
	r.Header.Set("Origin", "https://taskboard.test")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Range", "bytes=0-1")
	r.Header.Set("If-None-Match", "*")
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	return w
}
func runtimeHumanWire(t *testing.T, v command.SubmitHumanReport) []byte {
	t.Helper()
	payload := map[string]any{"work_item_id": v.WorkItemID, "run_id": v.RunID, "report_id": v.ReportID, "completion_subject_digest": "sha256:" + v.SubjectDigest.String(), "lease_epoch": v.LeaseEpoch, "restore_generation": v.RestoreGeneration, "kind": v.Kind, "media_type": v.MediaType, "content": v.Content}
	if v.Review != nil {
		payload["review"] = v.Review
	}
	if v.Evidence != nil {
		e := v.Evidence
		payload["evidence"] = map[string]any{"ac_id": e.ACID, "ac_revision_digest": "sha256:" + e.ACRevisionDigest.String(), "recipe_digest": "sha256:" + e.RecipeDigest.String(), "environment_digest": "sha256:" + e.EnvironmentDigest.String(), "verdict": e.Verdict}
	}
	b, err := json.Marshal(map[string]any{"command_id": v.CommandID, "idempotency_key": v.IdempotencyKey, "operation": "SubmitHumanReport", "expected_version": v.ExpectedVersion, "issued_at": v.IssuedAt.Format(time.RFC3339Nano), "payload": payload})
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func runtimeHumanDB(t *testing.T, f *workerFixture) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(f.root, "state", "taskboard.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
func runtimeHumanCount(t *testing.T, db *sql.DB, table string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM "` + table + `"`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func runtimeHumanSetApp(t *testing.T, f *workerFixture, artifacts port.ArtifactStore, policy service.CompletionPolicy) {
	t.Helper()
	adapter, err := newLocalFakeAdapter()
	if err != nil {
		t.Fatal(err)
	}
	app, err := service.New(f.worker.store, f.clock, cryptoIDSource{}, adapter, artifacts, httpapi.NewHub(), service.Config{Operator: "operator", IdempotencyTTL: time.Hour, Specification: admittedTestSpecification{}, Completion: policy})
	if err != nil {
		t.Fatal(err)
	}
	f.worker.commands = app
}

type humanArtifactFault struct {
	port.ArtifactStore
	puts  atomic.Int64
	opens atomic.Int64
	put   func(context.Context, io.Reader) (domain.Digest, uint64, error)
	open  func(context.Context, domain.Digest) (io.ReadCloser, error)
}

func (a *humanArtifactFault) Put(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
	a.puts.Add(1)
	if a.put != nil {
		return a.put(ctx, r)
	}
	return a.ArtifactStore.Put(ctx, r)
}
func (a *humanArtifactFault) Open(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
	a.opens.Add(1)
	if a.open != nil {
		return a.open(ctx, d)
	}
	return a.ArtifactStore.Open(ctx, d)
}

func TestHumanReport_SealReplayAndScope(t *testing.T) {
	for _, kind := range []string{"review", "evidence"} {
		t.Run(kind, func(t *testing.T) {
			f, v := runtimeHumanFixture(t)
			if kind == "evidence" {
				v = runtimeHumanEvidence(t, f, v)
			}
			fault := &humanArtifactFault{ArtifactStore: f.artifacts}
			runtimeHumanSetApp(t, f, fault, localCompletionPolicy())
			db := runtimeHumanDB(t, f)
			tables := []string{"human_reports", "reviews", "evidence", "artifacts", "audit_entries", "command_results", "idempotency_records", "projection_events", "outbox", "completion_records"}
			counts := map[string]int{}
			for _, table := range tables {
				counts[table] = runtimeHumanCount(t, db, table)
			}
			body := runtimeHumanWire(t, v)
			path := "/api/v1/projects/" + string(v.ProjectID) + "/commands"
			first := runtimeHumanHTTP(t, f, "POST", path, body)
			if first.Code != 200 {
				t.Fatal(first.Code, first.Body)
			}
			for _, table := range tables {
				want := counts[table]
				if table == "human_reports" || table == "artifacts" || table == "audit_entries" || table == "command_results" || table == "idempotency_records" || table == "projection_events" || table == "reviews" && kind == "review" || table == "evidence" && kind == "evidence" {
					want++
				}
				if got := runtimeHumanCount(t, db, table); got != want {
					t.Fatalf("%s=%d want%d", table, got, want)
				}
			}
			item, err := f.worker.store.LoadWorkItem(t.Context(), v.ProjectID, v.WorkItemID)
			if err != nil || item.Version() != v.ExpectedVersion || item.Phase() != domain.PhaseReview {
				t.Fatal("submission changed phase/version", err)
			}
			var report port.HumanReport
			if err = f.worker.store.Within(t.Context(), func(tx port.Transaction) error {
				var e error
				report, e = tx.(port.HumanReportTransaction).LoadHumanReport(t.Context(), v.ProjectID, v.ReportID)
				return e
			}); err != nil {
				t.Fatal(err)
			}
			if report.Actor != "operator" || report.SubjectDigest != v.SubjectDigest || report.Artifact.Digest != domain.HashString(v.Content) || report.Artifact.ByteLength != uint64(len(v.Content)) || report.Kind != kind {
				t.Fatalf("provenance %+v", report)
			}
			snapshot := runtimeOutputSnapshot(t, f)
			replay := runtimeHumanHTTP(t, f, "POST", path, body)
			if replay.Code != 200 || replay.Body.String() != first.Body.String() || fault.puts.Load() != 1 || !bytes.Equal(snapshot, runtimeOutputSnapshot(t, f)) {
				t.Fatal("replay changed result/state")
			}
			changed := v
			changed.Content += "changed"
			conflict := runtimeHumanHTTP(t, f, "POST", path, runtimeHumanWire(t, changed))
			if conflict.Code != 409 || fault.puts.Load() != 1 {
				t.Fatal("conflicting key touched store", conflict.Code)
			}
			if err = os.Remove(filepath.Join(f.root, "artifacts", "sha256", report.Artifact.Digest.String())); err != nil {
				t.Fatal(err)
			}
			f.reopen(t)
			replay = runtimeHumanHTTP(t, f, "POST", path, body)
			if replay.Code != 200 || replay.Body.String() != first.Body.String() || !bytes.Equal(snapshot, runtimeOutputSnapshot(t, f)) {
				t.Fatal("restart/object loss broke durable replay", replay.Code, replay.Body)
			}
		})
	}
}

func TestHumanReport_ReadAndDownload(t *testing.T) {
	for _, faultKind := range []string{"intact", "missing", "tamper", "symlink"} {
		t.Run(faultKind, func(t *testing.T) {
			f, v := runtimeHumanFixture(t)
			out, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
			if err != nil {
				t.Fatal(err, string(out.Payload))
			}
			digest := domain.HashString(v.Content)
			object := filepath.Join(f.root, "artifacts", "sha256", digest.String())
			switch faultKind {
			case "missing":
				err = os.Remove(object)
			case "tamper":
				err = os.WriteFile(object, []byte("private invalid bytes"), 0600)
			case "symlink":
				outside := filepath.Join(privateTestRoot(t), "outside")
				if err = os.WriteFile(outside, []byte(v.Content), 0600); err == nil {
					err = os.Remove(object)
				}
				if err == nil {
					err = os.Symlink(outside, object)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			// Mutable authority can advance while immutable report history stays readable.
			db := runtimeHumanDB(t, f)
			if _, err = db.Exec("UPDATE instance_state SET restore_generation=restore_generation+1"); err != nil {
				t.Fatal(err)
			}
			before := runtimeOutputSnapshot(t, f)
			entries, err := os.ReadDir(filepath.Dir(object))
			if err != nil {
				t.Fatal(err)
			}
			modes := make([]os.FileMode, len(entries))
			for i, entry := range entries {
				info, err := entry.Info()
				if err != nil {
					t.Fatal(err)
				}
				modes[i] = info.Mode()
			}
			path := "/api/v1/projects/" + string(v.ProjectID) + "/human-reports/" + v.ReportID
			for range 2 {
				metadata := runtimeHumanHTTP(t, f, "GET", path, nil)
				if metadata.Code != 200 || strings.Contains(metadata.Body.String(), v.Content) {
					t.Fatal(metadata.Code, metadata.Body)
				}
				got := runtimeHumanHTTP(t, f, "GET", path+"/content", nil)
				if faultKind == "intact" {
					if got.Code != 200 || got.Body.String() != v.Content {
						t.Fatal(got.Code, got.Body)
					}
					for k, want := range map[string]string{"Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="` + digest.String() + `.bin"`, "Content-Length": fmt.Sprint(len(v.Content)), "ETag": `"sha256:` + digest.String() + `"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "none"} {
						if got.Header().Get(k) != want {
							t.Fatalf("header%s=%q", k, got.Header().Get(k))
						}
					}
				} else if got.Code != 503 || strings.Contains(got.Body.String(), "private") {
					t.Fatal(got.Code, got.Body)
				}
			}
			for _, suffix := range []string{"", "/content"} {
				if got := runtimeHumanHTTP(t, f, "HEAD", path+suffix, nil); got.Code != 405 {
					t.Fatal(got.Code, got.Body)
				}
			}
			for _, bad := range []string{strings.Replace(path, string(v.ProjectID), "prj_0000000002", 1), strings.Replace(path, v.ReportID, "report_0000000099", 1), strings.Replace(path, v.ReportID, "..", 1)} {
				got := runtimeHumanHTTP(t, f, "GET", bad+"/content", nil)
				if got.Code != 404 {
					t.Fatal(got.Code, got.Body)
				}
			}
			if got := runtimeHumanHTTP(t, f, "GET", "/api/v1/projects/"+string(v.ProjectID)+"/artifacts/sha256:"+digest.String(), nil); got.Code != 404 {
				t.Fatal("human report broadened M1b authority", got.Code)
			}
			f.reopen(t)
			if got := runtimeHumanHTTP(t, f, "GET", path, nil); got.Code != 200 {
				t.Fatal(got.Code, got.Body)
			}
			after, err := os.ReadDir(filepath.Dir(object))
			if err != nil || len(entries) != len(after) || !bytes.Equal(before, runtimeOutputSnapshot(t, f)) {
				t.Fatal("reads mutated tables or objects", err)
			}
			for i, entry := range entries {
				if entry.Name() != after[i].Name() || entry.Type() != after[i].Type() {
					t.Fatal("read changed directory entry names/types")
				}
				afterInfo, afterErr := after[i].Info()
				if afterErr != nil || modes[i] != afterInfo.Mode() {
					t.Fatal("read changed directory modes", afterErr)
				}
			}

		})
	}
}

func TestHumanReport_ConcurrentReplay(t *testing.T) {
	f, v := runtimeHumanFixture(t)
	barrier := make(chan struct{})
	var arrived atomic.Int64
	fault := &humanArtifactFault{ArtifactStore: f.artifacts}
	fault.put = func(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
		if arrived.Add(1) == 2 {
			close(barrier)
		}
		select {
		case <-barrier:
		case <-ctx.Done():
			return domain.Digest{}, 0, ctx.Err()
		}
		return f.artifacts.Put(ctx, r)
	}
	runtimeHumanSetApp(t, f, fault, localCompletionPolicy())
	var wg sync.WaitGroup
	results := make(chan command.Outcome, 2)
	errs := make(chan error, 2)
	for range 2 {
		wg.Go(func() {
			out, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
			results <- out
			errs <- err
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	a, b := <-results, <-results
	if !bytes.Equal(a.Payload, b.Payload) || a.Replayed == b.Replayed {
		t.Fatal("concurrent result not one replay")
	}
	db := runtimeHumanDB(t, f)
	if runtimeHumanCount(t, db, "human_reports") != 1 || runtimeHumanCount(t, db, "reviews") != 1 {
		t.Fatal("concurrent publication duplicated rows")
	}
}

type humanFaultReader struct {
	io.Reader
	readErr, closeErr error
}

func (r humanFaultReader) Read(b []byte) (int, error) {
	if r.readErr != nil {
		return 0, r.readErr
	}
	return r.Reader.Read(b)
}
func (r humanFaultReader) Close() error { return r.closeErr }

func TestHumanReport_StorageFaultsAndRollback(t *testing.T) {
	for _, kind := range []string{"put", "put-identity", "open", "read", "close", "bytes", "cancel", "stale", "late-db", "mime-final"} {
		t.Run(kind, func(t *testing.T) {
			f, v := runtimeHumanFixture(t)
			db := runtimeHumanDB(t, f)
			before := runtimeOutputSnapshot(t, f)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			fault := &humanArtifactFault{ArtifactStore: f.artifacts}
			fault.put = func(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
				if kind == "put" {
					return domain.Digest{}, 0, errors.New("private store failure")
				}
				d, n, e := f.artifacts.Put(ctx, r)
				if e != nil {
					return d, n, e
				}
				switch kind {
				case "put-identity":
					return domain.HashString("wrong"), n, nil
				case "cancel":
					cancel()
				case "stale":
					_, e = db.Exec("UPDATE work_items SET version=version+1 WHERE project_id=? AND work_item_id=?", v.ProjectID, v.WorkItemID)
				case "late-db":
					_, e = db.Exec("CREATE TRIGGER human_fail_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT,'injected late failure'); END")
				case "mime-final":
					e = f.worker.store.Within(ctx, func(tx port.Transaction) error {
						return tx.StoreArtifact(ctx, port.Artifact{Digest: d, ByteLength: n, MediaType: "text/plain", Availability: "Present", StorageKey: "sha256:" + d.String()})
					})
				}
				return d, n, e
			}
			if kind == "open" {
				fault.open = func(context.Context, domain.Digest) (io.ReadCloser, error) {
					return nil, errors.New("private open failure")
				}
			}
			if kind == "read" || kind == "close" || kind == "bytes" {
				fault.open = func(context.Context, domain.Digest) (io.ReadCloser, error) {
					r := humanFaultReader{Reader: strings.NewReader(v.Content)}
					switch kind {
					case "read":
						r.readErr = errors.New("private read")
					case "close":
						r.closeErr = errors.New("private close")
					case "bytes":
						r.Reader = strings.NewReader("wrong")
					}
					return r, nil
				}
			}
			runtimeHumanSetApp(t, f, fault, localCompletionPolicy())
			out, err := f.worker.commands.SubmitHumanReport(ctx, "operator", v)
			if err == nil {
				t.Fatal("fault accepted")
			}
			if strings.Contains(string(out.Payload), "private") {
				t.Fatal("error leaked details")
			}
			failure, classified := errors.AsType[*command.Error](err)
			expectedCode := command.CodeStorageCorruption
			switch kind {
			case "put", "open", "cancel":
				expectedCode = command.CodeProjectionUnavailable
			case "stale":
				expectedCode = command.CodeVersionConflict
			case "late-db":
				expectedCode = ""
			}
			if expectedCode == "" {
				if classified {
					t.Fatal("late database failure became a domain decision", err)
				}
			} else if !classified || failure.Code != expectedCode {
				t.Fatalf("%s code=%v want%s", kind, err, expectedCode)
			}

			if runtimeHumanCount(t, db, "human_reports") != 0 || runtimeHumanCount(t, db, "reviews") != 0 {
				t.Fatal("failure published semantic authority")
			}
			var results int
			if err = db.QueryRow("SELECT count(*) FROM command_results WHERE command_id=?", v.CommandID).Scan(&results); err != nil {
				t.Fatal(err)
			}
			want := 0
			if kind == "stale" {
				want = 1
			}
			if results != want {
				t.Fatalf("recorded=%d want%d", results, want)
			}
			runtimeHumanRecorded(t, db, v, want)
			if kind != "stale" && kind != "mime-final" && !bytes.Equal(before, runtimeOutputSnapshot(t, f)) {
				t.Fatal("failure changed database")
			}
			if kind == "late-db" {
				if _, err = db.Exec("DROP TRIGGER human_fail_audit"); err != nil {
					t.Fatal(err)
				}
			}
			path := "/api/v1/projects/" + string(v.ProjectID) + "/human-reports/" + v.ReportID + "/content"
			if got := runtimeHumanHTTP(t, f, "GET", path, nil); got.Code != 404 {
				t.Fatal("orphan grants read authority", got.Code)
			}
			if kind != "stale" && kind != "mime-final" {
				runtimeHumanSetApp(t, f, f.artifacts, localCompletionPolicy())
				if _, err = f.worker.commands.SubmitHumanReport(t.Context(), "operator", v); err != nil {
					t.Fatal("same-key healthy retry failed", err)
				}
			}
		})
	}
}

func TestHumanReport_PreflightGuards(t *testing.T) {
	for _, kind := range []string{"actor", "version", "subject", "fence", "work", "unknown-ac", "revision", "recipe", "environment", "nonhuman", "dependent", "zero-env", "prohibited-actor", "prohibited-role", "mime", "semantic-id"} {
		t.Run(kind, func(t *testing.T) {
			f, v := runtimeHumanFixture(t)
			v = runtimeHumanEvidence(t, f, v)
			actor := domain.ActorID("operator")
			policy := localCompletionPolicy()
			rule := policy.Checks["local"]
			switch kind {
			case "actor":
				actor = "forged"
			case "version":
				v.ExpectedVersion++
			case "subject":
				v.SubjectDigest = domain.HashString("wrong")
			case "fence":
				v.LeaseEpoch++
			case "work":
				v.WorkItemID = "wi_0000000002"
			case "unknown-ac":
				v.Evidence.ACID = "unknown"
			case "revision":
				v.Evidence.ACRevisionDigest = domain.HashString("wrong")
			case "recipe":
				v.Evidence.RecipeDigest = domain.HashString("wrong")
			case "environment":
				v.Evidence.EnvironmentDigest = domain.HashString("wrong")
			case "nonhuman":
				rule.VerifierClass = "independent"
			case "dependent":
				rule.Independent = false
			case "zero-env":
				rule.EnvironmentDigest = domain.Digest{}
			case "prohibited-actor":
				rule.ProhibitedVerifierActor = "operator"
			case "prohibited-role":
				rule.ProhibitedVerifierRunRole = "human"
			case "mime":
				err := f.worker.store.Within(t.Context(), func(tx port.Transaction) error {
					d := domain.HashString(v.Content)
					return tx.StoreArtifact(t.Context(), port.Artifact{Digest: d, MediaType: "text/plain", ByteLength: uint64(len(v.Content)), StorageKey: "sha256:" + d.String(), Availability: "Present"})
				})
				if err != nil {
					t.Fatal(err)
				}
			case "semantic-id":
				err := f.worker.store.Within(t.Context(), func(tx port.Transaction) error {
					return tx.StoreReview(t.Context(), port.Review{ID: domain.ReviewID(v.ReportID), ProjectID: v.ProjectID, SubjectDigest: v.SubjectDigest, Verdict: "Approved", Reviewer: "operator", Independent: true, CreatedAtNS: f.clock.Now().UnixNano()})
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			policy.Checks["local"] = rule
			fault := &humanArtifactFault{ArtifactStore: f.artifacts}
			runtimeHumanSetApp(t, f, fault, policy)
			before := runtimeOutputSnapshot(t, f)
			out, err := f.worker.commands.SubmitHumanReport(t.Context(), actor, v)
			if err == nil || fault.puts.Load() != 0 || fault.opens.Load() != 0 || !bytes.Equal(before, runtimeOutputSnapshot(t, f)) {
				t.Fatal("preflight touched state/store", err, string(out.Payload), fault.puts.Load())
			}
			expectedCode := map[string]string{"actor": command.CodePermissionDenied, "version": command.CodeVersionConflict, "subject": command.CodeStaleSubject, "fence": command.CodeStaleSubject, "work": command.CodeNotFound, "unknown-ac": command.CodePermissionDenied, "revision": command.CodeStaleSubject, "recipe": command.CodePermissionDenied, "environment": command.CodePermissionDenied, "nonhuman": command.CodePermissionDenied, "dependent": command.CodePermissionDenied, "zero-env": command.CodePermissionDenied, "prohibited-actor": command.CodePermissionDenied, "prohibited-role": command.CodePermissionDenied, "mime": command.CodeStorageCorruption, "semantic-id": command.CodeIdempotencyConflict}[kind]
			failure, classified := errors.AsType[*command.Error](err)
			if !classified || failure.Code != expectedCode {
				t.Fatalf("%s code=%v want%s", kind, err, expectedCode)
			}
			runtimeHumanRecorded(t, runtimeHumanDB(t, f), v, 0)
			if kind == "nonhuman" || kind == "dependent" || kind == "zero-env" || strings.HasPrefix(kind, "prohibited") || kind == "unknown-ac" {
				e, ok := errors.AsType[*command.Error](err)
				if !ok || e.Code != command.CodePermissionDenied {
					t.Fatal("policy wrong rejection", err)
				}
			}
		})
	}
}

func TestHumanReport_CapacityRaceAndReplay(t *testing.T) {
	for _, kind := range []string{"at-limit", "preflight-full", "final-full", "replay-full"} {
		t.Run(kind, func(t *testing.T) {
			f, v := runtimeHumanFixture(t)
			db := runtimeHumanDB(t, f)
			fill := func(n int) error {
				return f.worker.store.Within(t.Context(), func(tx port.Transaction) error {
					for i := range n {
						if err := tx.StoreReview(t.Context(), port.Review{ID: domain.ReviewID(fmt.Sprintf("capacity-%d", i)), ProjectID: v.ProjectID, SubjectDigest: v.SubjectDigest, Verdict: "Approved", Reviewer: "operator", Independent: true, CreatedAtNS: f.clock.Now().UnixNano()}); err != nil {
							return err
						}
					}
					return nil
				})
			}
			var original []byte
			if kind == "replay-full" {
				out, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
				if err != nil {
					t.Fatal(err)
				}
				original = out.Payload
			}
			fault := &humanArtifactFault{ArtifactStore: f.artifacts}
			if kind == "final-full" {
				fault.put = func(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
					d, n, err := f.artifacts.Put(ctx, r)
					if err == nil {
						err = fill(1024)
					}
					return d, n, err
				}
			} else {
				n := 1024
				if kind == "at-limit" || kind == "replay-full" {
					n = 1023
				}
				if err := fill(n); err != nil {
					t.Fatal(err)
				}
			}
			runtimeHumanSetApp(t, f, fault, localCompletionPolicy())
			out, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
			if kind == "at-limit" || kind == "replay-full" {
				if err != nil {
					t.Fatal(err)
				}
				if kind == "replay-full" && (!out.Replayed || !bytes.Equal(original, out.Payload) || fault.puts.Load() != 0) {
					t.Fatal("capacity blocked replay")
				}
				if runtimeHumanCount(t, db, "reviews") != 1024 || runtimeHumanCount(t, db, "human_reports") != 1 {
					t.Fatal("at-limit publication wrong")
				}
				return
			}
			e, ok := errors.AsType[*command.Error](err)
			if !ok || e.Code != command.CodeLifecycleRejected {
				t.Fatal("capacity did not fail lifecycle", err)
			}
			var n int
			if err = db.QueryRow("SELECT count(*) FROM command_results WHERE command_id=?", v.CommandID).Scan(&n); err != nil {
				t.Fatal(err)
			}
			want := 0
			if kind == "final-full" {
				want = 1
			}
			if n != want || fault.puts.Load() != int64(want) || runtimeHumanCount(t, db, "human_reports") != 0 || runtimeHumanCount(t, db, "reviews") != 1024 {
				t.Fatal("capacity race recording wrong", n, fault.puts.Load())
			}
			runtimeHumanRecorded(t, db, v, want)
		})
	}
}

func TestHumanReport_IndependentScopesAndPhases(t *testing.T) {
	f, v := runtimeHumanFixture(t)
	first, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
	if err != nil {
		t.Fatal(err)
	}
	// A second report may reuse exact immutable bytes, but has its own identity.
	second := v
	second.CommandID = "cmd_0000000051"
	second.IdempotencyKey = "00000000-0000-4000-8000-000000000051"
	second.ReportID = "report_0000000051"
	if _, err = f.worker.commands.SubmitHumanReport(t.Context(), "operator", second); err != nil {
		t.Fatal(err)
	}
	second.CommandID = "cmd_0000000052"
	second.IdempotencyKey = "00000000-0000-4000-8000-000000000052"
	if _, err = f.worker.commands.SubmitHumanReport(t.Context(), "operator", second); err == nil {
		t.Fatal("same report id accepted new intent")
	} else if e, ok := errors.AsType[*command.Error](err); !ok || e.Code != command.CodeIdempotencyConflict {
		t.Fatal("wrong report-ID collision code", err)
	}
	qa := command.RequestQA{Metadata: command.Metadata{CommandID: "cmd_0000000053", IdempotencyKey: "00000000-0000-4000-8000-000000000053", ExpectedVersion: v.ExpectedVersion, IssuedAt: f.clock.Now(), CorrelationID: "report"}, ProjectID: v.ProjectID, WorkItemID: v.WorkItemID, CandidateID: "candidate-report", SubjectDigest: v.SubjectDigest}
	if _, err = f.worker.commands.RequestQA(t.Context(), "operator", qa); err != nil {
		t.Fatal(err)
	}
	third := v
	third.CommandID = "cmd_0000000054"
	third.IdempotencyKey = "00000000-0000-4000-8000-000000000054"
	third.ReportID = "report_0000000054"
	third.ExpectedVersion++
	if _, err = f.worker.commands.SubmitHumanReport(t.Context(), "operator", third); err == nil {
		t.Fatal("review permitted in QA")
	} else if e, ok := errors.AsType[*command.Error](err); !ok || e.Code != command.CodeLifecycleRejected {
		t.Fatal("wrong Review-in-QA code", err)
	}
	third = runtimeHumanEvidence(t, f, third)
	if _, err = f.worker.commands.SubmitHumanReport(t.Context(), "operator", third); err != nil {
		t.Fatal("evidence refused in QA", err)
	}
	// An old acknowledged report still replays even after phase/version advancement.
	out, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
	if err != nil || !out.Replayed || !bytes.Equal(out.Payload, first.Payload) {
		t.Fatal("historical replay changed", err)
	}
}

func TestHumanReport_IntentSnapshotAndOutsideTransactionIO(t *testing.T) {
	f, v := runtimeHumanFixture(t)
	original := *v.Review
	fault := &humanArtifactFault{ArtifactStore: f.artifacts}
	fault.put = func(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
		v.Review.Verdict = "ChangesRequested"
		return f.artifacts.Put(ctx, r)
	}
	fault.open = func(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
		// Taking a separate writer transaction here would time out if Open happened
		// while the submission still held SQLite's writer lock.
		if err := f.worker.store.Within(ctx, func(tx port.Transaction) error { _, err := tx.LoadWorkItem(ctx, v.ProjectID, v.WorkItemID); return err }); err != nil {
			return nil, err
		}
		return f.artifacts.Open(ctx, d)
	}
	runtimeHumanSetApp(t, f, fault, localCompletionPolicy())
	if _, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v); err != nil {
		t.Fatal(err)
	}
	db := runtimeHumanDB(t, f)
	var verdict string
	if err := db.QueryRow("SELECT verdict FROM reviews WHERE project_id=? AND review_id=?", v.ProjectID, v.ReportID).Scan(&verdict); err != nil || verdict != original.Verdict {
		t.Fatal("external I/O changed canonical intent", verdict, err)
	}
	// The download's Open also runs without a writer lock.
	if _, body, err := f.worker.commands.ReadHumanReport(t.Context(), "operator", v.ProjectID, v.ReportID); err != nil || string(body) != v.Content {
		t.Fatal(err)
	}
}

func runtimeHumanRecorded(t *testing.T, db *sql.DB, v command.SubmitHumanReport, want int) {
	t.Helper()
	var results, keys int
	if err := db.QueryRow("SELECT count(*) FROM command_results WHERE project_id=? AND command_id=?", v.ProjectID, v.CommandID).Scan(&results); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT count(*) FROM idempotency_records WHERE principal_id='operator' AND project_id=? AND operation='SubmitHumanReport' AND idempotency_key=?", v.ProjectID, v.IdempotencyKey).Scan(&keys); err != nil {
		t.Fatal(err)
	}
	if results != want || keys != want {
		t.Fatalf("result/idempotency rows=%d/%d want%d", results, keys, want)
	}
}

func runtimeHumanMaterial(t *testing.T, f *workerFixture, v command.SubmitHumanReport) port.CompletionMaterial {
	t.Helper()
	var m port.CompletionMaterial
	if err := f.worker.store.Within(t.Context(), func(tx port.Transaction) error {
		var err error
		m, err = tx.LoadCompletionMaterial(t.Context(), port.CompletionMaterialQuery{ProjectID: v.ProjectID, WorkItemID: v.WorkItemID, RunID: v.RunID, CandidateID: "candidate-report", SubjectDigest: v.SubjectDigest, MaximumRecords: 1024})
		if err != nil {
			return err
		}
		current, err := tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), v.ProjectID, v.WorkItemID)
		m.RequiredACRevisions = current.Requirements
		m.GraphRevisionDigest = current.GraphRevisionDigest
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestHumanReport_PostIOSnapshotDecisions(t *testing.T) {
	for _, kind := range []string{"material-only", "count-only", "final-conflict"} {
		t.Run(kind, func(t *testing.T) {
			f, v := runtimeHumanFixture(t)
			db := runtimeHumanDB(t, f)
			other := port.HumanReport{ProjectID: v.ProjectID, WorkItemID: v.WorkItemID, RunID: v.RunID, ID: "report_0000000080", Kind: "review", SubjectDigest: v.SubjectDigest, Actor: "operator", CreatedAtNS: f.clock.Now().UnixNano(), LeaseEpoch: v.LeaseEpoch, RestoreGeneration: v.RestoreGeneration, Artifact: port.Artifact{Digest: domain.HashString("seeded independent report"), MediaType: "text/plain", ByteLength: uint64(len("seeded independent report")), Availability: "Present", StorageKey: "sha256:" + domain.HashString("seeded independent report").String()}}
			review := port.Review{ID: domain.ReviewID(other.ID), ProjectID: v.ProjectID, SubjectDigest: v.SubjectDigest, Verdict: "Approved", Reviewer: "operator", Independent: true, CreatedAtNS: other.CreatedAtNS}
			if kind == "count-only" {
				if _, _, err := f.artifacts.Put(t.Context(), strings.NewReader("seeded independent report")); err != nil {
					t.Fatal(err)
				}
				if err := f.worker.store.Within(t.Context(), func(tx port.Transaction) error {
					if err := tx.StoreArtifact(t.Context(), other.Artifact); err != nil {
						return err
					}
					return tx.StoreReview(t.Context(), review)
				}); err != nil {
					t.Fatal(err)
				}
			}
			before := runtimeHumanMaterial(t, f, v)
			authority := f.authority(t)
			fault := &humanArtifactFault{ArtifactStore: f.artifacts}
			fault.put = func(ctx context.Context, r io.Reader) (domain.Digest, uint64, error) {
				d, n, err := f.artifacts.Put(ctx, r)
				if err != nil {
					return d, n, err
				}
				err = f.worker.store.Within(ctx, func(tx port.Transaction) error {
					if kind == "count-only" {
						return tx.(port.HumanReportTransaction).StoreHumanReport(ctx, other)
					}
					added := review
					if kind == "final-conflict" {
						added.ID = domain.ReviewID(v.ReportID)
					}
					return tx.StoreReview(ctx, added)
				})
				return d, n, err
			}
			runtimeHumanSetApp(t, f, fault, localCompletionPolicy())
			out, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
			e, ok := errors.AsType[*command.Error](err)
			wantCode := command.CodeStaleSubject
			wantRows := 1
			if kind == "final-conflict" {
				wantCode = command.CodeIdempotencyConflict
				wantRows = 0
			}
			if !ok || e.Code != wantCode {
				t.Fatalf("%s=%v want%s", kind, err, wantCode)
			}
			after := runtimeHumanMaterial(t, f, v)
			if before.WorkItem.Version() != after.WorkItem.Version() || authority != f.authority(t) {
				t.Fatal("unrelated version or authority guard masked snapshot comparison")
			}
			if kind == "count-only" && !reflect.DeepEqual(before, after) {
				t.Fatal("material drift masked count-only comparison")
			}
			if kind == "material-only" && reflect.DeepEqual(before, after) {
				t.Fatal("material drift was not established")
			}
			runtimeHumanRecorded(t, db, v, wantRows)
			var submitted int
			if err := db.QueryRow("SELECT count(*) FROM human_reports WHERE project_id=? AND report_id=?", v.ProjectID, v.ReportID).Scan(&submitted); err != nil || submitted != 0 {
				t.Fatal("stale command published its report", err)
			}
			if wantRows == 1 {
				retry, retryErr := f.worker.commands.SubmitHumanReport(t.Context(), "operator", v)
				re, ok := errors.AsType[*command.Error](retryErr)
				if !ok || re.Code != command.CodeStaleSubject || !retry.Replayed || !bytes.Equal(retry.Payload, out.Payload) || fault.puts.Load() != 1 {
					t.Fatal("recorded stale decision did not replay before Put", retryErr)
				}
				runtimeHumanRecorded(t, db, v, 1)
			} else {
				// An unrecorded final conflict leaves the key available for corrected intent.
				fixed := v
				fixed.ReportID = "report_0000000081"
				runtimeHumanSetApp(t, f, f.artifacts, localCompletionPolicy())
				if _, err = f.worker.commands.SubmitHumanReport(t.Context(), "operator", fixed); err != nil {
					t.Fatal("unrecorded conflict consumed key", err)
				}
				runtimeHumanRecorded(t, db, fixed, 1)
			}
		})
	}
}

func TestHumanReport_CompletionConsumesHumanRecords(t *testing.T) {
	for _, kind := range []string{"complete", "missing-evidence", "missing-review", "changes-requested"} {
		t.Run(kind, func(t *testing.T) {
			f, review := runtimeHumanFixture(t)
			metadata := func(n int, version uint64) command.Metadata {
				return command.Metadata{CommandID: fmt.Sprintf("cmd_00000000%02d", n), IdempotencyKey: fmt.Sprintf("00000000-0000-4000-8000-%012d", n), ExpectedVersion: version, IssuedAt: f.clock.Now(), CorrelationID: "human-completion"}
			}
			if _, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", review); err != nil {
				t.Fatal(err)
			}
			evidence := runtimeHumanEvidence(t, f, review)
			evidence.Metadata = metadata(61, review.ExpectedVersion)
			evidence.ReportID = "report_0000000061"
			evidence.Content = "Acceptance check local: independently verified and passing.\n"
			if domain.HashString(review.Content) == domain.HashString(evidence.Content) {
				t.Fatal("test must isolate Review and Evidence bytes")
			}
			if _, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", evidence); err != nil {
				t.Fatal(err)
			}
			if kind == "changes-requested" {
				f.clock.now = f.clock.now.Add(time.Nanosecond)
				rejected := review
				rejected.Metadata = metadata(62, review.ExpectedVersion)
				rejected.ReportID = "report_0000000062"
				rejected.Content = "A later independent review requests changes.\n"
				rejected.Review = &command.HumanReviewIntent{Verdict: "ChangesRequested"}
				if _, err := f.worker.commands.SubmitHumanReport(t.Context(), "operator", rejected); err != nil {
					t.Fatal(err)
				}
				var verdict string
				if err := runtimeHumanDB(t, f).QueryRow("SELECT verdict FROM reviews WHERE project_id=? AND review_id=?", review.ProjectID, rejected.ReportID).Scan(&verdict); err != nil || verdict != "Rejected" {
					t.Fatal("ChangesRequested semantic verdict", verdict, err)
				}
			}
			m := runtimeHumanMaterial(t, f, review)
			revisions := make([]domain.ACRevisionBinding, len(m.RequiredACRevisions))
			for i, r := range m.RequiredACRevisions {
				revisions[i] = domain.ACRevisionBinding{ACID: r.ACID, RevisionDigest: r.RevisionDigest}
			}
			policy := localCompletionPolicy()
			subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: review.ProjectID, WorkItemID: review.WorkItemID, WorkItemVersion: review.ExpectedVersion + 1, CandidateID: m.Candidate.ID, CandidateDigest: m.Candidate.Digest, RunID: m.Run.ID, RunInputDigest: m.Run.InputDigest, RequiredACRevisions: revisions, AcceptedGraphRevisionDigest: m.GraphRevisionDigest, PolicyRevisionDigest: policy.RevisionDigest, CompletionRecipeDigest: policy.RecipeDigest})
			if err != nil || subject.Digest() != review.SubjectDigest {
				t.Fatal("completion subject precondition", err)
			}
			if _, err = f.worker.commands.RequestQA(t.Context(), "operator", command.RequestQA{Metadata: metadata(63, review.ExpectedVersion), ProjectID: review.ProjectID, WorkItemID: review.WorkItemID, CandidateID: m.Candidate.ID, SubjectDigest: subject.Digest()}); err != nil {
				t.Fatal("human Review did not authorize QA", err)
			}
			if _, err = f.worker.commands.ApproveSubject(t.Context(), "operator", command.ApproveSubject{Metadata: metadata(64, review.ExpectedVersion+1), ProjectID: review.ProjectID, WorkItemID: review.WorkItemID, CandidateID: m.Candidate.ID, RequestID: "approval-human", SubjectDigest: subject.Digest(), Decision: "Approved"}); err != nil {
				t.Fatal("human Review did not authorize approval", err)
			}
			if kind == "missing-evidence" || kind == "missing-review" {
				content := evidence.Content
				if kind == "missing-review" {
					content = review.Content
				}
				if err = os.Remove(filepath.Join(f.root, "artifacts", "sha256", domain.HashString(content).String())); err != nil {
					t.Fatal(err)
				}
			}
			_, err = f.worker.commands.CompleteWorkItem(t.Context(), "operator", command.CompleteWorkItem{Metadata: metadata(65, review.ExpectedVersion+1), ProjectID: review.ProjectID, WorkItemID: review.WorkItemID, Subject: subject})
			db := runtimeHumanDB(t, f)
			item, itemErr := f.worker.store.LoadWorkItem(t.Context(), review.ProjectID, review.WorkItemID)
			if itemErr != nil {
				t.Fatal(itemErr)
			}
			if kind == "missing-evidence" || kind == "changes-requested" {
				reason := domain.CodeEvidenceUnavailable
				if kind == "changes-requested" {
					reason = domain.CodeReviewRejected
				}
				failure, ok := errors.AsType[*command.Error](err)
				if !ok || failure.Code != command.CodeDoneGateUnsatisfied || !slices.Equal(failure.Reasons, []domain.RejectionCode{reason}) {
					t.Fatal("wrong isolated completion rejection", err)
				}
				if item.Phase() != domain.PhaseQA || item.Version() != review.ExpectedVersion+1 {
					t.Fatal("rejected completion changed work item")
				}
				for _, table := range []string{"completion_records", "completion_record_reviews", "completion_record_evidence", "completion_record_approvals", "approval_consumptions"} {
					if runtimeHumanCount(t, db, table) != 0 {
						t.Fatal("rejected completion wrote", table)
					}
				}
				return
			}
			if err != nil || item.Phase() != domain.PhaseDone || item.Version() != review.ExpectedVersion+2 {
				t.Fatal("human reports did not complete current work item", err)
			}
			var reviewID, evidenceID string
			if err = db.QueryRow("SELECT review_id FROM completion_record_reviews WHERE project_id=?", review.ProjectID).Scan(&reviewID); err != nil {
				t.Fatal(err)
			}
			if err = db.QueryRow("SELECT evidence_id FROM completion_record_evidence WHERE project_id=?", review.ProjectID).Scan(&evidenceID); err != nil {
				t.Fatal(err)
			}
			if reviewID != string(review.ReportID) || evidenceID != string(evidence.ReportID) || runtimeHumanCount(t, db, "completion_records") != 1 {
				t.Fatal("completion omitted submitted human report identities", reviewID, evidenceID)
			}
		})
	}
}
