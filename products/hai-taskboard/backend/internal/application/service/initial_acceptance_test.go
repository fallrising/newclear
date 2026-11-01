package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

var initialContent = []byte("The operator explicitly accepts this exact AC.\n")

func TestAdmission_InitialAcceptanceImmutableDedupKeys(t *testing.T) {
	for _, mode := range []string{"exact_legacy", "occupied_id", "both_keys"} {
		t.Run(mode, func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			d := domain.HashBytes(initialContent)
			stable := "ac_initial_" + domain.HashString(string(projectID)+"\x00AC-A\x00"+d.String()).String()
			err := store.Within(t.Context(), func(tx port.Transaction) error {
				if mode != "occupied_id" {
					if err := tx.StoreACRevision(t.Context(), port.ACRevision{ID: "legacy_exact", ProjectID: projectID, ACID: "AC-A", Digest: d, Content: bytes.Clone(initialContent), CreatedAtNS: 1}); err != nil {
						return err
					}
				}
				if mode != "exact_legacy" {
					return tx.StoreACRevision(t.Context(), port.ACRevision{ID: stable, ProjectID: projectID, ACID: "AC-OTHER", Digest: domain.HashString("other"), Content: []byte("other"), CreatedAtNS: 1})
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			before := initialCounts(t, db)
			_, err = svc.AcceptInitialSpecification(t.Context(), operator, q)
			if mode == "exact_legacy" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				if err == nil {
					t.Fatal("acceptance ignored occupied deterministic immutable AC identity")
				}
				if after := initialCounts(t, db); !reflect.DeepEqual(before, after) {
					t.Fatalf("rejected collision changed durable state: %v -> %v", before, after)
				}
			}
		})
	}
}

func initialMetadata(n int, v uint64) command.Metadata {
	return command.Metadata{CommandID: fmt.Sprintf("cmd_01HABCDEF%02d", n), IdempotencyKey: fmt.Sprintf("00000000-0000-4000-8000-%012d", n), ExpectedVersion: v, IssuedAt: fixedTime(), CorrelationID: "initial"}
}
func initialReader(t *testing.T, content []byte, extra ...domain.WorkItemID) *fakeReader {
	return initialReaderAC(t, content, "AC-A", extra...)
}
func initialReaderAC(t *testing.T, content []byte, ac domain.ACID, extra ...domain.WorkItemID) *fakeReader {
	t.Helper()
	format := specification.SHA1
	manifest := strings.ReplaceAll(literalManifest, "wi_A", string(workItemID))
	encodedAC, err := json.Marshal(ac)
	if err != nil {
		t.Fatal(err)
	}
	manifest = strings.ReplaceAll(manifest, `"AC-A"`, string(encodedAC))
	for _, id := range extra {
		manifest = strings.Replace(manifest, `"work_item_ids":["`+string(workItemID)+`"`, `"work_item_ids":["`+string(workItemID)+`","`+string(id)+`"`, 1)
	}
	manifest = strings.ReplaceAll(manifest, strings.Repeat("1", 64), domain.HashBytes(content).String())
	manifest = strings.ReplaceAll(manifest, strings.Repeat("2", 64), domain.HashString("initial recipe").String())
	objects := map[specification.ObjectID]specification.Object{}
	add := func(kind specification.ObjectKind, data []byte) specification.ObjectID {
		id := fixtureID(t, format, independentHash(format, kind, data))
		objects[id] = specification.Object{Kind: kind, Data: data}
		return id
	}
	source := add(specification.BlobObject, []byte(literalSource))
	mf := add(specification.BlobObject, []byte(manifest))
	tree := []byte{}
	for _, e := range []struct {
		name string
		id   specification.ObjectID
	}{{"a.md", source}, {"manifest.json", mf}} {
		raw, _ := hex.DecodeString(e.id.String())
		tree = append(tree, []byte("100644 "+e.name+"\x00")...)
		tree = append(tree, raw...)
	}
	tr := add(specification.TreeObject, tree)
	co := add(specification.CommitObject, []byte("tree "+tr.String()+"\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\ninitial\n"))
	return &fakeReader{snapshot: &fakeSnapshot{commit: co, objects: objects}}
}
func initialFixture(t *testing.T) (*Service, *sqlite.Store, *sql.DB, command.AcceptInitialSpecification) {
	return initialFixtureContent(t, initialContent)
}
func initialFixtureContent(t *testing.T, content []byte, extra ...domain.WorkItemID) (*Service, *sqlite.Store, *sql.DB, command.AcceptInitialSpecification) {
	return initialFixtureContentAC(t, content, "AC-A", extra...)
}
func initialFixtureContentAC(t *testing.T, content []byte, ac domain.ACID, extra ...domain.WorkItemID) (*Service, *sqlite.Store, *sql.DB, command.AcceptInitialSpecification) {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "initial.db")
	store, e := sqlite.OpenAtRootWithClock(t.Context(), root, path, fixedTime)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { store.Close() })
	db, e := sql.Open("sqlite", path)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	svc := testService(t, newMemoryUnit(), true)
	svc.unit = store
	if _, e = svc.CreateProject(t.Context(), operator, command.CreateProject{Metadata: initialMetadata(10, 0), ProjectID: projectID, Name: "Project", RepositoryRoot: "legacy", ApprovedRef: "main"}); e != nil {
		t.Fatal(e)
	}
	if _, e = svc.CreateWorkItem(t.Context(), operator, command.CreateWorkItem{Metadata: initialMetadata(11, 0), ProjectID: projectID, WorkItemID: workItemID, Title: "Empty Draft", Goal: "Explicit initial acceptance", OwnerID: operator, RequiredACRevisions: []command.ACRevision{}}); e != nil {
		t.Fatalf("valid empty Draft bootstrap rejected before first acceptance: %v", e)
	}
	for i, id := range extra {
		if _, e = svc.CreateWorkItem(t.Context(), operator, command.CreateWorkItem{Metadata: initialMetadata(30+i, 0), ProjectID: projectID, WorkItemID: id, Title: "Mapped Draft", Goal: "Exact union", OwnerID: operator, RequiredACRevisions: []command.ACRevision{}}); e != nil {
			t.Fatal(e)
		}
	}
	a := port.ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: projectID, ID: "binding", Version: 1, ObjectFormat: specification.SHA1}, ConfigurationID: "initial-repo", ApprovedBy: operator, Refs: []string{"refs/heads/main"}, ManifestPaths: []string{"manifest.json"}, Reader: initialReaderAC(t, content, ac, extra...)}
	_, a.Binding.Digest, e = port.CanonicalRepositoryBinding(a)
	if e != nil {
		t.Fatal(e)
	}
	svc.config.RepositoryAuthority = fixedRepository{a}
	svc.config.Completion.RecipeDigest = domain.HashString("initial recipe")
	svc.config.Completion.Checks = map[domain.ACID]VerificationRule{ac: {VerifierClass: "test"}}
	out, e := svc.ProposeSpecification(t.Context(), operator, command.ProposeSpecification{Metadata: initialMetadata(12, 1), ProjectID: projectID, BindingID: "binding", BindingVersion: 1, BindingDigest: a.Binding.Digest, Ref: "refs/heads/main", ManifestPath: "manifest.json"})
	if e != nil {
		t.Fatal(e)
	}
	var result struct {
		Result struct {
			Proposal string `json:"proposal_digest"`
		} `json:"result"`
	}
	if e = json.Unmarshal(out.Payload, &result); e != nil {
		t.Fatal(e)
	}
	pd, e := domain.ParseDigest(strings.TrimPrefix(result.Result.Proposal, "sha256:"))
	if e != nil {
		t.Fatal(e)
	}
	q := command.AcceptInitialSpecification{Metadata: initialMetadata(13, 1), ProjectID: projectID, ProposalDigest: pd, PolicyRevisionDigest: svc.config.Completion.RevisionDigest, WorkItems: []port.InitialWorkItemVersion{{WorkItemID: workItemID, ExpectedVersion: 1}}, ACContents: []command.InitialACContent{{ACID: ac, Content: bytes.Clone(content)}}}
	for _, id := range extra {
		q.WorkItems = append(q.WorkItems, port.InitialWorkItemVersion{WorkItemID: id, ExpectedVersion: 1})
	}
	if e = store.Within(t.Context(), func(tx port.Transaction) error {
		p, e := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), projectID, pd)
		if e != nil {
			return e
		}
		_, q.AcceptanceSubjectDigest, e = port.CanonicalInitialAcceptanceSubject(port.NewInitialAcceptanceSubject(projectID, 1, p, q.PolicyRevisionDigest, q.WorkItems))
		return e
	}); e != nil {
		t.Fatal(e)
	}
	return svc, store, db, q
}
func initialCounts(t *testing.T, db *sql.DB) []int {
	t.Helper()
	ns := []int{}
	for _, table := range []string{"ac_revisions", "accepted_spec_revisions", "accepted_revision_acs", "accepted_work_item_bindings", "accepted_work_item_requirements", "project_spec_heads", "work_item_spec_heads", "current_ac_requirements", "command_results", "idempotency_records", "audit_entries", "projection_events", "runs", "work_item_ac_requirements"} {
		var n int
		if e := db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); e != nil {
			t.Fatal(e)
		}
		ns = append(ns, n)
	}
	var p, w int
	if e := db.QueryRow("SELECT version FROM projects WHERE project_id=?", projectID).Scan(&p); e != nil {
		t.Fatal(e)
	}
	if e := db.QueryRow("SELECT version FROM work_items WHERE work_item_id=?", workItemID).Scan(&w); e != nil {
		t.Fatal(e)
	}
	rows, e := db.Query("PRAGMA foreign_key_check")
	if e != nil {
		t.Fatal(e)
	}
	defer rows.Close()
	if rows.Next() {
		t.Fatal("foreign key violation")
	}
	if e = rows.Err(); e != nil {
		t.Fatal(e)
	}
	return append(ns, p, w)
}
func initialDigest(t *testing.T, db *sql.DB) domain.Digest {
	t.Helper()
	var s string
	if e := db.QueryRow("SELECT accepted_revision_digest FROM project_spec_heads").Scan(&s); e != nil {
		t.Fatal(e)
	}
	d, e := domain.ParseDigest(s)
	if e != nil {
		t.Fatal(e)
	}
	return d
}
func TestAdmission_FirstAcceptAtomicAndSingleWinner(t *testing.T) {
	for _, kind := range []string{"multiple_exact_mappings", "partial_mapping"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := initialFixtureContent(t, initialContent, "wi_01HABCDEFGJ")
			if kind == "partial_mapping" {
				q.WorkItems = q.WorkItems[:1]
				if e := store.Within(t.Context(), func(tx port.Transaction) error {
					p, e := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), projectID, q.ProposalDigest)
					if e != nil {
						return e
					}
					_, q.AcceptanceSubjectDigest, e = port.CanonicalInitialAcceptanceSubject(port.NewInitialAcceptanceSubject(projectID, 1, p, q.PolicyRevisionDigest, q.WorkItems))
					return e
				}); e != nil {
					t.Fatal(e)
				}
				before := initialCounts(t, db)
				if _, e := svc.AcceptInitialSpecification(t.Context(), operator, q); e == nil {
					t.Fatal("partial mapping accepted")
				}
				after := initialCounts(t, db)
				for i := range 8 {
					if before[i] != after[i] {
						t.Fatal("partial mapping wrote state")
					}
				}
				return
			}
			if _, e := svc.AcceptInitialSpecification(t.Context(), operator, q); e != nil {
				t.Fatal(e)
			}
			var heads, requirements, advanced int
			if e := db.QueryRow("SELECT count(*) FROM work_item_spec_heads").Scan(&heads); e != nil {
				t.Fatal(e)
			}
			if e := db.QueryRow("SELECT count(*) FROM current_ac_requirements").Scan(&requirements); e != nil {
				t.Fatal(e)
			}
			if e := db.QueryRow("SELECT count(*) FROM work_items WHERE version=2 AND phase='Draft'").Scan(&advanced); e != nil {
				t.Fatal(e)
			}
			if heads != 2 || requirements != 2 || advanced != 2 {
				t.Fatalf("multi item state %d %d %d", heads, requirements, advanced)
			}
		})
	}

	t.Run("empty_exact_AC_content", func(t *testing.T) {
		svc, store, db, q := initialFixtureContent(t, []byte{})
		if _, e := svc.AcceptInitialSpecification(t.Context(), operator, q); e != nil {
			t.Fatal(e)
		}
		d := initialDigest(t, db)
		if e := store.Within(t.Context(), func(tx port.Transaction) error {
			_, e := tx.(port.InitialAcceptanceTransaction).LoadInitialAcceptance(t.Context(), projectID, d)
			return e
		}); e != nil {
			t.Fatal(e)
		}
	})

	t.Run("positive_reopen_exact_replay", func(t *testing.T) {
		svc, store, db, q := initialFixture(t)
		out, e := svc.AcceptInitialSpecification(t.Context(), operator, q)
		if e != nil {
			t.Fatalf("valid explicit acceptance failed: %v", e)
		}
		want := []int{1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 0, 0, 2, 2}
		if got := initialCounts(t, db); !reflect.DeepEqual(got, want) {
			t.Fatalf("exact atomic rows/versions %v", got)
		}
		var phase string
		if e = db.QueryRow("SELECT phase FROM work_items").Scan(&phase); e != nil || phase != "Draft" {
			t.Fatalf("phase %s %v", phase, e)
		}
		var ph, wh int
		var pd, wd string
		if e = db.QueryRow("SELECT head_version,accepted_revision_digest FROM project_spec_heads").Scan(&ph, &pd); e != nil {
			t.Fatal(e)
		}
		if e = db.QueryRow("SELECT head_version,accepted_revision_digest FROM work_item_spec_heads").Scan(&wh, &wd); e != nil {
			t.Fatal(e)
		}
		if ph != 1 || wh != 1 || pd != wd {
			t.Fatalf("initial exact heads %d %d %s %s", ph, wh, pd, wd)
		}
		d := initialDigest(t, db)
		var seq int
		var name, path string
		if e = db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); e != nil {
			t.Fatal(e)
		}
		if e = store.Close(); e != nil {
			t.Fatal(e)
		}
		reopened, e := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedTime)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { reopened.Close() })
		svc.unit = reopened
		if e = reopened.Within(t.Context(), func(tx port.Transaction) error {
			r, e := tx.(port.InitialAcceptanceTransaction).LoadInitialAcceptance(t.Context(), projectID, d)
			if e == nil {
				m := r.Material()
				m.Bindings[0].ACs[0].Digest = "changed"
				if r.Material().Bindings[0].ACs[0].Digest == "changed" {
					t.Fatal("mutable view")
				}
			}
			return e
		}); e != nil {
			t.Fatal(e)
		}
		svc.config.RepositoryAuthority = nil
		replay, e := svc.AcceptInitialSpecification(t.Context(), operator, q)
		if e != nil || !replay.Replayed || !bytes.Equal(out.Payload, replay.Payload) {
			t.Fatalf("exact replay %v", e)
		}
		var fk string
		if e = db.QueryRow("PRAGMA foreign_key_check").Scan(&fk); !errors.Is(e, sql.ErrNoRows) {
			t.Fatalf("foreign keys %v", e)
		}
	})
	for _, kind := range []string{"same_key", "distinct_keys"} {
		t.Run(kind, func(t *testing.T) {
			svc, _, db, q := initialFixture(t)
			var wg sync.WaitGroup
			var mu sync.Mutex
			wins := 0
			var payload []byte
			for i := range 4 {
				wg.Go(func() {
					v := q
					if kind == "distinct_keys" {
						v.Metadata = initialMetadata(20+i, 1)
					}
					out, e := svc.AcceptInitialSpecification(t.Context(), operator, v)
					mu.Lock()
					defer mu.Unlock()
					if e != nil {
						return
					}
					wins++
					if payload == nil {
						payload = out.Payload
					}
					if kind == "same_key" && !bytes.Equal(payload, out.Payload) {
						t.Error("concurrent bytes differ")
					}
				})
			}
			wg.Wait()
			if kind == "same_key" && wins != 4 || kind == "distinct_keys" && wins != 1 {
				t.Fatalf("winner count %d", wins)
			}
			got := initialCounts(t, db)
			if got[1] != 1 || got[12] != 0 || got[14] != 2 || got[15] != 2 {
				t.Fatal(got)
			}
		})
	}
	for _, kind := range []string{"actor", "project", "policy", "subject", "project_version", "item_version", "missing_ac", "extra_ac", "wrong_ac", "duplicate_ac", "missing_item", "extra_item", "duplicate_item", "recipe", "rule", "revoked", "changed_binding", "non_draft", "run_history", "project_changed_db", "item_changed_db", "preexisting_head", "oversize_ac"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			actor := operator
			switch kind {
			case "actor":
				actor = "other"
			case "project":
				q.ProjectID = "prj_01HABCDEFGJ"
			case "policy":
				q.PolicyRevisionDigest = domain.HashString("changed")
			case "subject":
				q.AcceptanceSubjectDigest = domain.HashString("forged")
			case "project_version":
				q.ExpectedVersion = 2
			case "item_version":
				q.WorkItems[0].ExpectedVersion = 2
			case "missing_ac":
				q.ACContents = nil
			case "extra_ac":
				q.ACContents = append(q.ACContents, command.InitialACContent{ACID: "AC-B", Content: []byte("extra")})
			case "wrong_ac":
				q.ACContents[0].Content = []byte("wrong")
			case "duplicate_ac":
				q.ACContents = append(q.ACContents, q.ACContents[0])
			case "missing_item":
				q.WorkItems = nil
			case "extra_item":
				q.WorkItems = append(q.WorkItems, port.InitialWorkItemVersion{WorkItemID: "wi_01HABCDEFGJ", ExpectedVersion: 1})
			case "duplicate_item":
				q.WorkItems = append(q.WorkItems, q.WorkItems[0])
			case "recipe":
				svc.config.Completion.RecipeDigest = domain.HashString("wrong")
			case "rule":
				delete(svc.config.Completion.Checks, "AC-A")
			case "revoked":
				svc.config.RepositoryAuthority = nil
			case "changed_binding":
				a, _ := svc.config.RepositoryAuthority.Lookup(projectID, "binding")
				a.ConfigurationID = "changed"
				_, a.Binding.Digest, _ = port.CanonicalRepositoryBinding(a)
				svc.config.RepositoryAuthority = fixedRepository{a}
			case "project_changed_db":
				if _, e := db.Exec("UPDATE projects SET version=2"); e != nil {
					t.Fatal(e)
				}
			case "item_changed_db":
				if _, e := db.Exec("UPDATE work_items SET version=2"); e != nil {
					t.Fatal(e)
				}
			case "run_history":
				if e := store.Within(t.Context(), func(tx port.Transaction) error {
					return tx.CreateRun(t.Context(), port.Run{ID: "run_01HABCDEFGH", ProjectID: projectID, WorkItemID: workItemID, InputDigest: domain.HashString("historical"), AdapterID: "fake/v1", AdapterVersion: "1", ScenarioID: "test", Attempt: 1, DesiredAction: "Dispatch", DispatchState: "Pending", ObservedState: "Unknown", ReconciliationState: "None", SideEffectOutcome: "NotApplicable", CreatedAtNS: 1})
				}); e != nil {
					t.Fatal(e)
				}
			case "non_draft":
				if _, e := db.Exec("UPDATE work_items SET phase='Ready'"); e != nil {
					t.Fatal(e)
				}
			case "preexisting_head":
				if _, e := svc.AcceptInitialSpecification(t.Context(), operator, q); e != nil {
					t.Fatal(e)
				}
				q.Metadata = initialMetadata(14, 1)
			case "oversize_ac":
				q.ACContents[0].Content = make([]byte, 65537)
			}
			before := initialCounts(t, db)
			if _, e := svc.AcceptInitialSpecification(t.Context(), actor, q); e == nil {
				t.Fatal("invalid acceptance succeeded")
			}
			after := initialCounts(t, db)
			for _, i := range []int{0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15} {
				if before[i] != after[i] {
					t.Fatalf("negative mutated %v -> %v", before, after)
				}
			}
		})
	}
}
func TestAdmission_InitialAcceptanceWriteFaultsRollback(t *testing.T) {
	for _, table := range []string{"ac_revisions", "accepted_spec_revisions", "accepted_revision_acs", "accepted_work_item_bindings", "accepted_work_item_requirements", "project_spec_heads", "work_item_spec_heads", "current_ac_requirements", "projects", "work_items", "audit_entries", "projection_events", "command_results", "idempotency_records"} {
		t.Run(table, func(t *testing.T) {
			svc, _, db, q := initialFixture(t)
			before := initialCounts(t, db)
			action := "INSERT"
			if table == "projects" || table == "work_items" {
				action = "UPDATE"
			}
			if _, e := db.Exec("CREATE TRIGGER initial_fault BEFORE " + action + " ON " + table + " BEGIN SELECT RAISE(ABORT,'initial fault'); END"); e != nil {
				t.Fatal(e)
			}
			if _, e := svc.AcceptInitialSpecification(t.Context(), operator, q); e == nil {
				t.Fatal("write fault accepted")
			}
			if got := initialCounts(t, db); !reflect.DeepEqual(got, before) {
				t.Fatalf("partial writes %v", got)
			}
		})
	}
}

type initialHookUnit struct {
	base  port.UnitOfWork
	after func() error
}

func (u initialHookUnit) Within(ctx context.Context, fn func(port.Transaction) error) error {
	return u.base.Within(ctx, func(tx port.Transaction) error {
		return fn(initialHookTransaction{tx.(port.InitialAcceptanceTransaction), u.after})
	})
}

type initialHookTransaction struct {
	port.InitialAcceptanceTransaction
	after func() error
}

func (tx initialHookTransaction) StoreInitialAcceptance(ctx context.Context, r port.InitialAcceptedRecord, a []port.ACRevision, n int64) error {
	if e := tx.InitialAcceptanceTransaction.StoreInitialAcceptance(ctx, r, a, n); e != nil {
		return e
	}
	return tx.after()
}
func TestAdmission_InitialAcceptancePostwriteRollback(t *testing.T) {
	for _, kind := range []string{"recordable", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			before := initialCounts(t, db)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			svc.unit = initialHookUnit{store, func() error {
				if kind == "cancel" {
					cancel()
					return nil
				}
				return command.NewError(command.CodeVersionConflict, "postwrite", false, nil, nil)
			}}
			if _, e := svc.AcceptInitialSpecification(ctx, operator, q); e == nil {
				t.Fatal("postwrite accepted")
			}
			if got := initialCounts(t, db); !reflect.DeepEqual(got, before) {
				t.Fatal(got)
			}
		})
	}
}
func TestAdmission_InitialAcceptanceCorruptionFailsClosed(t *testing.T) {
	for _, kind := range []string{"canonical", "oversize", "normalized", "binding", "requirements", "current", "ac"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			if _, e := svc.AcceptInitialSpecification(t.Context(), operator, q); e != nil {
				t.Fatal(e)
			}
			d := initialDigest(t, db)
			var ss []string
			switch kind {
			case "canonical":
				ss = []string{"DROP TRIGGER accepted_spec_revisions_immutable_update", "UPDATE accepted_spec_revisions SET canonical_content=x'7b7d'"}
			case "oversize":
				ss = []string{"DROP TRIGGER accepted_spec_revisions_immutable_update", "UPDATE accepted_spec_revisions SET canonical_content=zeroblob(16777217)"}
			case "normalized":
				ss = []string{"DROP TRIGGER accepted_spec_revisions_immutable_update", "UPDATE accepted_spec_revisions SET accepted_by_actor='other'"}
			case "binding":
				ss = []string{"DROP TRIGGER accepted_work_item_bindings_immutable_update", "UPDATE accepted_work_item_bindings SET canonical_content=x'7b7d'"}
			case "requirements":
				ss = []string{"DROP TRIGGER accepted_work_item_requirements_immutable_delete", "DELETE FROM accepted_work_item_requirements"}
			case "current":
				ss = []string{"DELETE FROM current_ac_requirements"}
			case "ac":
				ss = []string{"DROP TRIGGER ac_revisions_immutable_update", "UPDATE ac_revisions SET content=x'00'"}
			}
			for _, s := range ss {
				if _, e := db.Exec(s); e != nil {
					t.Fatal(e)
				}
			}
			e := store.Within(t.Context(), func(tx port.Transaction) error {
				_, e := tx.(port.InitialAcceptanceTransaction).LoadInitialAcceptance(t.Context(), projectID, d)
				return e
			})
			if _, ok := errors.AsType[domain.StorageCorruptionError](e); !ok {
				t.Fatalf("corruption allowed %v", e)
			}
		})
	}
}
