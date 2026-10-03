package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

var ctx = context.Background()

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "events.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, path
}
func parsed(t *testing.T, id, at string, extra map[string]any) *event.Event {
	t.Helper()
	fields := map[string]any{"specversion": "1.0", "source": "urn:test", "id": id, "type": "test.event", "time": at}
	for k, v := range extra {
		fields[k] = v
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	e, err := event.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return e
}
func put(t *testing.T, s *Store, e *event.Event) int64 {
	t.Helper()
	r, err := s.Ingest(ctx, e, time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	return r.Seq
}
func ids(t *testing.T, page Page) []string {
	t.Helper()
	out := []string{}
	for _, item := range page.Items {
		var e map[string]any
		if err := json.Unmarshal(item.Event, &e); err != nil {
			t.Fatal(err)
		}
		out = append(out, e["id"].(string))
	}
	return out
}
func checkIDs(t *testing.T, s *Store, q Query, want string) Page {
	t.Helper()
	p, err := s.List(ctx, q)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(ids(t, p), ","); got != want {
		t.Fatalf("query %+v got %q want %q", q, got, want)
	}
	return p
}

func TestIngestDurableDuplicateConflictAndRaw(t *testing.T) {
	s, path := newStore(t)
	raw := []byte(`{ "specversion":"1.0", "source":"urn:test", "id":"one", "type":"test.event", "time":"2026-10-03T12:05:01Z", "summary":null }`)
	e, err := event.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	seq := put(t, s, e)
	same := parsed(t, "one", "2026-10-03T12:05:01Z", nil)
	r, err := s.Ingest(ctx, same, time.Now())
	if err != nil || !r.Duplicate || r.Seq != seq {
		t.Fatalf("duplicate %+v %v", r, err)
	}
	changed := parsed(t, "one", "2026-10-03T12:05:01Z", map[string]any{"summary": "changed"})
	if _, err := s.Ingest(ctx, changed, time.Now()); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflict: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	d, err := reopened.Detail(ctx, seq)
	if err != nil {
		t.Fatal(err)
	}
	if string(d.Item.Event) != string(raw) || !d.Item.ClockSkew {
		t.Fatalf("original changed: %+v", d.Item)
	}
	var count int
	if err := reopened.db.QueryRow("SELECT COUNT(*) FROM ingest_conflicts").Scan(&count); err != nil || count != 1 {
		t.Fatalf("durable conflicts=%d %v", count, err)
	}
	r, err = reopened.Ingest(ctx, same, time.Now())
	if err != nil || r.Seq != seq || !r.Duplicate {
		t.Fatalf("restart duplicate %+v %v", r, err)
	}
	rawPage, err := json.Marshal(checkIDs(t, reopened, Query{}, "one"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rawPage), `"next_cursor":null`) {
		t.Fatalf("missing required terminal cursor: %s", rawPage)
	}
}

func TestConcurrentDuplicate(t *testing.T) {
	s, _ := newStore(t)
	e := parsed(t, "same", "2026-10-03T12:00:00Z", nil)
	const n = 24
	var wg sync.WaitGroup
	results := make(chan Result, n)
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); r, err := s.Ingest(ctx, e, time.Now()); results <- r; errs <- err }()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	newCount := 0
	var seq int64
	for r := range results {
		if seq == 0 {
			seq = r.Seq
		}
		if seq != r.Seq {
			t.Fatalf("multiple identities %d %d", seq, r.Seq)
		}
		if !r.Duplicate {
			newCount++
		}
	}
	if newCount != 1 {
		t.Fatalf("new events=%d", newCount)
	}
	checkIDs(t, s, Query{}, "same")
}

func TestFiltersOrderingLiteralSearchAndCivilTimes(t *testing.T) {
	s, _ := newStore(t)
	fixtures := []struct {
		id, at string
		extra  map[string]any
	}{
		{"old", "0001-01-01T00:00:00Z", nil},
		{"a", "2026-10-03T10:00:00Z", map[string]any{"type": "release.deploy.ok", "subject": "svc/猫", "summary": "100%_done", "correlationid": "chain", "severity": "warning"}},
		{"b", "2026-10-03T12:00:00+02:00", map[string]any{"type": "release.deploy.failed", "subject": "svc/猫/child", "severity": "error", "correlationid": "chain"}},
		{"c", "2026-10-03T10:00:00.000000001Z", map[string]any{"source": "urn:other", "type": "release.check", "severity": "debug", "data": map[string]any{"secret": "needle"}}},
		{"future", "9999-12-31T23:59:59Z", nil},
	}
	for _, f := range fixtures {
		put(t, s, parsed(t, f.id, f.at, f.extra))
	}
	checkIDs(t, s, Query{}, "future,c,b,a,old")
	checkIDs(t, s, Query{Source: "urn:test", Type: "release.deploy.*", SubjectPrefix: "svc/猫", CorrelationID: "chain", SeverityMin: "warning"}, "b,a")
	checkIDs(t, s, Query{Type: "release*"}, "c,b,a")
	checkIDs(t, s, Query{Type: "release.deploy.ok"}, "a")
	checkIDs(t, s, Query{SeverityMin: "info"}, "future,b,a,old")
	checkIDs(t, s, Query{Q: "%_"}, "a")
	checkIDs(t, s, Query{Q: "needle"}, "")
	checkIDs(t, s, Query{From: "2026-10-03T12:00:00+02:00", To: "2026-10-03T10:00:00.000000001Z"}, "b,a")
	checkIDs(t, s, Query{From: "0001-01-01T00:00:00Z", To: "0001-01-01T00:00:01Z"}, "old")
}

func TestCursorSnapshotAndValidation(t *testing.T) {
	s, _ := newStore(t)
	for i := 0; i < 5; i++ {
		put(t, s, parsed(t, fmt.Sprint(i), fmt.Sprintf("2026-10-03T10:00:0%dZ", i), nil))
	}
	page := checkIDs(t, s, Query{Limit: 2}, "4,3")
	if page.NextCursor == nil {
		t.Fatal("missing next cursor")
	}
	// Both newer arrivals and backdated arrivals stay outside the first page's snapshot.
	put(t, s, parsed(t, "new", "2026-10-03T11:00:00Z", nil))
	put(t, s, parsed(t, "late", "2026-10-03T10:00:01Z", nil))
	next := checkIDs(t, s, Query{Limit: 2, Cursor: *page.NextCursor}, "2,1")
	if next.NextCursor == nil {
		t.Fatal("missing next page")
	}
	last := checkIDs(t, s, Query{Limit: 1, Cursor: *next.NextCursor}, "0")
	if last.NextCursor != nil {
		t.Fatal("extra page")
	}
	for _, q := range []Query{{Cursor: *page.NextCursor, Source: "urn:other"}, {Cursor: "bad"}, {Cursor: strings.Repeat("a", 4097)}, {Type: "release.*.invalid"}, {Limit: -1}, {Limit: 201}, {SeverityMin: "fatal"}, {From: "no"}, {From: "2026-10-04T00:00:00Z", To: "2026-10-03T00:00:00Z"}} {
		if _, err := s.List(ctx, q); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("query %+v: %v", q, err)
		}
	}
	for _, raw := range []string{`{"v":1,"f":"bad","s":5,"t":"2026-10-03T10:00:01.000000000Z","n":1}`, `{"v":1,"f":"bad","s":5,"t":"2026-10-03T10:00:01.000000000Z","n":1,"extra":true}`, `{} {}`} {
		if _, err := s.List(ctx, Query{Cursor: base64.RawURLEncoding.EncodeToString([]byte(raw))}); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("cursor %s: %v", raw, err)
		}
	}
}

func TestDetailCorrelationAndSingleDecodeCausation(t *testing.T) {
	s, _ := newStore(t)
	cause := put(t, s, parsed(t, "id%23#", "2026-10-03T09:00:00Z", map[string]any{"source": "urn:test%23"}))
	peer := put(t, s, parsed(t, "peer", "2026-10-03T11:00:00Z", map[string]any{"correlationid": "chain"}))
	item := put(t, s, parsed(t, "item", "2026-10-03T10:00:00Z", map[string]any{"correlationid": "chain", "causationid": "urn:test%2523#id%2523%23"}))
	// A twice-decoded lookalike is not a causation target.
	put(t, s, parsed(t, "id##", "2026-10-03T08:00:00Z", map[string]any{"source": "urn:test#"}))
	d, err := s.Detail(ctx, item)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Related) != 2 || d.Related[0].Seq != cause || d.Related[1].Seq != peer {
		t.Fatalf("related=%+v", d.Related)
	}
	if _, err := s.Detail(ctx, 9999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("not found: %v", err)
	}
	if _, err := s.Detail(ctx, 0); !errors.Is(err, ErrInvalidQuery) {
		t.Fatalf("invalid seq: %v", err)
	}
	// The same event satisfying both relationships appears once, and self never appears.
	e := parsed(t, "both", "2026-10-03T12:00:00Z", map[string]any{"correlationid": "chain", "causationid": "urn:test#peer"})
	seq := put(t, s, e)
	d, err = s.Detail(ctx, seq)
	if err != nil || len(d.Related) != 2 {
		t.Fatalf("dedup related=%+v %v", d.Related, err)
	}
}

func TestBusyFailureRollsBackAndPragmas(t *testing.T) {
	s, path := newStore(t)
	var mode string
	var syncLevel, busy int
	if err := s.db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow("PRAGMA synchronous").Scan(&syncLevel); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow("PRAGMA busy_timeout").Scan(&busy); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" || syncLevel != 2 || busy != 1000 {
		t.Fatalf("pragmas %s %d %d", mode, syncLevel, busy)
	}
	other, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	other.SetMaxOpenConns(1)
	if _, err := other.Exec("BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	_, err = s.Ingest(ctx, parsed(t, "busy", "2026-10-03T12:00:00Z", nil), time.Now())
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("busy error=%v", err)
	}
	if time.Since(started) > 3*time.Second {
		t.Fatal("busy wait exceeded bound")
	}
	if _, err := other.Exec("ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	checkIDs(t, s, Query{}, "")
	put(t, s, parsed(t, "busy", "2026-10-03T12:00:00Z", nil))
	checkIDs(t, s, Query{}, "busy")
	if err := s.Ready(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestMigrationFailuresAreAtomicAndUnknownVersionRejected(t *testing.T) {
	for _, kind := range []string{"unknown", "collision"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "migration.db")
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "unknown" {
				_, err = db.Exec("PRAGMA user_version = 99")
			} else {
				_, err = db.Exec("CREATE TABLE ingest_conflicts(existing INTEGER)")
			}
			if err != nil {
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
			var version, count int
			if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
				t.Fatal(err)
			}
			if kind == "unknown" && version != 99 || kind == "collision" && version != 0 {
				t.Fatalf("version changed=%d", version)
			}
			if err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE name='events'").Scan(&count); err != nil || count != 0 {
				t.Fatalf("partial migration events=%d %v", count, err)
			}
		})
	}
}

func TestPathsPermissionsAndClosedUnavailable(t *testing.T) {
	for _, path := range []string{"", ":memory:", "file:/tmp/not-a-db", filepath.Join(t.TempDir(), "bad?mode=memory")} {
		if s, err := Open(path); err == nil {
			s.Close()
			t.Fatalf("accepted path %q", path)
		}
	}
	path := filepath.Join(t.TempDir(), "private", "events#special.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for p, want := range map[string]os.FileMode{path: 0600, filepath.Dir(path): 0700} {
		info, err := os.Stat(p)
		if err != nil || info.Mode().Perm() != want {
			t.Fatalf("permission %s %v %v", p, info, err)
		}
	}
	s.Close()
	if err := s.Ready(ctx); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("closed ready=%v", err)
	}
	if _, err := s.List(ctx, Query{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("closed list=%v", err)
	}
}

func TestUTCYearBoundaryKeysAndCursor(t *testing.T) {
	s, _ := newStore(t)
	for _, f := range []struct{ id, at string }{
		{"low", "0001-01-01T00:00:00+23:00"},
		{"normal", "2026-10-03T10:00:00Z"},
		{"high", "9999-12-31T23:59:59-23:00"},
	} {
		e := parsed(t, f.id, f.at, nil)
		key := timeKey(e.Time)
		if !validTimeKey(key) {
			t.Fatalf("invalid boundary key %q", key)
		}
		put(t, s, e)
	}
	page := checkIDs(t, s, Query{Limit: 1}, "high")
	if page.NextCursor == nil {
		t.Fatal("missing boundary cursor")
	}
	checkIDs(t, s, Query{Cursor: *page.NextCursor}, "normal,low")
	checkIDs(t, s, Query{From: "9999-12-31T23:59:59-23:00"}, "high")
	checkIDs(t, s, Query{From: "2026-10-03t10:00:00z", To: "2026-10-03T10:00:01Z"}, "normal")
}

func TestFailedConflictJournalDoesNotChangeOriginal(t *testing.T) {
	s, _ := newStore(t)
	original := parsed(t, "original", "2026-10-03T12:00:00Z", nil)
	seq := put(t, s, original)
	if _, err := s.db.Exec(`CREATE TRIGGER reject_conflicts BEFORE INSERT ON ingest_conflicts BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END`); err != nil {
		t.Fatal(err)
	}
	changed := parsed(t, "original", "2026-10-03T12:00:00Z", map[string]any{"summary": "changed"})
	if _, err := s.Ingest(ctx, changed, time.Now()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("failed journal must return unavailable: %v", err)
	}
	d, err := s.Detail(ctx, seq)
	if err != nil || string(d.Item.Event) != string(original.Raw) {
		t.Fatalf("original changed: %+v %v", d, err)
	}
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM ingest_conflicts").Scan(&count); err != nil || count != 0 {
		t.Fatalf("partial journal: %d %v", count, err)
	}
	if _, err := s.db.Exec("DROP TRIGGER reject_conflicts"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Ingest(ctx, changed, time.Now()); !errors.Is(err, ErrConflict) {
		t.Fatalf("retry journal: %v", err)
	}
}

func TestArbitraryFractionPrecisionAndClockSkew(t *testing.T) {
	s, _ := newStore(t)
	put(t, s, parsed(t, "later", "2026-10-03T12:00:00.0000000002Z", nil))
	put(t, s, parsed(t, "earlier", "2026-10-03T12:00:00.0000000001Z", nil))
	checkIDs(t, s, Query{}, "later,earlier")
	checkIDs(t, s, Query{From: "2026-10-03T12:00:00.0000000001Z", To: "2026-10-03T12:00:00.0000000002Z"}, "earlier")
	page := checkIDs(t, s, Query{Limit: 1}, "later")
	if page.NextCursor == nil {
		t.Fatal("missing exact fraction cursor")
	}
	checkIDs(t, s, Query{Cursor: *page.NextCursor}, "earlier")
	// Equivalent decimal fractions compare equal, with seq as the tie breaker.
	put(t, s, parsed(t, "same", "2026-10-03T12:00:00.000000000100Z", nil))
	checkIDs(t, s, Query{}, "later,same,earlier")
	// Precision is not bounded by Go's nine-digit nanosecond representation,
	// or by the cursor size: cursor positions retrieve the immutable row by seq.
	longTime := "2026-10-03T13:00:00." + strings.Repeat("0", 17000) + "1Z"
	put(t, s, parsed(t, "long", longTime, nil))
	page = checkIDs(t, s, Query{Limit: 1}, "long")
	if page.NextCursor == nil || len(*page.NextCursor) > 4096 {
		t.Fatal("timestamp inflated cursor")
	}
	checkIDs(t, s, Query{Cursor: *page.NextCursor}, "later,same,earlier")
	checkIDs(t, s, Query{From: longTime}, "long")
	for _, f := range []struct {
		id, at string
		skew   bool
	}{
		{"exact", "2026-10-03T12:05:00Z", false},
		{"fraction", "2026-10-03T12:05:00.0000000001Z", true},
	} {
		seq := put(t, s, parsed(t, f.id, f.at, nil))
		d, err := s.Detail(ctx, seq)
		if err != nil || d.Item.ClockSkew != f.skew {
			t.Fatalf("clock skew %s: %+v %v", f.id, d, err)
		}
	}
}

func TestSubjectPrefixEmbeddedNULAndUnicode(t *testing.T) {
	s, _ := newStore(t)
	put(t, s, parsed(t, "nul", "2026-10-03T12:00:00Z", map[string]any{"subject": "猫a\x00b%_"}))
	put(t, s, parsed(t, "plain", "2026-10-03T12:00:00Z", map[string]any{"subject": "猫a"}))
	checkIDs(t, s, Query{SubjectPrefix: "猫a\x00"}, "nul")
	checkIDs(t, s, Query{SubjectPrefix: "猫a\x00b%_"}, "nul")
	checkIDs(t, s, Query{SubjectPrefix: "猫a"}, "plain,nul")
	checkIDs(t, s, Query{Q: "\x00b"}, "nul")
}
