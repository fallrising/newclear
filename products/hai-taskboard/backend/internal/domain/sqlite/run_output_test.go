package sqlite

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	driversqlite "modernc.org/sqlite"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRunOutput_V3UpgradePreservesHistory(t *testing.T) {
	frozen := []string{"57d96955d3351de47b1a81696398cf9ddb843394eb5c004c6f79841117c7745c", "5fbac05b24ba8bccedafb2857ff45934c88612e1ee6f550d12e4576fd2ea0b48", "77da66f51221f7af1a792ed40b2f1b3a04d0f706b737288f2c54a1def7fb48e7"}
	for i, want := range frozen {
		if compiledMigrations()[i].checksum != want {
			t.Fatal("frozen migration checksum changed", i)
		}
	}
	if err := validateMigrationRegistry(compiledMigrations()); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	path := filepath.Join(root, "state.db")
	db := migrationTestDB(t, path)
	if err := migrationRun(t, db, t.Context(), compiledMigrations()[:3], 42); err != nil {
		t.Fatal(err)
	}
	acceptancePopulateV1(t, db)
	before := outputV3Snapshot(t, db)
	store, err := migrationOpen(t.Context(), root, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	var version, count int
	if err = db.QueryRow("SELECT schema_version FROM instance_state").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 4 {
		t.Fatalf("schema=%d; want V4", version)
	}
	if err = db.QueryRow("SELECT count(*) FROM run_output_artifacts").Scan(&count); err != nil || count != 0 {
		t.Fatalf("backfill/count=%d err=%v", count, err)
	}
	if outputV3Snapshot(t, db) != before {
		t.Fatal("legacy history changed")
	}
	store, err = migrationOpen(t.Context(), root, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
}

func outputFixture(t *testing.T) (*Store, port.RunOutputWrite) {
	t.Helper()
	store, input := currentFixture(t)
	if err := storeInput(t, store, input, "run-output", nil); err != nil {
		t.Fatal(err)
	}
	if err := store.withConn(t.Context(), func(c *sql.Conn) error { return migrate(c, t.Context(), 43) }); err != nil {
		t.Fatal(err)
	}
	fence := port.RunFence{ProjectID: "project-1", RunID: "run-output", InputDigest: input.Digest(), Holder: "worker", Epoch: 1, RestoreGeneration: 1}
	migrationExec(t, store.db, `UPDATE runs SET desired_action='Dispatch',dispatch_state='Acknowledged',observed_state='Succeeded',reconciliation_state='None',side_effect_outcome='Confirmed' WHERE run_id='run-output'`)
	migrationExec(t, store.db, `UPDATE outbox SET state='Acknowledged',claim_epoch=1 WHERE run_id='run-output'`)
	migrationExec(t, store.db, `INSERT INTO run_leases VALUES('project-1','run-output',1,'worker',100)`)
	return store, port.RunOutputWrite{Fence: fence, ArtifactDigest: domain.HashString("output"), PublishedAtNS: 99}
}
func outputArtifact(d domain.Digest) port.Artifact {
	return port.Artifact{Digest: d, MediaType: "text/plain", ByteLength: 6, StorageKey: "sha256:" + d.String(), Availability: "Present"}
}
func outputWrite(t *testing.T, s *Store, w port.RunOutputWrite) error {
	t.Helper()
	return s.Within(t.Context(), func(tx port.Transaction) error { return tx.(port.RunOutputTransaction).StoreRunOutput(t.Context(), w) })
}
func outputAddArtifact(t *testing.T, s *Store, d domain.Digest) {
	t.Helper()
	if err := s.Within(t.Context(), func(tx port.Transaction) error { return tx.StoreArtifact(t.Context(), outputArtifact(d)) }); err != nil {
		t.Fatal(err)
	}
}
func outputRead(t *testing.T, s *Store, p domain.ProjectID, r domain.RunID) ([]port.RunOutput, error) {
	t.Helper()
	var result []port.RunOutput
	err := s.Within(t.Context(), func(tx port.Transaction) error {
		var err error
		result, err = tx.(port.RunOutputTransaction).LoadRunOutputs(t.Context(), p, r)
		return err
	})
	return result, err
}
func TestRunOutput_ExactReplaySortedHistoryAndReopen(t *testing.T) {
	s, w := outputFixture(t)
	outputAddArtifact(t, s, w.ArtifactDigest)
	for range 2 {
		if err := outputWrite(t, s, w); err != nil {
			t.Fatal(err)
		}
	}
	second := w
	second.ArtifactDigest = domain.HashString("second")
	outputAddArtifact(t, s, second.ArtifactDigest)
	if err := outputWrite(t, s, second); err != nil {
		t.Fatal(err)
	}
	got, err := outputRead(t, s, w.Fence.ProjectID, w.Fence.RunID)
	if err != nil || len(got) != 2 || got[0].ArtifactDigest.String() >= got[1].ArtifactDigest.String() {
		t.Fatalf("sorted complete outputs=%v err=%v", got, err)
	}
	for _, o := range got {
		if o.InputDigest != w.Fence.InputDigest || o.LeaseEpoch != 1 || o.RestoreGeneration != 1 || o.Artifact != outputArtifact(o.ArtifactDigest) {
			t.Fatal(o)
		}
	}
	migrationExec(t, s.db, "UPDATE instance_state SET restore_generation=2")
	migrationExec(t, s.db, "UPDATE run_leases SET epoch=2,holder='replacement',deadline_ns=200 WHERE run_id='run-output'")
	if err := outputWrite(t, s, w); !errors.Is(err, port.ErrFenceRejected) {
		t.Fatalf("stale replay=%v", err)
	}
	after, err := outputRead(t, s, w.Fence.ProjectID, w.Fence.RunID)
	if err != nil || !slices.Equal(got, after) {
		t.Fatal("history lost after generation change", err)
	}
	var path string
	if err = s.db.QueryRow("SELECT file FROM pragma_database_list WHERE name='main'").Scan(&path); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := migrationOpen(t.Context(), filepath.Dir(path), path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	after, err = outputRead(t, reopened, w.Fence.ProjectID, w.Fence.RunID)
	if err != nil || !slices.Equal(got, after) {
		t.Fatal("reopen changed history", err)
	}
}
func TestRunOutput_FenceScopeTerminalMetadataAndConflicts(t *testing.T) {
	for _, name := range []string{"project", "run", "input", "holder", "epoch", "generation", "expired", "zero-epoch", "overflow", "failed", "unknown", "reconcile", "missing-artifact", "missing", "key", "media", "stored-input-mismatch", "conflict"} {
		t.Run(name, func(t *testing.T) {
			s, w := outputFixture(t)
			a := outputArtifact(w.ArtifactDigest)
			switch name {
			case "project":
				w.Fence.ProjectID = "other"
			case "run":
				w.Fence.RunID = "other"
			case "input":
				w.Fence.InputDigest = domain.HashString("other")
			case "holder":
				w.Fence.Holder = "other"
			case "epoch":
				w.Fence.Epoch = 2
			case "generation":
				w.Fence.RestoreGeneration = 2
			case "expired":
				w.PublishedAtNS = 101
			case "zero-epoch":
				w.Fence.Epoch = 0
			case "overflow":
				w.Fence.Epoch = 1 << 63
			case "failed":
				migrationExec(t, s.db, "UPDATE runs SET observed_state='Failed'")
			case "unknown":
				migrationExec(t, s.db, "UPDATE runs SET side_effect_outcome='OutcomeUnknown'")
			case "reconcile":
				migrationExec(t, s.db, "UPDATE runs SET reconciliation_state='NeedsReconcile'")
			case "missing":
				a.Availability = "Missing"
			case "key":
				a.StorageKey = "arbitrary"
			case "media":
				a.MediaType = "invalid media"
			case "oversized-media":
				a.MediaType = "text/" + strings.Repeat("x", 200)
			}
			if name != "missing-artifact" {
				if err := s.Within(t.Context(), func(tx port.Transaction) error { return tx.StoreArtifact(t.Context(), a) }); err != nil {
					t.Fatal(err)
				}
			}
			if name == "conflict" {
				migrationExec(t, s.db, `INSERT INTO run_output_artifacts VALUES(?,?,?,?,2,1)`, "project-1", "run-output", a.Digest.String(), w.Fence.InputDigest.String())
			}
			if name == "stored-input-mismatch" {
				migrationExec(t, s.db, `INSERT INTO run_output_artifacts VALUES(?,?,?,?,1,1)`, "project-1", "run-output", a.Digest.String(), domain.HashString("wrong-input").String())
			}
			if err := outputWrite(t, s, w); err == nil {
				t.Fatal("invalid output accepted")
			}
			var n int
			if err := s.db.QueryRow("SELECT count(*) FROM run_output_artifacts").Scan(&n); err != nil {
				t.Fatal(err)
			}
			want := 0
			if name == "conflict" || name == "stored-input-mismatch" {
				want = 1
			}
			if n != want {
				t.Fatal("rejection mutated associations", n)
			}
		})
	}
}
func TestRunOutput_ImmutableSQLAndConstraints(t *testing.T) {
	s, w := outputFixture(t)
	outputAddArtifact(t, s, w.ArtifactDigest)
	if err := outputWrite(t, s, w); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`UPDATE run_output_artifacts SET lease_epoch=lease_epoch`,
		`DELETE FROM run_output_artifacts`,
		`INSERT OR REPLACE INTO run_output_artifacts SELECT * FROM run_output_artifacts`,
		`REPLACE INTO run_output_artifacts SELECT * FROM run_output_artifacts`,
		`INSERT OR IGNORE INTO run_output_artifacts SELECT * FROM run_output_artifacts`,
		`INSERT INTO run_output_artifacts SELECT * FROM run_output_artifacts WHERE true ON CONFLICT DO NOTHING`,
		`INSERT INTO run_output_artifacts SELECT * FROM run_output_artifacts WHERE true ON CONFLICT DO UPDATE SET lease_epoch=excluded.lease_epoch`,
	} {
		if _, err := s.db.ExecContext(t.Context(), q); err == nil {
			t.Errorf("immutable SQL accepted: %s", q)
		}
	}
	outputAddArtifact(t, s, domain.HashString("x"))
	for _, args := range [][]any{
		{"", "run-output", domain.HashString("x").String(), w.Fence.InputDigest.String(), 1, 1},
		{"project-1", "", domain.HashString("x").String(), w.Fence.InputDigest.String(), 1, 1},
		{"project-1", "run-output", "INVALID", w.Fence.InputDigest.String(), 1, 1},
		{"project-1", "run-output", domain.HashString("x").String(), "bad", 1, 1},
		{"project-1", "run-output", domain.HashString("x").String(), w.Fence.InputDigest.String(), 0, 1},
		{"project-1", "run-output", domain.HashString("x").String(), w.Fence.InputDigest.String(), 1, -1},
		{"project-1", "run-output", domain.HashString("x").String(), w.Fence.InputDigest.String(), 1.5, 1},
		{"project-1", "run-output", nil, w.Fence.InputDigest.String(), 1, 1},
	} {
		if _, err := s.db.ExecContext(t.Context(), "INSERT INTO run_output_artifacts VALUES(?,?,?,?,?,?)", args...); err == nil {
			t.Fatal("invalid table row accepted", args)
		}
	}
	var strict int
	if err := s.db.QueryRow("SELECT strict FROM pragma_table_list WHERE name='run_output_artifacts'").Scan(&strict); err != nil || strict != 1 {
		t.Fatal("not STRICT", err)
	}
}
func TestRunOutput_RollbackCancellationAndCapacity(t *testing.T) {
	s, w := outputFixture(t)
	sentinel := errors.New("postwrite failure")
	err := s.Within(t.Context(), func(tx port.Transaction) error {
		if e := tx.StoreArtifact(t.Context(), outputArtifact(w.ArtifactDigest)); e != nil {
			return e
		}
		if e := tx.(port.RunOutputTransaction).StoreRunOutput(t.Context(), w); e != nil {
			return e
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	var n int
	if err = s.db.QueryRow("SELECT count(*) FROM artifacts").Scan(&n); err != nil || n != 0 {
		t.Fatal("artifact rollback", n, err)
	}
	outputAddArtifact(t, s, w.ArtifactDigest)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	err = s.Within(ctx, func(tx port.Transaction) error { return tx.(port.RunOutputTransaction).StoreRunOutput(ctx, w) })
	if !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation", err)
	}
	if err := s.Within(t.Context(), func(tx port.Transaction) error {
		for i := range port.RunOutputLimit {
			d := domain.HashString(fmt.Sprintf("output-%d", i))
			if e := tx.StoreArtifact(t.Context(), outputArtifact(d)); e != nil {
				return e
			}
			if _, e := tx.(transaction).conn.ExecContext(t.Context(), `INSERT INTO run_output_artifacts VALUES(?,?,?,?,1,1)`, w.Fence.ProjectID, w.Fence.RunID, d.String(), w.Fence.InputDigest.String()); e != nil {
				return e
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	got, err := outputRead(t, s, w.Fence.ProjectID, w.Fence.RunID)
	if err != nil || len(got) != port.RunOutputLimit {
		t.Fatalf("exact capacity=%d err=%v", len(got), err)
	}
	if err := outputWrite(t, s, w); err == nil {
		t.Fatal("overflow write accepted")
	}
	migrationExec(t, s.db, `INSERT INTO run_output_artifacts VALUES(?,?,?,?,1,1)`, w.Fence.ProjectID, w.Fence.RunID, w.ArtifactDigest.String(), w.Fence.InputDigest.String())
	got, err = outputRead(t, s, w.Fence.ProjectID, w.Fence.RunID)
	if err == nil || got != nil {
		t.Fatalf("overflow silently truncated: len=%d err=%v", len(got), err)
	}
}

// outputV3Snapshot retains every pre-V4 schema object and record, excluding only
// the intentionally advanced schema version and newly appended ledger entry.
func outputV3Snapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), `SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name<>'run_output_artifacts' ORDER BY name`)
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
			query += " WHERE version<=3"
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
	rows, err = db.QueryContext(t.Context(), `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name<>'run_output_artifacts' ORDER BY type,name`)
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
func TestRunOutput_PopulatedV3EnvelopeUpgrade(t *testing.T) {
	s, input := currentFixture(t)
	if err := storeInput(t, s, input, "legacy", nil); err != nil {
		t.Fatal(err)
	}
	before := outputV3Snapshot(t, s.db)
	if err := s.withConn(t.Context(), func(c *sql.Conn) error { return migrate(c, t.Context(), 44) }); err != nil {
		t.Fatal(err)
	}
	if outputV3Snapshot(t, s.db) != before {
		t.Fatal("V3 records/schema changed")
	}
	got, err := outputRead(t, s, "project-1", "legacy")
	if err != nil || len(got) != 0 {
		t.Fatal("legacy output inferred", got, err)
	}
}
func TestRunOutput_HistoricalCorruptionFailsClosed(t *testing.T) {
	for _, name := range []string{"input", "missing", "media", "key", "scope", "epoch", "generation", "digest", "absent-artifact", "oversized-media"} {
		t.Run(name, func(t *testing.T) {
			s, w := outputFixture(t)
			a := outputArtifact(w.ArtifactDigest)
			switch name {
			case "missing":
				a.Availability = "Quarantined"
			case "media":
				a.MediaType = "invalid media"
			case "oversized-media":
				a.MediaType = "text/" + strings.Repeat("x", 200)
			case "key":
				a.StorageKey = "bad"
			}
			if err := s.Within(t.Context(), func(tx port.Transaction) error { return tx.StoreArtifact(t.Context(), a) }); err != nil {
				t.Fatal(err)
			}
			input := w.Fence.InputDigest.String()
			if name == "input" {
				input = domain.HashString("other").String()
			}
			if name == "scope" {
				if err := s.Within(t.Context(), func(tx port.Transaction) error {
					r := port.Run{ID: "other", ProjectID: "project-1", WorkItemID: "item-1", InputDigest: domain.HashString("other"), AdapterID: "fake/v1", AdapterVersion: "1", ScenarioID: "success", Attempt: 1, DesiredAction: "None", DispatchState: "Pending", ObservedState: "Unknown", ReconciliationState: "None", SideEffectOutcome: "NotApplicable", CreatedAtNS: 42}
					return tx.CreateRun(t.Context(), r)
				}); err != nil {
					t.Fatal(err)
				}
				w.Fence.RunID = "other"
			}
			if name == "epoch" || name == "generation" || name == "digest" || name == "absent-artifact" {
				// Standalone malformed storage fixture; immutable production triggers stay intact.
				root := t.TempDir()
				db := migrationTestDB(t, filepath.Join(root, "malformed.db"))
				migrationExec(t, db, `CREATE TABLE runs(project_id,run_id,input_digest);CREATE TABLE artifacts(digest,media_type,byte_length,storage_key,availability);CREATE TABLE run_output_artifacts(project_id,run_id,artifact_digest,input_digest,lease_epoch,restore_generation)`)
				migrationExec(t, db, `INSERT INTO runs VALUES(?,?,?)`, w.Fence.ProjectID, w.Fence.RunID, input)
				if name != "absent-artifact" {
					migrationExec(t, db, `INSERT INTO artifacts VALUES(?,?,?,?,?)`, a.Digest.String(), a.MediaType, a.ByteLength, a.StorageKey, a.Availability)
				}
				epoch, generation := int64(1), int64(1)
				digest := a.Digest.String()
				if name == "epoch" {
					epoch = 0
				}
				if name == "generation" {
					generation = -1
				}
				if name == "digest" {
					digest = "BAD"
				}
				migrationExec(t, db, `INSERT INTO run_output_artifacts VALUES(?,?,?,?,?,?)`, w.Fence.ProjectID, w.Fence.RunID, digest, input, epoch, generation)
				conn, err := db.Conn(t.Context())
				if err != nil {
					t.Fatal(err)
				}
				defer conn.Close()
				got, err := (transaction{conn: conn}).LoadRunOutputs(t.Context(), w.Fence.ProjectID, w.Fence.RunID)
				if _, ok := errors.AsType[domain.StorageCorruptionError](err); !ok || got != nil {
					t.Fatal("corrupt history not typed", got, err)
				}
				return
			}
			migrationExec(t, s.db, `INSERT INTO run_output_artifacts VALUES(?,?,?,?,1,1)`, w.Fence.ProjectID, w.Fence.RunID, a.Digest.String(), input)
			got, err := outputRead(t, s, w.Fence.ProjectID, w.Fence.RunID)
			if err == nil || got != nil {
				t.Fatal("corrupt history accepted", got, err)
			}
		})
	}
}

func TestRunOutput_V4MigrationRollbackCancellationAndRetry(t *testing.T) {
	for _, failure := range []string{"sql", "history", "state", "cancel"} {
		t.Run(failure, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			if err := migrationRun(t, db, t.Context(), compiledMigrations()[:3], 42); err != nil {
				t.Fatal(err)
			}
			acceptancePopulateV1(t, db)
			before := migrationLogicalSnapshot(t, db)
			history := outputV3Snapshot(t, db)
			statement := v4Migration
			ctx := t.Context()
			var called atomic.Bool
			switch failure {
			case "sql":
				statement += "\nINSERT INTO absent_output_probe VALUES(1);"
			case "history":
				statement += "\nINSERT INTO schema_migrations VALUES(4,'conflict',43);"
			case "state":
				statement += "\nDROP TABLE instance_state;"
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(t.Context())
				defer cancel()
				name := fmt.Sprintf("output_cancel_%d", migrationCancelFunctionSequence.Add(1))
				if err := driversqlite.RegisterScalarFunction(name, 0, func(*driversqlite.FunctionContext, []driver.Value) (driver.Value, error) {
					called.Store(true)
					cancel()
					return int64(1), nil
				}); err != nil {
					t.Fatal(err)
				}
				db.SetMaxIdleConns(0)
				statement += "\nSELECT " + name + "();"
			}
			registry := append(slices.Clone(compiledMigrations()[:3]), migrationTestStep(4, statement))
			err := migrationRun(t, db, ctx, registry, 43)
			if err == nil {
				t.Fatal("failing V4 accepted")
			}
			if failure == "cancel" && (!called.Load() || !errors.Is(err, context.Canceled)) {
				t.Fatal("cancel callback not reached", err)
			}
			if migrationLogicalSnapshot(t, db) != before || outputV3Snapshot(t, db) != history {
				t.Fatal("V4 failure changed V3 state/history")
			}
			opened, err := migrationOpen(t.Context(), root, path)
			if err != nil {
				t.Fatal("V4 retry lock leaked", err)
			}
			if err = opened.Close(); err != nil {
				t.Fatal(err)
			}
			if outputV3Snapshot(t, db) != history {
				t.Fatal("successful V4 retry changed V3 history")
			}
		})
	}
}
func TestRunOutput_CancelAfterWriteRollsBackAndReleasesWriter(t *testing.T) {
	s, w := outputFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	err := s.Within(ctx, func(tx port.Transaction) error {
		if err := tx.StoreArtifact(ctx, outputArtifact(w.ArtifactDigest)); err != nil {
			return err
		}
		if err := tx.(port.RunOutputTransaction).StoreRunOutput(ctx, w); err != nil {
			return err
		}
		cancel()
		return ctx.Err()
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	got, err := outputRead(t, s, w.Fence.ProjectID, w.Fence.RunID)
	if err != nil || len(got) != 0 {
		t.Fatal("cancellation retained output or writer", got, err)
	}
	var n int
	if err = s.db.QueryRow("SELECT count(*) FROM artifacts").Scan(&n); err != nil || n != 0 {
		t.Fatal("cancellation retained metadata", n, err)
	}
}
func TestRunOutput_ImmediateForeignKeys(t *testing.T) {
	s, w := outputFixture(t)
	outputAddArtifact(t, s, w.ArtifactDigest)
	for _, args := range [][]any{
		{"other", "run-output", w.ArtifactDigest.String(), w.Fence.InputDigest.String()},
		{"project-1", "other", w.ArtifactDigest.String(), w.Fence.InputDigest.String()},
		{"project-1", "run-output", domain.HashString("absent").String(), w.Fence.InputDigest.String()},
	} {
		err := s.Within(t.Context(), func(tx port.Transaction) error {
			_, err := tx.(transaction).conn.ExecContext(t.Context(), `INSERT INTO run_output_artifacts VALUES(?,?,?,?,1,1)`, args...)
			if err == nil {
				return errors.New("missing immediate FK rejection")
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestRunOutput_LeaseDeadlineEqualityMatchesPublication(t *testing.T) {
	s, w := outputFixture(t)
	outputAddArtifact(t, s, w.ArtifactDigest)
	w.PublishedAtNS = 100
	if err := outputWrite(t, s, w); err != nil {
		t.Fatal("exact deadline rejected", err)
	}
	w.PublishedAtNS = 101
	if err := outputWrite(t, s, w); !errors.Is(err, port.ErrFenceRejected) {
		t.Fatal("expired deadline accepted", err)
	}
}

func TestRunOutput_V4DigestByteConstraints(t *testing.T) {
	for _, field := range []string{"artifact_digest", "input_digest"} {
		for _, value := range []string{strings.Repeat("a", 64) + "\x00BAD", strings.Repeat("a", 63) + "\x00", strings.Repeat("é", 32), strings.Repeat("a", 63) + "A"} {
			t.Run(field+fmt.Sprintf("-%x", []byte(value)[len(value)-1:]), func(t *testing.T) {
				// Standalone V4 constraint fixture isolates its own checks from frozen parent
				// digest constraints; no production table or trigger is changed.
				db := migrationTestDB(t, filepath.Join(t.TempDir(), "constraints.db"))
				migrationExec(t, db, `CREATE TABLE runs(project_id TEXT,run_id TEXT,PRIMARY KEY(project_id,run_id));CREATE TABLE artifacts(digest TEXT PRIMARY KEY)`)
				migrationExec(t, db, v4Migration)
				artifact, input := domain.HashString("artifact").String(), domain.HashString("input").String()
				if field == "artifact_digest" {
					artifact = value
				} else {
					input = value
				}
				migrationExec(t, db, `INSERT INTO runs VALUES('project','run')`)
				migrationExec(t, db, `INSERT INTO artifacts VALUES(?)`, artifact)
				if _, err := db.ExecContext(t.Context(), `INSERT INTO run_output_artifacts VALUES('project','run',?,?,1,1)`, artifact, input); err == nil {
					t.Fatal("invalid digest bytes accepted", field, len(value))
				}
			})
		}
	}
}

func TestRunOutput_MetadataSQLBoundsUTF8BytesBeforeReturning(t *testing.T) {
	for _, test := range []struct {
		name, value string
		calls       int
		valid       bool
	}{
		{"valid-control", "text/plain", 2, true},
		{"ordinary-nul", "text/plain\x00", 2, false},
		{"nul-suffix", "text/plain\x00" + strings.Repeat("x", 1000), 1, false},
		{"multibyte", "text/" + strings.Repeat("é", 100), 1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int64
			name := fmt.Sprintf("output_media_bound_%d", migrationCancelFunctionSequence.Add(1))
			if err := driversqlite.RegisterScalarFunction(name, 0, func(_ *driversqlite.FunctionContext, _ []driver.Value) (driver.Value, error) {
				calls.Add(1)
				return test.value, nil
			}); err != nil {
				t.Fatal(err)
			}
			db := migrationTestDB(t, filepath.Join(t.TempDir(), "bounds.db"))
			digest, input := domain.HashString("output").String(), domain.HashString("input").String()
			migrationExec(t, db, `CREATE TABLE runs(project_id,run_id,input_digest);CREATE TABLE artifact_source(digest,media_type,byte_length,storage_key,availability);CREATE TABLE run_output_artifacts(project_id,run_id,artifact_digest,input_digest,lease_epoch,restore_generation)`)
			migrationExec(t, db, `CREATE VIEW artifacts AS SELECT digest,`+name+`() AS media_type,byte_length,storage_key,availability FROM artifact_source`)
			migrationExec(t, db, `INSERT INTO runs VALUES('project','run',?)`, input)
			migrationExec(t, db, `INSERT INTO artifact_source VALUES(?,?,1,?,'Present')`, digest, test.value, "sha256:"+digest)
			migrationExec(t, db, `INSERT INTO run_output_artifacts VALUES('project','run',?,?,1,1)`, digest, input)
			conn, err := db.Conn(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			got, err := (transaction{conn: conn}).LoadRunOutputs(t.Context(), "project", "run")
			if test.valid {
				if err != nil || len(got) != 1 {
					t.Fatal("valid control rejected", err)
				}
			} else if _, ok := errors.AsType[domain.StorageCorruptionError](err); !ok || got != nil {
				t.Fatal("invalid metadata accepted", err)
			}
			// SQLite evaluates the view field for the condition; evaluation again means
			// the oversized value passed CASE and was returned to the Go driver.
			if calls.Load() != int64(test.calls) {
				t.Fatalf("metadata evaluated %d times; want %d (byte bound before return)", calls.Load(), test.calls)
			}
		})
	}
}
