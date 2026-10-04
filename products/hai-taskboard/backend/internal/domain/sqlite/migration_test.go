package sqlite

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	driversqlite "modernc.org/sqlite"
)

const frozenV1Checksum = "57d96955d3351de47b1a81696398cf9ddb843394eb5c004c6f79841117c7745c"

func TestAdmission_MigrationPreservesV1AndRejectsUnknownSchema(t *testing.T) {
	if migrationChecksum() != frozenV1Checksum {
		t.Fatal("V1 SQL bytes changed")
	}
	for _, name := range []string{"valid-reopen", "unknown-newer", "state-mismatch", "state-missing"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			store, err := OpenAtRootWithClock(t.Context(), root, path, func() time.Time { return fixedClockTime })
			if err != nil {
				t.Fatal(err)
			}
			mustCreateProject(t, store)
			mustCreateWorkItem(t, store, mustWorkItem(t, "item-1", "project-1", domain.PhaseQA, 5))
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			db := migrationTestDB(t, path)
			migrationExec(t, db, "UPDATE instance_state SET restore_generation=7,stream_epoch=9,next_event_sequence=12 WHERE id=1")
			switch name {
			case "unknown-newer":
				// A newer binary may legitimately append history and advance state.
				// No immutable row or trigger is modified to produce this Red.
				migrationExec(t, db, "INSERT INTO schema_migrations VALUES (2,?,?)", domain.HashString("synthetic newer binary").String(), fixedClockTime.UnixNano()+1)
				migrationExec(t, db, "UPDATE instance_state SET schema_version=2 WHERE id=1")
			case "state-mismatch":
				migrationExec(t, db, "UPDATE instance_state SET schema_version=2 WHERE id=1")
			case "state-missing":
				migrationExec(t, db, "DELETE FROM instance_state WHERE id=1")
			}
			before := migrationLogicalSnapshot(t, db)
			reopened, err := OpenAtRootWithClock(t.Context(), root, path, func() time.Time { return fixedClockTime.Add(time.Hour) })
			if name == "valid-reopen" {
				if err != nil {
					t.Fatalf("valid V1 reopen failed: %v", err)
				}
				identity, err := reopened.Identity(t.Context())
				if err != nil || identity.MigrationSum != frozenV1Checksum {
					t.Fatalf("V1 identity changed: %#v %v", identity, err)
				}
			} else if err == nil {
				t.Error("public reopen accepted incompatible migration history/state")
			}
			if reopened != nil {
				if err := reopened.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if after := migrationLogicalSnapshot(t, db); after != before {
				t.Fatal("reopen mutated application/schema/history/state")
			}
		})
	}
}

func migrationTestDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", databaseURI(path))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close migration fixture: %v", err)
		}
	})
	return db
}

func migrationExec(t *testing.T, db *sql.DB, statement string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(t.Context(), statement, args...); err != nil {
		t.Fatal(err)
	}
}

func migrationLogicalSnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var snapshot strings.Builder
	for _, query := range []string{
		"SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
		"SELECT * FROM schema_migrations ORDER BY version",
		"SELECT * FROM instance_state ORDER BY id",
		"SELECT * FROM projects ORDER BY project_id",
		"SELECT * FROM work_items ORDER BY project_id,work_item_id",
	} {
		rows, err := db.QueryContext(t.Context(), query)
		if err != nil {
			fmt.Fprintf(&snapshot, "%s: %v\n", query, err)
			continue
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			t.Fatal(err)
		}
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for index := range values {
				pointers[index] = &values[index]
			}
			if err := rows.Scan(pointers...); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			fmt.Fprintf(&snapshot, "%s: %#v\n", query, values)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		if err := rows.Close(); err != nil {
			t.Fatal(err)
		}
	}
	return snapshot.String()
}

func migrationTestStep(version int, statement string) migrationStep {
	return migrationStep{version, statement, domain.HashString(statement).String()}
}

func migrationTestRegistry() []migrationStep {
	return []migrationStep{{1, v1Migration, frozenV1Checksum}}
}

func migrationRun(t *testing.T, db *sql.DB, ctx context.Context, registry []migrationStep, appliedAt int64) error {
	t.Helper()
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	err = runMigrations(conn, ctx, registry, appliedAt)
	return errors.Join(err, conn.Close())
}

func TestMigrationRunner_RegistryAndHistoryValidation(t *testing.T) {
	for _, fixture := range []struct {
		name     string
		registry []migrationStep
	}{
		{"empty", nil},
		{"wrong-checksum", []migrationStep{{1, v1Migration, "wrong"}}},
		{"gap", []migrationStep{migrationTestStep(2, "SELECT 1")}},
		{"duplicate-version", []migrationStep{migrationTestStep(1, "SELECT 1"), migrationTestStep(1, "SELECT 2")}},
		{"empty-sql", []migrationStep{migrationTestStep(1, "")}},
		{"duplicate-sql", []migrationStep{migrationTestStep(1, "SELECT 1"), migrationTestStep(2, "SELECT 1")}},
	} {
		t.Run("registry/"+fixture.name, func(t *testing.T) {
			db := migrationTestDB(t, filepath.Join(t.TempDir(), "state.db"))
			before := migrationLogicalSnapshot(t, db)
			if err := migrationRun(t, db, t.Context(), fixture.registry, 42); err == nil {
				t.Fatal("invalid registry accepted")
			}
			if migrationLogicalSnapshot(t, db) != before {
				t.Fatal("registry validation mutated database")
			}
		})
	}
	for _, fixture := range []struct{ name, setup string }{
		{"checksum", "INSERT INTO schema_migrations VALUES(1,'wrong',42); INSERT INTO instance_state VALUES(1,1)"},
		{"gap", fmt.Sprintf("INSERT INTO schema_migrations VALUES(2,'%s',42); INSERT INTO instance_state VALUES(1,2)", frozenV1Checksum)},
		{"duplicate", fmt.Sprintf("INSERT INTO schema_migrations VALUES(1,'%s',42),(1,'%s',42); INSERT INTO instance_state VALUES(1,1)", frozenV1Checksum, frozenV1Checksum)},
		{"malformed-timestamp", fmt.Sprintf("INSERT INTO schema_migrations VALUES(1,'%s','bad'); INSERT INTO instance_state VALUES(1,1)", frozenV1Checksum)},
		{"text-version", fmt.Sprintf("INSERT INTO schema_migrations VALUES('1','%s',42); INSERT INTO instance_state VALUES(1,1)", frozenV1Checksum)},
		{"text-timestamp", fmt.Sprintf("INSERT INTO schema_migrations VALUES(1,'%s','42'); INSERT INTO instance_state VALUES(1,1)", frozenV1Checksum)},
		{"text-state", fmt.Sprintf("INSERT INTO schema_migrations VALUES(1,'%s',42); INSERT INTO instance_state VALUES(1,'1')", frozenV1Checksum)},
		{"missing-state", fmt.Sprintf("INSERT INTO schema_migrations VALUES(1,'%s',42)", frozenV1Checksum)},
		{"extra-state", fmt.Sprintf("INSERT INTO schema_migrations VALUES(1,'%s',42); INSERT INTO instance_state VALUES(1,1),(2,1)", frozenV1Checksum)},
		{"wrong-id", fmt.Sprintf("INSERT INTO schema_migrations VALUES(1,'%s',42); INSERT INTO instance_state VALUES(2,1)", frozenV1Checksum)},
		{"empty-history-application", "CREATE TABLE application_probe(value INTEGER)"},
		{"empty-history-sqlite-prefix", "CREATE TABLE sqliteXprobe(value INTEGER)"},
	} {
		t.Run("history/"+fixture.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			db := migrationTestDB(t, path)
			// Standalone malformed input, not a V1 fixture with bypassed triggers.
			migrationExec(t, db, "CREATE TABLE schema_migrations(version,checksum,applied_at_ns); CREATE TABLE instance_state(id,schema_version); "+fixture.setup)
			before := migrationLogicalSnapshot(t, db)
			store, err := migrationOpen(t.Context(), root, path)
			if store != nil {
				if closeErr := store.Close(); closeErr != nil {
					t.Fatal(closeErr)
				}
			}
			if err == nil {
				t.Fatal("invalid history/state accepted")
			}
			if migrationLogicalSnapshot(t, db) != before {
				t.Fatal("rejection mutated malformed input")
			}
		})
	}
	t.Run("application-without-ledger", func(t *testing.T) {
		db := migrationTestDB(t, filepath.Join(t.TempDir(), "state.db"))
		migrationExec(t, db, "CREATE TABLE application_probe(value INTEGER); INSERT INTO application_probe VALUES(7)")
		before := migrationLogicalSnapshot(t, db)
		if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err == nil {
			t.Fatal("adopted application schema without ledger")
		}
		if migrationLogicalSnapshot(t, db) != before {
			t.Fatal("rejection left a new ledger")
		}
	})
	t.Run("ledger-only", func(t *testing.T) {
		db := migrationTestDB(t, filepath.Join(t.TempDir(), "state.db"))
		migrationExec(t, db, "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT UNIQUE,applied_at_ns INTEGER)")
		if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err != nil {
			t.Fatal(err)
		}
		before := migrationLogicalSnapshot(t, db)
		if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), -1); err != nil {
			t.Fatal(err)
		}
		if migrationLogicalSnapshot(t, db) != before {
			t.Fatal("valid history timestamp changed")
		}
	})
	t.Run("negative-timestamp", func(t *testing.T) {
		db := migrationTestDB(t, filepath.Join(t.TempDir(), "state.db"))
		if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), -42); err != nil {
			t.Fatal(err)
		}
		before := migrationLogicalSnapshot(t, db)
		if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 99); err != nil {
			t.Fatal(err)
		}
		if migrationLogicalSnapshot(t, db) != before {
			t.Fatal("valid int64 timestamp was rewritten")
		}
	})
}

func TestMigrationRunner_AtomicUpgradeRollbackAndRestart(t *testing.T) {
	for _, existing := range []bool{false, true} {
		for _, failure := range []string{"sql", "history", "state"} {
			t.Run(fmt.Sprintf("existing=%t/%s", existing, failure), func(t *testing.T) {
				root := t.TempDir()
				path := filepath.Join(root, "state.db")
				db := migrationTestDB(t, path)
				if existing {
					if err := migrationRun(t, db, t.Context(), migrationTestRegistry(), 42); err != nil {
						t.Fatal(err)
					}
				}
				before := migrationLogicalSnapshot(t, db)
				registry := append(migrationTestRegistry(), migrationTestStep(2, "CREATE TABLE earlier_probe(value INTEGER); INSERT INTO earlier_probe VALUES(17)"))
				statement := "CREATE TABLE later_probe(value INTEGER); "
				switch failure {
				case "sql":
					statement += "INSERT INTO missing_table VALUES(1)"
				case "history":
					statement += "INSERT INTO schema_migrations VALUES(3,'synthetic conflicting history',43)"
				case "state":
					statement += "DROP TABLE instance_state"
				}
				registry = append(registry, migrationTestStep(3, statement))
				if err := migrationRun(t, db, t.Context(), registry, 43); err == nil {
					t.Fatal("failing upgrade accepted")
				}
				if migrationLogicalSnapshot(t, db) != before {
					t.Fatal("whole batch did not roll back")
				}
				store, err := migrationOpen(t.Context(), root, path)
				if err != nil {
					t.Fatalf("restart after rollback: %v", err)
				}
				if err := store.Close(); err != nil {
					t.Fatal(err)
				}
				baseline := migrationLogicalSnapshot(t, db)
				registry[2] = migrationTestStep(3, "CREATE TABLE later_probe(value INTEGER); INSERT INTO later_probe VALUES(23)")
				if err := migrationRun(t, db, t.Context(), registry, 44); err != nil {
					t.Fatal(err)
				}
				var count, version, earlier, later int
				var v1Time int64
				if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil {
					t.Fatal(err)
				}
				if err := db.QueryRowContext(t.Context(), "SELECT schema_version FROM instance_state").Scan(&version); err != nil {
					t.Fatal(err)
				}
				if err := db.QueryRowContext(t.Context(), "SELECT value FROM earlier_probe").Scan(&earlier); err != nil {
					t.Fatal(err)
				}
				if err := db.QueryRowContext(t.Context(), "SELECT value FROM later_probe").Scan(&later); err != nil {
					t.Fatal(err)
				}
				if count != 3 || version != 3 || earlier != 17 || later != 23 {
					t.Fatalf("incomplete ordered batch: %d %d %d %d", count, version, earlier, later)
				}
				if err := db.QueryRowContext(t.Context(), "SELECT applied_at_ns FROM schema_migrations WHERE version=1").Scan(&v1Time); err != nil {
					t.Fatal(err)
				}
				if existing && v1Time != 42 {
					t.Fatal("V1 timestamp changed")
				}
				after := migrationLogicalSnapshot(t, db)
				if after == baseline {
					t.Fatal("positive synthetic upgrade made no change")
				}
				if err := migrationRun(t, db, t.Context(), registry, 99); err != nil {
					t.Fatal(err)
				}
				if migrationLogicalSnapshot(t, db) != after {
					t.Fatal("synthetic restart mutated history")
				}
				store, err = migrationOpen(t.Context(), root, path)
				if store != nil {
					if err := store.Close(); err != nil {
						t.Fatal(err)
					}
				}
				if err == nil {
					t.Fatal("production V1 accepted synthetic future schema")
				}
				if migrationLogicalSnapshot(t, db) != after {
					t.Fatal("production rejection mutated future database")
				}
			})
		}
	}
}

func TestMigrationRunner_ConcurrentStartup(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("existing=%t", existing), func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "state.db")
			if existing {
				store, err := migrationOpen(t.Context(), root, path)
				if err != nil {
					t.Fatal(err)
				}
				if err := store.Close(); err != nil {
					t.Fatal(err)
				}
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
				if _, busy := errors.AsType[BusyError](err); !busy {
					t.Fatalf("unexpected startup rejection: %v", err)
				}
			}
			if successes == 0 {
				t.Fatal("no startup succeeded")
			}
			db := migrationTestDB(t, path)
			var count, version int
			if err := db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(t.Context(), "SELECT schema_version FROM instance_state WHERE id=1").Scan(&version); err != nil {
				t.Fatal(err)
			}
			if count != 1 || version != 1 {
				t.Fatalf("startup did not converge: %d %d", count, version)
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

var migrationCancelFunctionSequence atomic.Uint64

func TestMigrationRunner_CancellationReleasesWriter(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("existing=%t", existing), func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			name := fmt.Sprintf("migration_test_cancel_%d", migrationCancelFunctionSequence.Add(1))
			var called atomic.Bool
			// Test-only SQLite callback deterministically cancels after real DDL.
			// Registration precedes connection creation and never changes production SQL.
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
			}
			before := migrationLogicalSnapshot(t, db)
			registry := append(migrationTestRegistry(), migrationTestStep(2, "CREATE TABLE cancellation_probe(value INTEGER); INSERT INTO cancellation_probe VALUES(1); SELECT "+name+"(); INSERT INTO cancellation_probe VALUES(2)"))
			err := migrationRun(t, db, ctx, registry, 43)
			if !called.Load() || !errors.Is(err, context.Canceled) {
				t.Fatalf("DDL cancellation not observed: called=%t err=%v", called.Load(), err)
			}
			if migrationLogicalSnapshot(t, db) != before {
				t.Fatal("canceled batch did not roll back")
			}
			// This is a separate Store/connection, not merely the canceled handle.
			store, err := migrationOpen(t.Context(), root, path)
			if err != nil {
				t.Fatalf("writer lock leaked: %v", err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func migrationOpen(ctx context.Context, root, path string) (*Store, error) {
	return OpenAtRootWithClock(ctx, root, path, func() time.Time { return fixedClockTime })
}
