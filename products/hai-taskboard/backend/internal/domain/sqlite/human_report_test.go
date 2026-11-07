package sqlite

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestHumanReport_Migration(t *testing.T) {
	store := openTestStore(t)
	t.Cleanup(func() { _ = store.Close() })
	var count int
	if err := store.db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='human_reports'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("fresh database lacks immutable human-report provenance table")
	}
}

func TestHumanReport_MigrationUpgradeAndRollback(t *testing.T) {
	for _, failure := range []string{"none", "sql", "history", "state"} {
		t.Run(failure, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if err := migrationRun(t, db, t.Context(), compiledMigrations()[:4], 42); err != nil {
				t.Fatal(err)
			}
			acceptancePopulateV1(t, db)
			before := migrationLogicalSnapshot(t, db)
			old := outputV3Snapshot(t, db)
			if failure != "none" {
				statement := v5Migration
				switch failure {
				case "sql":
					statement += ";INSERT INTO absent_human_report_probe VALUES(1);"
				case "history":
					statement += ";INSERT INTO schema_migrations VALUES(5,'conflict',43);"
				case "state":
					statement += ";DROP TABLE instance_state;"
				}
				registry := append(slices.Clone(compiledMigrations()[:4]), migrationTestStep(5, statement))
				if err := migrationRun(t, db, t.Context(), registry, 43); err == nil {
					t.Fatal("faulty migration accepted")
				}
				if migrationLogicalSnapshot(t, db) != before || outputV3Snapshot(t, db) != old {
					t.Fatal("failed upgrade mutated V4")
				}
				var n int
				if err := db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE name='human_reports'").Scan(&n); err != nil || n != 0 {
					t.Fatal("partial migration retained", err)
				}
			}
			s, err := migrationOpen(t.Context(), root, path)
			if err != nil {
				t.Fatal(err)
			}
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			if outputV3Snapshot(t, db) != old {
				t.Fatal("upgrade altered old schema/history")
			}
			snapshot := migrationLogicalSnapshot(t, db)
			s, err = migrationOpen(t.Context(), root, path)
			if err != nil {
				t.Fatal(err)
			}
			_ = s.Close()
			if snapshot != migrationLogicalSnapshot(t, db) {
				t.Fatal("reopen rewrote migration history")
			}
		})
	}
}

func TestHumanReport_ImmutableProvenanceConstraints(t *testing.T) {
	s, w := outputFixture(t)
	mustCreateWorkItem(t, s, mustWorkItem(t, "other-item", w.Fence.ProjectID, domain.PhaseDraft, 1))
	a := port.Artifact{Digest: domain.HashString("human text"), MediaType: "text/plain", ByteLength: 10, StorageKey: "sha256:" + domain.HashString("human text").String(), Availability: "Present"}
	base := port.HumanReport{ProjectID: w.Fence.ProjectID, WorkItemID: "item-1", RunID: w.Fence.RunID, ID: "report_0000000001", Kind: "review", SubjectDigest: domain.HashString("subject"), Actor: "human", CreatedAtNS: 42, LeaseEpoch: 1, RestoreGeneration: 1, Artifact: a}
	if err := s.Within(t.Context(), func(tx port.Transaction) error { return tx.StoreArtifact(t.Context(), a) }); err != nil {
		t.Fatal(err)
	}
	seedReview := func(r port.HumanReport) {
		t.Helper()
		if err := s.Within(t.Context(), func(tx port.Transaction) error {
			return tx.StoreReview(t.Context(), port.Review{ID: domain.ReviewID(r.ID), ProjectID: r.ProjectID, SubjectDigest: r.SubjectDigest, Verdict: "Approved", Reviewer: r.Actor, Independent: true, CreatedAtNS: r.CreatedAtNS})
		}); err != nil {
			t.Fatal(err)
		}
	}
	store := func(r port.HumanReport) error {
		return s.Within(t.Context(), func(tx port.Transaction) error {
			return tx.(port.HumanReportTransaction).StoreHumanReport(t.Context(), r)
		})
	}
	seedReview(base)
	if err := store(base); err != nil {
		t.Fatal(err)
	}
	if err := s.Within(t.Context(), func(tx port.Transaction) error {
		got, err := tx.(port.HumanReportTransaction).LoadHumanReport(t.Context(), base.ProjectID, base.ID)
		if err == nil && got != base {
			t.Fatal("roundtrip changed provenance")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"UPDATE human_reports SET actor_id=actor_id", "DELETE FROM human_reports", "INSERT OR REPLACE INTO human_reports SELECT * FROM human_reports", "REPLACE INTO human_reports SELECT * FROM human_reports"} {
		if _, err := s.db.Exec(query); err == nil {
			t.Fatal("immutable row changed", query)
		}
	}
	for i, tc := range []struct {
		name   string
		change func(*port.HumanReport)
	}{{"actor", func(r *port.HumanReport) { r.Actor = "forged" }}, {"subject", func(r *port.HumanReport) { r.SubjectDigest = domain.HashString("wrong") }}, {"item", func(r *port.HumanReport) { r.WorkItemID = "other-item" }}, {"timestamp", func(r *port.HumanReport) { r.CreatedAtNS++ }}} {
		t.Run(tc.name, func(t *testing.T) {
			control := base
			control.ID = fmt.Sprintf("report_%010d", i+2)
			seedReview(control)
			bad := control
			tc.change(&bad)
			if err := store(bad); err == nil || !strings.Contains(err.Error(), "human report provenance mismatch") {
				t.Fatal("expected precise provenance rejection", err)
			}
			if err := store(control); err != nil {
				t.Fatal("otherwise-identical valid binding failed", err)
			}
		})
	}
	ac := domain.HashString("human AC")
	if err := s.Within(t.Context(), func(tx port.Transaction) error {
		return tx.StoreACRevision(t.Context(), port.ACRevision{ID: "human-ac", ProjectID: base.ProjectID, ACID: "human-ac", Digest: ac, Content: []byte("human AC"), CreatedAtNS: 42})
	}); err != nil {
		t.Fatal(err)
	}
	seedEvidence := func(r port.HumanReport, change func(*port.Evidence)) {
		t.Helper()
		e := port.Evidence{ID: domain.EvidenceID(r.ID), ProjectID: r.ProjectID, SubjectDigest: r.SubjectDigest, ACID: "human-ac", ACRevisionDigest: ac, Verdict: "Passed", Applicability: "Current", Availability: "Present", VerifierClass: "human", VerifierActor: r.Actor, VerifierRole: "human", RecipeDigest: domain.HashString("recipe"), EnvironmentDigest: domain.HashString("env"), ArtifactDigest: a.Digest}
		if change != nil {
			change(&e)
		}
		if err := s.Within(t.Context(), func(tx port.Transaction) error { return tx.StoreEvidence(t.Context(), e) }); err != nil {
			t.Fatal(err)
		}
	}
	e := base
	e.Kind = "evidence"
	e.ID = "report_0000000010"
	seedEvidence(e, nil)
	if err := store(e); err != nil {
		t.Fatal("valid Evidence provenance", err)
	}
	if err := s.Within(t.Context(), func(tx port.Transaction) error {
		got, err := tx.(port.HumanReportTransaction).LoadHumanReport(t.Context(), e.ProjectID, e.ID)
		if err == nil && got != e {
			t.Fatal("Evidence read changed")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	other := a
	other.Digest = domain.HashString("other bytes")
	other.StorageKey = "sha256:" + other.Digest.String()
	if err := s.Within(t.Context(), func(tx port.Transaction) error { return tx.StoreArtifact(t.Context(), other) }); err != nil {
		t.Fatal(err)
	}
	for i, change := range []func(*port.Evidence){func(e *port.Evidence) { e.ArtifactDigest = other.Digest }, func(e *port.Evidence) { e.VerifierActor = "other" }, func(e *port.Evidence) { e.SubjectDigest = domain.HashString("other") }, func(e *port.Evidence) { e.VerifierClass = "independent" }, func(e *port.Evidence) { e.VerifierRole = "producer" }} {
		bad := e
		bad.ID = fmt.Sprintf("report_%010d", i+20)
		seedEvidence(bad, change)
		if err := store(bad); err == nil || !strings.Contains(err.Error(), "human report provenance mismatch") {
			t.Fatal("Evidence mismatch not rejected by provenance trigger", i, err)
		}
	}
	both := base
	both.ID = "report_0000000040"
	seedReview(both)
	seedEvidence(both, nil)
	// Both FK targets exist and all provenance values match. Only the exclusive
	// kind/column pairing is invalid, so this must reach the CHECK constraint.
	if _, err := s.db.Exec(`INSERT INTO human_reports(project_id,report_id,work_item_id,run_id,subject_digest,actor_id,kind,artifact_digest,created_at_ns,lease_epoch,restore_generation,review_id,evidence_id) VALUES(?,?,?,?,?,?,'review',?,42,1,1,?,?)`, both.ProjectID, both.ID, both.WorkItemID, both.RunID, both.SubjectDigest.String(), both.Actor, a.Digest.String(), both.ID, both.ID); err == nil || !strings.Contains(err.Error(), "CHECK constraint") {
		t.Fatal("exclusive kind CHECK not established", err)
	}
	if err := s.Within(t.Context(), func(tx port.Transaction) error {
		_, err := tx.(port.HumanReportTransaction).LoadHumanReport(t.Context(), "other", base.ID)
		if !errors.Is(err, port.ErrNotFound) {
			t.Fatal("cross scope", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := s.Within(ctx, func(tx port.Transaction) error { return tx.(port.HumanReportTransaction).StoreHumanReport(ctx, base) }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
