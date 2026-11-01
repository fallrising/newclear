package sqlite

import (
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func indexReopen(t *testing.T, store *Store) *Store {
	t.Helper()
	var sequence int
	var name, path string
	if err := store.db.QueryRowContext(t.Context(), `PRAGMA database_list`).Scan(&sequence, &name, &path); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedClock(43))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	return reopened
}

func TestWorkItemMaterialIndex_LawfulWriterByteBounds(t *testing.T) {
	f, claim, digest, _ := verticalCandidateFixture(t)
	title := strings.Repeat("界", 80) // 240 bytes, not 240 runes.
	work := domain.WorkItemID("wi_0000000002")
	create := command.CreateWorkItem{Metadata: verticalMetadata(100, 0), ProjectID: verticalProject, WorkItemID: work, Title: title, Goal: "goal", OwnerID: verticalOperator}
	outcome, err := f.application.CreateWorkItem(t.Context(), verticalOperator, create)
	mustVerticalOutcome(t, outcome, err)
	got, err := f.store.ReadWorkItemMaterialIndex(t.Context(), verticalProject, work)
	if err != nil || got.Title != title {
		t.Fatalf("lawful title %+v %v", got, err)
	}
	before := acceptanceSnapshot(t, f.store.db)
	create.Metadata = verticalMetadata(101, 0)
	create.WorkItemID = "wi_0000000003"
	create.Title += "界"
	_, err = f.application.CreateWorkItem(t.Context(), verticalOperator, create)
	assertVerticalCommandCode(t, err, command.CodeInvalidRequest)
	if acceptanceSnapshot(t, f.store.db) != before {
		t.Fatal("rejected oversized title wrote state")
	}
	if _, err = f.store.ReadWorkItemMaterialIndex(t.Context(), verticalProject, create.WorkItemID); !errors.Is(err, port.ErrNotFound) {
		t.Fatal("oversized title stored", err)
	}

	id := domain.CandidateID(strings.Repeat("界", 26) + "ab") // 80 bytes.
	submit := command.SubmitCandidate{Metadata: verticalMetadata(5, 3), ProjectID: verticalProject, WorkItemID: verticalWorkItem, RunID: verticalRun, Candidate: command.Candidate{ID: id, RunID: verticalRun, Digest: digest, InputSubjectDigest: claim.Fence.InputDigest, CreatedAt: fixedClockTime, Artifacts: []command.ArtifactLocator{{Digest: digest, MediaType: "text/plain", ByteLength: uint64(len("candidate-v1")), Availability: "Present"}}}}
	// Reject 81 bytes through the real service before admitting the 80-byte boundary.
	submit.Candidate.ID = id + "x"
	_, err = f.application.SubmitCandidate(t.Context(), verticalOperator, submit)
	assertVerticalCommandCode(t, err, command.CodeInvalidRequest)
	if acceptanceSnapshot(t, f.store.db) != before {
		t.Fatal("rejected oversized candidate wrote state")
	}
	submit.Candidate.ID = id
	outcome, err = f.application.SubmitCandidate(t.Context(), verticalOperator, submit)
	mustVerticalOutcome(t, outcome, err)
	got, err = f.store.ReadWorkItemMaterialIndex(t.Context(), verticalProject, verticalWorkItem)
	if err != nil || len(got.Candidates) != 1 || got.Candidates[0].CandidateID != id {
		t.Fatalf("lawful candidate %+v %v", got, err)
	}
	durable := acceptanceSnapshot(t, f.store.db)
	reopened := indexReopen(t, f.store)
	again, err := reopened.ReadWorkItemMaterialIndex(t.Context(), verticalProject, verticalWorkItem)
	if err != nil || !reflect.DeepEqual(got, again) || acceptanceSnapshot(t, reopened.db) != durable {
		t.Fatal("legacy reopen changed identity/state", err)
	}
	wide, err := reopened.ReadWorkItemMaterialIndex(t.Context(), verticalProject, work)
	if err != nil || wide.Title != title {
		t.Fatal("legacy title changed on reopen", err)
	}
}

func TestWorkItemMaterialIndex_DetectedCorruptionBeforeCapacity(t *testing.T) {
	for _, kind := range []string{"run", "blocker"} {
		t.Run(kind, func(t *testing.T) {
			store := indexFixture(t)
			mustExec(t, store, `BEGIN`)
			for i := range 1025 {
				id := fmt.Sprintf("%010d", i)
				if kind == "run" {
					mustExec(t, store, fullRunInsert(string(projectionProject), "run_"+id, string(projectionWork)), domain.HashString(id).String())
				} else {
					mustExec(t, store, `INSERT INTO work_item_blockers VALUES(?,?,?,'reason',NULL)`, projectionProject, projectionWork, id)
				}
			}
			mustExec(t, store, `COMMIT`)
			if kind == "run" {
				mustExec(t, store, `DROP TRIGGER runs_immutable_identity_update`)
				mustExec(t, store, `UPDATE runs SET input_digest=? WHERE run_id='run_0000000000'`, []byte(strings.Repeat("a", 64)))
			} else {
				mustExec(t, store, `UPDATE work_item_blockers SET reason=? WHERE blocker_id='0000000000'`, []byte("blob"))
			}
			got, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
			if !errors.Is(err, domain.ErrStorageCorruption) || got.WorkItemID != "" {
				t.Fatalf("detected corruption with over-capacity rows: %+v %v", got, err)
			}
		})
	}
	t.Run("single-non-text-blocker", func(t *testing.T) {
		store := indexFixture(t)
		mustExec(t, store, `INSERT INTO work_item_blockers VALUES(?,?,?,? ,NULL)`, projectionProject, projectionWork, "blocker", []byte("blob"))
		_, err := store.ReadWorkItemMaterialIndex(t.Context(), projectionProject, projectionWork)
		if !errors.Is(err, domain.ErrStorageCorruption) {
			t.Fatal(err)
		}
	})
}
