package sqlite

import (
	"context"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"testing"
)

// Local structural contract keeps this regression compiling before capability implementation.
type outputAccessReadContract interface {
	LoadScopedRunOutputs(context.Context, domain.ProjectID, domain.WorkItemID, domain.RunID) ([]port.RunOutput, error)
	LoadProjectRunOutput(context.Context, domain.ProjectID, domain.Digest) (port.RunOutput, error)
}

func TestOutputAccessSQLite_ScopeAndHistory(t *testing.T) {
	s, w := outputFixture(t)
	outputAddArtifact(t, s, w.ArtifactDigest)
	if err := outputWrite(t, s, w); err != nil {
		t.Fatal(err)
	}
	var item domain.WorkItemID
	if err := s.db.QueryRow("SELECT work_item_id FROM runs WHERE run_id=?", w.Fence.RunID).Scan(&item); err != nil {
		t.Fatal(err)
	}
	read := func(project domain.ProjectID, work domain.WorkItemID, run domain.RunID) ([]port.RunOutput, error) {
		var result []port.RunOutput
		err := s.Within(t.Context(), func(tx port.Transaction) error {
			reader, ok := tx.(outputAccessReadContract)
			if !ok {
				return errors.New("scoped output capability absent")
			}
			var err error
			result, err = reader.LoadScopedRunOutputs(t.Context(), project, work, run)
			return err
		})
		return result, err
	}
	got, err := read(w.Fence.ProjectID, item, w.Fence.RunID)
	if err != nil || len(got) != 1 {
		t.Fatalf("historical scope: %v %v", got, err)
	}
	for _, scope := range []struct {
		p domain.ProjectID
		w domain.WorkItemID
		r domain.RunID
	}{{"other", item, w.Fence.RunID}, {w.Fence.ProjectID, "other", w.Fence.RunID}, {w.Fence.ProjectID, item, "other"}} {
		got, err = read(scope.p, scope.w, scope.r)
		if !errors.Is(err, port.ErrNotFound) || got != nil {
			t.Fatal("foreign scope accepted", got, err)
		}
	}
	migrationExec(t, s.db, "DELETE FROM run_leases")
	migrationExec(t, s.db, "UPDATE instance_state SET restore_generation=restore_generation+1")
	migrationExec(t, s.db, "UPDATE work_item_spec_heads SET head_version=head_version+1")
	got, err = read(w.Fence.ProjectID, item, w.Fence.RunID)
	if err != nil || len(got) != 1 || got[0].LeaseEpoch != 1 || got[0].RestoreGeneration != 1 {
		t.Fatal("history depends on current authority", got, err)
	}
}

func TestOutputAccessSQLite_CompleteLimitEmptyAndNoFallback(t *testing.T) {
	s, w := outputFixture(t)
	var item domain.WorkItemID
	if err := s.db.QueryRow("SELECT work_item_id FROM runs WHERE run_id=?", w.Fence.RunID).Scan(&item); err != nil {
		t.Fatal(err)
	}
	read := func() ([]port.RunOutput, error) {
		var result []port.RunOutput
		err := s.Within(t.Context(), func(tx port.Transaction) error {
			var err error
			result, err = tx.(port.RunOutputReadTransaction).LoadScopedRunOutputs(t.Context(), w.Fence.ProjectID, item, w.Fence.RunID)
			return err
		})
		return result, err
	}
	got, err := read()
	if err != nil || len(got) != 0 {
		t.Fatal("empty history", got, err)
	}
	migrationExec(t, s.db, "UPDATE runs SET observed_state='Running'")
	got, err = read()
	if err != nil || len(got) != 0 {
		t.Fatal("nonterminal empty history", got, err)
	}
	if err := s.Within(t.Context(), func(tx port.Transaction) error {
		for i := range port.RunOutputLimit {
			d := domain.HashString(fmt.Sprintf("access-%d", i))
			if err := tx.StoreArtifact(t.Context(), outputArtifact(d)); err != nil {
				return err
			}
			if _, err := tx.(transaction).conn.ExecContext(t.Context(), "INSERT INTO run_output_artifacts VALUES(?,?,?,?,1,1)", w.Fence.ProjectID, w.Fence.RunID, d.String(), w.Fence.InputDigest.String()); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got, err = read()
	if err != nil || len(got) != 1024 {
		t.Fatal("exact capacity", len(got), err)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].ArtifactDigest.String() >= got[i].ArtifactDigest.String() {
			t.Fatal("not strictly ordered")
		}
	}
	selected := got[0].ArtifactDigest
	checkArtifact := func(p domain.ProjectID, d domain.Digest, want error) {
		t.Helper()
		err := s.Within(t.Context(), func(tx port.Transaction) error {
			_, err := tx.(port.RunOutputReadTransaction).LoadProjectRunOutput(t.Context(), p, d)
			return err
		})
		if !errors.Is(err, want) {
			t.Fatal("artifact selection", err, want)
		}
	}
	checkArtifact(w.Fence.ProjectID, selected, nil)
	checkArtifact("other", selected, port.ErrNotFound)
	outputAddArtifact(t, s, w.ArtifactDigest)
	checkArtifact(w.Fence.ProjectID, w.ArtifactDigest, port.ErrNotFound)
	migrationExec(t, s.db, "INSERT INTO run_output_artifacts VALUES(?,?,?,?,1,1)", w.Fence.ProjectID, w.Fence.RunID, w.ArtifactDigest.String(), w.Fence.InputDigest.String())
	got, err = read()
	if !errors.Is(err, domain.ErrStorageCorruption) || got != nil {
		t.Fatal("overflow truncated", len(got), err)
	}
	checkArtifact(w.Fence.ProjectID, selected, domain.ErrStorageCorruption)
}
func TestOutputAccessSQLite_CorruptFirstBindingDoesNotFallBack(t *testing.T) {
	s, w := outputFixture(t)
	outputAddArtifact(t, s, w.ArtifactDigest)
	if err := outputWrite(t, s, w); err != nil {
		t.Fatal(err)
	}
	migrationExec(t, s.db, "INSERT INTO runs SELECT project_id,'run-a',work_item_id,input_digest,adapter_id,adapter_version,scenario_id,attempt,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome,created_at_ns FROM runs LIMIT 1")
	migrationExec(t, s.db, "INSERT INTO run_output_artifacts SELECT project_id,'run-a',artifact_digest,?,lease_epoch,restore_generation FROM run_output_artifacts LIMIT 1", domain.HashString("wrong-input").String())
	err := s.Within(t.Context(), func(tx port.Transaction) error {
		_, err := tx.(port.RunOutputReadTransaction).LoadProjectRunOutput(t.Context(), w.Fence.ProjectID, w.ArtifactDigest)
		return err
	})
	if !errors.Is(err, domain.ErrStorageCorruption) {
		t.Fatal("fell back past corrupt first binding", err)
	}
}
