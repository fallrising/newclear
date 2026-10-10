package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
)

var sourceNow = time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)

func sourceConfig(name, interval string) config.Source {
	return config.Source{Name: name, SourcePrefix: "urn:test", AllowedTypes: []string{"test.*"}, TokenRef: "file:/synthetic/" + name, ExpectedInterval: interval}
}
func sourcePage(t *testing.T, s *Store, now time.Time) SourcePage {
	t.Helper()
	p, e := s.ListSources(ctx, SourceQuery{}, now)
	if e != nil {
		t.Fatal(e)
	}
	return p
}
func assertSource(t *testing.T, s *Store, name, status string, now time.Time) SourceFreshness {
	t.Helper()
	for _, row := range sourcePage(t, s, now).Items {
		if row.Name == name {
			if row.Status != status {
				t.Fatalf("%s status=%s want %s", name, row.Status, status)
			}
			return row
		}
	}
	t.Fatalf("source %s missing", name)
	return SourceFreshness{}
}
func transitions(t *testing.T, s *Store, n int) {
	t.Helper()
	page, e := s.List(ctx, Query{Type: "signalhub.source.*"})
	if e != nil || len(page.Items) != n {
		t.Fatalf("transitions=%d want=%d err=%v", len(page.Items), n, e)
	}
}
func TestSourceBoundariesDuplicateAndRestart(t *testing.T) {
	s, path := newStore(t)
	sources := []config.Source{sourceConfig("test", "1m"), sourceConfig("never", "1s"), sourceConfig("disabled", "")}
	if e := s.ConfigureSources(ctx, sources, sourceNow); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"test", "never", "disabled"} {
		row := assertSource(t, s, name, "never", sourceNow.Add(24*time.Hour))
		if row.LastReceivedAt != nil || row.LastEventTime != nil {
			t.Fatal("never has timestamps")
		}
	}
	e := parsed(t, "first", "1999-01-01T00:00:00Z", nil)
	r, err := s.IngestSource(ctx, e, sourceNow, "test")
	if err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "test", "fresh", sourceNow.Add(time.Minute))
	assertSource(t, s, "test", "late", sourceNow.Add(time.Minute+time.Nanosecond))
	assertSource(t, s, "test", "late", sourceNow.Add(2*time.Minute))
	silentAt := sourceNow.Add(2*time.Minute + time.Nanosecond)
	assertSource(t, s, "test", "silent", silentAt)
	transitions(t, s, 1)
	if err = s.EvaluateSources(ctx, silentAt.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	transitions(t, s, 1)
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.ConfigureSources(ctx, sources, silentAt); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "test", "silent", silentAt)
	transitions(t, s, 1)
	// Time reversal alone never manufactures recovery.
	assertSource(t, s, "test", "silent", sourceNow)
	received := silentAt.Add(time.Second)
	dup, err := s.IngestSource(ctx, e, received, "test")
	if err != nil || !dup.Duplicate || dup.Seq != r.Seq {
		t.Fatalf("duplicate=%+v %v", dup, err)
	}
	row := assertSource(t, s, "test", "fresh", received)
	if *row.LastReceivedAt != received.Format(time.RFC3339Nano) || *row.LastEventTime != "1999-01-01T00:00:00Z" {
		t.Fatalf("wrong last times %+v", row)
	}
	transitions(t, s, 2)
	d, err := s.Detail(ctx, r.Seq)
	if err != nil || d.Item.ReceivedAt != sourceNow.Format(time.RFC3339Nano) {
		t.Fatalf("original receipt changed %+v %v", d, err)
	}
	if _, err = s.IngestSource(ctx, e, sourceNow, "disabled"); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "disabled", "fresh", sourceNow.AddDate(100, 0, 0))
	assertSource(t, s, "never", "never", sourceNow.AddDate(100, 0, 0))
}
func TestSourceLateIngestAndConflict(t *testing.T) {
	s, _ := newStore(t)
	if e := s.ConfigureSources(ctx, []config.Source{sourceConfig("test", "1s")}, sourceNow); e != nil {
		t.Fatal(e)
	}
	e := parsed(t, "one", sourceNow.Format(time.RFC3339Nano), nil)
	if _, err := s.IngestSource(ctx, e, sourceNow, "test"); err != nil {
		t.Fatal(err)
	}
	// No evaluator observed the intervening outage, so no phantom transitions.
	now := sourceNow.Add(time.Hour)
	if _, err := s.IngestSource(ctx, e, now, "test"); err != nil {
		t.Fatal(err)
	}
	transitions(t, s, 0)
	changed := parsed(t, "one", sourceNow.Format(time.RFC3339Nano), map[string]any{"summary": "conflict"})
	if _, err := s.IngestSource(ctx, changed, now.Add(time.Second), "test"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	row := assertSource(t, s, "test", "fresh", now)
	if *row.LastReceivedAt != now.Format(time.RFC3339Nano) {
		t.Fatal("conflict refreshed source")
	}
	if _, err := s.IngestSource(ctx, e, sourceNow, "test"); err != nil {
		t.Fatal(err)
	}
	row = assertSource(t, s, "test", "fresh", now)
	if *row.LastReceivedAt != now.Format(time.RFC3339Nano) {
		t.Fatal("clock reversal regressed receipt")
	}
}
func TestSourceConfigurationAndCursor(t *testing.T) {
	s, _ := newStore(t)
	sources := []config.Source{sourceConfig("zebra", "1s"), sourceConfig("alpha", "1d"), sourceConfig("middle", strings.Repeat("9", 100)+"h")}
	if err := s.ConfigureSources(ctx, sources, sourceNow); err != nil {
		t.Fatal(err)
	}
	p, err := s.ListSources(ctx, SourceQuery{Limit: 1}, sourceNow)
	if err != nil || len(p.Items) != 1 || p.Items[0].Name != "alpha" || p.NextCursor == nil {
		t.Fatalf("page %+v %v", p, err)
	}
	next, err := s.ListSources(ctx, SourceQuery{Cursor: *p.NextCursor, Limit: 2}, sourceNow)
	if err != nil || len(next.Items) != 2 || next.Items[0].Name != "middle" || next.Items[1].Name != "zebra" || next.NextCursor != nil {
		t.Fatalf("next %+v %v", next, err)
	}
	for _, q := range []SourceQuery{{Limit: 201}, {Limit: -1}, {Cursor: "bad"}, {Cursor: strings.Repeat("x", 4097)}} {
		if _, err = s.ListSources(ctx, q, sourceNow); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("query %+v: %v", q, err)
		}
	}
	e := parsed(t, "one", sourceNow.Format(time.RFC3339Nano), nil)
	for _, name := range []string{"zebra", "middle"} {
		if _, err = s.IngestSource(ctx, e, sourceNow, name); err != nil {
			t.Fatal(err)
		}
	}
	assertSource(t, s, "middle", "fresh", sourceNow.AddDate(1000, 0, 0))
	assertSource(t, s, "zebra", "silent", sourceNow.Add(3*time.Second))
	transitions(t, s, 1)
	sources[0].ExpectedInterval = ""
	if err = s.ConfigureSources(ctx, sources, sourceNow.Add(4*time.Second)); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "zebra", "fresh", sourceNow.Add(4*time.Second))
	transitions(t, s, 2)
	if _, err = s.ListSources(ctx, SourceQuery{Cursor: *p.NextCursor}, sourceNow); !errors.Is(err, ErrInvalidQuery) {
		t.Fatal("stale cursor accepted")
	}
	sources[0].TokenRef = "file:/synthetic/rotated"
	if err = s.ConfigureSources(ctx, sources, sourceNow); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "zebra", "never", sourceNow)
	sources[0].ExpectedInterval = "1s"
	if err = s.ConfigureSources(ctx, sources, sourceNow); err != nil {
		t.Fatal(err)
	}
	if _, err = s.IngestSource(ctx, e, sourceNow, "zebra"); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "zebra", "silent", sourceNow.Add(3*time.Second))
	transitions(t, s, 3)
	if err = s.ConfigureSources(ctx, sources[1:], sourceNow); err != nil {
		t.Fatal(err)
	}
	if len(sourcePage(t, s, sourceNow).Items) != 2 {
		t.Fatal("removed visible")
	}
	if err = s.ConfigureSources(ctx, sources, sourceNow); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "zebra", "never", sourceNow)
	if _, err = s.IngestSource(ctx, e, sourceNow, "zebra"); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "zebra", "silent", sourceNow.Add(3*time.Second))
	transitions(t, s, 4)
	raw, _ := json.Marshal(sourcePage(t, s, sourceNow))
	for _, forbidden := range []string{"token_ref", "synthetic", "hash", "generation", "transition"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("private metadata exposed: %s", raw)
		}
	}
}
func TestSourceTransitionRollbackAndBusy(t *testing.T) {
	s, path := newStore(t)
	if err := s.ConfigureSources(ctx, []config.Source{sourceConfig("test", "1s")}, sourceNow); err != nil {
		t.Fatal(err)
	}
	e := parsed(t, "one", sourceNow.Format(time.RFC3339Nano), nil)
	if _, err := s.IngestSource(ctx, e, sourceNow, "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_transitions BEFORE INSERT ON events WHEN NEW.type LIKE 'signalhub.source.%' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.EvaluateSources(ctx, sourceNow.Add(3*time.Second)); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("failed evaluator %v", err)
	}
	var status string
	if err := s.db.QueryRow("SELECT status FROM sources_state WHERE name='test'").Scan(&status); err != nil || status != "fresh" {
		t.Fatalf("partial state %s %v", status, err)
	}
	transitions(t, s, 0)
	if _, err := s.db.Exec("DROP TRIGGER reject_transitions"); err != nil {
		t.Fatal(err)
	}
	if err := s.EvaluateSources(ctx, sourceNow.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	}
	transitions(t, s, 1)
	if _, err := s.db.Exec(`CREATE TRIGGER reject_transitions BEFORE INSERT ON events WHEN NEW.type LIKE 'signalhub.source.%' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`); err != nil {
		t.Fatal(err)
	}
	newEvent := parsed(t, "two", sourceNow.Format(time.RFC3339Nano), nil)
	if _, err := s.IngestSource(ctx, newEvent, sourceNow.Add(4*time.Second), "test"); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	var count int
	s.db.QueryRow("SELECT COUNT(*) FROM events WHERE id='two'").Scan(&count)
	if count != 0 {
		t.Fatal("partial ingest committed")
	}
	assertSource(t, s, "test", "silent", sourceNow.Add(4*time.Second))
	transitions(t, s, 1)
	s.db.Exec("DROP TRIGGER reject_transitions")
	other, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	other.SetMaxOpenConns(1)
	if _, err = other.Exec("BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
	_, err = s.IngestSource(ctx, newEvent, sourceNow.Add(4*time.Second), "test")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("busy=%v", err)
	}
	if _, err = other.Exec("ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "test", "silent", sourceNow.Add(4*time.Second))
	transitions(t, s, 1)
	if _, err = s.IngestSource(ctx, newEvent, sourceNow.Add(4*time.Second), "test"); err != nil {
		t.Fatal(err)
	}
	transitions(t, s, 2)
}
func TestSourceM1MigrationDoesNotInventAttribution(t *testing.T) {
	path := filepath.Join(t.TempDir(), "m1.db")
	old, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = old.Exec(migration1 + "PRAGMA user_version=1;"); err != nil {
		t.Fatal(err)
	}
	legacy := &Store{db: old}
	e := parsed(t, "legacy", sourceNow.Format(time.RFC3339Nano), nil)
	if _, err = legacy.Ingest(ctx, e, sourceNow); err != nil {
		t.Fatal(err)
	}
	old.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.ConfigureSources(ctx, []config.Source{sourceConfig("first", "1s"), sourceConfig("overlap", "1s")}, sourceNow); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "first", "never", sourceNow)
	assertSource(t, s, "overlap", "never", sourceNow)
	r, err := s.IngestSource(ctx, e, sourceNow, "overlap")
	if err != nil || !r.Duplicate {
		t.Fatalf("legacy duplicate %+v %v", r, err)
	}
	assertSource(t, s, "first", "never", sourceNow)
	assertSource(t, s, "overlap", "fresh", sourceNow)
}
func TestSourceConcurrentTicksAndRecovery(t *testing.T) {
	s, _ := newStore(t)
	if err := s.ConfigureSources(ctx, []config.Source{sourceConfig("test", "1s")}, sourceNow); err != nil {
		t.Fatal(err)
	}
	e := parsed(t, "one", sourceNow.Format(time.RFC3339Nano), nil)
	if _, err := s.IngestSource(ctx, e, sourceNow, "test"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- s.EvaluateSources(context.Background(), sourceNow.Add(3*time.Second)) }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	transitions(t, s, 1)
	errs = make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.IngestSource(ctx, e, sourceNow.Add(4*time.Second), "test")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	transitions(t, s, 2)
}

func TestSourceMigrationFailurePreservesM1(t *testing.T) {
	path := filepath.Join(t.TempDir(), "m1.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(migration1 + "CREATE TABLE sources_state(collision INTEGER); PRAGMA user_version=1;"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if s, err := Open(path); err == nil {
		s.Close()
		t.Fatal("expected migration failure")
	}
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 1 {
		t.Fatalf("migration changed version=%d err=%v", version, err)
	}
	if _, err = db.Exec("SELECT collision FROM sources_state"); err != nil {
		t.Fatal("existing table changed", err)
	}
}

func TestSourceGenerationSkipsHistoricalIdentity(t *testing.T) {
	s, _ := newStore(t)
	occupied := parsed(t, "source:1:1", sourceNow.Format(time.RFC3339Nano), map[string]any{"source": "urn:signalhub:sources:test"})
	if _, err := s.Ingest(ctx, occupied, sourceNow); err != nil {
		t.Fatal(err)
	}
	if err := s.ConfigureSources(ctx, []config.Source{sourceConfig("test", "1s")}, sourceNow); err != nil {
		t.Fatal(err)
	}
	e := parsed(t, "one", sourceNow.Format(time.RFC3339Nano), nil)
	if _, err := s.IngestSource(ctx, e, sourceNow, "test"); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "test", "silent", sourceNow.Add(3*time.Second))
	p, err := s.List(ctx, Query{Type: "signalhub.source.*"})
	if err != nil || len(p.Items) != 1 {
		t.Fatalf("events=%+v %v", p, err)
	}
	var transition map[string]any
	json.Unmarshal(p.Items[0].Event, &transition)
	if transition["id"] != "source:2:1" {
		t.Fatalf("generation not skipped %+v", transition)
	}
}

func TestSourceDeliveryRecoversAfterClockReversal(t *testing.T) {
	s, _ := newStore(t)
	if err := s.ConfigureSources(ctx, []config.Source{sourceConfig("test", "1s")}, sourceNow); err != nil {
		t.Fatal(err)
	}
	e := parsed(t, "one", sourceNow.Format(time.RFC3339Nano), nil)
	if _, err := s.IngestSource(ctx, e, sourceNow, "test"); err != nil {
		t.Fatal(err)
	}
	assertSource(t, s, "test", "silent", sourceNow.Add(3*time.Second))
	replay := parsed(t, "two", "2000-01-01T00:00:00Z", nil)
	if _, err := s.IngestSource(ctx, replay, sourceNow.Add(-time.Hour), "test"); err != nil {
		t.Fatal(err)
	}
	row := assertSource(t, s, "test", "fresh", sourceNow.Add(-time.Hour))
	if *row.LastReceivedAt != sourceNow.Format(time.RFC3339Nano) || *row.LastEventTime != "2000-01-01T00:00:00Z" {
		t.Fatalf("clock reversal state %+v", row)
	}
	transitions(t, s, 2)
}

func TestSourceIntervalUnitsAndEmptyPage(t *testing.T) {
	last := sourceNow.Format(time.RFC3339Nano)
	for _, tc := range []struct {
		interval string
		duration time.Duration
	}{{"1s", time.Second}, {"2m", 2 * time.Minute}, {"3h", 3 * time.Hour}, {"2d", 48 * time.Hour}} {
		row := sourceState{SourceFreshness: SourceFreshness{LastReceivedAt: &last}, interval: tc.interval}
		for _, point := range []struct {
			age   time.Duration
			state string
		}{{tc.duration, "fresh"}, {tc.duration + time.Nanosecond, "late"}, {2 * tc.duration, "late"}, {2*tc.duration + time.Nanosecond, "silent"}} {
			got, err := freshnessAt(row, sourceNow.Add(point.age))
			if err != nil || got != point.state {
				t.Errorf("%s age=%s got %s error %v", tc.interval, point.age, got, err)
			}
		}
	}
	s, _ := newStore(t)
	if err := s.ConfigureSources(ctx, nil, sourceNow); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(sourcePage(t, s, sourceNow))
	if err != nil || string(raw) != `{"items":[],"next_cursor":null}` {
		t.Fatalf("empty page %s %v", raw, err)
	}
	for _, interval := range []string{"0s", "-1s", "1ms", "1s\n"} {
		if err := s.ConfigureSources(ctx, []config.Source{sourceConfig("invalid", interval)}, sourceNow); err == nil {
			t.Fatalf("accepted interval %q", interval)
		}
	}
}
