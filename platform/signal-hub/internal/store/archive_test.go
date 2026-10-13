package store

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The archive transaction is the sole product path deleting hot events. This
// synthetic deletion isolates the identity regression before archive exists.
func TestDurableIdentitySurvivesHotRemoval(t *testing.T) {
	s, _ := newStore(t)
	e := parsed(t, "archive-identity", "2026-01-01T12:00:00Z", nil)
	seq := put(t, s, e)
	if _, err := s.db.Exec("DELETE FROM events WHERE seq=?", seq); err != nil {
		t.Fatal(err)
	}
	got, err := s.Ingest(t.Context(), e, time.Now())
	if err != nil || !got.Duplicate || got.Seq != seq {
		t.Fatalf("purged duplicate got %+v %v, want original seq %d", got, err, seq)
	}
	changed := parsed(t, "archive-identity", "2026-01-01T12:00:00Z", map[string]any{"summary": "changed"})
	if _, err := s.Ingest(t.Context(), changed, time.Now()); !errors.Is(err, ErrConflict) {
		t.Fatalf("purged conflict: %v", err)
	}
	if _, err := s.Detail(t.Context(), seq); !errors.Is(err, ErrNotFound) {
		t.Fatalf("producer retry restored payload: %v", err)
	}
}

func archiveAt() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC) }
func mustArchive(t *testing.T, s *Store, dir string, now time.Time) ArchiveResult {
	t.Helper()
	result, err := s.Archive(t.Context(), ArchiveOptions{Directory: dir, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func TestArchiveRoundTripIdentityImmutabilityAndRestoreCursor(t *testing.T) {
	s, _ := newStore(t)
	dir := t.TempDir()
	now := archiveAt()
	first := parsed(t, "first", "2026-01-01T12:00:00.0000000001Z", map[string]any{"summary": nil, "correlationid": "chain"})
	seq := put(t, s, first)
	peer := put(t, s, parsed(t, "peer", "2026-01-01T13:00:00Z", map[string]any{"correlationid": "chain"}))
	result := mustArchive(t, s, dir, now)
	if result.Events != 2 || len(result.Parts) != 1 {
		t.Fatalf("result %+v", result)
	}
	m := result.Parts[0]
	file := filepath.Join(dir, m.Path)
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(original)
	if hex.EncodeToString(digest[:]) != m.SHA256 {
		t.Fatal("independent file hash differs")
	}
	gz, err := gzip.NewReader(bytes.NewReader(original))
	if err != nil {
		t.Fatal(err)
	}
	payload, err := io.ReadAll(gz)
	if err != nil {
		t.Fatal(err)
	}
	gz.Close()
	lines := bytes.Split(bytes.TrimSuffix(payload, []byte{'\n'}), []byte{'\n'})
	if len(lines) != 2 {
		t.Fatalf("independent line count %d", len(lines))
	}
	for _, line := range lines {
		e, err := event.Parse(line)
		if err != nil {
			t.Fatal(err)
		}
		if attr(e, "id") == "first" && e.ContentHash != first.ContentHash {
			t.Fatal("canonical content changed")
		}
		if _, ok := e.Fields["restored"]; ok {
			t.Fatal("hub metadata in archive")
		}
	}
	if _, err := s.Detail(t.Context(), seq); !errors.Is(err, ErrNotFound) {
		t.Fatalf("hot still present: %v", err)
	}
	got, err := s.Ingest(t.Context(), first, now)
	if err != nil || !got.Duplicate || got.Seq != seq {
		t.Fatalf("purged retry %+v %v", got, err)
	}
	changed := parsed(t, "first", "2026-01-01T12:00:00.0000000001Z", map[string]any{"summary": "changed"})
	if _, err := s.Ingest(t.Context(), changed, now); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	late := put(t, s, parsed(t, "late", "2026-01-01T14:00:00Z", nil))
	second := mustArchive(t, s, dir, now)
	if second.Events != 1 || second.Parts[0].Part != 2 || second.Parts[0].FirstSeq != late {
		t.Fatalf("late %+v", second)
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(original, after) {
		t.Fatal("old part rewritten")
	}
	for i := range 3 {
		put(t, s, parsed(t, fmt.Sprintf("recent%d", i), fmt.Sprintf("2026-10-13T10:00:0%dZ", i), nil))
	}
	page, err := s.List(t.Context(), Query{Limit: 1})
	if err != nil || page.NextCursor == nil {
		t.Fatalf("page %+v %v", page, err)
	}
	imported, err := s.ImportArchives(t.Context(), dir, "2026-01-01", "synthetic drill", now, 7)
	if err != nil || imported.Imported != 3 || imported.Duplicates != 0 {
		t.Fatalf("import %+v %v", imported, err)
	}
	detail, err := s.Detail(t.Context(), seq)
	if err != nil || !detail.Item.Restored || detail.Item.Seq != seq || len(detail.Related) != 1 || detail.Related[0].Seq != peer || !detail.Related[0].Restored {
		t.Fatalf("detail %+v %v", detail, err)
	}
	if _, err := s.List(t.Context(), Query{Limit: 1, Cursor: *page.NextCursor}); !errors.Is(err, ErrInvalidQuery) {
		t.Fatalf("restored rows leaked into old cursor: %v", err)
	}
	var deadline string
	if err := s.db.QueryRow("SELECT restore_until FROM events WHERE seq=?", seq).Scan(&deadline); err != nil {
		t.Fatal(err)
	}
	repeated, err := s.ImportArchives(t.Context(), dir, "2026-01-01", "repeat drill", now.Add(time.Hour), 30)
	if err != nil || repeated.Imported != 0 || repeated.Duplicates != 3 {
		t.Fatalf("repeat %+v %v", repeated, err)
	}
	var repeatedDeadline string
	s.db.QueryRow("SELECT restore_until FROM events WHERE seq=?", seq).Scan(&repeatedDeadline)
	if repeatedDeadline != deadline {
		t.Fatal("repeat extended retention")
	}
	var audits int
	if err := s.db.QueryRow("SELECT count(*) FROM audit_log WHERE action='archive.import' AND actor='owner'").Scan(&audits); err != nil || audits != 2 {
		t.Fatalf("audit %d %v", audits, err)
	}
	if result := mustArchive(t, s, dir, now.Add(6*24*time.Hour)); result.Events != 0 {
		t.Fatalf("restored expired early %+v", result)
	}
	expired := mustArchive(t, s, dir, now.Add(7*24*time.Hour))
	if expired.Events != 3 || expired.Parts[0].Part != 3 {
		t.Fatalf("expiry %+v", expired)
	}
	if _, err := s.VerifyArchives(t.Context(), dir, "2026-01-01"); err != nil {
		t.Fatal(err)
	}
	again, err := s.ImportArchives(t.Context(), dir, "2026-01-01", "second cycle", now.Add(8*24*time.Hour), 7)
	if err != nil || again.Imported != 3 || again.Duplicates != 0 {
		t.Fatalf("multi-part same identity %+v %v", again, err)
	}
}

func TestArchiveFailuresKeepEveryHotRowAndOrphansImmutable(t *testing.T) {
	for _, kind := range []string{"write", "hash", "membership", "purge", "commit", "success-notice"} {
		t.Run(kind, func(t *testing.T) {
			s, _ := newStore(t)
			dir := t.TempDir()
			now := archiveAt()
			seq := put(t, s, parsed(t, "one", "2026-01-01T12:00:00Z", nil))
			var original []byte
			switch kind {
			case "write":
				if err := os.WriteFile(filepath.Join(dir, "events"), []byte("synthetic obstruction"), 0600); err != nil {
					t.Fatal(err)
				}
			case "hash":
				if _, err := s.db.Exec("UPDATE events SET raw_json=? WHERE seq=?", []byte(`{"specversion":"1.0","source":"urn:test","id":"one","type":"test.event","time":"2026-01-01T12:00:00Z","summary":"tampered"}`), seq); err != nil {
					t.Fatal(err)
				}
			case "membership":
				if _, err := s.db.Exec("UPDATE events SET content_hash=zeroblob(32) WHERE seq=?", seq); err != nil {
					t.Fatal(err)
				}
			case "purge":
				if _, err := s.db.Exec(`CREATE TRIGGER reject_purge BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'synthetic purge failure'); END`); err != nil {
					t.Fatal(err)
				}
			case "success-notice":
				if _, err := s.db.Exec(`CREATE TRIGGER reject_success BEFORE INSERT ON events WHEN NEW.type='signalhub.archive.succeeded' BEGIN SELECT RAISE(ABORT,'synthetic status failure'); END`); err != nil {
					t.Fatal(err)
				}
			case "commit":
				if _, err := s.db.Exec(`PRAGMA foreign_keys=ON; CREATE TABLE synthetic_parent(id PRIMARY KEY); CREATE TABLE synthetic_child(id REFERENCES synthetic_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER reject_archive_commit AFTER INSERT ON archives BEGIN INSERT INTO synthetic_child VALUES(1); END`); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.Archive(t.Context(), ArchiveOptions{Directory: dir, Now: now}); err == nil {
				t.Fatal("accepted synthetic failure")
			}
			if _, err := s.Detail(t.Context(), seq); err != nil {
				t.Fatalf("deleted hot row after failure: %v", err)
			}
			var count int
			if err := s.db.QueryRow("SELECT count(*) FROM archives").Scan(&count); err != nil || count != 0 {
				t.Fatalf("manifest survived failed operation %d %v", count, err)
			}
			if err := s.db.QueryRow("SELECT count(*) FROM events WHERE type='signalhub.archive.failed'").Scan(&count); err != nil || count != 1 {
				t.Fatalf("failure notice %d %v", count, err)
			}
			if kind == "purge" {
				orphan := filepath.Join(dir, "events/2026/01/01.part-1.jsonl.gz")
				original, _ = os.ReadFile(orphan)
				if _, err := s.db.Exec("DROP TRIGGER reject_purge"); err != nil {
					t.Fatal(err)
				}
				retry := mustArchive(t, s, dir, now)
				if retry.Events != 1 || retry.Parts[0].Part != 2 {
					t.Fatalf("orphan collision %+v", retry)
				}
				after, _ := os.ReadFile(orphan)
				if !bytes.Equal(original, after) {
					t.Fatal("orphan overwritten")
				}
			}
		})
	}
}
func TestArchiveImportTamperAtomicityAndUntrustedPaths(t *testing.T) {
	for _, kind := range []string{"bytes", "count", "identity", "path", "symlink", "directory", "gzip-tail", "audit"} {
		t.Run(kind, func(t *testing.T) {
			s, _ := newStore(t)
			dir := t.TempDir()
			now := archiveAt()
			seq := put(t, s, parsed(t, "first", "2026-01-01T12:00:00Z", nil))
			first := mustArchive(t, s, dir, now).Parts[0]
			put(t, s, parsed(t, "late", "2026-01-01T13:00:00Z", nil))
			last := mustArchive(t, s, dir, now).Parts[0]
			path := filepath.Join(dir, last.Path)
			switch kind {
			case "bytes":
				b, _ := os.ReadFile(path)
				b[len(b)/2] ^= 1
				os.WriteFile(path, b, 0600)
			case "count":
				s.db.Exec("UPDATE archives SET event_count=2 WHERE part=?", last.Part)
			case "identity":
				s.db.Exec("UPDATE event_identities SET content_hash=zeroblob(32) WHERE seq=?", last.FirstSeq)
			case "path":
				s.db.Exec("UPDATE archives SET path='../escape.jsonl.gz' WHERE part=?", last.Part)
			case "symlink":
				os.Remove(path)
				os.Symlink(filepath.Join(dir, first.Path), path)
			case "directory":
				os.Remove(path)
				os.Mkdir(path, 0700)
			case "gzip-tail":
				f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
				f.Write([]byte("extra"))
				f.Close()
			case "audit":
				s.db.Exec(`CREATE TRIGGER reject_import_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`)
			}
			if _, err := s.ImportArchives(t.Context(), dir, "2026-01-01", "tamper probe", now, 7); err == nil {
				t.Fatal("import accepted tamper")
			}
			if _, err := s.Detail(t.Context(), seq); !errors.Is(err, ErrNotFound) {
				t.Fatalf("partial day import committed: %v", err)
			}
			var count int
			if err := s.db.QueryRow("SELECT count(*) FROM audit_log WHERE action='archive.import'").Scan(&count); err != nil || count != 0 {
				t.Fatalf("failed import audited as success %d %v", count, err)
			}
			if kind != "audit" {
				if _, err := s.VerifyArchives(t.Context(), dir, "2026-01-01"); err == nil {
					t.Fatal("verify accepted tamper")
				}
			}
		})
	}
}

func TestArchivePersistedRetentionWholeDaysAndCivilBounds(t *testing.T) {
	s, _ := newStore(t)
	dir := t.TempDir()
	now := archiveAt()
	sources := []config.Source{{Name: "short", SourcePrefix: "urn:test", AllowedTypes: []string{"test.event"}, RetentionDays: 1}, {Name: "long", SourcePrefix: "urn:test:long", AllowedTypes: []string{"test.event"}, RetentionDays: 30}}
	if err := s.ConfigureSources(t.Context(), sources, now); err != nil {
		t.Fatal(err)
	}
	short := put(t, s, parsed(t, "short", "2026-10-11T23:59:59.999999999999Z", nil))
	boundary := put(t, s, parsed(t, "boundary", "2026-10-12T00:00:00Z", nil))
	long := put(t, s, parsed(t, "long", "2026-10-11T12:00:00Z", map[string]any{"source": "urn:test:long"}))
	unmatched := put(t, s, parsed(t, "other", "2026-10-11T12:00:00Z", map[string]any{"source": "urn:other"}))
	sources[0].RetentionDays = 999 // Unaccepted in-memory edit must have no effect.
	result := mustArchive(t, s, dir, now)
	if result.Events != 1 || result.Parts[0].FirstSeq != short {
		t.Fatalf("source policy %+v", result)
	}
	for _, seq := range []int64{boundary, long, unmatched} {
		if _, err := s.Detail(t.Context(), seq); err != nil {
			t.Fatalf("retained seq %d %v", seq, err)
		}
	}
	for _, at := range []string{"0001-01-01T00:00:00+23:00", "9999-12-31T23:59:59-23:00"} {
		e := parsed(t, at, at, nil)
		seq := put(t, s, e)
		_, err := s.Archive(t.Context(), ArchiveOptions{Directory: dir, Now: now})
		if err == nil {
			t.Fatalf("unsupported UTC civil year %s accepted", at)
		}
		if _, err := s.Detail(t.Context(), seq); err != nil {
			t.Fatal("extreme event deleted")
		}
	}
	for _, days := range []int{-1, math.MaxInt} {
		if _, err := s.Archive(t.Context(), ArchiveOptions{Directory: dir, Now: now, DefaultRetentionDays: days}); err == nil {
			t.Fatalf("overflow retention %d accepted", days)
		}
	}
	if _, err := s.Archive(t.Context(), ArchiveOptions{Directory: dir}); err == nil {
		t.Fatal("zero archive time accepted")
	}
}

func TestArchiveRootRejectsSymlinkBeforeCreatingOutsideDirectories(t *testing.T) {
	s, _ := newStore(t)
	base := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(base, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	seq := put(t, s, parsed(t, "keep", "2026-01-01T12:00:00Z", nil))
	if _, err := s.Archive(t.Context(), ArchiveOptions{Directory: filepath.Join(link, "uncreated", "archive"), Now: archiveAt()}); err == nil {
		t.Fatal("accepted symlink ancestor")
	}
	if _, err := os.Stat(filepath.Join(outside, "uncreated")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("created outside directory: %v", err)
	}
	if _, err := s.Detail(t.Context(), seq); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(base, "new", "nested", "archives")
	if got := mustArchive(t, s, nested, archiveAt()); got.Events != 1 {
		t.Fatalf("new root %+v", got)
	}
}

func TestArchivePreservesPausedImmediateAndDigestInputs(t *testing.T) {
	for _, mode := range []string{"immediate", "digest"} {
		t.Run(mode, func(t *testing.T) {
			s, _ := newStore(t)
			dir := t.TempDir()
			old := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
			sub := subscription("paused", "earliest_hot")
			if mode == "digest" {
				sub.Mode = "digest"
				sub.Channel = delivery.Channel{Kind: "ntfy", URL: "https://receiver.example.invalid/topic", TokenRef: "file:/synthetic/token"}
				sub.Digest = &delivery.Digest{Every: "24h", At: "00:00", Timezone: "UTC", SkipEmpty: true}
			}
			seq := put(t, s, parsed(t, "needed", old.Format(time.RFC3339), nil))
			configureDelivery(t, s, old, sub)
			configureDelivery(t, s, old)
			if result := mustArchive(t, s, dir, archiveAt()); result.Events != 0 {
				t.Fatalf("paused %s input purged %+v", mode, result)
			}
			configureDelivery(t, s, old, sub)
			queueDelivery(t, s, old.Add(24*time.Hour))
			if len(deliveryPage(t, s, DeliveryQuery{}).Items) != 1 {
				t.Fatal("resumed projection lost input")
			}
			if result := mustArchive(t, s, dir, archiveAt()); result.Events != 1 {
				t.Fatalf("materialized %s input pinned %+v", mode, result)
			}
			if _, err := s.Detail(t.Context(), seq); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
		})
	}
}

func TestArchivePreservesMaterializedDeliveryLeaseDLQReplayAndNoRestoredQueue(t *testing.T) {
	s, _ := newStore(t)
	dir := t.TempDir()
	now := archiveAt()
	configureDelivery(t, s, now, subscription("out", "earliest_hot"))
	for i := range 4 {
		put(t, s, parsed(t, fmt.Sprintf("delivery%d", i), "2026-01-01T12:00:00Z", nil))
	}
	queueDelivery(t, s, now)
	succeeded := claimDelivery(t, s, now)
	finishDelivery(t, s, succeeded, 200, now)
	dlq := claimDelivery(t, s, now)
	finishDelivery(t, s, dlq, 400, now)
	inflight := claimDelivery(t, s, now)
	before := deliveryPage(t, s, DeliveryQuery{})
	beforeRaw, _ := json.Marshal(before)
	var beforeBody string
	if err := s.db.QueryRow("SELECT group_concat(hex(body)||'|'||COALESCE(lease_token,''),'::') FROM (SELECT body,lease_token FROM deliveries ORDER BY ordinal)").Scan(&beforeBody); err != nil {
		t.Fatal(err)
	}
	if result := mustArchive(t, s, dir, now); result.Events != 4 {
		t.Fatalf("delivery events pinned %+v", result)
	}
	if _, err := s.ImportArchives(t.Context(), dir, "2026-01-01", "delivery preservation", now, 7); err != nil {
		t.Fatal(err)
	}
	queueDelivery(t, s, now)
	afterRaw, _ := json.Marshal(deliveryPage(t, s, DeliveryQuery{}))
	if !bytes.Equal(beforeRaw, afterRaw) {
		t.Fatalf("queue metadata changed: %s / %s", beforeRaw, afterRaw)
	}
	var afterBody string
	s.db.QueryRow("SELECT group_concat(hex(body)||'|'||COALESCE(lease_token,''),'::') FROM (SELECT body,lease_token FROM deliveries ORDER BY ordinal)").Scan(&afterBody)
	if beforeBody != afterBody {
		t.Fatal("materialized bytes or leases changed")
	}
	finishDelivery(t, s, inflight, 200, now)
	if err := s.ReplayDelivery(t.Context(), dlq.DeliveryID, "synthetic replay", now); err != nil {
		t.Fatal(err)
	}
	configureDelivery(t, s, now, subscription("out", "earliest_hot"), subscription("restored-history", "earliest_hot"), subscription("new-now", "now"))
	queueDelivery(t, s, now)
	for _, item := range deliveryPage(t, s, DeliveryQuery{}).Items {
		if item.SubscriptionID != "out" {
			t.Fatalf("restored input delivered %+v", item)
		}
	}
	fresh := put(t, s, parsed(t, "new-input", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, now)
	for _, id := range []string{"restored-history", "new-now"} {
		items := deliveryPage(t, s, DeliveryQuery{Subscription: id}).Items
		if len(items) != 1 || *items[0].EventSeq != fresh {
			t.Fatalf("new post-import input %+v", items)
		}
	}
}

func TestArchiveRuleProtectionAndRollupMissingInputGuard(t *testing.T) {
	s, _ := newStore(t)
	dir := t.TempDir()
	old := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	now := archiveAt()
	r := metricRule("count")
	r.Bucket = "1d"
	sources := []config.Source{{Name: "short", SourcePrefix: "urn:test:short", AllowedTypes: []string{"test.event"}, RetentionDays: 1}, {Name: "long", SourcePrefix: "urn:test:long", AllowedTypes: []string{"test.event"}, RetentionDays: 365}}
	if err := s.ConfigureRuntime(t.Context(), sources, []rules.Rule{r}, old, false); err != nil {
		t.Fatal(err)
	}
	put(t, s, parsed(t, "short", old.Format(time.RFC3339), map[string]any{"source": "urn:test:short"}))
	put(t, s, parsed(t, "long", old.Format(time.RFC3339), map[string]any{"source": "urn:test:long"}))
	if result := mustArchive(t, s, dir, now); result.Events != 0 {
		t.Fatalf("pending backfill purged %+v", result)
	}
	if err := s.EvaluateRules(t.Context(), old); err != nil {
		t.Fatal(err)
	}
	if result := mustArchive(t, s, dir, now); result.Events != 0 {
		t.Fatalf("downtime catchup purged %+v", result)
	}
	if err := s.EvaluateRules(t.Context(), now); err != nil {
		t.Fatal(err)
	}
	if result := mustArchive(t, s, dir, now); result.Events != 1 {
		t.Fatalf("retention hole %+v", result)
	}
	before := metricPage(t, s, r.ID, MetricQuery{To: old.Add(12 * time.Hour).Format(time.RFC3339)})
	if err := s.BackfillRule(t.Context(), r.ID, "2026-01-01T00:00:00Z", now); err == nil {
		t.Fatal("missing archived inputs silently recomputed")
	}
	after := metricPage(t, s, r.ID, MetricQuery{To: old.Add(12 * time.Hour).Format(time.RFC3339)})
	beforeBytes, _ := json.Marshal(before)
	afterBytes, _ := json.Marshal(after)
	if !bytes.Equal(beforeBytes, afterBytes) {
		t.Fatal("failed backfill altered retained rollup")
	}
	if _, err := s.ImportArchives(t.Context(), dir, "2026-01-01", "restore rule input", now, 7); err != nil {
		t.Fatal(err)
	}
	if err := s.BackfillRule(t.Context(), r.ID, "2026-01-01T00:00:00Z", now); err != nil {
		t.Fatal(err)
	}
	rows := metricPage(t, s, r.ID, MetricQuery{To: old.Add(12 * time.Hour).Format(time.RFC3339)}).Items
	if len(rows) != 1 || rows[0].SampleCount != 2 || rows[0].Value == nil || *rows[0].Value != 2 {
		t.Fatalf("backfill lost imported inputs %+v", rows)
	}
}

func TestArchivePartBoundAndConcurrentLateIngest(t *testing.T) {
	s, path := newStore(t)
	dir := t.TempDir()
	now := archiveAt()
	tx, err := s.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 1001 {
		e := parsed(t, fmt.Sprintf("bounded-%04d", i), "2026-01-01T12:00:00Z", nil)
		if _, err := ingestTx(t.Context(), tx, e, now); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	resultCh := make(chan ArchiveResult, 1)
	errCh := make(chan error, 1)
	go func() {
		result, err := s.Archive(t.Context(), ArchiveOptions{Directory: dir, Now: now})
		resultCh <- result
		errCh <- err
	}()
	// This producer either precedes the archive snapshot or commits after its
	// writer reservation. It must always remain in hot storage or a verified part.
	late := parsed(t, "concurrent-late", "2026-01-01T14:00:00Z", nil)
	got, err := other.Ingest(t.Context(), late, now)
	busy := errors.Is(err, ErrUnavailable)
	if err != nil && !busy {
		t.Fatal(err)
	}
	result := <-resultCh
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
	if busy {
		t.Logf("producer observed bounded busy failure; retrying once after archive commit: %v", err)
		got, err = other.Ingest(t.Context(), late, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(result.Parts) != 2 || result.Parts[0].EventCount != 1000 || result.Parts[1].EventCount < 1 || result.Parts[1].EventCount > 2 {
		t.Fatalf("part bounds %+v", result)
	}
	if _, err := s.VerifyArchives(t.Context(), dir, "2026-01-01"); err != nil {
		t.Fatal(err)
	}
	var hot, archived int
	if err := s.db.QueryRow("SELECT count(*) FROM events WHERE seq=?", got.Seq).Scan(&hot); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow("SELECT count(*) FROM archive_members WHERE event_seq=?", got.Seq).Scan(&archived); err != nil {
		t.Fatal(err)
	}
	if hot+archived != 1 {
		t.Fatalf("concurrent producer lost/duplicated: hot=%d archive=%d", hot, archived)
	}
}

func TestArchiveEmptyHotUsesDurableSubscriptionHighWater(t *testing.T) {
	s, _ := newStore(t)
	now := archiveAt()
	dir := t.TempDir()
	seq := put(t, s, parsed(t, "history", "2026-01-01T12:00:00Z", nil))
	mustArchive(t, s, dir, now)
	// Remove synthetic maintenance notices so hot storage is truly empty.
	if _, err := s.db.Exec("DELETE FROM events WHERE type='signalhub.archive.succeeded'"); err != nil {
		t.Fatal(err)
	}
	var maximum int64
	s.db.QueryRow("SELECT max(seq) FROM event_identities").Scan(&maximum)
	configureDelivery(t, s, now, subscription("future", "now"))
	var activation int64
	if err := s.db.QueryRow("SELECT activation_seq FROM subscriptions WHERE id='future'").Scan(&activation); err != nil || activation != maximum || activation < seq {
		t.Fatalf("activation=%d highwater=%d %v", activation, maximum, err)
	}
	if _, err := s.ImportArchives(t.Context(), dir, "2026-01-01", "empty hot", now, 7); err != nil {
		t.Fatal(err)
	}
	next := put(t, s, parsed(t, "new", now.Format(time.RFC3339), nil))
	if next <= maximum {
		t.Fatalf("seq reused %d <= %d", next, maximum)
	}
	queueDelivery(t, s, now)
	page := deliveryPage(t, s, DeliveryQuery{})
	if len(page.Items) != 1 || *page.Items[0].EventSeq != next {
		t.Fatalf("activation queue %+v", page)
	}
}

func TestArchiveFailureCancellationBeforePublish(t *testing.T) {
	s, _ := newStore(t)
	seq := put(t, s, parsed(t, "cancel", "2026-01-01T12:00:00Z", nil))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := s.Archive(ctx, ArchiveOptions{Directory: t.TempDir(), Now: archiveAt()}); err == nil {
		t.Fatal("canceled archive accepted")
	}
	if _, err := s.Detail(t.Context(), seq); err != nil {
		t.Fatal("canceled archive lost event")
	}
}

func TestArchiveM4UpgradeDefersUnknownAcceptedSourceRetention(t *testing.T) {
	path := filepath.Join(t.TempDir(), "m4.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(migration1 + migration2 + migration3 + migration4 + "PRAGMA user_version=4;"); err != nil {
		t.Fatal(err)
	}
	e := parsed(t, "upgrade", "2026-01-01T12:00:00Z", nil)
	now := archiveAt()
	if _, err := legacy.Exec(`INSERT INTO events(source,id,type,subject,time,received_at,severity,severity_rank,summary,originurl,correlationid,causationid,content_hash,raw_json,clock_skew) VALUES(?,?,?,'',?,?,'info',1,'','','','',?,?,0)`, attr(e, "source"), attr(e, "id"), attr(e, "type"), timeKey(e.Time), now.Format(time.RFC3339Nano), e.ContentHash[:], e.Raw); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO sources_state(name,scope_hash,config_hash,source_prefix,expected_interval,active,generation,status) VALUES('accepted','opaque-scope','opaque-retention','urn:test','',1,1,'never')`); err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	dir := t.TempDir()
	if result := mustArchive(t, s, dir, now); result.Events != 0 {
		t.Fatalf("unknown accepted policy purged during upgrade %+v", result)
	}
	if err := s.ConfigureSources(t.Context(), []config.Source{{Name: "accepted", SourcePrefix: "urn:test", AllowedTypes: []string{"test.event"}, RetentionDays: 365}}, now); err != nil {
		t.Fatal(err)
	}
	if result := mustArchive(t, s, dir, now); result.Events != 0 {
		t.Fatalf("accepted365 policy ignored %+v", result)
	}
	if err := s.ConfigureSources(t.Context(), []config.Source{{Name: "accepted", SourcePrefix: "urn:test", AllowedTypes: []string{"test.event"}, RetentionDays: 90}}, now); err != nil {
		t.Fatal(err)
	}
	if result := mustArchive(t, s, dir, now); result.Events != 1 {
		t.Fatalf("accepted90 policy ignored %+v", result)
	}
}

func TestArchiveVerifyUnrecordedDayFailsClosed(t *testing.T) {
	s, _ := newStore(t)
	if _, err := s.VerifyArchives(t.Context(), t.TempDir(), "2026-01-01"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("verified no manifest: %v", err)
	}
}
