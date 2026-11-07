package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const indexRun domain.RunID = "run_0000000001"

func indexFixture(t *testing.T) *Store {
	t.Helper()
	store := openTestStore(t)
	t.Cleanup(func() { store.Close() })
	mustCreateProjectID(t, store, projectionProject)
	mustCreateWorkItem(t, store, mustWorkItem(t, projectionWork, projectionProject, domain.PhaseDraft, 1))
	return store
}
func indexRead(t *testing.T, store *Store) port.WorkItemMaterialIndex {
	t.Helper()
	result, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func indexRunFixture(t *testing.T, store *Store) {
	t.Helper()
	mustExec(t, store, fullRunInsert(string(projectionProject), string(indexRun), string(projectionWork)), domain.HashString("run-input").String())
}
func indexCandidateFixture(t *testing.T, store *Store, id string) {
	t.Helper()
	mustExec(t, store, `INSERT INTO candidates VALUES(?,?,?,?,?,1)`, projectionProject, id, indexRun, domain.HashString(id).String(), domain.HashString("historically-different-input").String())
}
func indexACFixture(t *testing.T, store *Store, id string) {
	t.Helper()
	digest := domain.HashString(id).String()
	mustExec(t, store, `INSERT INTO ac_revisions VALUES(?,?,?,?,X'01',1)`, projectionProject, "revision-"+id, id, digest)
	mustExec(t, store, `INSERT INTO work_item_ac_requirements VALUES(?,?,?,?)`, projectionProject, projectionWork, id, digest)
}

func TestWorkItemMaterialIndex_StoredIdentityAndHistory(t *testing.T) {
	t.Run("empty-and-scoped", func(t *testing.T) {
		store := indexFixture(t)
		result := indexRead(t, store)
		if result.ProjectID != projectionProject || result.WorkItemID != projectionWork || result.Title != "title" || result.Goal != "goal" || result.OwnerID != "owner" || result.Phase != domain.PhaseDraft || result.Version != 1 || result.Accepted != nil || result.RequiredACRevisions == nil || result.Runs == nil || result.Candidates == nil || result.Cursor != (port.Cursor{Epoch: 1}) || result.RestoreGeneration != 1 {
			t.Fatalf("unexpected empty snapshot: %+v", result)
		}
		mustCreateProjectID(t, store, "prj_0000000002")
		for _, scope := range [][2]string{{"prj_0000000009", string(projectionWork)}, {string(projectionProject), "wi_0000000009"}, {"prj_0000000002", string(projectionWork)}} {
			got, err := store.ReadWorkItemMaterialIndex(t.Context(), domain.ProjectID(scope[0]), domain.WorkItemID(scope[1]))
			if !errors.Is(err, port.ErrNotFound) || got.WorkItemID != "" {
				t.Fatalf("missing scope=%+v %v", got, err)
			}
		}
	})
	for _, phase := range []domain.Phase{domain.PhaseDraft, domain.PhaseReady, domain.PhaseDeveloping, domain.PhaseReview, domain.PhaseQA, domain.PhaseCanceled} {
		t.Run(string(phase), func(t *testing.T) {
			store := indexFixture(t)
			mustExec(t, store, `UPDATE work_items SET phase=?`, phase)
			if indexRead(t, store).Phase != phase {
				t.Fatal("changed stored phase")
			}
		})
	}
	t.Run("injected-history-byte-exact-order-and-independent-inputs", func(t *testing.T) {
		store := indexFixture(t)
		for _, id := range []string{"驗收 / A", " B", "Z"} {
			indexACFixture(t, store, id)
		}
		indexRunFixture(t, store)
		for _, id := range []string{"候選 / A", " B", "Z"} {
			indexCandidateFixture(t, store, id)
		}
		mustExec(t, store, fullRunInsert(string(projectionProject), "run_0000000000", string(projectionWork)), domain.HashString("older-run").String())
		result := indexRead(t, store)
		if !reflect.DeepEqual([]string{result.RequiredACRevisions[0].ACID, result.RequiredACRevisions[1].ACID, result.RequiredACRevisions[2].ACID}, []string{" B", "Z", "驗收 / A"}) || result.Candidates[0].CandidateID != " B" || result.Candidates[1].CandidateID != "Z" || result.Candidates[2].CandidateID != "候選 / A" || result.Runs[0].RunID != "run_0000000000" {
			t.Fatalf("wrong binary ordering: %+v", result)
		}
		if result.Candidates[0].InputSubjectDigest != domain.HashString("historically-different-input") || result.Runs[1].InputDigest != domain.HashString("run-input") {
			t.Fatal("rewrote stored inputs")
		}
	})
	t.Run("lawful-service-legacy-ac-and-candidate-identities", func(t *testing.T) {
		// Existing vertical fixture uses lawful service commands and a declared
		// specification test double. It is not an accepted-specification flow.
		fixture, claim, digest, _ := verticalCandidateFixture(t)
		candidateID := domain.CandidateID("候選 / legacy")
		outcome, err := fixture.application.SubmitCandidate(t.Context(), verticalOperator, command.SubmitCandidate{Metadata: verticalMetadata(5, 3), ProjectID: verticalProject, WorkItemID: verticalWorkItem, RunID: verticalRun, Candidate: command.Candidate{ID: candidateID, RunID: verticalRun, Digest: digest, InputSubjectDigest: claim.Fence.InputDigest, CreatedAt: fixedClockTime, Artifacts: []command.ArtifactLocator{{Digest: digest, MediaType: "text/plain", ByteLength: uint64(len("candidate-v1")), Availability: "Present"}}}})
		mustVerticalOutcome(t, outcome, err)
		got, err := fixture.store.ReadWorkItemMaterialIndex(t.Context(), verticalProject, verticalWorkItem)
		if err != nil || len(got.Candidates) != 1 || got.Candidates[0].CandidateID != candidateID {
			t.Fatalf("lawful candidate=%+v %v", got, err)
		}
		acID := domain.ACID("驗收 / legacy")
		err = fixture.store.Within(t.Context(), func(tx port.Transaction) error {
			return tx.StoreACRevision(t.Context(), port.ACRevision{ID: "legacy-ac", ProjectID: verticalProject, ACID: acID, Digest: digest, Content: []byte("candidate-v1"), CreatedAtNS: 1})
		})
		if err != nil {
			t.Fatal(err)
		}
		workID := domain.WorkItemID("wi_0000000002")
		outcome, err = fixture.application.CreateWorkItem(t.Context(), verticalOperator, command.CreateWorkItem{Metadata: verticalMetadata(100, 0), ProjectID: verticalProject, WorkItemID: workID, Title: "Legacy", Goal: "Preserve exact identity", OwnerID: verticalOperator, RequiredACRevisions: []command.ACRevision{{ACID: acID, RevisionDigest: digest}}})
		mustVerticalOutcome(t, outcome, err)
		got, err = fixture.store.ReadWorkItemMaterialIndex(t.Context(), verticalProject, workID)
		if err != nil || got.Accepted != nil || len(got.RequiredACRevisions) != 1 || got.RequiredACRevisions[0].ACID != string(acID) {
			t.Fatalf("lawful legacy AC=%+v %v", got, err)
		}
		legacy := got
		candidate, err := fixture.store.ReadWorkItemMaterialIndex(t.Context(), verticalProject, verticalWorkItem)
		if err != nil {
			t.Fatal(err)
		}
		durable := acceptanceSnapshot(t, fixture.store.db)
		reopened := indexReopen(t, fixture.store)
		for _, expected := range []port.WorkItemMaterialIndex{legacy, candidate} {
			again, err := reopened.ReadWorkItemMaterialIndex(t.Context(), verticalProject, expected.WorkItemID)
			if err != nil || !reflect.DeepEqual(expected, again) {
				t.Fatalf("legacy reopen %+v %v", again, err)
			}
		}
		if acceptanceSnapshot(t, reopened.db) != durable {
			t.Fatal("legacy reopen wrote durable state")
		}
	})
	t.Run("schema-valid-Done-and-broken-completion-join", func(t *testing.T) {
		store := indexFixture(t)
		insertValidCompletion(t, store, string(projectionProject), string(projectionWork), 2, "completion-index", "subject")
		mustExec(t, store, `UPDATE work_items SET phase='Done',version=2`)
		if got := indexRead(t, store); got.Phase != domain.PhaseDone || got.Version != 2 {
			t.Fatal("Done was not rehydrated")
		}
		mustExec(t, store, `DROP TRIGGER completion_record_reviews_immutable_delete`)
		mustExec(t, store, `DELETE FROM completion_record_reviews`)
		_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
		if !errors.Is(err, domain.ErrStorageCorruption) {
			t.Fatalf("broken Done=%v", err)
		}
	})
}

// Copy the existing schema-only Initial/Impact fixture into valid API scopes.
// Every FK remains enabled and checked at commit. Canonical payloads are opaque
// storage fixtures, deliberately not evidence of an implemented Impact writer.
func indexAcceptedFixture(t *testing.T) *Store {
	t.Helper()
	source := acceptanceFixture(t)
	store := indexFixture(t)
	mustCreateWorkItem(t, store, mustWorkItem(t, "wi_0000000002", projectionProject, domain.PhaseDraft, 1))
	err := store.immediate(t.Context(), func(conn *sql.Conn) error {
		if _, err := conn.ExecContext(t.Context(), `PRAGMA defer_foreign_keys=ON`); err != nil {
			return err
		}
		for _, table := range append([]string{"dependency_revisions", "ac_revisions"}, acceptanceTables...) {
			rows, err := source.QueryContext(t.Context(), `SELECT * FROM `+table+` WHERE project_id='p1'`)
			if err != nil {
				return err
			}
			columns, err := rows.Columns()
			if err != nil {
				rows.Close()
				return err
			}
			for rows.Next() {
				values := make([]any, len(columns))
				ptrs := make([]any, len(values))
				for i := range values {
					ptrs[i] = &values[i]
				}
				if err := rows.Scan(ptrs...); err != nil {
					rows.Close()
					return err
				}
				row := acceptanceRow{}
				for i, col := range columns {
					switch col {
					case "project_id":
						values[i] = string(projectionProject)
					case "work_item_id":
						if values[i] == "w1" {
							values[i] = string(projectionWork)
						} else {
							values[i] = "wi_0000000002"
						}
					}
					row[col] = values[i]
				}
				statement, args := acceptanceInsertStatement(table, row)
				if _, err := conn.ExecContext(t.Context(), statement, args...); err != nil {
					rows.Close()
					return fmt.Errorf("copy %s: %w", table, err)
				}
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			rows.Close()
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	assertForeignKeysClean(t, store)
	return store
}
func indexActivateImpact(ctx context.Context, conn *sql.Conn) error {
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`UPDATE project_spec_heads SET accepted_revision_digest=?,head_version=2`, []any{acceptanceHash("p1r2")}},
		{`UPDATE work_item_spec_heads SET accepted_revision_digest=?,binding_digest=?,head_version=2 WHERE work_item_id=?`, []any{acceptanceHash("p1r2"), acceptanceHash("p1r2w1"), projectionWork}},
		{`UPDATE work_item_spec_heads SET accepted_revision_digest=?,binding_digest=?,head_version=2 WHERE work_item_id=?`, []any{acceptanceHash("p1r2"), acceptanceHash("p1r2w2"), "wi_0000000002"}},
		{`UPDATE current_ac_requirements SET accepted_revision_digest=?,binding_digest=?,ac_revision_digest=? WHERE work_item_id=?`, []any{acceptanceHash("p1r2"), acceptanceHash("p1r2w1"), acceptanceHash("p1r2ac1"), projectionWork}},
		{`UPDATE current_ac_requirements SET accepted_revision_digest=?,binding_digest=?,ac_revision_digest=? WHERE work_item_id=?`, []any{acceptanceHash("p1r2"), acceptanceHash("p1r2w2"), acceptanceHash("p1r2ac1"), "wi_0000000002"}},
	} {
		if _, err := conn.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return err
		}
	}
	return nil
}
func TestWorkItemMaterialIndex_AcceptedRelations(t *testing.T) {
	t.Run("schema-valid-Initial-and-Impact", func(t *testing.T) {
		store := indexAcceptedFixture(t)
		got := indexRead(t, store)
		if got.Accepted == nil || got.Accepted.AcceptanceKind != "Initial" || got.Accepted.AcceptedRevisionDigest.String() != acceptanceHash("p1r1") || got.Accepted.BindingDigest.String() != acceptanceHash("p1r1w1") || got.Accepted.GraphRevisionDigest.String() != acceptanceHash("p1r1graph") || got.Accepted.PolicyRevisionDigest.String() != acceptanceHash("policy") || got.Accepted.ProjectHeadVersion != 1 || got.Accepted.WorkItemHeadVersion != 1 || len(got.RequiredACRevisions) != 1 {
			t.Fatalf("Initial=%+v", got)
		}
		if err := store.immediate(t.Context(), func(conn *sql.Conn) error { return indexActivateImpact(t.Context(), conn) }); err != nil {
			t.Fatal(err)
		}
		assertForeignKeysClean(t, store)
		got = indexRead(t, store)
		if got.Accepted.AcceptanceKind != "Impact" || got.Accepted.AcceptedRevisionDigest.String() != acceptanceHash("p1r2") || got.Accepted.ProjectHeadVersion != 2 || got.RequiredACRevisions[0].RevisionDigest.String() != acceptanceHash("p1r2ac1") {
			t.Fatalf("Impact=%+v", got)
		}
	})
	t.Run("project-head-only-keeps-legacy", func(t *testing.T) {
		store := indexAcceptedFixture(t)
		mustExec(t, store, `DELETE FROM current_ac_requirements WHERE work_item_id=?`, projectionWork)
		mustExec(t, store, `DELETE FROM work_item_spec_heads WHERE work_item_id=?`, projectionWork)
		indexACFixture(t, store, "legacy / 驗收")
		got := indexRead(t, store)
		if got.Accepted != nil || len(got.RequiredACRevisions) != 1 || got.RequiredACRevisions[0].ACID != "legacy / 驗收" {
			t.Fatalf("project-only head=%+v", got)
		}
	})
	for _, attack := range []string{"missing-current", "extra-current", "wrong-current-binding", "wrong-item-binding", "missing-project-head", "missing-accepted", "orphan-current"} {
		t.Run(attack, func(t *testing.T) {
			store := indexAcceptedFixture(t)
			mustExec(t, store, `PRAGMA foreign_keys=OFF`)
			switch attack {
			case "missing-current":
				mustExec(t, store, `DELETE FROM current_ac_requirements WHERE work_item_id=?`, projectionWork)
			case "extra-current":
				mustExec(t, store, `INSERT INTO current_ac_requirements SELECT project_id,work_item_id,accepted_revision_digest,binding_digest,'extra',ac_revision_digest FROM current_ac_requirements WHERE work_item_id=?`, projectionWork)
			case "wrong-current-binding":
				mustExec(t, store, `UPDATE current_ac_requirements SET binding_digest=? WHERE work_item_id=?`, acceptanceHash("wrong"), projectionWork)
			case "wrong-item-binding":
				mustExec(t, store, `UPDATE work_item_spec_heads SET binding_digest=? WHERE work_item_id=?`, acceptanceHash("wrong"), projectionWork)
			case "missing-project-head":
				mustExec(t, store, `DELETE FROM project_spec_heads`)
			case "missing-accepted":
				mustExec(t, store, `DROP TRIGGER accepted_spec_revisions_immutable_delete`)
				mustExec(t, store, `DELETE FROM accepted_spec_revisions WHERE acceptance_kind='Initial'`)
			case "orphan-current":
				mustExec(t, store, `DELETE FROM work_item_spec_heads WHERE work_item_id=?`, projectionWork)
			}
			_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
			if !errors.Is(err, domain.ErrStorageCorruption) {
				t.Fatalf("corrupt relation=%v", err)
			}
		})
	}
	for _, id := range []string{strings.Repeat("a", 81), strings.Repeat("z", 120), strings.Repeat("驗", 40)} {
		t.Run(fmt.Sprintf("accepted-id-bytes-%d-%x", len(id), id[:1]), func(t *testing.T) {
			store := indexAcceptedFixture(t)
			// Add one complete, FK-valid accepted/current pair, preserving exact bytes.
			digest := domain.HashString(id).String()
			mustExec(t, store, `INSERT INTO ac_revisions VALUES(?,?,?,?,X'01',1)`, projectionProject, "wide-ac", id, digest)
			mustExec(t, store, `INSERT INTO accepted_revision_acs VALUES(?,?,?,?)`, projectionProject, acceptanceHash("p1r1"), id, digest)
			mustExec(t, store, `INSERT INTO accepted_work_item_requirements VALUES(?,?,?,?,?,?)`, projectionProject, acceptanceHash("p1r1"), projectionWork, acceptanceHash("p1r1w1"), id, digest)
			mustExec(t, store, `INSERT INTO current_ac_requirements VALUES(?,?,?,?,?,?)`, projectionProject, projectionWork, acceptanceHash("p1r1"), acceptanceHash("p1r1w1"), id, digest)
			got := indexRead(t, store)
			if !slices.Contains(got.RequiredACRevisions, port.MaterialIndexAC{ACID: id, RevisionDigest: domain.HashString(id)}) {
				t.Fatal("accepted ID changed")
			}
		})
	}
}

func TestWorkItemMaterialIndex_BoundsAndCorruption(t *testing.T) {
	for _, kind := range []string{"legacy-ac", "run", "candidate", "blocker"} {
		t.Run(kind+"-1024-and-1025", func(t *testing.T) {
			store := indexFixture(t)
			if kind == "candidate" {
				indexRunFixture(t, store)
			}
			add := func(index int) {
				t.Helper()
				id := fmt.Sprintf("%010d", index)
				switch kind {
				case "legacy-ac":
					indexACFixture(t, store, id)
				case "run":
					mustExec(t, store, fullRunInsert(string(projectionProject), "run_"+id, string(projectionWork)), domain.HashString(id).String())
				case "candidate":
					indexCandidateFixture(t, store, id)
				case "blocker":
					mustExec(t, store, `INSERT INTO work_item_blockers VALUES(?,?,?,'reason',NULL)`, projectionProject, projectionWork, id)
				}
			}
			// One transaction keeps large fixture construction deterministic and cheap.
			mustExec(t, store, `BEGIN`)
			for i := range 1024 {
				add(i)
			}
			mustExec(t, store, `COMMIT`)
			got := indexRead(t, store)
			switch kind {
			case "legacy-ac":
				if len(got.RequiredACRevisions) != 1024 {
					t.Fatal("AC truncation")
				}
			case "run":
				if len(got.Runs) != 1024 {
					t.Fatal("run truncation")
				}
			case "candidate":
				if len(got.Candidates) != 1024 {
					t.Fatal("candidate truncation")
				}
			}
			add(1024)
			got, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
			if !errors.Is(err, port.ErrMaterialIndexCapacity) || got.WorkItemID != "" {
				t.Fatalf("overflow=%+v %v", got, err)
			}
		})
	}
	t.Run("blocker-2MiB-and-plus-one", func(t *testing.T) {
		store := indexFixture(t)
		reason := strings.Repeat("x", port.MaterialIndexBlockerByteLimit-1)
		mustExec(t, store, `INSERT INTO work_item_blockers VALUES(?,?,'b',?,NULL)`, projectionProject, projectionWork, reason)
		indexRead(t, store)
		mustExec(t, store, `UPDATE work_item_blockers SET reason=reason||'x'`)
		_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
		if !errors.Is(err, port.ErrMaterialIndexCapacity) {
			t.Fatalf("blocker bytes=%v", err)
		}
	})
	t.Run("foreign-histories-do-not-consume-bounds", func(t *testing.T) {
		store := indexFixture(t)
		mustCreateWorkItem(t, store, mustWorkItem(t, "wi_0000000002", projectionProject, domain.PhaseDraft, 1))
		mustCreateProjectID(t, store, "prj_0000000002")
		mustCreateWorkItem(t, store, mustWorkItem(t, projectionWork, "prj_0000000002", domain.PhaseDraft, 1))
		mustExec(t, store, `BEGIN`)
		for i := range 1025 {
			run := fmt.Sprintf("run_%010d", i)
			for _, scope := range [][2]string{{string(projectionProject), "wi_0000000002"}, {"prj_0000000002", string(projectionWork)}} {
				mustExec(t, store, fullRunInsert(scope[0], run, scope[1]), domain.HashString(run).String())
				mustExec(t, store, `INSERT INTO candidates VALUES(?,?,?,?,?,1)`, scope[0], run, run, domain.HashString(run).String(), domain.HashString("input").String())
			}
		}
		mustExec(t, store, `COMMIT`)
		got := indexRead(t, store)
		if len(got.Runs) != 0 || len(got.Candidates) != 0 {
			t.Fatal("foreign history leaked")
		}
	})
	t.Run("maximum-scalars-and-positive-nanosecond-boundaries", func(t *testing.T) {
		store := indexFixture(t)
		mustExec(t, store, `UPDATE work_items SET title=?,goal=?,owner_id=?,version=?`, strings.Repeat("驗", 80), strings.Repeat("x", 8000), strings.Repeat("主", 40), int64(math.MaxInt64))
		mustExec(t, store, `UPDATE instance_state SET restore_generation=?,stream_epoch=?,next_event_sequence=?`, int64(math.MaxInt64), int64(math.MaxInt64), int64(math.MaxInt64))
		indexACFixture(t, store, strings.Repeat("x", 80))
		indexRunFixture(t, store)
		indexCandidateFixture(t, store, strings.Repeat("y", 80))
		got := indexRead(t, store)
		if got.Runs[0].CreatedAtNS != 1 || got.Candidates[0].CreatedAtNS != 1 || got.Version != math.MaxInt64 || got.Cursor.Epoch != math.MaxInt64 || got.Cursor.Sequence != math.MaxInt64 || got.RestoreGeneration != math.MaxInt64 {
			t.Fatal("scalar boundary changed")
		}
		mustExec(t, store, `DROP TRIGGER runs_immutable_identity_update`)
		mustExec(t, store, `UPDATE runs SET created_at_ns=?`, int64(math.MaxInt64))
		mustExec(t, store, `DROP TRIGGER candidates_immutable_update`)
		mustExec(t, store, `UPDATE candidates SET created_at_ns=?`, int64(math.MaxInt64))
		got = indexRead(t, store)
		if got.Runs[0].CreatedAtNS != math.MaxInt64 || got.Candidates[0].CreatedAtNS != math.MaxInt64 {
			t.Fatal("max timestamp changed")
		}
	})
	for _, attack := range []struct {
		name, query string
		value       any
	}{
		{"title-oversize", `UPDATE work_items SET title=?`, strings.Repeat("x", 241)},
		{"title-blob", `UPDATE work_items SET title=?`, []byte("blob")},
		{"title-invalid-utf8", `UPDATE work_items SET title=?`, string([]byte{255})},
		{"goal-control", `UPDATE work_items SET goal=?`, "bad\ntext"},
		{"owner-oversize", `UPDATE work_items SET owner_id=?`, strings.Repeat("x", 121)},
		{"version-text", `UPDATE work_items SET version=?`, "oops"},
		{"version-float", `UPDATE work_items SET version=?`, 1.5},
		{"version-zero", `UPDATE work_items SET version=?`, 0},
		{"phase-invalid", `UPDATE work_items SET phase=?`, "invalid"},
		{"run-id-invalid", `UPDATE runs SET run_id=?`, "run_notvalid"},
		{"run-digest-zero", `UPDATE runs SET input_digest=?`, strings.Repeat("0", 64)},
		{"run-digest-uppercase", `UPDATE runs SET input_digest=?`, strings.Repeat("A", 64)},
		{"run-digest-blob", `UPDATE runs SET input_digest=?`, []byte(strings.Repeat("a", 64))},
		{"run-timestamp-zero", `UPDATE runs SET created_at_ns=?`, 0},
		{"run-timestamp-negative", `UPDATE runs SET created_at_ns=?`, -1},
		{"run-timestamp-float", `UPDATE runs SET created_at_ns=?`, 1.5},
		{"candidate-id-oversize", `UPDATE candidates SET candidate_id=?`, strings.Repeat("x", 81)},
		{"candidate-id-control", `UPDATE candidates SET candidate_id=?`, "bad\x00id"},
		{"candidate-id-utf8", `UPDATE candidates SET candidate_id=?`, string([]byte{255})},
		{"candidate-digest-zero", `UPDATE candidates SET candidate_digest=?`, strings.Repeat("0", 64)},
		{"candidate-input-zero", `UPDATE candidates SET input_subject_digest=?`, strings.Repeat("0", 64)},
		{"candidate-timestamp-zero", `UPDATE candidates SET created_at_ns=?`, 0},
		{"candidate-timestamp-text", `UPDATE candidates SET created_at_ns=?`, "bad"},
		{"legacy-ac-oversize", `UPDATE work_item_ac_requirements SET ac_id=?`, strings.Repeat("x", 81)},
		{"legacy-ac-control", `UPDATE work_item_ac_requirements SET ac_id=?`, "bad\nac"},
		{"legacy-ac-digest-zero", `UPDATE work_item_ac_requirements SET revision_digest=?`, strings.Repeat("0", 64)},
		{"epoch-zero", `UPDATE instance_state SET stream_epoch=?`, 0},
		{"epoch-float", `UPDATE instance_state SET stream_epoch=?`, 1.5},
		{"sequence-negative", `UPDATE instance_state SET next_event_sequence=?`, -1},
		{"generation-text", `UPDATE instance_state SET restore_generation=?`, "bad"},
	} {
		t.Run(attack.name, func(t *testing.T) {
			store := indexFixture(t)
			indexACFixture(t, store, "AC-1")
			indexRunFixture(t, store)
			indexCandidateFixture(t, store, "candidate")
			// Deliberately bypass integrity guards solely to test corrupt storage reads.
			mustExec(t, store, `PRAGMA foreign_keys=OFF`)
			mustExec(t, store, `PRAGMA ignore_check_constraints=ON`)
			mustExec(t, store, `DROP TRIGGER runs_immutable_identity_update`)
			mustExec(t, store, `DROP TRIGGER candidates_immutable_update`)
			mustExec(t, store, `DROP TRIGGER work_item_ac_requirements_immutable_update`)
			mustExec(t, store, attack.query, attack.value)
			got, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
			if !errors.Is(err, domain.ErrStorageCorruption) || got.WorkItemID != "" {
				t.Fatalf("corruption=%+v %v", got, err)
			}
		})
	}
	t.Run("duplicate-legacy-ac-id", func(t *testing.T) {
		store := indexFixture(t)
		indexACFixture(t, store, "AC-1")
		digest := domain.HashString("second-revision").String()
		mustExec(t, store, `INSERT INTO ac_revisions VALUES(?, 'second', 'AC-1', ?, X'01',1)`, projectionProject, digest)
		mustExec(t, store, `INSERT INTO work_item_ac_requirements VALUES(?,?,'AC-1',?)`, projectionProject, projectionWork, digest)
		_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
		if !errors.Is(err, domain.ErrStorageCorruption) {
			t.Fatalf("duplicate ID=%v", err)
		}
	})
}

func TestWorkItemMaterialIndex_RunEnumVocabulary(t *testing.T) {
	for _, set := range []struct {
		column string
		values []string
	}{
		{"desired_action", []string{"None", "Dispatch", "CancelRequested"}},
		{"dispatch_state", []string{"Pending", "Claimed", "Sent", "Acknowledged", "FailedToDispatch"}},
		{"observed_state", []string{"Unknown", "Starting", "Running", "Succeeded", "Failed", "Canceled"}},
		{"reconciliation_state", []string{"None", "NeedsReconcile", "Reconciled"}},
		{"side_effect_outcome", []string{"NotApplicable", "Confirmed", "OutcomeUnknown"}},
	} {
		t.Run(set.column, func(t *testing.T) {
			store := indexFixture(t)
			indexRunFixture(t, store)
			for _, value := range set.values {
				mustExec(t, store, `UPDATE runs SET `+set.column+`=?`, value)
				run := indexRead(t, store).Runs[0]
				got := map[string]string{"desired_action": run.DesiredAction, "dispatch_state": run.DispatchState, "observed_state": run.ObservedState, "reconciliation_state": run.ReconciliationState, "side_effect_outcome": run.SideEffectOutcome}[set.column]
				if got != value {
					t.Fatalf("enum %s -> %s", value, got)
				}
			}
			mustExec(t, store, `PRAGMA ignore_check_constraints=ON`)
			mustExec(t, store, `UPDATE runs SET `+set.column+`='Invented'`)
			_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
			if !errors.Is(err, domain.ErrStorageCorruption) {
				t.Fatalf("invalid enum=%v", err)
			}
		})
	}
}

func TestWorkItemMaterialIndex_SnapshotAndNoWrites(t *testing.T) {
	store := indexAcceptedFixture(t)
	var sequence int
	var name, path string
	if err := store.db.QueryRowContext(t.Context(), `PRAGMA database_list`).Scan(&sequence, &name, &path); err != nil {
		t.Fatal(err)
	}
	writer, err := OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedClock(42))
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	old := indexRead(t, store)
	err = store.readProjection(t.Context(), func(conn *sql.Conn) error {
		first, err := store.readWorkItemMaterialIndex(t.Context(), conn, projectionProject, projectionWork)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(first, old) {
			return errors.New("initial snapshot differs")
		}
		// This independent connection commits synchronously while the reader remains
		// pinned. A writer lock held by the read path would block/fail this commit.
		err = writer.immediate(t.Context(), func(write *sql.Conn) error {
			if err := indexActivateImpact(t.Context(), write); err != nil {
				return err
			}
			for _, statement := range []struct {
				query string
				args  []any
			}{
				{`UPDATE work_items SET title='new title',version=2,phase='Ready' WHERE work_item_id=?`, []any{projectionWork}},
				{fullRunInsert(string(projectionProject), string(indexRun), string(projectionWork)), []any{domain.HashString("run-input").String()}},
				{`INSERT INTO candidates VALUES(?,?,?,?,?,1)`, []any{projectionProject, "candidate", indexRun, domain.HashString("candidate").String(), domain.HashString("input").String()}},
				{`UPDATE instance_state SET stream_epoch=2,next_event_sequence=7,restore_generation=2`, nil},
			} {
				if _, err := write.ExecContext(t.Context(), statement.query, statement.args...); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		pinned, err := store.readWorkItemMaterialIndex(t.Context(), conn, projectionProject, projectionWork)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(first, pinned) {
			return fmt.Errorf("torn snapshot: before=%+v after=%+v", first, pinned)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	after := indexRead(t, store)
	if after.Title != "new title" || after.Version != 2 || after.Phase != domain.PhaseReady || after.Accepted.AcceptanceKind != "Impact" || after.Accepted.WorkItemHeadVersion != 2 || after.RequiredACRevisions[0].RevisionDigest.String() != acceptanceHash("p1r2ac1") || len(after.Runs) != 1 || len(after.Candidates) != 1 || after.Cursor != (port.Cursor{Epoch: 2, Sequence: 7}) || after.RestoreGeneration != 2 {
		t.Fatalf("fresh snapshot missing writer update: %+v", after)
	}
	// acceptanceSnapshot includes every durable user table, complete row values,
	// IDs, all allocator fields, schema and migration ledger (not only row counts).
	durable := acceptanceSnapshot(t, store.db)
	for range 3 {
		if got := indexRead(t, store); !reflect.DeepEqual(got, after) {
			t.Fatal("unstable public read")
		}
	}
	if acceptanceSnapshot(t, store.db) != durable {
		t.Fatal("public reads mutated durable rows or allocators")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedClock(43))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if got := indexRead(t, reopened); !reflect.DeepEqual(got, after) {
		t.Fatalf("reopen changed snapshot: %+v", got)
	}
	if acceptanceSnapshot(t, reopened.db) != durable {
		t.Fatal("reopen/read mutated durable state")
	}
}

func TestWorkItemMaterialIndex_AcceptedBoundsAndCorruption(t *testing.T) {
	t.Run("accepted-1024-and-1025", func(t *testing.T) {
		store := indexAcceptedFixture(t)
		add := func(index int) {
			id := fmt.Sprintf("AC-%04d", index)
			digest := domain.HashString(id).String()
			mustExec(t, store, `INSERT INTO ac_revisions VALUES(?,?,?,?,X'01',1)`, projectionProject, id, id, digest)
			mustExec(t, store, `INSERT INTO accepted_revision_acs VALUES(?,?,?,?)`, projectionProject, acceptanceHash("p1r1"), id, digest)
			mustExec(t, store, `INSERT INTO accepted_work_item_requirements VALUES(?,?,?,?,?,?)`, projectionProject, acceptanceHash("p1r1"), projectionWork, acceptanceHash("p1r1w1"), id, digest)
			mustExec(t, store, `INSERT INTO current_ac_requirements VALUES(?,?,?,?,?,?)`, projectionProject, projectionWork, acceptanceHash("p1r1"), acceptanceHash("p1r1w1"), id, digest)
		}
		mustExec(t, store, `BEGIN`)
		for i := range 1023 {
			add(i)
		}
		mustExec(t, store, `COMMIT`)
		if len(indexRead(t, store).RequiredACRevisions) != 1024 {
			t.Fatal("accepted requirements truncated")
		}
		add(1023)
		_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
		if !errors.Is(err, port.ErrMaterialIndexCapacity) {
			t.Fatalf("accepted overflow=%v", err)
		}
	})
	for _, attack := range []string{"zero-head-version", "zero-item-head-version", "max-head-versions", "zero-graph", "zero-policy", "bad-kind", "invalid-accepted-ac", "orphan-accepted-ac", "orphan-ac-revision", "missing-binding"} {
		t.Run(attack, func(t *testing.T) {
			store := indexAcceptedFixture(t)
			mustExec(t, store, `PRAGMA foreign_keys=OFF`)
			mustExec(t, store, `PRAGMA ignore_check_constraints=ON`)
			switch attack {
			case "zero-head-version":
				mustExec(t, store, `UPDATE project_spec_heads SET head_version=0`)
			case "zero-item-head-version":
				mustExec(t, store, `UPDATE work_item_spec_heads SET head_version=0`)
			case "max-head-versions":
				mustExec(t, store, `UPDATE project_spec_heads SET head_version=?`, int64(math.MaxInt64))
				mustExec(t, store, `UPDATE work_item_spec_heads SET head_version=?`, int64(math.MaxInt64))
			case "zero-graph":
				mustExec(t, store, `DROP TRIGGER accepted_spec_revisions_immutable_update`)
				mustExec(t, store, `UPDATE accepted_spec_revisions SET graph_revision_digest=?`, strings.Repeat("0", 64))
			case "zero-policy":
				mustExec(t, store, `DROP TRIGGER accepted_spec_revisions_immutable_update`)
				mustExec(t, store, `UPDATE accepted_spec_revisions SET policy_revision_digest=?`, strings.Repeat("0", 64))
			case "bad-kind":
				mustExec(t, store, `DROP TRIGGER accepted_spec_revisions_immutable_update`)
				mustExec(t, store, `UPDATE accepted_spec_revisions SET acceptance_kind='Bad'`)
			case "invalid-accepted-ac":
				mustExec(t, store, `UPDATE current_ac_requirements SET ac_id='space / ID'`)
			case "orphan-accepted-ac":
				mustExec(t, store, `DROP TRIGGER accepted_revision_acs_immutable_delete`)
				mustExec(t, store, `DELETE FROM accepted_revision_acs`)
			case "orphan-ac-revision":
				mustExec(t, store, `DROP TRIGGER ac_revisions_immutable_delete`)
				mustExec(t, store, `DELETE FROM ac_revisions`)
			case "missing-binding":
				mustExec(t, store, `DROP TRIGGER accepted_work_item_bindings_immutable_delete`)
				mustExec(t, store, `DELETE FROM accepted_work_item_bindings`)
			}
			got, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
			if attack == "max-head-versions" {
				if err != nil || got.Accepted.ProjectHeadVersion != math.MaxInt64 || got.Accepted.WorkItemHeadVersion != math.MaxInt64 {
					t.Fatalf("max head versions=%+v %v", got, err)
				}
				return
			}
			if !errors.Is(err, domain.ErrStorageCorruption) {
				t.Fatalf("corrupt accepted relation=%v", err)
			}
		})
	}
	t.Run("orphan-legacy-requirement", func(t *testing.T) {
		store := indexFixture(t)
		indexACFixture(t, store, "AC-1")
		mustExec(t, store, `PRAGMA foreign_keys=OFF`)
		mustExec(t, store, `DROP TRIGGER ac_revisions_immutable_delete`)
		mustExec(t, store, `DELETE FROM ac_revisions`)
		_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
		if !errors.Is(err, domain.ErrStorageCorruption) {
			t.Fatalf("orphan legacy=%v", err)
		}
	})
}
