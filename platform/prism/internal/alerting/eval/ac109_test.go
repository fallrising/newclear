//go:build integration

package eval

import (
	"database/sql"
	"encoding/json/v2"
	"math"
	"os"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/alerting/state"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

// TestAC109Postgres is the AC-109 alert_state check against PostgreSQL.
// It is not part of make lint test. Run:
//
//	PRISM_POSTGRES_DSN='postgres://prism:prism@127.0.0.1:54329/prism?sslmode=disable' \
//	  go test -tags=integration -count=1 -run TestAC109Postgres ./internal/alerting/eval
func TestAC109Postgres(t *testing.T) {
	dsn := os.Getenv("PRISM_POSTGRES_DSN")
	if dsn == "" {
		t.Fatal("set PRISM_POSTGRES_DSN to a PostgreSQL URL; see the comment on TestAC109Postgres")
	}
	db, err := state.Open(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Down(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	sqldb, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqldb.Close() })
	var versions int
	if err := sqldb.QueryRowContext(t.Context(), `SELECT count(*) FROM alerting_schema_migrations WHERE version = 1`).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Fatalf("alerting_schema_migrations versions = %d", versions)
	}
	var schemaMigrations sql.NullString
	if err := sqldb.QueryRowContext(t.Context(), `SELECT to_regclass('public.schema_migrations')`).Scan(&schemaMigrations); err != nil {
		t.Fatal(err)
	}
	if schemaMigrations.Valid {
		t.Fatalf("schema_migrations = %s", schemaMigrations.String)
	}

	runAC109(t, db, restoreHooks{
		afterPending: func(t *testing.T, st state.Store, activeAt time.Time) {
			if err := db.Migrate(t.Context()); err != nil {
				t.Fatal(err)
			}
			assertSQLRow(t, sqldb, "", 1, activeAt, true)
			assertRow(t, st, "", state.Pending, activeAt, false)
		},
		afterFiring: func(t *testing.T, st state.Store, activeAt time.Time) {
			assertSQLRow(t, sqldb, "", 2, activeAt, false)
			assertRow(t, st, "", state.Firing, activeAt, true)
		},
		afterGone: func(t *testing.T, st state.Store) {
			var n int
			if err := sqldb.QueryRowContext(t.Context(), `SELECT count(*) FROM alert_state WHERE tenant_id = ''`).Scan(&n); err != nil {
				t.Fatal(err)
			}
			if n != 0 {
				t.Fatalf("rows left = %d", n)
			}
			if rows := mustLoad(t, st, ""); len(rows) != 0 {
				t.Fatalf("load left %#v", rows)
			}
		},
	})

	high := state.Row{
		Fingerprint: math.MinInt64,
		Labels:      map[string]string{"alertname": "Hi"},
		State:       state.Firing,
		ActiveAt:    origin,
	}
	if err := db.Save(t.Context(), "hi", []state.Row{high}); err != nil {
		t.Fatal(err)
	}
	var fp int64
	var ruleID sql.NullString
	if err := sqldb.QueryRowContext(t.Context(), `SELECT fingerprint, rule_id::text FROM alert_state WHERE tenant_id = 'hi'`).Scan(&fp, &ruleID); err != nil {
		t.Fatal(err)
	}
	if fp != math.MinInt64 || ruleID.Valid {
		t.Fatalf("high bit fingerprint = %d rule_id valid %v", fp, ruleID.Valid)
	}
	loaded, err := db.Load(t.Context(), "hi")
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 || loaded[0].Fingerprint != math.MinInt64 {
		t.Fatalf("loaded high bit = %#v", loaded)
	}

	if err := db.Down(t.Context()); err != nil {
		t.Fatal(err)
	}
	var alertTable, versionTable sql.NullString
	if err := sqldb.QueryRowContext(t.Context(), `SELECT to_regclass('public.alert_state'), to_regclass('public.alerting_schema_migrations')`).Scan(&alertTable, &versionTable); err != nil {
		t.Fatal(err)
	}
	if alertTable.Valid || versionTable.Valid {
		t.Fatalf("tables after down = %v %v", alertTable, versionTable)
	}
}

func assertSQLRow(t *testing.T, db *sql.DB, tenant string, code int, activeAt time.Time, firedNull bool) {
	t.Helper()
	var (
		gotTenant string
		fp        int64
		ruleID    sql.NullString
		raw       []byte
		stateCode int
		gotActive time.Time
		fired     sql.NullTime
	)
	err := db.QueryRowContext(t.Context(), `
SELECT tenant_id, fingerprint, rule_id::text, labels, state, active_at, fired_at
FROM alert_state WHERE tenant_id = $1`, tenant).Scan(&gotTenant, &fp, &ruleID, &raw, &stateCode, &gotActive, &fired)
	if err != nil {
		t.Fatal(err)
	}
	if gotTenant != tenant || ruleID.Valid || stateCode != code || !gotActive.UTC().Equal(activeAt) || fired.Valid == firedNull {
		t.Fatalf("sql row tenant %q state %d active %s fired valid %v rule %v", gotTenant, stateCode, gotActive, fired.Valid, ruleID.Valid)
	}
	var lbl map[string]string
	if err := json.Unmarshal(raw, &lbl); err != nil {
		t.Fatal(err)
	}
	if lbl["alertname"] != "Hold" || fp != int64(utm.Fingerprint(labels.FromMap(lbl))) {
		t.Fatalf("sql labels %#v fingerprint %d", lbl, fp)
	}
}
