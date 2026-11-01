package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const projectionProject domain.ProjectID = "prj_0000000001"
const projectionWork domain.WorkItemID = "wi_0000000001"

func appendProjection(t *testing.T, store *Store, project domain.ProjectID, index int) {
	t.Helper()
	err := store.Within(t.Context(), func(tx port.Transaction) error {
		name := fmt.Sprintf("event-%d", index)
		payload := []byte(fmt.Sprintf(`{"api_version":"v1","event_type":"project.changed","project_id":%q,"resource_kind":"project","resource_id":%q,"resource_version":1}`, project, project))
		if err := tx.StoreCommandResult(t.Context(), port.CommandResult{ID: name, ProjectID: project, Digest: domain.HashBytes(payload), Payload: payload, TimestampNS: 42}); err != nil {
			return err
		}
		seq, err := tx.AppendAudit(t.Context(), port.AuditEntry{GroupID: name, CommandID: name, ProjectID: project, Actor: "operator", Operation: "CreateProject", SubjectDigest: domain.HashBytes(payload), TimestampNS: 42})
		if err != nil {
			return err
		}
		_, err = tx.AppendProjectionEvent(t.Context(), port.ProjectionEvent{ProjectID: project, Payload: payload, PayloadDigest: domain.HashBytes(payload), AuditSequence: seq})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPersistedProjection_SnapshotAndRestart(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "projection.db")
	store, err := OpenAtRootWithClock(t.Context(), root, path, fixedClock(42))
	if err != nil {
		t.Fatal(err)
	}
	mustCreateProjectID(t, store, projectionProject)
	item := mustWorkItem(t, projectionWork, projectionProject, domain.PhaseDraft, 1)
	if err := store.CreateWorkItem(t.Context(), port.WorkItem{Item: item, Title: "Durable board", Goal: "Read rows", Owner: "operator"}); err != nil {
		t.Fatal(err)
	}
	appendProjection(t, store, projectionProject, 1)
	before, err := store.ReadBoard(t.Context(), projectionProject)
	if err != nil || before.Cursor != (port.Cursor{Epoch: 1, Sequence: 1}) || len(before.Items) != 1 || before.Items[0].Title != "Durable board" {
		t.Fatalf("snapshot=%+v err=%v", before, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenAtRootWithClock(t.Context(), root, path, fixedClock(43))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	after, err := store.ReadBoard(t.Context(), projectionProject)
	if err != nil || after.Cursor != before.Cursor || len(after.Items) != 1 || after.Items[0].Item.Phase() != domain.PhaseDraft {
		t.Fatalf("restart=%+v err=%v", after, err)
	}
	replay, err := store.ReadProjectionEvents(t.Context(), projectionProject, port.Cursor{Epoch: 1})
	if err != nil || len(replay.Events) != 1 || replay.Events[0].Cursor != before.Cursor {
		t.Fatalf("restart replay=%+v err=%v", replay, err)
	}
	if _, err := store.ReadBoard(t.Context(), "prj_0000000009"); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("missing=%v", err)
	}
	var sequence uint64
	if err := store.db.QueryRowContext(t.Context(), `SELECT next_event_sequence FROM instance_state`).Scan(&sequence); err != nil || sequence != 1 {
		t.Fatalf("read allocated a cursor: %d %v", sequence, err)
	}
}

func TestPersistedProjection_ReplayIntegrityAndProjectScope(t *testing.T) {
	for _, attack := range []string{"valid", "foreign", "missing", "digest", "future", "epoch", "retention", "bounded"} {
		t.Run(attack, func(t *testing.T) {
			store := openTestStore(t)
			defer store.Close()
			mustCreateProjectID(t, store, projectionProject)
			appendProjection(t, store, projectionProject, 1)
			after := port.Cursor{Epoch: 1}
			switch attack {
			case "foreign":
				mustCreateProjectID(t, store, "prj_0000000002")
				appendProjection(t, store, "prj_0000000002", 2)
			case "missing":
				mustExec(t, store, `DROP TRIGGER projection_events_immutable_delete`)
				mustExec(t, store, `DELETE FROM projection_events`)
			case "digest":
				mustExec(t, store, `DROP TRIGGER projection_events_immutable_update`)
				mustExec(t, store, `UPDATE projection_events SET payload='corrupt'`)
			case "future":
				after.Sequence = 2
			case "epoch":
				after.Epoch = 2
			case "retention":
				mustExec(t, store, `INSERT INTO stream_retention VALUES (?,1,2)`, projectionProject)
			case "bounded":
				for index := 2; index <= 129; index++ {
					appendProjection(t, store, projectionProject, index)
				}
			}
			got, err := store.ReadProjectionEvents(t.Context(), projectionProject, after)
			switch attack {
			case "missing", "digest", "future":
				if err == nil || len(got.Events) != 0 {
					t.Fatalf("corruption exposed replay %+v %v", got, err)
				}
			case "foreign", "retention", "bounded":
				if err != nil || len(got.Events) != 0 || got.MinimumSequence != got.Cursor.Sequence+1 {
					t.Fatalf("reset=%+v err=%v", got, err)
				}
			case "epoch":
				if err != nil || got.Cursor.Epoch != 1 || len(got.Events) != 0 {
					t.Fatalf("epoch reset=%+v err=%v", got, err)
				}
			case "valid":
				if err != nil || len(got.Events) != 1 {
					t.Fatalf("valid=%+v err=%v", got, err)
				}
			}
			if _, err := store.ReadProjectionEvents(t.Context(), "prj_0000000009", after); !errors.Is(err, port.ErrNotFound) {
				t.Fatalf("missing project=%v", err)
			}
		})
	}
}

func TestPersistedProjection_ReadTransactionPinsCursor(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "snapshot.db")
	reader, err := OpenAtRootWithClock(t.Context(), root, path, fixedClock(42))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	writer, err := OpenAtRootWithClock(t.Context(), root, path, fixedClock(42))
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	mustCreateProjectID(t, reader, projectionProject)
	appendProjection(t, reader, projectionProject, 1)
	// A second connection commits while the read transaction is pinned. The
	// first connection must still see the old high water and old rows together.
	err = reader.readProjection(t.Context(), func(conn *sql.Conn) error {
		before, _, err := projectionPosition(t.Context(), conn, projectionProject)
		if err != nil {
			return err
		}
		appendProjection(t, writer, projectionProject, 2)
		after, _, err := projectionPosition(t.Context(), conn, projectionProject)
		if err != nil {
			return err
		}
		var count int
		if err := conn.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM projection_events`).Scan(&count); err != nil {
			return err
		}
		if before != after || count != 1 {
			return fmt.Errorf("mixed snapshot: %v %v count=%d", before, after, count)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPersistedProjection_CorruptDoneFailsClosed(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()
	mustCreateProjectID(t, store, projectionProject)
	item := mustWorkItem(t, projectionWork, projectionProject, domain.PhaseDraft, 1)
	if err := store.CreateWorkItem(t.Context(), port.WorkItem{Item: item, Title: "Guarded", Goal: "No forged Done", Owner: "operator"}); err != nil {
		t.Fatal(err)
	}
	mustExec(t, store, `DROP TRIGGER work_items_done_requires_completion`)
	mustExec(t, store, `UPDATE work_items SET phase='Done' WHERE project_id=? AND work_item_id=?`, projectionProject, projectionWork)
	board, err := store.ReadBoard(t.Context(), projectionProject)
	if err == nil || len(board.Items) != 0 {
		t.Fatalf("forged Done was projected: %+v %v", board, err)
	}
}
