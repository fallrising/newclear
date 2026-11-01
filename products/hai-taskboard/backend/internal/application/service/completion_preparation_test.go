package service

import (
	"bytes"
	"context"
	"database/sql"
	json "encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

func TestCompletionPreparation_PolicyPrecedence(t *testing.T) {
	for _, kind := range []string{"missing", "environment", "policy", "recipe", "approval", "base", "class", "independent", "actor", "role", "adapter", "scenario", "corruption", "between_head", "between_version", "between_policy"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 1)
			mutate := func() {
				rule := f.svc.config.Completion.Checks["AC-A"]
				rule.EnvironmentDigest = domain.Digest{}
				switch kind {
				case "missing":
					delete(f.svc.config.Completion.Checks, "AC-A")
					return
				case "policy":
					f.svc.config.Completion.RevisionDigest = domain.HashString("changed")
				case "recipe":
					f.svc.config.Completion.RecipeDigest = domain.HashString("changed")
				case "approval", "between_policy":
					f.svc.config.Completion.ApprovalRequired = !f.svc.config.Completion.ApprovalRequired
				case "base":
					f.svc.config.Completion.IntegrationBaseDigest = domain.HashString("changed")
				case "class":
					rule.VerifierClass = "changed"
				case "independent":
					rule.Independent = !rule.Independent
				case "actor":
					rule.ProhibitedVerifierActor = "changed"
				case "role":
					rule.ProhibitedVerifierRunRole = "changed"
				case "adapter":
					f.svc.executorDeclaration.AdapterVersion = "2"
				case "scenario":
					f.svc.executorDeclaration.Scenarios = []string{"other"}
				case "corruption":
					if _, err := f.db.Exec("DROP TRIGGER run_input_envelopes_no_update; UPDATE run_input_envelopes SET canonical_content=x'7b7d'"); err != nil {
						t.Fatal(err)
					}
				case "between_head":
					if _, err := f.db.Exec("UPDATE work_item_spec_heads SET head_version=head_version+1"); err != nil {
						t.Fatal(err)
					}
				case "between_version":
					if _, err := f.db.Exec("UPDATE work_items SET version=version+1"); err != nil {
						t.Fatal(err)
					}
				}
				f.svc.config.Completion.Checks["AC-A"] = rule
			}
			between := kind == "between_head" || kind == "between_version" || kind == "between_policy"
			if between {
				changed := false
				f.svc.artifacts = changingCurrentArtifacts{base: f.svc.artifacts, after: func() {
					if !changed {
						changed = true
						mutate()
					}
				}}
			} else {
				mutate()
			}
			before := preparationDatabaseSnapshot(t, f.db)
			_, err := f.svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
			if kind == "corruption" {
				if !errors.Is(err, domain.ErrStorageCorruption) {
					t.Fatalf("want corruption, got %v", err)
				}
			} else {
				want := command.CodeStaleSubject
				if kind == "missing" || kind == "environment" {
					want = command.CodePolicyRejected
				}
				failure, ok := errors.AsType[*command.Error](err)
				if !ok || failure.Code != want {
					t.Fatalf("want %s, got %v", want, err)
				}
			}
			if !between && !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
				t.Fatal("preparation wrote database")
			}
			if kind == "missing" {
				err = f.store.Within(t.Context(), func(tx port.Transaction) error {
					_, _, e := f.svc.currentCompletionMaterial(t.Context(), tx, port.CompletionMaterialQuery{ProjectID: projectID, WorkItemID: workItemID, CandidateID: f.candidate.Candidate.ID})
					return e
				})
				failure, ok := errors.AsType[*command.Error](err)
				if !ok || failure.Code != command.CodeStaleSubject {
					t.Fatalf("command semantics changed: %v", err)
				}
			}
		})
	}
}

type preparationSession struct{}

func (preparationSession) Authenticate(context.Context, string) (httpapi.Session, error) {
	return httpapi.Session{ID: "test", Principal: operator}, nil
}
func (preparationSession) AuthorizeProject(_ context.Context, _ httpapi.Session, p domain.ProjectID) error {
	if p != projectID {
		return httpapi.ErrPermissionDenied
	}
	return nil
}
func (preparationSession) AuthorizeCommandResult(context.Context, httpapi.Session, domain.ProjectID, string) error {
	return httpapi.ErrPermissionDenied
}
func (preparationSession) Revoked(httpapi.Session) <-chan struct{} { return nil }
func preparationHTTP(t *testing.T, f currentFlow) *httptest.ResponseRecorder {
	t.Helper()
	server, err := httpapi.NewServer(f.svc, httpapi.UnitCommandResults{Unit: f.svc.unit}, httpapi.PersistedProjections{Store: f.store}, preparationSession{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(projectID)+"/work-items/"+string(workItemID)+"/candidates/"+string(f.candidate.Candidate.ID)+"/completion-preparation", nil)
	r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: "test"})
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	return w
}

// Existing acceptedCurrentFlow performs public first acceptance, Ready, dispatch,
// one deterministic Fake execution and candidate publication in real SQLite.
// Its admission repository/artifact fixtures are explicit local test inputs.
func TestCompletionPreparationHTTP_ExactSnapshotWithoutWrites(t *testing.T) {
	for _, stage := range []int{1, 5} {
		t.Run(map[int]string{1: "Review", 5: "QA"}[stage], func(t *testing.T) {
			f := acceptedCurrentFlow(t, stage)
			before := preparationDatabaseSnapshot(t, f.db)
			exact, err := f.svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				w := preparationHTTP(t, f)
				if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), exact) || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("exact HTTP snapshot: %d %s", w.Code, w.Body)
				}
			}
			var wire struct {
				Expected uint64 `json:"expected_version"`
				Phase    string `json:"phase"`
				Digest   string `json:"completion_subject_digest"`
				Subject  struct {
					Version uint64 `json:"work_item_version"`
				} `json:"completion_subject"`
				Epoch      uint64 `json:"lease_epoch"`
				Generation uint64 `json:"restore_generation"`
			}
			if err = json.Unmarshal(exact, &wire); err != nil {
				t.Fatal(err)
			}
			wantVersion := uint64(5)
			if stage == 5 {
				wantVersion = 6
			}
			if wire.Expected != wantVersion || wire.Subject.Version != 6 || wire.Phase != map[int]string{1: "Review", 5: "QA"}[stage] || wire.Digest != "sha256:"+f.review.Review.SubjectDigest.String() || wire.Epoch != f.review.LeaseEpoch || wire.Generation != f.review.RestoreGeneration {
				t.Fatalf("wrong preparation %s", exact)
			}
			var seq int
			var name, path string
			if err = f.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); err != nil {
				t.Fatal(err)
			}
			if err = f.store.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedTime)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			f.store = reopened
			f.svc.unit = reopened
			w := preparationHTTP(t, f)
			if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), exact) {
				t.Fatalf("reopen changed response %d %s", w.Code, w.Body)
			}
			if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
				t.Fatal("GET changed persisted rows, phase/version, commands, audit, projection or outbox")
			}
		})
	}
}
func TestCompletionPreparationHTTP_StaleAndPolicyRemainDistinct(t *testing.T) {
	for _, stale := range []bool{false, true} {
		f := acceptedCurrentFlow(t, 1)
		delete(f.svc.config.Completion.Checks, "AC-A")
		if stale {
			f.svc.config.Completion.ApprovalRequired = !f.svc.config.Completion.ApprovalRequired
		}
		before := preparationDatabaseSnapshot(t, f.db)
		w := preparationHTTP(t, f)
		want := `"code":"policy_rejected"`
		if stale {
			want = `"code":"stale_subject"`
		}
		if w.Code != 409 || !bytes.Contains(w.Body.Bytes(), []byte(want)) {
			t.Fatalf("classification: %d %s", w.Code, w.Body)
		}
		if !stale && !bytes.Contains(w.Body.Bytes(), []byte(`"details":{"reason":"verification_policy_incomplete"}`)) {
			t.Fatal(w.Body)
		}
		if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
			t.Fatal("error wrote database")
		}
	}
}
func preparationDatabaseSnapshot(t *testing.T, db *sql.DB) []byte {
	t.Helper()
	rows, err := db.Query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var table string
		if err = rows.Scan(&table); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, table)
	}
	if err = rows.Close(); err != nil {
		t.Fatal(err)
	}
	result := map[string][][]any{}
	for _, table := range tables {
		r, e := db.Query(`SELECT * FROM "` + table + `" ORDER BY rowid`)
		if e != nil {
			t.Fatal(e)
		}
		columns, e := r.Columns()
		if e != nil {
			t.Fatal(e)
		}
		for r.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if e = r.Scan(pointers...); e != nil {
				t.Fatal(e)
			}
			result[table] = append(result[table], values)
		}
		if e = r.Err(); e != nil {
			t.Fatal(e)
		}
		if e = r.Close(); e != nil {
			t.Fatal(e)
		}
	}
	data, err := json.Marshal(result, json.Deterministic(true))
	if err != nil {
		t.Fatal(err)
	}
	return data
}
