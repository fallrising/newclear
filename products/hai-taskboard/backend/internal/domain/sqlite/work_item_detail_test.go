package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const detailOther domain.WorkItemID = "wi_0000000002"

// detailSeed injects rows together with the real canonical audit chain the
// write path produces: command result naming a WorkItem, group and entry.
type detailSeed struct {
	t     *testing.T
	store *Store
	n     int
}

func newDetailSeed(t *testing.T) *detailSeed {
	t.Helper()
	store := indexFixture(t)
	mustCreateWorkItem(t, store, mustWorkItem(t, detailOther, projectionProject, domain.PhaseDraft, 1))
	indexACFixture(t, store, "AC-1")
	return &detailSeed{t: t, store: store}
}

func (d *detailSeed) audit(item domain.WorkItemID, subject domain.Digest) {
	d.t.Helper()
	d.n++
	id := fmt.Sprintf("cmd_%010d", d.n)
	payload, err := command.CanonicalSuccess(command.Metadata{CommandID: id, CorrelationID: "detail"}, command.PublishReviewOperation, command.Result{Type: "FixtureReviewPublished", ProjectID: projectionProject, WorkItemID: item, RunID: indexRun, Version: 1, Phase: domain.PhaseReview}, uint64(d.n), port.Cursor{Epoch: 1, Sequence: uint64(d.n)})
	if err != nil {
		d.t.Fatal(err)
	}
	group := fmt.Sprintf("group-%d", d.n)
	mustExec(d.t, d.store, `INSERT INTO command_results VALUES(?,?,?,?,?)`, projectionProject, id, domain.HashBytes(payload).String(), payload, d.n)
	mustExec(d.t, d.store, `INSERT INTO audit_groups VALUES(?,?,?,?,?)`, projectionProject, group, id, "owner", d.n)
	mustExec(d.t, d.store, `INSERT INTO audit_entries VALUES(?,?,?,?,?,?,NULL,NULL)`, d.n, projectionProject, group, "owner", "PublishFixtureReview", subject.String())
}

func (d *detailSeed) review(id string, subject domain.Digest) {
	d.t.Helper()
	mustExec(d.t, d.store, `INSERT INTO reviews VALUES(?,?,?,'Approved','reviewer',1,?)`, projectionProject, id, subject.String(), 5)
}

func (d *detailSeed) read(item domain.WorkItemID) (port.WorkItemDetail, error) {
	return d.store.ReadWorkItemDetail(d.t.Context(), projectionProject, item, command.DecodeResultOwner)
}

func (d *detailSeed) must(item domain.WorkItemID) port.WorkItemDetail {
	d.t.Helper()
	got, err := d.read(item)
	if err != nil {
		d.t.Fatal(err)
	}
	return got
}

func detailReviewIDs(v port.WorkItemDetail) []string {
	ids := []string{}
	for _, r := range v.Reviews {
		ids = append(ids, r.ID)
	}
	return ids
}

// TestWorkItemDetail_AttributionCorruption is DTL-AC-04, plus the stored-NULL
// cases of DTL-AC-02 that no lawful command path produces.
func TestWorkItemDetail_AttributionCorruption(t *testing.T) {
	seed := func(t *testing.T) *detailSeed {
		d := newDetailSeed(t)
		mine, theirs := domain.HashString("subject-1"), domain.HashString("subject-2")
		d.audit(projectionWork, mine)
		d.audit(detailOther, theirs)
		d.review("review-1", mine)
		d.review("review-2", theirs)
		mustExec(t, d.store, `INSERT INTO evidence VALUES(?,?,?,?,?,'Passed','Current','Present','human','owner','human',?,?,NULL)`, projectionProject, "evidence-1", mine.String(), "AC-1", domain.HashString("AC-1").String(), domain.HashString("recipe").String(), domain.HashString("environment").String())
		mustExec(t, d.store, `INSERT INTO approvals VALUES(?,?,?,'CompleteWorkItem','owner',?)`, projectionProject, "approval-2", theirs.String(), 9)
		// A conflicting subject that no Review/Evidence/Approval row uses is harmless.
		d.audit(projectionWork, domain.HashString("unused"))
		d.audit(detailOther, domain.HashString("unused"))
		return d
	}
	t.Run("exact", func(t *testing.T) {
		d := seed(t)
		first, second := d.must(projectionWork), d.must(detailOther)
		if !slices.Equal(detailReviewIDs(first), []string{"review-1"}) || !slices.Equal(detailReviewIDs(second), []string{"review-2"}) {
			t.Fatalf("reviews %v %v", detailReviewIDs(first), detailReviewIDs(second))
		}
		if len(first.Evidence) != 1 || first.Evidence[0].ReportArtifactDigest != nil || first.Evidence[0].HumanReportID != "" || len(second.Evidence) != 0 {
			t.Fatalf("evidence %+v %+v", first.Evidence, second.Evidence)
		}
		if len(first.Approvals) != 0 || len(second.Approvals) != 1 || second.Approvals[0].ConsumedAtNS != nil || second.Approvals[0].CompletionRecordID != "" {
			t.Fatalf("approvals %+v %+v", first.Approvals, second.Approvals)
		}
		if len(first.Audit) != 2 || first.Audit[0].RunID != indexRun || first.Audit[0].BeforeDigest != nil || len(second.Audit) != 2 {
			t.Fatalf("audit %+v %+v", first.Audit, second.Audit)
		}
	})
	for name, corrupt := range map[string]func(*detailSeed){
		"unattributed_review": func(d *detailSeed) { d.review("review-orphan", domain.HashString("orphan")) },
		"unattributed_approval": func(d *detailSeed) {
			mustExec(d.t, d.store, `INSERT INTO approvals VALUES(?,?,?,'CompleteWorkItem','owner',9)`, projectionProject, "approval-orphan", domain.HashString("orphan").String())
		},
		"two_items": func(d *detailSeed) { d.audit(detailOther, domain.HashString("subject-1")) },
	} {
		t.Run(name, func(t *testing.T) {
			d := seed(t)
			corrupt(d)
			for _, item := range []domain.WorkItemID{projectionWork, detailOther} {
				if got, err := d.read(item); !errors.Is(err, domain.ErrStorageCorruption) || got.Material.WorkItemID != "" {
					t.Fatalf("%s: %+v %v", item, got.Reviews, err)
				}
			}
		})
	}
}

// TestWorkItemDetail_SnapshotCapacityCorruption is DTL-AC-05.
func TestWorkItemDetail_SnapshotCapacityCorruption(t *testing.T) {
	t.Run("snapshot_and_no_writes", func(t *testing.T) {
		d := newDetailSeed(t)
		subject := domain.HashString("subject-1")
		d.audit(projectionWork, subject)
		d.review("review-1", subject)
		mustExec(t, d.store, `INSERT INTO work_item_blockers VALUES('prj_0000000001','wi_0000000001','blocker-open','waiting',NULL)`)
		var sequence int
		var name, path string
		if err := d.store.db.QueryRowContext(t.Context(), `PRAGMA database_list`).Scan(&sequence, &name, &path); err != nil {
			t.Fatal(err)
		}
		writer, err := OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedClock(42))
		if err != nil {
			t.Fatal(err)
		}
		defer writer.Close()
		old := d.must(projectionWork)
		err = d.store.readProjection(t.Context(), func(conn *sql.Conn) error {
			first, err := d.store.readWorkItemDetail(t.Context(), conn, projectionProject, projectionWork, command.DecodeResultOwner)
			if err != nil || !reflect.DeepEqual(first, old) {
				return fmt.Errorf("initial snapshot differs: %v", err)
			}
			// The independent writer commits while this reader stays pinned.
			err = writer.immediate(t.Context(), func(write *sql.Conn) error {
				for _, statement := range []string{
					`UPDATE work_items SET title='new title' WHERE work_item_id='wi_0000000001'`,
					`INSERT INTO reviews VALUES('prj_0000000001','review-new','` + subject.String() + `','Rejected','reviewer',1,6)`,
					`INSERT INTO work_item_blockers VALUES('prj_0000000001','wi_0000000001','blocker-new','late',7)`,
				} {
					if _, err := write.ExecContext(t.Context(), statement); err != nil {
						return err
					}
				}
				return nil
			})
			if err != nil {
				return err
			}
			pinned, err := d.store.readWorkItemDetail(t.Context(), conn, projectionProject, projectionWork, command.DecodeResultOwner)
			if err != nil || !reflect.DeepEqual(first, pinned) {
				return fmt.Errorf("torn snapshot: %v", err)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		after := d.must(projectionWork)
		if after.Summary.Title != "new title" || !slices.Equal(detailReviewIDs(after), []string{"review-1", "review-new"}) || len(after.Blockers) != 2 || after.Blockers[0].ID != "blocker-new" || after.Blockers[0].ResolvedAtNS == nil || *after.Blockers[0].ResolvedAtNS != 7 || after.Blockers[1].ResolvedAtNS != nil {
			t.Fatalf("fresh read missed writer: %+v", after)
		}
		durable := acceptanceSnapshot(t, d.store.db)
		for range 3 {
			if got := d.must(projectionWork); !reflect.DeepEqual(got, after) {
				t.Fatal("unstable read")
			}
		}
		if acceptanceSnapshot(t, d.store.db) != durable {
			t.Fatal("detail reads mutated durable state")
		}
	})
	t.Run("capacity", func(t *testing.T) {
		d := newDetailSeed(t)
		subject := domain.HashString("subject-1")
		d.audit(projectionWork, subject)
		mustExec(t, d.store, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1024)
INSERT INTO reviews SELECT 'prj_0000000001',printf('review-%04d',i),?,'Approved','reviewer',1,5 FROM n`, subject.String())
		if got := d.must(projectionWork); len(got.Reviews) != 1024 {
			t.Fatalf("limit rows %d", len(got.Reviews))
		}
		d.review("review-extra", subject)
		if _, err := d.read(projectionWork); !errors.Is(err, port.ErrWorkItemDetailCapacity) {
			t.Fatalf("capacity %v", err)
		}
	})
	t.Run("corrupt_blocker", func(t *testing.T) {
		d := newDetailSeed(t)
		mustExec(t, d.store, `INSERT INTO work_item_blockers VALUES('prj_0000000001','wi_0000000001','blocker-bad',char(1),3)`)
		if _, err := d.read(projectionWork); !errors.Is(err, domain.ErrStorageCorruption) {
			t.Fatalf("corrupt blocker %v", err)
		}
	})
	t.Run("missing_scope", func(t *testing.T) {
		d := newDetailSeed(t)
		if _, err := d.store.ReadWorkItemDetail(t.Context(), "prj_0000000009", projectionWork, command.DecodeResultOwner); !errors.Is(err, port.ErrNotFound) {
			t.Fatalf("missing %v", err)
		}
	})
}
