package sqlite

import (
	"bytes"
	"context"
	"crypto/sha1"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
	"maps"
	driversqlite "modernc.org/sqlite"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestRunInput_V2UpgradePreservesLegacyHistory(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "state.db")
	db := migrationTestDB(t, path)
	if err := migrationRun(t, db, t.Context(), compiledMigrations()[:2], 42); err != nil {
		t.Fatal(err)
	}
	acceptancePopulateV1(t, db)
	before := acceptanceV1Snapshot(t, db)
	store, err := inputV3Open(t.Context(), root, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	var version, count int
	if err := db.QueryRowContext(t.Context(), "SELECT schema_version FROM instance_state").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 3 {
		t.Fatalf("V2 upgrade schema=%d; want V3", version)
	}
	if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM run_input_envelopes").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("legacy envelopes backfilled")
	}
	if acceptanceV1Snapshot(t, db) != before {
		t.Fatal("legacy history changed")
	}
}

// Storage fixtures use the real proposal/accepted codecs and adapters. They are
// not a service/runtime acceptance flow.
type inputSnapshot struct {
	commit  specification.ObjectID
	objects map[specification.ObjectID]specification.Object
}

func (s *inputSnapshot) Open(context.Context, string) (specification.Snapshot, error) { return s, nil }
func (s *inputSnapshot) Commit() specification.ObjectID                               { return s.commit }
func (s *inputSnapshot) Close() error                                                 { return nil }
func (s *inputSnapshot) ReadObject(ctx context.Context, id specification.ObjectID, _ int64) (specification.Object, error) {
	return s.objects[id], ctx.Err()
}
func currentFixture(t *testing.T) (*Store, port.RunInput) { return currentFixtureAt(t, false) }
func currentFixtureAt(t *testing.T, v2 bool) (*Store, port.RunInput) {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "state.db")
	var store *Store
	var e error
	if v2 {
		store, e = acceptanceV2Open(t.Context(), root, path)
	} else {
		store, e = inputV3Open(t.Context(), root, path)
	}
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { store.Close() })
	mustCreateProject(t, store)
	mustCreateWorkItem(t, store, mustWorkItem(t, "item-1", "project-1", domain.PhaseDraft, 1))
	recipe := domain.HashString("recipe")
	content := [][]byte{[]byte("first AC"), []byte("second AC")}
	raw := fmt.Sprintf(`{"schema_version":1,"nodes":[{"id":"SPEC-A","path":"a.md","required":true,"work_item_ids":["item-1"],"required_ac_revisions":[{"ac_id":"ac1","ac_revision_digest":"%s"},{"ac_id":"ac2","ac_revision_digest":"%s"}],"recipe_digest":"%s"}],"edges":[]}`, domain.HashBytes(content[0]).String(), domain.HashBytes(content[1]).String(), recipe.String())
	s := &inputSnapshot{objects: map[specification.ObjectID]specification.Object{}}
	add := func(kind specification.ObjectKind, b []byte) specification.ObjectID {
		sum := sha1.Sum(append([]byte(fmt.Sprintf("%s %d\x00", kind, len(b))), b...))
		id, e := specification.ParseObjectID(specification.SHA1, hex.EncodeToString(sum[:]))
		if e != nil {
			t.Fatal(e)
		}
		s.objects[id] = specification.Object{Kind: kind, Data: b}
		return id
	}
	source := add(specification.BlobObject, []byte("source\n"))
	manifest := add(specification.BlobObject, []byte(raw))
	tree := []byte{}
	for _, entry := range []struct {
		name string
		id   specification.ObjectID
	}{{"a.md", source}, {"manifest.json", manifest}} {
		b, _ := hex.DecodeString(entry.id.String())
		tree = append(tree, []byte("100644 "+entry.name+"\x00")...)
		tree = append(tree, b...)
	}
	tr := add(specification.TreeObject, tree)
	s.commit = add(specification.CommitObject, []byte("tree "+tr.String()+"\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n"))
	approved := port.ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: "project-1", ID: "binding", Version: 1, ObjectFormat: specification.SHA1}, ConfigurationID: "fixture", ApprovedBy: "operator", Refs: []string{"refs/heads/main"}, ManifestPaths: []string{"manifest.json"}, Reader: s}
	_, approved.Binding.Digest, e = port.CanonicalRepositoryBinding(approved)
	if e != nil {
		t.Fatal(e)
	}
	proposal, e := specification.Import(t.Context(), s, specification.Request{Binding: approved.Binding, Ref: "refs/heads/main", ManifestPath: "manifest.json"})
	if e != nil {
		t.Fatal(e)
	}
	subject := port.NewInitialAcceptanceSubject("project-1", 1, proposal, domain.HashString("policy"), []port.InitialWorkItemVersion{{WorkItemID: "item-1", ExpectedVersion: 1}})
	accepted, e := port.BuildInitialAcceptedRecord(proposal, subject, "operator")
	if e != nil {
		t.Fatal(e)
	}
	e = store.Within(t.Context(), func(tx port.Transaction) error {
		a := tx.(port.InitialAcceptanceTransaction)
		if e := a.StoreProposal(t.Context(), approved, proposal, 42); e != nil {
			return e
		}
		return a.StoreInitialAcceptance(t.Context(), accepted, []port.ACRevision{{ProjectID: "project-1", ACID: "ac1", Digest: domain.HashBytes(content[0]), Content: content[0]}, {ProjectID: "project-1", ACID: "ac2", Digest: domain.HashBytes(content[1]), Content: content[1]}}, 42)
	})
	if e != nil {
		t.Fatal(e)
	}
	var view port.CurrentSpecification
	e = store.Within(t.Context(), func(tx port.Transaction) error {
		var e error
		view, e = tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), "project-1", "item-1")
		return e
	})
	if e != nil {
		t.Fatal(e)
	}
	acs := []port.InitialACBinding{}
	rules := []port.RunInputVerificationRule{}
	for _, a := range view.Requirements {
		acs = append(acs, port.InitialACBinding{ACID: a.ACID, Digest: a.RevisionDigest.String()})
		rules = append(rules, port.RunInputVerificationRule{ACID: a.ACID, VerifierClass: "test", EnvironmentDigest: domain.HashString(port.FakeEnvironmentProfile).String()})
	}
	input, e := port.NewRunInput(port.RunInputMaterial{Schema: 1, ProjectID: "project-1", WorkItemID: "item-1", ReadyVersion: 3, BindingDigest: view.BindingDigest.String(), GraphRevisionDigest: view.GraphRevisionDigest.String(), ACs: acs, PolicyRevisionDigest: view.PolicyRevisionDigest.String(), RecipeDigest: view.RecipeDigest.String(), Rules: rules, IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}, AdapterID: "fake/v1", AdapterVersion: "1", ScenarioID: "success"})
	if e != nil {
		t.Fatal(e)
	}
	return store, input
}
func inputRun(v port.RunInput, id domain.RunID) port.Run {
	m := v.Material()
	return port.Run{ID: id, ProjectID: m.ProjectID, WorkItemID: m.WorkItemID, InputDigest: v.Digest(), AdapterID: m.AdapterID, AdapterVersion: m.AdapterVersion, ScenarioID: m.ScenarioID, Attempt: 1, DesiredAction: "Dispatch", DispatchState: "Pending", ObservedState: "Unknown", ReconciliationState: "None", SideEffectOutcome: "NotApplicable", CreatedAtNS: 42}
}
func storeInput(t *testing.T, store *Store, v port.RunInput, id domain.RunID, after func(port.Transaction) error) error {
	t.Helper()
	return store.Within(t.Context(), func(tx port.Transaction) error {
		if e := tx.CreateRun(t.Context(), inputRun(v, id)); e != nil {
			return e
		}
		if e := tx.(port.CurrentInputTransaction).StoreRunInput(t.Context(), port.RunInputEnvelope{RunID: id, Input: v}); e != nil {
			return e
		}
		if after != nil {
			return after(tx)
		}
		return inputOutbox(t, tx, v, id)
	})
}
func inputOutbox(t *testing.T, tx port.Transaction, v port.RunInput, id domain.RunID) error {
	t.Helper()
	m := v.Material()
	payload := []byte("result")
	cmd := "command-" + string(id)
	if e := tx.StoreCommandResult(t.Context(), port.CommandResult{ID: cmd, ProjectID: m.ProjectID, Digest: domain.HashBytes(payload), Payload: payload, TimestampNS: 42}); e != nil {
		return e
	}
	if _, e := tx.AppendAudit(t.Context(), port.AuditEntry{GroupID: cmd, CommandID: cmd, ProjectID: m.ProjectID, Actor: "operator", Operation: "fixture", SubjectDigest: v.Digest(), TimestampNS: 42}); e != nil {
		return e
	}
	return tx.EnqueueOutbox(t.Context(), port.OutboxIntent{ID: cmd, CommandID: cmd, AuditGroupID: cmd, ProjectID: m.ProjectID, RunID: id, PayloadDigest: v.Digest(), TimestampNS: 42})
}
func TestRunInput_ActualV3WriteReadReplayRollbackAndCopies(t *testing.T) {
	store, v := currentFixture(t)
	before := acceptanceSnapshot(t, store.db)
	sentinel := errors.New("rollback")
	if e := storeInput(t, store, v, "rolled-back", func(port.Transaction) error { return sentinel }); !errors.Is(e, sentinel) {
		t.Fatal(e)
	}
	if acceptanceSnapshot(t, store.db) != before {
		t.Fatal("input write failure partially committed")
	}
	ctx, cancel := context.WithCancel(t.Context())
	e := store.Within(ctx, func(tx port.Transaction) error {
		if e := tx.CreateRun(ctx, inputRun(v, "canceled")); e != nil {
			return e
		}
		if e := tx.(port.CurrentInputTransaction).StoreRunInput(ctx, port.RunInputEnvelope{RunID: "canceled", Input: v}); e != nil {
			return e
		}
		cancel()
		return ctx.Err()
	})
	if !errors.Is(e, context.Canceled) || acceptanceSnapshot(t, store.db) != before {
		t.Fatal("write cancellation failed rollback", e)
	}
	if e := storeInput(t, store, v, "run-1", nil); e != nil {
		t.Fatal(e)
	}
	check := func() {
		t.Helper()
		if e := store.Within(t.Context(), func(tx port.Transaction) error {
			a := tx.(port.CurrentInputTransaction)
			env, e := a.LoadRunInput(t.Context(), "project-1", "run-1")
			if e != nil {
				return e
			}
			if env.RunID != "run-1" || env.Input.Digest() != v.Digest() || !bytes.Equal(env.Input.CanonicalJSON(), v.CanonicalJSON()) {
				t.Fatal("input identity")
			}
			b := env.Input.CanonicalJSON()
			b[0] = 'x'
			return a.StoreRunInput(t.Context(), env)
		}); e != nil {
			t.Fatal(e)
		}
	}
	check()
	var path string
	if e := store.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path); e != nil {
		t.Fatal(e)
	}
	if e := store.Close(); e != nil {
		t.Fatal(e)
	}
	opened, e := inputV3Open(t.Context(), filepath.Dir(path), path)
	if e != nil {
		t.Fatal(e)
	}
	store.db = opened.db
	check()
	if e := store.Within(t.Context(), func(tx port.Transaction) error { return tx.CreateRun(t.Context(), inputRun(v, "legacy")) }); e != nil {
		t.Fatal(e)
	}
	if e := store.Within(t.Context(), func(tx port.Transaction) error {
		_, e := tx.(port.CurrentInputTransaction).LoadRunInput(t.Context(), "project-1", "legacy")
		return e
	}); !errors.Is(e, port.ErrNotFound) {
		t.Fatalf("legacy absence: %v", e)
	}
}
func TestRunInput_CurrentSpecificationCopiesMissingAndCorruption(t *testing.T) {
	for _, kind := range []string{"copies", "missing-project-head", "missing-item-head", "partial", "wrong-item", "wrong-project", "head-version", "binding", "accepted", "ac", "oversize-ac", "oversize-accepted"} {
		t.Run(kind, func(t *testing.T) {
			store, _ := currentFixture(t)
			switch kind {
			case "missing-project-head":
				migrationExec(t, store.db, "PRAGMA foreign_keys=OFF; DELETE FROM project_spec_heads; PRAGMA foreign_keys=ON")
			case "missing-item-head":
				migrationExec(t, store.db, "PRAGMA foreign_keys=OFF; DELETE FROM work_item_spec_heads; PRAGMA foreign_keys=ON")
			case "partial":
				migrationExec(t, store.db, "DELETE FROM current_ac_requirements WHERE ac_id='ac2'")
			case "head-version":
				migrationExec(t, store.db, "PRAGMA ignore_check_constraints=ON; UPDATE project_spec_heads SET head_version=0; PRAGMA ignore_check_constraints=OFF")
			case "binding":
				migrationExec(t, store.db, "DROP TRIGGER accepted_work_item_bindings_immutable_update; UPDATE accepted_work_item_bindings SET canonical_content=X'7b7d'")
			case "accepted":
				migrationExec(t, store.db, "DROP TRIGGER accepted_spec_revisions_immutable_update; UPDATE accepted_spec_revisions SET accepted_by_actor='other'")
			case "ac":
				migrationExec(t, store.db, "DROP TRIGGER ac_revisions_immutable_update; UPDATE ac_revisions SET content=X'00'")
			case "oversize-ac":
				migrationExec(t, store.db, "DROP TRIGGER ac_revisions_immutable_update; UPDATE ac_revisions SET content=zeroblob(65537)")
			case "oversize-accepted":
				migrationExec(t, store.db, "DROP TRIGGER accepted_spec_revisions_immutable_update; UPDATE accepted_spec_revisions SET canonical_content=zeroblob(16777217)")
			}
			project, item := domain.ProjectID("project-1"), domain.WorkItemID("item-1")
			if kind == "wrong-item" {
				item = "other"
			}
			if kind == "wrong-project" {
				project = "other"
			}
			var view port.CurrentSpecification
			e := store.Within(t.Context(), func(tx port.Transaction) error {
				var e error
				view, e = tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), project, item)
				return e
			})
			if kind == "copies" {
				if e != nil || len(view.Requirements) != 2 || len(view.ACContents) != 2 || view.RecipeDigest != domain.HashString("recipe") {
					t.Fatal("current view", e)
				}
				c := view.Clone()
				c.Requirements[0].ACID = "other"
				c.ACContents[0].Content[0] = 'x'
				view.ACContents[0].Content[0] = 'x'
				if e := store.Within(t.Context(), func(tx port.Transaction) error {
					_, e := tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), project, item)
					return e
				}); e != nil {
					t.Fatal("copy alias", e)
				}
				return
			}
			if strings.HasPrefix(kind, "missing-") || strings.HasPrefix(kind, "wrong-") {
				if !errors.Is(e, port.ErrNotFound) {
					t.Fatalf("missing scope accepted: %v", e)
				}
			} else if _, ok := errors.AsType[domain.StorageCorruptionError](e); !ok {
				t.Fatalf("malformed material: %v", e)
			}
		})
	}
}

func TestRunInput_V3MigrationRollbackCancelAndFrozenHistory(t *testing.T) {
	if compiledMigrations()[0].checksum != frozenV1Checksum || compiledMigrations()[1].checksum != "5fbac05b24ba8bccedafb2857ff45934c88612e1ee6f550d12e4576fd2ea0b48" {
		t.Fatal("frozen migration identity")
	}
	for _, failure := range []string{"sql", "history", "state", "cancel"} {
		t.Run(failure, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if e := migrationRun(t, db, t.Context(), acceptanceV2Registry(), 42); e != nil {
				t.Fatal(e)
			}
			acceptancePopulateV1(t, db)
			before := acceptanceSnapshot(t, db)
			statement := v3Migration
			ctx := t.Context()
			var called atomic.Bool
			switch failure {
			case "sql":
				statement += "\nINSERT INTO absent_failure_probe VALUES(1);"
			case "history":
				statement += "\nINSERT INTO schema_migrations VALUES(3,'conflict',43);"
			case "state":
				statement += "\nDROP TABLE instance_state;"
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(t.Context())
				defer cancel()
				name := fmt.Sprintf("input_cancel_%d", migrationCancelFunctionSequence.Add(1))
				if e := driversqlite.RegisterScalarFunction(name, 0, func(*driversqlite.FunctionContext, []driver.Value) (driver.Value, error) {
					called.Store(true)
					cancel()
					return int64(1), nil
				}); e != nil {
					t.Fatal(e)
				}
				db.SetMaxIdleConns(0) // Reopen after registering the test-only function.
				statement += "\nSELECT " + name + "();"
			}
			registry := append(acceptanceV2Registry(), migrationTestStep(3, statement))
			e := migrationRun(t, db, ctx, registry, 43)
			if e == nil {
				t.Fatal("failing V3 accepted")
			}
			if failure == "cancel" && (!called.Load() || !errors.Is(e, context.Canceled)) {
				t.Fatal("cancel callback not reached", e)
			}
			if acceptanceSnapshot(t, db) != before {
				t.Fatal("actual V3 batch did not roll back")
			}
			store, e := inputV3Open(t.Context(), root, path)
			if e != nil {
				t.Fatal("V3 retry/writer release", e)
			}
			if e = store.Close(); e != nil {
				t.Fatal(e)
			}
			var version, count int
			if e = db.QueryRow("SELECT schema_version FROM instance_state").Scan(&version); e != nil {
				t.Fatal(e)
			}
			if e = db.QueryRow("SELECT count(*) FROM run_input_envelopes").Scan(&count); e != nil {
				t.Fatal(e)
			}
			if version != 3 || count != 0 {
				t.Fatal("V3 retry inference/version")
			}
		})
	}
}
func TestRunInput_ImmutableReplacementAndScopedVerification(t *testing.T) {
	store, v := currentFixture(t)
	if e := storeInput(t, store, v, "run-1", nil); e != nil {
		t.Fatal(e)
	}
	row := acceptanceReadRow(t, store.db, "run_input_envelopes", "project_id='project-1'")
	statement, args := acceptanceInsertStatement("run_input_envelopes", row)
	before := acceptanceSnapshot(t, store.db)
	for name, query := range map[string]string{"update": "UPDATE run_input_envelopes SET codec_version=codec_version", "delete": "DELETE FROM run_input_envelopes", "duplicate": statement, "ignore": strings.Replace(statement, "INSERT INTO", "INSERT OR IGNORE INTO", 1), "replace": strings.Replace(statement, "INSERT INTO", "INSERT OR REPLACE INTO", 1), "replace-spelling": strings.Replace(statement, "INSERT INTO", "REPLACE INTO", 1), "upsert": statement + " ON CONFLICT(project_id,run_id) DO UPDATE SET codec_version=excluded.codec_version", "nothing": statement + " ON CONFLICT DO NOTHING"} {
		t.Run(name, func(t *testing.T) {
			var values []any
			if strings.Contains(query, "VALUES") {
				values = args
			}
			if _, e := store.db.ExecContext(t.Context(), query, values...); e == nil || !strings.Contains(e.Error(), "immutable") {
				t.Fatalf("immutable bypass: %v", e)
			}
			if acceptanceSnapshot(t, store.db) != before {
				t.Fatal("history changed")
			}
		})
	}
	for _, kind := range []string{"scope", "item", "digest", "adapter", "version", "scenario", "missing-run"} {
		t.Run(kind, func(t *testing.T) {
			m := v.Material()
			switch kind {
			case "scope":
				m.ProjectID = "other"
			case "item":
				m.WorkItemID = "other"
			case "digest":
				m.GraphRevisionDigest = domain.HashString("other").String()
			case "adapter":
				m.AdapterID = "other"
			case "version":
				m.AdapterVersion = "2"
			case "scenario":
				m.ScenarioID = "other"
			}
			wrong, e := port.NewRunInput(m)
			if e == nil {
				id := domain.RunID("run-1")
				if kind == "missing-run" {
					id = "missing"
				}
				e = store.Within(t.Context(), func(tx port.Transaction) error {
					return tx.(port.CurrentInputTransaction).StoreRunInput(t.Context(), port.RunInputEnvelope{RunID: id, Input: wrong})
				})
			}
			if e == nil {
				t.Fatal("mismatch accepted")
			}
			if acceptanceSnapshot(t, store.db) != before {
				t.Fatal("rejection mutated rows")
			}
		})
	}
}
func TestRunInput_StoredCorruptionAndOutbox(t *testing.T) {
	for _, kind := range []string{"canonical", "oversize", "normalized-item", "codec", "digest", "run-item", "run-adapter", "run-version", "run-scenario", "outbox", "missing-outbox", "duplicate-outbox"} {
		t.Run(kind, func(t *testing.T) {
			store, v := currentFixture(t)
			if e := storeInput(t, store, v, "run-1", nil); e != nil {
				t.Fatal(e)
			}
			switch kind {
			case "canonical":
				migrationExec(t, store.db, "DROP TRIGGER run_input_envelopes_no_update; UPDATE run_input_envelopes SET canonical_content=X'7b7d'")
			case "oversize":
				migrationExec(t, store.db, "DROP TRIGGER run_input_envelopes_no_update; PRAGMA ignore_check_constraints=ON; UPDATE run_input_envelopes SET canonical_content=zeroblob(1048577); PRAGMA ignore_check_constraints=OFF")
			case "normalized-item":
				migrationExec(t, store.db, "DROP TRIGGER run_input_envelopes_no_update; PRAGMA foreign_keys=OFF; UPDATE run_input_envelopes SET work_item_id='other'; PRAGMA foreign_keys=ON")
			case "codec":
				migrationExec(t, store.db, "DROP TRIGGER run_input_envelopes_no_update; PRAGMA ignore_check_constraints=ON; UPDATE run_input_envelopes SET codec_version=2; PRAGMA ignore_check_constraints=OFF")
			case "digest":
				migrationExec(t, store.db, "DROP TRIGGER run_input_envelopes_no_update; UPDATE run_input_envelopes SET input_digest=?", domain.HashString("other").String())
			case "run-item":
				migrationExec(t, store.db, "DROP TRIGGER runs_immutable_identity_update; PRAGMA foreign_keys=OFF; UPDATE runs SET work_item_id='other'; PRAGMA foreign_keys=ON")
			case "run-adapter":
				migrationExec(t, store.db, "DROP TRIGGER runs_immutable_identity_update; UPDATE runs SET adapter_id='other'")
			case "run-version":
				migrationExec(t, store.db, "DROP TRIGGER runs_immutable_identity_update; UPDATE runs SET adapter_version='2'")
			case "run-scenario":
				migrationExec(t, store.db, "DROP TRIGGER runs_immutable_identity_update; UPDATE runs SET scenario_id='other'")
			case "outbox":
				migrationExec(t, store.db, "DROP TRIGGER outbox_immutable_identity_update; UPDATE outbox SET payload_digest=?", domain.HashString("other").String())
			case "missing-outbox":
				migrationExec(t, store.db, "DROP TRIGGER outbox_immutable_delete; DELETE FROM outbox")
			case "duplicate-outbox":
				migrationExec(t, store.db, "INSERT INTO outbox SELECT project_id,'second',command_id,audit_group_id,run_id,payload_digest,state,claim_epoch,created_at_ns,claimed_at_ns FROM outbox")
			}
			e := store.Within(t.Context(), func(tx port.Transaction) error {
				_, e := tx.(port.CurrentInputTransaction).LoadRunInput(t.Context(), "project-1", "run-1")
				return e
			})
			if _, ok := errors.AsType[domain.StorageCorruptionError](e); !ok {
				t.Fatalf("corrupt stored input allowed: %v", e)
			}
		})
	}
}

func inputV2Snapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	out := acceptanceV1Snapshot(t, db)
	for _, table := range append(slices.Clone(acceptanceTables), "schema_migrations WHERE version<=2") {
		rows, e := db.QueryContext(t.Context(), "SELECT * FROM "+table)
		if e != nil {
			t.Fatal(e)
		}
		columns, e := rows.Columns()
		if e != nil {
			t.Fatal(e)
		}
		records := []string{}
		for rows.Next() {
			values := make([]any, len(columns))
			ptrs := make([]any, len(columns))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if e = rows.Scan(ptrs...); e != nil {
				t.Fatal(e)
			}
			records = append(records, fmt.Sprintf("%#v", values))
		}
		if e = errors.Join(rows.Err(), rows.Close()); e != nil {
			t.Fatal(e)
		}
		slices.Sort(records)
		out += fmt.Sprintf("%s:%v\n", table, records)
	}
	return out
}
func TestRunInput_V2UpgradePreservesAcceptedMaterial(t *testing.T) {
	store, v := currentFixtureAt(t, true)
	before := inputV2Snapshot(t, store.db)
	var path string
	if e := store.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path); e != nil {
		t.Fatal(e)
	}
	if e := store.Close(); e != nil {
		t.Fatal(e)
	}
	opened, e := inputV3Open(t.Context(), filepath.Dir(path), path)
	if e != nil {
		t.Fatal(e)
	}
	store.db = opened.db
	if inputV2Snapshot(t, store.db) != before {
		t.Fatal("V2 accepted/history rows changed")
	}
	var count int
	if e = store.db.QueryRow("SELECT count(*) FROM run_input_envelopes").Scan(&count); e != nil || count != 0 {
		t.Fatal("accepted V2 envelope backfill", e)
	}
	if e = store.Within(t.Context(), func(tx port.Transaction) error {
		view, e := tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), "project-1", "item-1")
		if e == nil && (view.BindingDigest.String() != v.Material().BindingDigest || len(view.Requirements) != 2) {
			t.Fatal("accepted binding changed")
		}
		return e
	}); e != nil {
		t.Fatal(e)
	}
}
func TestRunInput_ExactSchemaAndConstraints(t *testing.T) {
	store, v := currentFixture(t)
	var strict int
	if e := store.db.QueryRow("SELECT strict FROM pragma_table_list WHERE name='run_input_envelopes'").Scan(&strict); e != nil || strict != 1 {
		t.Fatal("STRICT missing", e)
	}
	rows, e := store.db.Query("PRAGMA foreign_key_list(run_input_envelopes)")
	if e != nil {
		t.Fatal(e)
	}
	fkCount := 0
	for rows.Next() {
		var id, seq int
		var table, from, to, onUpdate, onDelete, match string
		if e = rows.Scan(&id, &seq, &table, &from, &to, &onUpdate, &onDelete, &match); e != nil {
			t.Fatal(e)
		}
		if (table != "runs" && table != "work_items") || onUpdate != "NO ACTION" || onDelete != "NO ACTION" {
			t.Fatal("FK shape")
		}
		fkCount++
	}
	if e = errors.Join(rows.Err(), rows.Close()); e != nil || fkCount != 4 {
		t.Fatal("compound FKs", e)
	}
	if e = store.Within(t.Context(), func(tx port.Transaction) error { return tx.CreateRun(t.Context(), inputRun(v, "unwritten")) }); e != nil {
		t.Fatal(e)
	}
	valid := acceptanceRow{"project_id": "project-1", "run_id": "unwritten", "work_item_id": "item-1", "codec_version": 1, "input_digest": v.Digest().String(), "canonical_content": v.CanonicalJSON()}
	for _, test := range []struct {
		name, key string
		value     any
	}{{"empty-project", "project_id", ""}, {"missing-project", "project_id", "other"}, {"empty-run", "run_id", ""}, {"missing-run", "run_id", "other"}, {"empty-item", "work_item_id", ""}, {"missing-item", "work_item_id", "other"}, {"codec", "codec_version", 2}, {"digest-short", "input_digest", "abc"}, {"digest-upper", "input_digest", strings.Repeat("A", 64)}, {"empty-bytes", "canonical_content", []byte{}}, {"oversize", "canonical_content", make([]byte, port.RunInputLimit+1)}, {"text", "canonical_content", "text"}, {"null", "canonical_content", nil}} {
		t.Run(test.name, func(t *testing.T) {
			row := maps.Clone(valid)
			row[test.key] = test.value
			query, args := acceptanceInsertStatement("run_input_envelopes", row)
			if _, e := store.db.ExecContext(t.Context(), query, args...); e == nil {
				t.Fatal("invalid schema row accepted")
			}
		})
	}
}

func TestRunInput_V2ConcurrentStartup(t *testing.T) {
	store, _ := currentFixtureAt(t, true)
	before := inputV2Snapshot(t, store.db)
	var path string
	if e := store.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path); e != nil {
		t.Fatal(e)
	}
	if e := store.Close(); e != nil {
		t.Fatal(e)
	}
	start := make(chan struct{})
	results := make(chan error, 4)
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			<-start
			opened, e := inputV3Open(t.Context(), filepath.Dir(path), path)
			if opened != nil {
				e = errors.Join(e, opened.Close())
			}
			results <- e
		})
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
			continue
		}
		if _, ok := errors.AsType[BusyError](e); !ok {
			t.Fatal(e)
		}
	}
	if success == 0 {
		t.Fatal("no V3 startup")
	}
	opened, e := inputV3Open(t.Context(), filepath.Dir(path), path)
	if e != nil {
		t.Fatal(e)
	}
	store.db = opened.db
	if inputV2Snapshot(t, store.db) != before {
		t.Fatal("concurrent upgrade changed prior history")
	}
	var count int
	if e = store.db.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&count); e != nil || count != 3 {
		t.Fatal("migration cardinality", e)
	}
}

// inputV3Open freezes the original V3 migration oracle as newer schemas append.
func inputV3Open(ctx context.Context, root, path string) (*Store, error) {
	if !controlledPath(root, path) {
		return nil, ErrInvalidPath
	}
	db, err := sql.Open("sqlite", databaseURI(path))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Store{db: db}
	err = store.withConn(ctx, func(conn *sql.Conn) error {
		if err := configure(conn, ctx); err != nil {
			return err
		}
		if err := runMigrations(conn, ctx, compiledMigrations()[:3], fixedClockTime.UnixNano()); err != nil {
			return err
		}
		return assertEngine(conn, ctx)
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}
