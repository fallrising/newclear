package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/testfixture"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

func storagePolicy(t *testing.T, id domain.ProjectID) port.PolicyProfile {
	t.Helper()
	p, e := port.NewPolicyProfile(port.PolicyProfileMaterial{Schema: 1, ProjectID: id, RecipeDigest: domain.HashString("recipe").String(), IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}, Rules: []port.RunInputVerificationRule{{ACID: "AC-1", VerifierClass: "human", Independent: true, EnvironmentDigest: domain.HashString("environment").String()}}})
	if e != nil {
		t.Fatal(e)
	}
	return p
}

func registrationRows(t *testing.T, s *Store) int {
	t.Helper()
	var n int
	if e := s.db.QueryRow("SELECT count(*) FROM project_completion_policies").Scan(&n); e != nil {
		t.Fatal(e)
	}
	return n
}

func TestPolicyProfiles_ImmutableRegistration(t *testing.T) {
	s := openTestStore(t)
	t.Cleanup(func() { _ = s.Close() })
	var n int
	if err := s.db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='project_completion_policies'").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatal("immutable project policy registration table missing")
	}
	mustCreateProject(t, s)
	p := storagePolicy(t, "project-1")
	selected := map[domain.ProjectID]port.PolicyProfile{"project-1": p}
	if e := s.RegisterPolicyProfiles(t.Context(), selected, 42); e != nil {
		t.Fatal(e)
	}
	for _, query := range []string{"UPDATE project_completion_policies SET registered_at_ns=43", "DELETE FROM project_completion_policies", "INSERT OR REPLACE INTO project_completion_policies SELECT * FROM project_completion_policies", "REPLACE INTO project_completion_policies SELECT * FROM project_completion_policies", "INSERT OR IGNORE INTO project_completion_policies SELECT * FROM project_completion_policies", "INSERT INTO project_completion_policies SELECT * FROM project_completion_policies WHERE true ON CONFLICT DO NOTHING", "INSERT INTO project_completion_policies SELECT * FROM project_completion_policies WHERE true ON CONFLICT(project_id) DO UPDATE SET registered_at_ns=43"} {
		if _, e := s.db.Exec(query); e == nil {
			t.Fatal("immutable SQL accepted", query)
		}
	}
	if e := s.RegisterPolicyProfiles(t.Context(), selected, 99); e != nil {
		t.Fatal(e)
	}
	var data []byte
	var stamp int64
	if e := s.db.QueryRow("SELECT canonical_content,registered_at_ns FROM project_completion_policies").Scan(&data, &stamp); e != nil || stamp != 42 || !bytes.Equal(data, p.CanonicalJSON()) {
		t.Fatal("restart changed row", e)
	}
	for _, bad := range []map[domain.ProjectID]port.PolicyProfile{nil, {}, {"wrong": p}} {
		if e := s.RegisterPolicyProfiles(t.Context(), bad, 99); e == nil {
			t.Fatal("omitted or mis-scoped profile admitted")
		}
	}
	m := p.Material()
	m.ApprovalRequired = true
	changed, e := port.NewPolicyProfile(m)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.RegisterPolicyProfiles(t.Context(), map[domain.ProjectID]port.PolicyProfile{"project-1": changed}, 99); e == nil {
		t.Fatal("changed headless policy admitted")
	}
	if registrationRows(t, s) != 1 {
		t.Fatal("registration count")
	}
}

func TestPolicyProfiles_AtomicAndConcurrentRegistration(t *testing.T) {
	s := openTestStore(t)
	t.Cleanup(func() { _ = s.Close() })
	mustCreateProject(t, s)
	mustCreateProjectID(t, s, "project-2")
	a, b := storagePolicy(t, "project-1"), storagePolicy(t, "project-2")
	selected := map[domain.ProjectID]port.PolicyProfile{"project-1": a, "project-2": b}
	mustExec(t, s, `CREATE TRIGGER policy_later_insert_failure BEFORE INSERT ON project_completion_policies WHEN NEW.project_id='project-2' BEGIN SELECT RAISE(ABORT,'injected later failure'); END`)
	if e := s.RegisterPolicyProfiles(t.Context(), selected, 42); e == nil {
		t.Fatal("injected insert succeeded")
	}
	if registrationRows(t, s) != 0 {
		t.Fatal("partial batch committed")
	}
	mustExec(t, s, "DROP TRIGGER policy_later_insert_failure")
	var seq int
	var name, path string
	if e := s.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); e != nil {
		t.Fatal(e)
	}
	other, e := OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedClock(42))
	if e != nil {
		t.Fatal(e)
	}
	defer other.Close()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, store := range []*Store{s, other} {
		wg.Go(func() { results <- store.RegisterPolicyProfiles(t.Context(), selected, 42) })
	}
	wg.Wait()
	close(results)
	for e := range results {
		if e != nil {
			t.Fatal(e)
		}
	}
	if registrationRows(t, s) != 2 {
		t.Fatal("concurrent registration duplicated")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if e = s.RegisterPolicyProfiles(ctx, selected, 42); e == nil {
		t.Fatal("cancellation ignored")
	}
}

func TestPolicyProfiles_StartupCompatibility(t *testing.T) {
	for _, kind := range []string{"unknown", "legacy-run", "legacy-accepted", "registered-compatible", "registered-policy", "registered-recipe", "registered-rule", "registered-extra-revision", "registered-missing-head", "registered-missing-current", "registered-extra-head", "registered-extra-current", "registered-missing-target", "registered-forged-column", "corrupt-bytes", "corrupt-digest", "corrupt-scope", "orphan-head", "orphan-current"} {
		t.Run(kind, func(t *testing.T) {
			s := openTestStore(t)
			t.Cleanup(func() { _ = s.Close() })
			if kind != "unknown" {
				mustCreateProject(t, s)
				mustCreateWorkItem(t, s, mustWorkItem(t, "item-1", "project-1", domain.PhaseDraft, 1))
			}
			p := storagePolicy(t, "project-1")
			selected := map[domain.ProjectID]port.PolicyProfile{"project-1": p}
			registered := kind != "unknown" && kind != "legacy-run" && kind != "legacy-accepted" && kind != "orphan-head" && kind != "orphan-current"
			if registered {
				if e := s.RegisterPolicyProfiles(t.Context(), selected, 42); e != nil {
					t.Fatal(e)
				}
			}
			switch kind {
			case "legacy-run":
				mustExec(t, s, fullRunInsert("project-1", "legacy-run", "item-1"), domain.HashString("legacy").String())
			case "corrupt-bytes", "corrupt-digest", "corrupt-scope":
				mustExec(t, s, "DROP TRIGGER project_completion_policies_no_update")
				if kind == "corrupt-bytes" {
					mustExec(t, s, "UPDATE project_completion_policies SET canonical_content=?", []byte("{}"))
				} else if kind == "corrupt-scope" {
					other := storagePolicy(t, "other-project")
					mustExec(t, s, "UPDATE project_completion_policies SET revision_digest=?,canonical_content=?", other.Digest().String(), other.CanonicalJSON())
				} else {
					mustExec(t, s, "UPDATE project_completion_policies SET revision_digest=?", domain.HashString("wrong").String())
				}
			case "orphan-head", "orphan-current":
				mustExec(t, s, "PRAGMA foreign_keys=OFF")
				d := domain.HashString("absent").String()
				if kind == "orphan-head" {
					mustExec(t, s, `INSERT INTO project_spec_heads VALUES('project-1',?,1)`, d)
				} else {
					mustExec(t, s, `INSERT INTO current_ac_requirements VALUES('project-1','item-1',?,?,'AC-1',?)`, d, d, d)
				}
			case "unknown":
			default:
				policy, recipe, ac := p.Digest(), domain.HashString("recipe"), domain.ACID("AC-1")
				if kind == "legacy-accepted" {
					policy = domain.HashString("local-policy-v1")
				}
				if kind == "registered-policy" {
					policy = domain.HashString("other")
				}
				if kind == "registered-recipe" {
					recipe = domain.HashString("other")
				}
				if kind == "registered-rule" {
					ac = "missing"
				}
				if e := testfixture.Accept(t.Context(), s, "project-1", "operator", policy, recipe, ac, []byte("AC"), []domain.WorkItemID{"item-1"}, 42); e != nil {
					t.Fatal(e)
				}
				switch kind {
				case "registered-missing-head":
					mustExec(t, s, "PRAGMA foreign_keys=OFF")
					mustExec(t, s, "DELETE FROM project_spec_heads")
				case "registered-missing-current":
					mustExec(t, s, "DELETE FROM current_ac_requirements")
				case "registered-extra-head":
					mustExec(t, s, "PRAGMA foreign_keys=OFF")
					mustExec(t, s, `INSERT INTO work_item_spec_heads SELECT project_id,'extra',?,binding_digest,head_version FROM work_item_spec_heads`, domain.HashString("other").String())
				case "registered-extra-current":
					mustExec(t, s, "PRAGMA foreign_keys=OFF")
					mustExec(t, s, `INSERT INTO current_ac_requirements SELECT project_id,work_item_id,?,binding_digest,'extra',ac_revision_digest FROM current_ac_requirements`, domain.HashString("other").String())
				case "registered-missing-target":
					mustExec(t, s, "PRAGMA foreign_keys=OFF")
					mustExec(t, s, "DROP TRIGGER accepted_spec_revisions_immutable_delete")
					mustExec(t, s, "DELETE FROM accepted_spec_revisions")
				case "registered-forged-column":
					mustExec(t, s, "DROP TRIGGER accepted_spec_revisions_immutable_update")
					mustExec(t, s, "UPDATE accepted_spec_revisions SET policy_revision_digest=?", domain.HashString("wrong").String())
				case "registered-extra-revision":
					mustExec(t, s, "PRAGMA foreign_keys=OFF")
					mustExec(t, s, `INSERT INTO accepted_spec_revisions SELECT project_id,?,proposal_digest,graph_revision_digest,normative_binding_digest,policy_revision_digest,acceptance_subject_digest,canonical_content,acceptance_kind,base_accepted_revision_digest,impact_plan_digest,activation_decision_digest,decision_value,accepted_by_actor,created_at_ns FROM accepted_spec_revisions`, domain.HashString("other").String())
				}
			}
			before := registrationRows(t, s)
			e := s.RegisterPolicyProfiles(t.Context(), selected, 99)
			if (e == nil) != (kind == "registered-compatible") {
				t.Fatalf("compatibility %s: %v", kind, e)
			}
			if strings.HasPrefix(kind, "corrupt-") || strings.HasPrefix(kind, "orphan-") || strings.HasPrefix(kind, "registered-missing-") || strings.HasPrefix(kind, "registered-extra-") || kind == "registered-forged-column" {
				if !errors.Is(e, domain.ErrStorageCorruption) {
					t.Fatalf("structural corruption lost classification: %s %v", kind, e)
				}
			}
			if registrationRows(t, s) != before {
				t.Fatal("rejection changed registrations")
			}
			if !registered && kind != "unknown" {
				if e = s.RegisterPolicyProfiles(t.Context(), nil, 99); e != nil {
					t.Fatal("unconfigured legacy behavior changed", e)
				}
			}
		})
	}
}

func policyV5Snapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name<>'project_completion_policies' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	for _, name := range names {
		query := "SELECT * FROM " + name
		if name == "schema_migrations" {
			query += " WHERE version<=5"
		}
		if name == "instance_state" {
			query = "SELECT id,restore_generation,stream_epoch,next_event_sequence FROM instance_state"
		}
		rows, err = db.QueryContext(t.Context(), query)
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
			if err = rows.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			records = append(records, fmt.Sprintf("%#v", values))
		}
		if err = errors.Join(rows.Err(), rows.Close()); err != nil {
			t.Fatal(err)
		}
		slices.Sort(records)
		fmt.Fprintf(&out, "%s:%v\n", name, records)
	}
	rows, err = db.QueryContext(t.Context(), `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name<>'project_completion_policies' ORDER BY type,name`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var kind, name, owner string
		var statement sql.NullString
		if err = rows.Scan(&kind, &name, &owner, &statement); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&out, "%s/%s/%s/%v\n", kind, name, owner, statement)
	}
	if err = errors.Join(rows.Err(), rows.Close()); err != nil {
		t.Fatal(err)
	}
	return out.String()
}
func TestPolicyProfiles_MigrationUpgradeAndRollback(t *testing.T) {
	for _, failure := range []string{"none", "sql", "history", "state"} {
		t.Run(failure, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if e := migrationRun(t, db, t.Context(), compiledMigrations()[:5], 42); e != nil {
				t.Fatal(e)
			}
			acceptancePopulateV1(t, db)
			old := policyV5Snapshot(t, db)
			before := migrationLogicalSnapshot(t, db)
			if failure != "none" {
				statement := v6Migration
				switch failure {
				case "sql":
					statement += ";INSERT INTO absent_policy_probe VALUES(1);"
				case "history":
					statement += ";INSERT INTO schema_migrations VALUES(6,'conflict',43);"
				case "state":
					statement += ";DROP TABLE instance_state;"
				}
				registry := append(slices.Clone(compiledMigrations()[:5]), migrationTestStep(6, statement))
				if e := migrationRun(t, db, t.Context(), registry, 43); e == nil {
					t.Fatal("faulty migration accepted")
				}
				if policyV5Snapshot(t, db) != old || migrationLogicalSnapshot(t, db) != before {
					t.Fatal("failed migration changed V5")
				}
			}
			s, e := migrationOpen(t.Context(), root, path)
			if e != nil {
				t.Fatal(e)
			}
			if registrationRows(t, s) != 0 {
				t.Fatal("legacy policy backfilled")
			}
			_ = s.Close()
			if policyV5Snapshot(t, db) != old {
				t.Fatal("V5 schema/history changed")
			}
			after := migrationLogicalSnapshot(t, db)
			s, e = migrationOpen(t.Context(), root, path)
			if e != nil {
				t.Fatal(e)
			}
			_ = s.Close()
			if migrationLogicalSnapshot(t, db) != after {
				t.Fatal("reopen rewrote migration")
			}
		})
	}
}
