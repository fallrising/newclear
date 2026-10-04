package sqlite

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	driversqlite "modernc.org/sqlite"
)

var acceptanceTables = []string{
	"repository_binding_versions", "specification_proposals", "accepted_spec_revisions",
	"accepted_revision_acs", "accepted_work_item_bindings", "accepted_work_item_requirements",
	"project_spec_heads", "work_item_spec_heads", "current_ac_requirements",
	"specification_impact_plans", "specification_activation_decisions",
}

func TestAcceptanceSchema_V1UpgradePreservesHistoryAndLeavesHeadsEmpty(t *testing.T) {
	for _, populated := range []bool{false, true} {
		t.Run(fmt.Sprintf("populated=%t", populated), func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err != nil {
				t.Fatal(err)
			}
			if populated {
				acceptancePopulateV1(t, db)
			}
			migrationExec(t, db, "UPDATE instance_state SET restore_generation=7,stream_epoch=9,next_event_sequence=12")
			before := acceptanceV1Snapshot(t, db)
			store, err := migrationOpen(t.Context(), root, path)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			var version, history int
			if err := db.QueryRowContext(t.Context(), "SELECT schema_version FROM instance_state WHERE id=1").Scan(&version); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM schema_migrations").Scan(&history); err != nil {
				t.Fatal(err)
			}
			if version != 2 || history != 2 {
				t.Errorf("public V1 upgrade left schema/history at %d/%d; want 2/2", version, history)
			}
			for _, table := range acceptanceTables {
				var count int
				if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
					t.Errorf("V2 table %s absent: %v", table, err)
				} else if count != 0 {
					t.Errorf("V2 table %s was backfilled", table)
				}
			}
			if acceptanceV1Snapshot(t, db) != before {
				t.Fatal("V1 history/identity/state changed during upgrade")
			}
		})
	}
}

func acceptancePopulateV1(t *testing.T, db *sql.DB) {
	t.Helper()
	migrationExec(t, db, `INSERT INTO projects VALUES('project-1','project-one','legacy-repository','main',7);
INSERT INTO work_items VALUES('project-1','item-1','title','goal','owner','QA',5);`)
	migrationExec(t, db, "INSERT INTO ac_revisions VALUES('project-1','ac-rev-1','ac-1',?,X'0102',42)", strings.Repeat("a", 64))
	migrationExec(t, db, "INSERT INTO work_item_ac_requirements VALUES('project-1','item-1','ac-1',?)", strings.Repeat("a", 64))
	migrationExec(t, db, "INSERT INTO dependency_revisions VALUES('project-1',?,X'0304',42)", strings.Repeat("b", 64))
	migrationExec(t, db, "INSERT INTO runs VALUES('project-1','run-1','item-1',?,'Fake','v1','scenario',1,'None','Pending','Unknown','None','NotApplicable',42)", strings.Repeat("c", 64))
	migrationExec(t, db, "INSERT INTO candidates VALUES('project-1','candidate-1','run-1',?,?,42)", strings.Repeat("d", 64), strings.Repeat("e", 64))
	// Historical completion and its exact evidence/review joins are legal V1
	// storage fixtures. They do not claim a new admission/operator command.
	subject := acceptanceHash("historical completion")
	migrationExec(t, db, "INSERT INTO artifacts VALUES(?,'text/plain',0,'historical-object','Present')", strings.Repeat("f", 64))
	migrationExec(t, db, "INSERT INTO work_items VALUES('project-1','done-item','done title','goal','owner','Done',3)")
	migrationExec(t, db, "INSERT INTO reviews VALUES('project-1','historical-review',?,'Approved','reviewer',1,42)", subject)
	migrationExec(t, db, "INSERT INTO evidence VALUES('project-1','historical-evidence',?,'ac-1',?,'Passed','Current','Present','test','verifier','independent',?,?,?)", subject, strings.Repeat("a", 64), acceptanceHash("recipe"), acceptanceHash("environment"), strings.Repeat("f", 64))
	migrationExec(t, db, "INSERT INTO completion_records VALUES('project-1','historical-completion','done-item',3,?,'operator',42,1,1,0)", subject)
	migrationExec(t, db, "INSERT INTO completion_record_evidence VALUES('project-1','historical-completion','historical-evidence'); INSERT INTO completion_record_reviews VALUES('project-1','historical-completion','historical-review')")
}

// Every V1 table and schema object participates; only schema_version and later
// migration rows may differ. This preserves empty tables too, without latest-row guesses.
func acceptanceV1Snapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var names []string
	rows, err := db.QueryContext(t.Context(), "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(acceptanceTables, name) {
			names = append(names, name)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	var result strings.Builder
	for _, name := range names {
		query := "SELECT * FROM " + name
		if name == "schema_migrations" {
			query += " WHERE version=1"
		}
		if name == "instance_state" {
			query = "SELECT id,restore_generation,stream_epoch,next_event_sequence FROM instance_state"
		}
		rows, err := db.QueryContext(t.Context(), query)
		if err != nil {
			t.Fatal(err)
		}
		columns, err := rows.Columns()
		if err != nil {
			t.Fatal(err)
		}
		var records []string
		for rows.Next() {
			values := make([]any, len(columns))
			ptrs := make([]any, len(columns))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			records = append(records, fmt.Sprintf("%#v", values))
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if err := rows.Close(); err != nil {
			t.Fatal(err)
		}
		slices.Sort(records)
		fmt.Fprintf(&result, "%s:%v\n", name, records)
	}
	rows, err = db.QueryContext(t.Context(), "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var kind, name, owner string
		var statement sql.NullString
		if err := rows.Scan(&kind, &name, &owner, &statement); err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(acceptanceTables, owner) {
			fmt.Fprintf(&result, "schema:%s/%s/%s/%v\n", kind, name, owner, statement)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	return result.String()
}

func acceptanceSnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	result := acceptanceV1Snapshot(t, db)
	for _, table := range acceptanceTables {
		rows, err := db.QueryContext(t.Context(), "SELECT * FROM "+table)
		if err != nil {
			result += table + ":absent\n"
			continue
		}
		columns, err := rows.Columns()
		if err != nil {
			t.Fatal(err)
		}
		var records []string
		for rows.Next() {
			values := make([]any, len(columns))
			ptrs := make([]any, len(columns))
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			records = append(records, fmt.Sprintf("%#v", values))
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if err := rows.Close(); err != nil {
			t.Fatal(err)
		}
		slices.Sort(records)
		result += fmt.Sprintf("%s:%v\n", table, records)
	}
	// Include complete DDL, ledger and instance version, which V1 preservation allows to advance.
	result += migrationLogicalSnapshot(t, db)
	return result
}

func TestAcceptanceSchema_FreshUpgradeAndReopen(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "state.db")
	store, err := OpenAtRootWithClock(t.Context(), root, path, func() time.Time { return fixedClockTime })
	if err != nil {
		t.Fatal(err)
	}
	identity, err := store.Identity(t.Context())
	if err != nil || identity.MigrationSum != frozenV1Checksum {
		t.Fatalf("V1 Identity compatibility: %#v %v", identity, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	db := migrationTestDB(t, path)
	for _, step := range compiledMigrations() {
		var sum string
		var stamp int64
		if err := db.QueryRowContext(t.Context(), "SELECT checksum,applied_at_ns FROM schema_migrations WHERE version=?", step.version).Scan(&sum, &stamp); err != nil {
			t.Fatal(err)
		}
		if sum != step.checksum || stamp != fixedClockTime.UnixNano() {
			t.Fatalf("wrong migration %d identity/time", step.version)
		}
	}
	for _, table := range acceptanceTables {
		var count int
		if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("inferred %s rows", table)
		}
	}
	before := acceptanceSnapshot(t, db)
	store, err = OpenAtRootWithClock(t.Context(), root, path, func() time.Time { return fixedClockTime.Add(time.Hour) })
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if acceptanceSnapshot(t, db) != before {
		t.Fatal("reopen changed schema/history/state")
	}
}

func TestAcceptanceSchema_RejectsUnknownAndOldBinary(t *testing.T) {
	for _, malformed := range []string{"step2-checksum", "step2-timestamp", "gap-after-v1"} {
		t.Run(malformed, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err != nil {
				t.Fatal(err)
			}
			// Invalid incoming history fixture: apply actual DDL, then append a bad new
			// row. No applied immutable row is updated or deleted and no trigger is disabled.
			migrationExec(t, db, v2Migration)
			switch malformed {
			case "step2-checksum":
				migrationExec(t, db, "INSERT INTO schema_migrations VALUES(2,'wrong',43)")
				migrationExec(t, db, "UPDATE instance_state SET schema_version=2")
			case "step2-timestamp":
				migrationExec(t, db, "INSERT INTO schema_migrations VALUES(2,?,'bad')", compiledMigrations()[1].checksum)
				migrationExec(t, db, "UPDATE instance_state SET schema_version=2")
			case "gap-after-v1":
				migrationExec(t, db, "INSERT INTO schema_migrations VALUES(3,?,43)", acceptanceHash("gap"))
				migrationExec(t, db, "UPDATE instance_state SET schema_version=3")
			}
			before := acceptanceSnapshot(t, db)
			store, err := migrationOpen(t.Context(), root, path)
			if store != nil {
				if err := store.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if err == nil {
				t.Fatal("malformed later history accepted")
			}
			if acceptanceSnapshot(t, db) != before {
				t.Fatal("malformed later history rejection changed database")
			}
		})
	}
	for _, unknown := range []bool{false, true} {
		t.Run(fmt.Sprintf("unknown=%t", unknown), func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if err := migrationRun(t, db, t.Context(), compiledMigrations(), 42); err != nil {
				t.Fatal(err)
			}
			if unknown {
				migrationExec(t, db, "INSERT INTO schema_migrations VALUES(3,?,43)", domain.HashString("newer binary").String())
				migrationExec(t, db, "UPDATE instance_state SET schema_version=3")
			}
			before := acceptanceSnapshot(t, db)
			if unknown {
				store, err := migrationOpen(t.Context(), root, path)
				if store != nil {
					if err := store.Close(); err != nil {
						t.Fatal(err)
					}
				}
				if err == nil {
					t.Fatal("unknown newer accepted")
				}
			} else if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 43); err == nil {
				t.Fatal("old V1 registry accepted actual V2")
			}
			if acceptanceSnapshot(t, db) != before {
				t.Fatal("incompatible reopen changed database")
			}
		})
	}
}

func TestAcceptanceSchema_ActualV2RollbackRestart(t *testing.T) {
	for _, prefix := range []string{"fresh", "empty-v1", "populated-v1"} {
		for _, failure := range []string{"sql", "history", "state"} {
			t.Run(prefix+"/"+failure, func(t *testing.T) {
				root := t.TempDir()
				path := filepath.Join(root, "state.db")
				db := migrationTestDB(t, path)
				if prefix != "fresh" {
					if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err != nil {
						t.Fatal(err)
					}
				}
				if prefix == "populated-v1" {
					acceptancePopulateV1(t, db)
				}
				before := acceptanceSnapshot(t, db)
				statement := v2Migration
				switch failure {
				case "sql":
					statement += "\nINSERT INTO absent_failure_probe VALUES(1);"
				case "history":
					statement += "\nINSERT INTO schema_migrations VALUES(2,'conflicting test history',43);"
				case "state":
					statement += "\nDROP TABLE instance_state;"
				}
				registry := append(migrationTestRegistry(), migrationTestStep(2, statement))
				if err := migrationRun(t, db, t.Context(), registry, 43); err == nil {
					t.Fatal("actual V2 failing step accepted")
				}
				if acceptanceSnapshot(t, db) != before {
					t.Fatal("actual V2 DDL/history/state failed atomic rollback")
				}
				store, err := migrationOpen(t.Context(), root, path)
				if err != nil {
					t.Fatalf("actual V2 retry: %v", err)
				}
				if err := store.Close(); err != nil {
					t.Fatal(err)
				}
				var version int
				if err := db.QueryRowContext(t.Context(), "SELECT schema_version FROM instance_state").Scan(&version); err != nil {
					t.Fatal(err)
				}
				if version != 2 {
					t.Fatal("retry did not apply V2")
				}
				for _, table := range acceptanceTables {
					var count int
					if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
						t.Fatal(err)
					}
					if count != 0 {
						t.Fatal("retry inferred accepted data")
					}
				}
			})
		}
	}
}

func TestAcceptanceSchema_ActualV2CancelAndConcurrent(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("cancel/existing=%t", existing), func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			var called atomic.Bool
			name := fmt.Sprintf("acceptance_cancel_%d", migrationCancelFunctionSequence.Add(1))
			if err := driversqlite.RegisterScalarFunction(name, 0, func(_ *driversqlite.FunctionContext, _ []driver.Value) (driver.Value, error) {
				called.Store(true)
				cancel()
				return int64(1), nil
			}); err != nil {
				t.Fatal(err)
			}
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if existing {
				if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err != nil {
					t.Fatal(err)
				}
				acceptancePopulateV1(t, db)
			}
			before := acceptanceSnapshot(t, db)
			registry := append(migrationTestRegistry(), migrationTestStep(2, v2Migration+"\nSELECT "+name+"();"))
			err := migrationRun(t, db, ctx, registry, 43)
			if !called.Load() || !errors.Is(err, context.Canceled) {
				t.Fatalf("actual V2 DDL cancellation not reached: %v", err)
			}
			if acceptanceSnapshot(t, db) != before {
				t.Fatal("canceled actual V2 changed database")
			}
			store, err := migrationOpen(t.Context(), root, path)
			if err != nil {
				t.Fatalf("writer release/retry: %v", err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("concurrent/existing-v1=%t", existing), func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			if existing {
				db := migrationTestDB(t, path)
				if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err != nil {
					t.Fatal(err)
				}
				acceptancePopulateV1(t, db)
			}
			start := make(chan struct{})
			results := make(chan error, 4)
			var wg sync.WaitGroup
			for range 4 {
				wg.Go(func() {
					<-start
					store, err := migrationOpen(t.Context(), root, path)
					if store != nil {
						err = errors.Join(err, store.Close())
					}
					results <- err
				})
			}
			close(start)
			wg.Wait()
			close(results)
			successes := 0
			for err := range results {
				if err == nil {
					successes++
					continue
				}
				if _, ok := errors.AsType[BusyError](err); !ok {
					t.Fatalf("unexpected concurrent open error: %v", err)
				}
			}
			if successes == 0 {
				t.Fatal("no successful V2 startup")
			}
			db := migrationTestDB(t, path)
			var count, version int
			if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(t.Context(), "SELECT schema_version FROM instance_state").Scan(&version); err != nil {
				t.Fatal(err)
			}
			if count != 2 || version != 2 {
				t.Fatal("V2 startup did not converge")
			}
			store, err := migrationOpen(t.Context(), root, path)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

type acceptanceRow map[string]any

func acceptanceHash(value string) string { return domain.HashString(value).String() }

func acceptanceInsert(t *testing.T, db *sql.DB, table string, row acceptanceRow) {
	t.Helper()
	keys := make([]string, 0, len(row))
	for key := range row {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	args := make([]any, len(keys))
	marks := make([]string, len(keys))
	for i, key := range keys {
		args[i] = row[key]
		marks[i] = "?"
	}
	migrationExec(t, db, "INSERT INTO "+table+" ("+strings.Join(keys, ",")+") VALUES ("+strings.Join(marks, ",")+")", args...)
}

// Direct SQL fixtures describe storage relationships, not operator acceptance or
// SHA verification. Two projects provide genuine independently scoped parents.
func acceptanceFixture(t *testing.T) *sql.DB {
	t.Helper()
	db := migrationTestDB(t, filepath.Join(t.TempDir(), "state.db"))
	if err := migrationRun(t, db, t.Context(), compiledMigrations(), 42); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"p1", "p2"} {
		migrationExec(t, db, "INSERT INTO projects VALUES(?,?, 'legacy','main',1)", p, p)
		for _, wi := range []string{"w1", "w2"} {
			migrationExec(t, db, "INSERT INTO work_items VALUES(?,?,'title','goal','owner','Draft',1)", p, wi)
		}
		acceptanceInsert(t, db, "repository_binding_versions", acceptanceRow{"project_id": p, "repository_binding_id": "repo-" + p, "binding_version": 1, "binding_digest": acceptanceHash(p + "repo"), "object_format": "sha1", "binding_content": []byte("binding"), "approved_by_actor": "operator", "created_at_ns": 42})
		for _, rev := range []string{"r1", "r2"} {
			graph := acceptanceHash(p + rev + "graph")
			proposal := acceptanceHash(p + rev + "proposal")
			accepted := acceptanceHash(p + rev)
			migrationExec(t, db, "INSERT INTO dependency_revisions VALUES(?,?,X'01',42)", p, graph)
			acceptanceInsert(t, db, "specification_proposals", acceptanceRow{"project_id": p, "proposal_digest": proposal, "schema_version": 1, "repository_binding_id": "repo-" + p, "binding_version": 1, "object_format": "sha1", "commit_oid": strings.Repeat("a", 40), "manifest_path": "manifest.json", "manifest_blob_oid": strings.Repeat("b", 40), "manifest_digest": acceptanceHash(p + rev + "manifest"), "graph_revision_digest": graph, "canonical_content": []byte("proposal"), "created_at_ns": 42})
			row := acceptanceRow{"project_id": p, "accepted_revision_digest": accepted, "proposal_digest": proposal, "graph_revision_digest": graph, "normative_binding_digest": acceptanceHash(p + rev + "norm"), "policy_revision_digest": acceptanceHash("policy"), "acceptance_subject_digest": acceptanceHash(p + rev + "subject"), "canonical_content": []byte("accepted"), "acceptance_kind": "Initial", "base_accepted_revision_digest": nil, "impact_plan_digest": nil, "activation_decision_digest": nil, "decision_value": nil, "accepted_by_actor": "operator", "created_at_ns": 42}
			if rev == "r2" {
				base := acceptanceHash(p + "r1")
				plan := acceptanceHash(p + "plan")
				readset := acceptanceHash(p + "readset")
				decision := acceptanceHash(p + "decision")
				acceptanceInsert(t, db, "specification_impact_plans", acceptanceRow{"project_id": p, "plan_digest": plan, "kernel_plan_digest": acceptanceHash(p + "kernel"), "proposal_digest": proposal, "repository_binding_id": "repo-" + p, "binding_version": 1, "base_accepted_revision_digest": base, "base_graph_revision_digest": acceptanceHash(p + "r1graph"), "proposed_graph_revision_digest": graph, "policy_revision_digest": acceptanceHash("policy"), "read_set_digest": readset, "algorithm_version": "v1", "canonical_content": []byte("plan"), "created_at_ns": 42})
				acceptanceInsert(t, db, "specification_activation_decisions", acceptanceRow{"project_id": p, "decision_digest": decision, "plan_digest": plan, "proposal_digest": proposal, "base_accepted_revision_digest": base, "read_set_digest": readset, "operation": "ActivateSpecificationImpact", "decision_value": "Approve", "actor_id": "operator", "subject_digest": acceptanceHash(p + "decision-subject"), "canonical_content": []byte("decision"), "created_at_ns": 42})
				row["acceptance_kind"] = "Impact"
				row["base_accepted_revision_digest"] = base
				row["impact_plan_digest"] = plan
				row["activation_decision_digest"] = decision
				row["decision_value"] = "Approve"
			}
			acceptanceInsert(t, db, "accepted_spec_revisions", row)
			for _, ac := range []string{"ac1", "ac2"} {
				digest := acceptanceHash(p + rev + ac)
				migrationExec(t, db, "INSERT INTO ac_revisions VALUES(?,?,?,?,X'02',42)", p, rev+ac, ac, digest)
				acceptanceInsert(t, db, "accepted_revision_acs", acceptanceRow{"project_id": p, "accepted_revision_digest": accepted, "ac_id": ac, "ac_revision_digest": digest})
			}
			for _, wi := range []string{"w1", "w2"} {
				binding := acceptanceHash(p + rev + wi)
				acceptanceInsert(t, db, "accepted_work_item_bindings", acceptanceRow{"project_id": p, "accepted_revision_digest": accepted, "work_item_id": wi, "binding_digest": binding, "canonical_content": []byte("subset")})
				acceptanceInsert(t, db, "accepted_work_item_requirements", acceptanceRow{"project_id": p, "accepted_revision_digest": accepted, "work_item_id": wi, "binding_digest": binding, "ac_id": "ac1", "ac_revision_digest": acceptanceHash(p + rev + "ac1")})
			}
		}
		acceptanceInsert(t, db, "project_spec_heads", acceptanceRow{"project_id": p, "accepted_revision_digest": acceptanceHash(p + "r1"), "head_version": 1})
		for _, wi := range []string{"w1", "w2"} {
			acceptanceInsert(t, db, "work_item_spec_heads", acceptanceRow{"project_id": p, "work_item_id": wi, "accepted_revision_digest": acceptanceHash(p + "r1"), "binding_digest": acceptanceHash(p + "r1" + wi), "head_version": 1})
			acceptanceInsert(t, db, "current_ac_requirements", acceptanceRow{"project_id": p, "work_item_id": wi, "accepted_revision_digest": acceptanceHash(p + "r1"), "binding_digest": acceptanceHash(p + "r1" + wi), "ac_id": "ac1", "ac_revision_digest": acceptanceHash(p + "r1ac1")})
		}
	}
	return db
}

func acceptanceReadRow(t *testing.T, db *sql.DB, table, where string) acceptanceRow {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), "SELECT * FROM "+table+" WHERE "+where+" LIMIT 1")
	if err != nil {
		t.Fatal(err)
	}
	columns, err := rows.Columns()
	if err != nil {
		t.Fatal(err)
	}
	if !rows.Next() {
		t.Fatal("missing valid fixture row")
	}
	values := make([]any, len(columns))
	ptrs := make([]any, len(columns))
	for i := range values {
		ptrs[i] = &values[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		t.Fatal(err)
	}
	row := make(acceptanceRow, len(columns))
	for i, col := range columns {
		row[col] = values[i]
	}
	if rows.Next() {
		t.Fatal("LIMIT 1 fixture returned multiple rows")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	return row
}

func acceptanceInsertStatement(table string, row acceptanceRow) (string, []any) {
	keys := make([]string, 0, len(row))
	for key := range row {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	args := make([]any, len(keys))
	marks := make([]string, len(keys))
	for i, key := range keys {
		args[i] = row[key]
		marks[i] = "?"
	}
	return "INSERT INTO " + table + " (" + strings.Join(keys, ",") + ") VALUES (" + strings.Join(marks, ",") + ")", args
}

func TestAcceptanceSchema_ScopedRelationsAndHeadSwap(t *testing.T) {
	t.Run("sha256-object-format-positive", func(t *testing.T) {
		db := acceptanceFixture(t)
		binding := acceptanceReadRow(t, db, "repository_binding_versions", "project_id='p1'")
		binding["repository_binding_id"] = "repo-sha256"
		binding["object_format"] = "sha256"
		acceptanceInsert(t, db, "repository_binding_versions", binding)
		row := acceptanceReadRow(t, db, "specification_proposals", "project_id='p1'")
		row["proposal_digest"] = acceptanceHash("sha256-proposal")
		row["repository_binding_id"] = "repo-sha256"
		row["object_format"] = "sha256"
		row["commit_oid"] = strings.Repeat("a", 64)
		row["manifest_blob_oid"] = strings.Repeat("b", 64)
		acceptanceInsert(t, db, "specification_proposals", row)
	})
	t.Run("reject-decision-cannot-back-accepted-impact", func(t *testing.T) {
		db := acceptanceFixture(t)
		decision := acceptanceReadRow(t, db, "specification_activation_decisions", "project_id='p1'")
		decision["decision_digest"] = acceptanceHash("rejected-decision")
		decision["decision_value"] = "Reject"
		acceptanceInsert(t, db, "specification_activation_decisions", decision)
		row := acceptanceReadRow(t, db, "accepted_spec_revisions", "project_id='p1' AND acceptance_kind='Impact'")
		row["accepted_revision_digest"] = acceptanceHash("new-accepted")
		row["activation_decision_digest"] = decision["decision_digest"]
		before := acceptanceSnapshot(t, db)
		statement, args := acceptanceInsertStatement("accepted_spec_revisions", row)
		if _, err := db.ExecContext(t.Context(), statement, args...); err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
			t.Fatalf("Reject decision referenced as Approve: %v", err)
		}
		if acceptanceSnapshot(t, db) != before {
			t.Fatal("rejected decision changed accepted history")
		}
	})
	// Each cloned insert has a new PK, valid remaining parents, and one deliberately
	// changed relationship. This prevents immutable/duplicate-key rejection masking FKs.
	for _, test := range []struct {
		name, table, column string
		value               any
	}{
		{"repository-project", "repository_binding_versions", "project_id", "absent-project"},
		{"proposal-repository", "specification_proposals", "repository_binding_id", "repo-p2"},
		{"proposal-binding-version", "specification_proposals", "binding_version", 2},
		{"proposal-graph", "specification_proposals", "graph_revision_digest", acceptanceHash("p2r1graph")},
		{"revision-proposal", "accepted_spec_revisions", "proposal_digest", acceptanceHash("p2r2proposal")},
		{"revision-proposal-graph", "accepted_spec_revisions", "graph_revision_digest", acceptanceHash("p1r1graph")},
		{"revision-base", "accepted_spec_revisions", "base_accepted_revision_digest", acceptanceHash("p2r1")},
		{"revision-plan", "accepted_spec_revisions", "impact_plan_digest", acceptanceHash("p2plan")},
		{"revision-decision", "accepted_spec_revisions", "activation_decision_digest", acceptanceHash("p2decision")},
		{"accepted-ac", "accepted_revision_acs", "ac_revision_digest", acceptanceHash("p2r1ac2")},
		{"binding-revision", "accepted_work_item_bindings", "accepted_revision_digest", acceptanceHash("p2r1")},
		{"binding-workitem", "accepted_work_item_bindings", "work_item_id", "absent-workitem"},
		{"requirement-binding", "accepted_work_item_requirements", "binding_digest", acceptanceHash("p1r1w2")},
		{"requirement-revision", "accepted_work_item_requirements", "accepted_revision_digest", acceptanceHash("p1r2")},
		{"requirement-ac", "accepted_work_item_requirements", "ac_revision_digest", acceptanceHash("p2r1ac2")},
		{"plan-proposal", "specification_impact_plans", "proposal_digest", acceptanceHash("p2r2proposal")},
		{"plan-repository", "specification_impact_plans", "repository_binding_id", "repo-p2"},
		{"plan-binding-version", "specification_impact_plans", "binding_version", 2},
		{"plan-base", "specification_impact_plans", "base_accepted_revision_digest", acceptanceHash("p2r1")},
		{"plan-base-graph", "specification_impact_plans", "base_graph_revision_digest", acceptanceHash("p1r2graph")},
		{"plan-proposed-graph", "specification_impact_plans", "proposed_graph_revision_digest", acceptanceHash("p1r1graph")},
		{"decision-plan", "specification_activation_decisions", "plan_digest", acceptanceHash("p2plan")},
		{"decision-proposal", "specification_activation_decisions", "proposal_digest", acceptanceHash("p2r2proposal")},
		{"decision-base", "specification_activation_decisions", "base_accepted_revision_digest", acceptanceHash("p2r1")},
		{"decision-readset", "specification_activation_decisions", "read_set_digest", acceptanceHash("p2readset")},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := acceptanceFixture(t)
			row := acceptanceReadRow(t, db, test.table, "project_id='p1'")
			switch test.table {
			case "repository_binding_versions":
				row["repository_binding_id"] = "new-binding"
			case "specification_proposals":
				row["proposal_digest"] = acceptanceHash("new-proposal")
			case "accepted_spec_revisions":
				row = acceptanceReadRow(t, db, test.table, "project_id='p1' AND acceptance_kind='Impact'")
				row["accepted_revision_digest"] = acceptanceHash("new-revision")
			case "accepted_revision_acs":
				row["ac_id"] = "ac3"
				migrationExec(t, db, "INSERT INTO ac_revisions VALUES('p2','foreign-ac3','ac3',?,X'01',42)", test.value)
			case "accepted_work_item_bindings":
				row["work_item_id"] = "w3"
				migrationExec(t, db, "INSERT INTO work_items VALUES('p1','w3','title','goal','owner','Draft',1)")
			case "accepted_work_item_requirements":
				row = acceptanceReadRow(t, db, test.table, "project_id='p1' AND accepted_revision_digest='"+acceptanceHash("p1r1")+"' AND work_item_id='w1'")
				row["ac_id"] = "ac2"
				row["ac_revision_digest"] = acceptanceHash("p1r1ac2")
			case "specification_impact_plans":
				row["plan_digest"] = acceptanceHash("new-plan")
			case "specification_activation_decisions":
				row["decision_digest"] = acceptanceHash("new-decision")
			}
			row[test.column] = test.value
			before := acceptanceSnapshot(t, db)
			statement, args := acceptanceInsertStatement(test.table, row)
			_, err := db.ExecContext(t.Context(), statement, args...)
			if err == nil || !strings.Contains(err.Error(), "FOREIGN KEY constraint failed") {
				t.Fatalf("expected scoped FK rejection, got %v", err)
			}
			if acceptanceSnapshot(t, db) != before {
				t.Fatal("FK rejection changed durable rows")
			}
		})
	}
	for _, test := range []struct {
		name, sql, want string
		args            []any
	}{
		{"project-head-proposal", "UPDATE project_spec_heads SET accepted_revision_digest=? WHERE project_id='p1'", "FOREIGN KEY", []any{acceptanceHash("p1r1proposal")}},
		{"workitem-head-crossproject", "UPDATE work_item_spec_heads SET accepted_revision_digest=? WHERE project_id='p1' AND work_item_id='w1'", "FOREIGN KEY", []any{acceptanceHash("p2r1")}},
		{"workitem-head-subset", "UPDATE work_item_spec_heads SET binding_digest=? WHERE project_id='p1' AND work_item_id='w1'", "FOREIGN KEY", []any{acceptanceHash("p1r1w2")}},
		{"current-subset", "UPDATE current_ac_requirements SET binding_digest=? WHERE project_id='p1' AND work_item_id='w1'", "FOREIGN KEY", []any{acceptanceHash("p1r1w2")}},
		{"current-ac", "UPDATE current_ac_requirements SET ac_revision_digest=? WHERE project_id='p1' AND work_item_id='w1'", "FOREIGN KEY", []any{acceptanceHash("p2r1ac1")}},
		{"null-project", "UPDATE project_spec_heads SET project_id=NULL WHERE project_id='p1'", "NOT NULL", nil},
		{"null-workitem", "UPDATE work_item_spec_heads SET work_item_id=NULL WHERE project_id='p1'", "NOT NULL", nil},
		{"null-revision", "UPDATE current_ac_requirements SET accepted_revision_digest=NULL WHERE project_id='p1'", "NOT NULL", nil},
		{"null-binding", "UPDATE current_ac_requirements SET binding_digest=NULL WHERE project_id='p1'", "NOT NULL", nil},
		{"head-version-type", "UPDATE project_spec_heads SET head_version='bad' WHERE project_id='p1'", "cannot store TEXT", nil},
		{"head-version-positive", "UPDATE project_spec_heads SET head_version=0 WHERE project_id='p1'", "CHECK constraint", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := acceptanceFixture(t)
			before := acceptanceSnapshot(t, db)
			_, err := db.ExecContext(t.Context(), test.sql, test.args...)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("guard rejection: %v", err)
			}
			if acceptanceSnapshot(t, db) != before {
				t.Fatal("guard mutation leaked")
			}
		})
	}
	for _, test := range []struct {
		name, column string
		value        any
		want         string
	}{
		{"oid-length", "commit_oid", "bad", "CHECK constraint"},
		{"oid-uppercase", "manifest_blob_oid", strings.Repeat("A", 40), "CHECK constraint"},
		{"object-format", "object_format", "other", "CHECK constraint"},
		{"digest-shape", "manifest_digest", "bad", "CHECK constraint"},
		{"empty-content", "canonical_content", []byte{}, "CHECK constraint"},
		{"null-repository", "repository_binding_id", nil, "NOT NULL"},
		{"null-proposal", "proposal_digest", nil, "NOT NULL"},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := acceptanceFixture(t)
			row := acceptanceReadRow(t, db, "specification_proposals", "project_id='p1'")
			row["proposal_digest"] = acceptanceHash("new-proposal")
			row[test.column] = test.value
			before := acceptanceSnapshot(t, db)
			statement, args := acceptanceInsertStatement("specification_proposals", row)
			_, err := db.ExecContext(t.Context(), statement, args...)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("format rejection: %v", err)
			}
			if acceptanceSnapshot(t, db) != before {
				t.Fatal("format rejection changed rows")
			}
		})
	}
	t.Run("nullable-impact-check", func(t *testing.T) {
		db := acceptanceFixture(t)
		row := acceptanceReadRow(t, db, "accepted_spec_revisions", "project_id='p1' AND acceptance_kind='Impact'")
		row["accepted_revision_digest"] = acceptanceHash("new-accepted")
		row["decision_value"] = nil
		statement, args := acceptanceInsertStatement("accepted_spec_revisions", row)
		if _, err := db.ExecContext(t.Context(), statement, args...); err == nil || !strings.Contains(err.Error(), "CHECK constraint") {
			t.Fatalf("NULL bypassed impact CHECK: %v", err)
		}
	})
	for _, complete := range []bool{false, true} {
		t.Run(fmt.Sprintf("whole-head-swap=%t", complete), func(t *testing.T) {
			db := acceptanceFixture(t)
			before := acceptanceSnapshot(t, db)
			err := acceptanceSwap(t, db, complete)
			if !complete {
				if err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
					t.Fatalf("partial swap committed: %v", err)
				}
				if acceptanceSnapshot(t, db) != before {
					t.Fatal("partial swap was not rolled back")
				}
				return
			}
			if err != nil {
				t.Fatalf("lawful deferred swap rejected: %v", err)
			}
			var count int
			if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM current_ac_requirements c JOIN work_item_spec_heads w USING(project_id,work_item_id,accepted_revision_digest,binding_digest) JOIN project_spec_heads p USING(project_id,accepted_revision_digest) WHERE c.project_id='p1' AND c.accepted_revision_digest=?", acceptanceHash("p1r2")).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 2 {
				t.Fatal("head swap missing requirements")
			}
			migrationExec(t, db, "UPDATE projects SET version=version+7 WHERE project_id='p1'; UPDATE work_items SET version=version+3 WHERE project_id='p1'")
			var head int
			if err := db.QueryRowContext(t.Context(), "SELECT head_version FROM project_spec_heads WHERE project_id='p1'").Scan(&head); err != nil {
				t.Fatal(err)
			}
			if head != 2 {
				t.Fatal("aggregate version mutation unexpectedly changed head")
			}
		})
	}
}

func acceptanceSwap(t *testing.T, db *sql.DB, complete bool) (resultErr error) {
	t.Helper()
	conn, err := db.Conn(t.Context())
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, conn.Close()) }()
	if _, err := conn.ExecContext(t.Context(), "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_, err := conn.ExecContext(context.Background(), "ROLLBACK")
			resultErr = errors.Join(resultErr, err)
		}
	}()
	if _, err := conn.ExecContext(t.Context(), "UPDATE project_spec_heads SET accepted_revision_digest=?,head_version=2 WHERE project_id='p1'", acceptanceHash("p1r2")); err != nil {
		return err
	}
	if complete {
		for _, wi := range []string{"w1", "w2"} {
			if _, err := conn.ExecContext(t.Context(), "UPDATE work_item_spec_heads SET accepted_revision_digest=?,binding_digest=?,head_version=2 WHERE project_id='p1' AND work_item_id=?", acceptanceHash("p1r2"), acceptanceHash("p1r2"+wi), wi); err != nil {
				return err
			}
			if _, err := conn.ExecContext(t.Context(), "UPDATE current_ac_requirements SET accepted_revision_digest=?,binding_digest=?,ac_revision_digest=? WHERE project_id='p1' AND work_item_id=?", acceptanceHash("p1r2"), acceptanceHash("p1r2"+wi), acceptanceHash("p1r2ac1"), wi); err != nil {
				return err
			}
		}
	}
	if _, err := conn.ExecContext(t.Context(), "COMMIT"); err != nil {
		return err
	}
	committed = true
	return nil
}

func TestAcceptanceSchema_ImmutableHistoryAndReplacement(t *testing.T) {
	for _, table := range acceptanceTables {
		if slices.Contains([]string{"project_spec_heads", "work_item_spec_heads", "current_ac_requirements"}, table) {
			continue
		}
		t.Run(table, func(t *testing.T) {
			db := acceptanceFixture(t)
			migrationExec(t, db, "PRAGMA recursive_triggers=OFF")
			var recursive, count int
			if err := db.QueryRowContext(t.Context(), "PRAGMA recursive_triggers").Scan(&recursive); err != nil {
				t.Fatal(err)
			}
			if recursive != 0 {
				t.Fatal("fixture needs recursive_triggers off")
			}
			if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count < 2 {
				t.Fatal("distinct historical inserts not demonstrated")
			}
			before := acceptanceSnapshot(t, db)
			row := acceptanceReadRow(t, db, table, "project_id='p1'")
			statement, args := acceptanceInsertStatement(table, row)
			checks := []struct {
				name, sql string
				args      []any
			}{
				{"update", "UPDATE " + table + " SET project_id=project_id WHERE project_id='p1'", nil},
				{"delete", "DELETE FROM " + table + " WHERE project_id='p1'", nil},
				{"duplicate", statement, args}, {"ignore", strings.Replace(statement, "INSERT INTO", "INSERT OR IGNORE INTO", 1), args},
				{"replace", strings.Replace(statement, "INSERT INTO", "INSERT OR REPLACE INTO", 1), args},
				{"replace-spelling", strings.Replace(statement, "INSERT INTO", "REPLACE INTO", 1), args},
			}
			rows, err := db.QueryContext(t.Context(), "PRAGMA index_list("+table+")")
			if err != nil {
				t.Fatal(err)
			}
			var indexes []string
			for rows.Next() {
				var seq, unique, partial int
				var name, origin string
				if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
					t.Fatal(err)
				}
				if unique == 1 {
					indexes = append(indexes, name)
				}
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			if err := rows.Close(); err != nil {
				t.Fatal(err)
			}
			for _, index := range indexes {
				rows, err := db.QueryContext(t.Context(), "PRAGMA index_info("+index+")")
				if err != nil {
					t.Fatal(err)
				}
				var keys []string
				for rows.Next() {
					var seq, cid int
					var col string
					if err := rows.Scan(&seq, &cid, &col); err != nil {
						t.Fatal(err)
					}
					keys = append(keys, col)
				}
				if err := rows.Err(); err != nil {
					t.Fatal(err)
				}
				if err := rows.Close(); err != nil {
					t.Fatal(err)
				}
				// Alternate keys are PK supersets: these coincident-key controls deliberately
				// do not invent an independently distinct alternate-key collision.
				checks = append(checks, struct {
					name, sql string
					args      []any
				}{"upsert/" + index, statement + " ON CONFLICT (" + strings.Join(keys, ",") + ") DO UPDATE SET project_id=excluded.project_id", args})
			}
			for _, check := range checks {
				t.Run(check.name, func(t *testing.T) {
					if _, err := db.ExecContext(t.Context(), check.sql, check.args...); err == nil || !strings.Contains(err.Error(), "immutable") {
						t.Fatalf("expected immutable trigger rejection on valid fixture, got %v", err)
					}
					if acceptanceSnapshot(t, db) != before {
						t.Fatal("immutable history changed")
					}
				})
			}
		})
	}
}
