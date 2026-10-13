package store

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
	"os"
	"strings"
	"testing"
	"time"
)

func TestDeliveryMigrationReady(t *testing.T) {
	s, _ := newStore(t)
	for _, table := range []string{"subscriptions", "deliveries", "delivery_attempts", "audit_log"} {
		var n int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatalf("M4 table %s unavailable: %v", table, err)
		}
	}
}

func subscription(id, start string) delivery.Subscription {
	return delivery.Subscription{ID: id, Filter: rules.Filter{Types: []string{"test.event"}}, Channel: delivery.Channel{Kind: "webhook", URL: "https://receiver.example.invalid/signals", SecretRef: "file:/synthetic/secret"}, Mode: "immediate", Start: start}
}
func configureDelivery(t *testing.T, s *Store, now time.Time, subs ...delivery.Subscription) {
	t.Helper()
	if err := s.ConfigureRuntime(t.Context(), nil, nil, now, false, subs); err != nil {
		t.Fatal(err)
	}
}
func queueDelivery(t *testing.T, s *Store, now time.Time) {
	t.Helper()
	if err := s.QueueDeliveries(t.Context(), now, "https://board.example.invalid"); err != nil {
		t.Fatal(err)
	}
}
func claimDelivery(t *testing.T, s *Store, now time.Time) *DeliveryWork {
	t.Helper()
	work, err := s.ClaimDelivery(t.Context(), now)
	if err != nil || work == nil {
		t.Fatalf("claim %+v %v", work, err)
	}
	return work
}
func finishDelivery(t *testing.T, s *Store, work *DeliveryWork, status int, now time.Time) {
	t.Helper()
	if err := s.FinishDelivery(t.Context(), *work, delivery.Result{HTTPStatus: new(status), DurationMS: 5}, now); err != nil {
		t.Fatal(err)
	}
}
func deliveryPage(t *testing.T, s *Store, q DeliveryQuery) DeliveryPage {
	t.Helper()
	page, err := s.ListDeliveries(t.Context(), q)
	if err != nil {
		t.Fatal(err)
	}
	return page
}

func TestDeliveryImmediateActivationDurabilityAndPause(t *testing.T) {
	s, path := newStore(t)
	now := ruleTime(12)
	before := put(t, s, parsed(t, "before", now.Format(time.RFC3339), nil))
	configureDelivery(t, s, now, subscription("history", "earliest_hot"), subscription("new", "now"))
	raw := []byte(`{ "specversion":"1.0", "source":"urn:test", "id":"after", "type":"test.event", "time":"2026-10-03T12:00:00Z" }`)
	e, err := event.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	after := put(t, s, e)
	queueDelivery(t, s, now)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	queueDelivery(t, s, now)
	page := deliveryPage(t, s, DeliveryQuery{})
	if len(page.Items) != 3 || page.Items[0].DeliveryID != fmt.Sprintf("history:%d", before) {
		t.Fatalf("activation/restart %+v", page)
	}
	configureDelivery(t, s, now, subscription("new", "now"))
	work := claimDelivery(t, s, now)
	if work.SubscriptionID != "new" || work.DeliveryID != fmt.Sprintf("new:%d", after) || !bytes.Equal(work.Message.Body, raw) {
		t.Fatalf("wrong active work %+v", work)
	}
	finishDelivery(t, s, work, 200, now)
	if idle, err := s.ClaimDelivery(t.Context(), now); idle != nil || err != nil {
		t.Fatalf("paused work claimed %+v %v", idle, err)
	}
	configureDelivery(t, s, now, subscription("history", "earliest_hot"), subscription("new", "now"))
	if claimDelivery(t, s, now).DeliveryID != fmt.Sprintf("history:%d", before) {
		t.Fatal("readding did not resume")
	}
	var definition string
	if err := s.db.QueryRow("SELECT definition FROM subscriptions LIMIT 1").Scan(&definition); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(definition, "receiver") || strings.Contains(definition, "synthetic/secret") {
		t.Fatal("endpoint/reference persisted")
	}
}

func TestDeliveryQueueRollbackAndImmutableConfiguration(t *testing.T) {
	s, _ := newStore(t)
	now := ruleTime(12)
	sub := subscription("out", "earliest_hot")
	source := config.Source{Name: "producer", SourcePrefix: "urn:before:", AllowedTypes: []string{"test.event"}}
	if err := s.ConfigureRuntime(t.Context(), []config.Source{source}, nil, now, false, []delivery.Subscription{sub}); err != nil {
		t.Fatal(err)
	}
	put(t, s, parsed(t, "a", now.Format(time.RFC3339), nil))
	put(t, s, parsed(t, "b", now.Format(time.RFC3339), nil))
	if _, err := s.db.Exec(`CREATE TRIGGER fail_delivery BEFORE INSERT ON deliveries WHEN NEW.delivery_id='out:2' BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END;`); err != nil {
		t.Fatal(err)
	}
	if err := s.QueueDeliveries(t.Context(), now, ""); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("failure %v", err)
	}
	if len(deliveryPage(t, s, DeliveryQuery{}).Items) != 0 {
		t.Fatal("queue partially committed")
	}
	var scan int64
	if err := s.db.QueryRow("SELECT scan_seq FROM subscriptions").Scan(&scan); err != nil || scan != 0 {
		t.Fatalf("cursor advanced %d %v", scan, err)
	}
	if _, err := s.db.Exec("DROP TRIGGER fail_delivery"); err != nil {
		t.Fatal(err)
	}
	queueDelivery(t, s, now)
	changed := sub
	changed.Filter.Types = []string{"other.event"}
	source.SourcePrefix = "urn:after:"
	if err := s.ConfigureRuntime(t.Context(), []config.Source{source}, nil, now, false, []delivery.Subscription{changed}); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("mutable identity accepted %v", err)
	}
	sources, err := s.ListSources(t.Context(), SourceQuery{}, now)
	if err != nil || sources.Items[0].SourcePrefix != "urn:before:" {
		t.Fatalf("source half-activated %+v %v", sources, err)
	}
	changed = sub
	changed.Channel.URL = "https://rotated.example.invalid/new"
	changed.Channel.SecretRef = "file:/synthetic/rotated"
	configureDelivery(t, s, now, changed)
	if len(deliveryPage(t, s, DeliveryQuery{}).Items) != 2 {
		t.Fatal("rotation rewrote queue")
	}
}

func TestDeliveryRetryDLQReplayAndSanitization(t *testing.T) {
	s, _ := newStore(t)
	now := ruleTime(12)
	configureDelivery(t, s, now, subscription("out", "earliest_hot"))
	put(t, s, parsed(t, "retry", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, now)
	var original []byte
	for attempt := 1; attempt <= 4; attempt++ {
		work := claimDelivery(t, s, now)
		if attempt == 1 {
			original = bytes.Clone(work.Message.Body)
		}
		if work.Attempt != attempt || work.DeliveryID != "out:1" || !bytes.Equal(original, work.Message.Body) {
			t.Fatalf("unstable attempt %+v", work)
		}
		status := 500
		if attempt == 4 {
			status = 200
		}
		finishDelivery(t, s, work, status, now)
		row := deliveryPage(t, s, DeliveryQuery{}).Items[0]
		if attempt < 4 {
			if row.State != "pending" || row.NextAttemptAt == nil {
				t.Fatalf("retry state %+v", row)
			}
			next, err := time.Parse(time.RFC3339Nano, *row.NextAttemptAt)
			if err != nil {
				t.Fatal(err)
			}
			if next.Before(now.Add(30*time.Second)) || next.After(now.Add(time.Hour)) {
				t.Fatal("retry delay outside bounds")
			}
			if work, err := s.ClaimDelivery(t.Context(), next.Add(-time.Nanosecond)); work != nil || err != nil {
				t.Fatal("early retry")
			}
			now = next
		} else if row.State != "succeeded" || row.AttemptCount != 4 {
			t.Fatalf("not successful %+v", row)
		}
	}
	put(t, s, parsed(t, "bad", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, now)
	work := claimDelivery(t, s, now)
	finishDelivery(t, s, work, 400, now)
	for _, reason := range []string{"", " \n\t"} {
		if err := s.ReplayDelivery(t.Context(), work.DeliveryID, reason, now); !errors.Is(err, ErrInvalidReason) {
			t.Fatalf("blank reason accepted %v", err)
		}
	}
	events, err := s.List(t.Context(), Query{Type: "signalhub.delivery.dlq"})
	if err != nil || len(events.Items) != 1 {
		t.Fatalf("DLQ events %+v %v", events, err)
	}
	if err := s.FinishDelivery(t.Context(), *work, delivery.Result{HTTPStatus: new(400)}, now); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplayDelivery(t.Context(), work.DeliveryID, "receiver repaired", now); err != nil {
		t.Fatal(err)
	}
	replay := claimDelivery(t, s, now)
	if replay.DeliveryID != work.DeliveryID || replay.Attempt != 2 || !bytes.Equal(replay.Message.Body, work.Message.Body) {
		t.Fatal("replay changed identity/payload")
	}
	if err := s.FinishDelivery(t.Context(), *replay, delivery.Result{Error: new("secret https://private.example.invalid/token"), DurationMS: -1}, now); err != nil {
		t.Fatal(err)
	}
	row := deliveryPage(t, s, DeliveryQuery{State: "pending"}).Items[0]
	if row.LastAttempt == nil || *row.LastAttempt.Error != "transport failure" || row.LastAttempt.DurationMS != 0 {
		t.Fatalf("unsafe error %+v", row)
	}
	var reason, actor, action string
	if err := s.db.QueryRow("SELECT reason,actor,action FROM audit_log").Scan(&reason, &actor, &action); err != nil || reason != "receiver repaired" || actor != "owner" || action != "delivery.replay" {
		t.Fatalf("missing audit %q %q %q %v", reason, actor, action, err)
	}
}

func TestDeliveryLeaseRecoveryAndStaleFence(t *testing.T) {
	s, path := newStore(t)
	now := ruleTime(12)
	configureDelivery(t, s, now, subscription("out", "earliest_hot"))
	put(t, s, parsed(t, "lease", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, now)
	first := claimDelivery(t, s, now)
	if current := deliveryPage(t, s, DeliveryQuery{}).Items[0]; current.LastAttempt == nil || current.LastAttempt.Error != nil {
		t.Fatal("live claim mislabeled interrupted")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if work, err := s.ClaimDelivery(t.Context(), now.Add(2*time.Minute-time.Nanosecond)); err != nil || work != nil {
		t.Fatal("lease recovered early")
	}
	next := claimDelivery(t, s, now.Add(2*time.Minute))
	if first.LeaseToken == next.LeaseToken || next.Attempt != 2 || first.DeliveryID != next.DeliveryID {
		t.Fatal("lease was not fenced")
	}
	finishDelivery(t, s, first, 200, now.Add(2*time.Minute))
	if row := deliveryPage(t, s, DeliveryQuery{}).Items[0]; row.State != "inflight" {
		t.Fatal("stale worker committed")
	}
	finishDelivery(t, s, next, 204, now.Add(2*time.Minute))
	var summary string
	if err := s.db.QueryRow("SELECT error FROM delivery_attempts WHERE attempt=1").Scan(&summary); err != nil || summary != "attempt interrupted" {
		t.Fatalf("interrupted attempt %q %v", summary, err)
	}
}

func TestDeliveryAttemptBudgetReplayAndAuditRollback(t *testing.T) {
	s, _ := newStore(t)
	now := ruleTime(12)
	configureDelivery(t, s, now, subscription("out", "earliest_hot"))
	put(t, s, parsed(t, "budget", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, now)
	for attempt := 1; attempt <= 12; attempt++ {
		work := claimDelivery(t, s, now)
		finishDelivery(t, s, work, 503, now)
		now = now.Add(time.Hour)
	}
	row := deliveryPage(t, s, DeliveryQuery{}).Items[0]
	if row.State != "dlq" || row.AttemptCount != 12 {
		t.Fatalf("budget %+v", row)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER fail_replay BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic unavailable audit'); END;`); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplayDelivery(t.Context(), row.DeliveryID, "retry", now); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("audit failure %v", err)
	}
	if deliveryPage(t, s, DeliveryQuery{}).Items[0].State != "dlq" {
		t.Fatal("replay lost audit")
	}
	if _, err := s.db.Exec("DROP TRIGGER fail_replay"); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplayDelivery(t.Context(), row.DeliveryID, "retry", now); err != nil {
		t.Fatal(err)
	}
	work := claimDelivery(t, s, now)
	if work.Attempt != 13 {
		t.Fatal("lifetime counter reset")
	}
	finishDelivery(t, s, work, 503, now)
	if deliveryPage(t, s, DeliveryQuery{}).Items[0].State != "pending" {
		t.Fatal("replay budget not reset")
	}
}

func TestDeliveryHTTPClassificationAndInactiveReplay(t *testing.T) {
	for _, status := range []int{200, 204, 301, 400, 401, 408, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			s, _ := newStore(t)
			now := ruleTime(12)
			sub := subscription("out", "earliest_hot")
			configureDelivery(t, s, now, sub)
			put(t, s, parsed(t, "status", now.Format(time.RFC3339), nil))
			queueDelivery(t, s, now)
			work := claimDelivery(t, s, now)
			if err := s.FinishDelivery(t.Context(), *work, delivery.Result{HTTPStatus: new(status), Error: new("delivery HTTP response rejected")}, now); err != nil {
				t.Fatal(err)
			}
			want := "dlq"
			if status >= 200 && status < 300 {
				want = "succeeded"
			}
			if status == 408 || status == 429 || status >= 500 {
				want = "pending"
			}
			if row := deliveryPage(t, s, DeliveryQuery{}).Items[0]; row.State != want {
				t.Fatalf("HTTP %d -> %s want %s", status, row.State, want)
			}
			if want == "dlq" {
				configureDelivery(t, s, now)
				if err := s.ReplayDelivery(t.Context(), work.DeliveryID, "inactive", now); !errors.Is(err, ErrNotReplayable) {
					t.Fatalf("inactive replay %v", err)
				}
			}
		})
	}
}

func digestSubscription(id, start string, skip bool) delivery.Subscription {
	sub := subscription(id, start)
	sub.Mode = "digest"
	sub.Channel = delivery.Channel{Kind: "ntfy", URL: "https://receiver.example.invalid/topic", TokenRef: "file:/synthetic/token"}
	sub.Digest = &delivery.Digest{Every: "24h", At: "00:00", Timezone: "UTC", SkipEmpty: skip}
	return sub
}
func TestDeliveryDigestSnapshotActivationAndMatching(t *testing.T) {
	s, _ := newStore(t)
	now := ruleTime(12)
	for i := range 25 {
		put(t, s, parsed(t, fmt.Sprintf("old-%02d", i), now.Format(time.RFC3339), map[string]any{"summary": fmt.Sprintf("match-%02d", i)}))
	}
	put(t, s, parsed(t, "unmatched", now.Format(time.RFC3339), map[string]any{"type": "other.event", "summary": "NEVER"}))
	configureDelivery(t, s, now, digestSubscription("history", "earliest_hot", true), digestSubscription("new", "now", true))
	put(t, s, parsed(t, "postactivation", now.Format(time.RFC3339), map[string]any{"summary": "POST"}))
	queueDelivery(t, s, now)
	if len(deliveryPage(t, s, DeliveryQuery{}).Items) != 0 {
		t.Fatal("incomplete digest window queued")
	}
	end := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	put(t, s, parsed(t, "next-window", end.Format(time.RFC3339), nil))
	queueDelivery(t, s, end)
	page := deliveryPage(t, s, DeliveryQuery{})
	if len(page.Items) != 2 {
		t.Fatalf("digests %+v", page)
	}
	history := claimDelivery(t, s, end)
	if !strings.HasPrefix(string(history.Message.Body), "26 events\n") || !strings.Contains(string(history.Message.Body), "match-19") || strings.Contains(string(history.Message.Body), "match-20") || strings.Contains(string(history.Message.Body), "NEVER") {
		t.Fatalf("digest matching/cap %s", history.Message.Body)
	}
	finishDelivery(t, s, history, 200, end)
	recent := claimDelivery(t, s, end)
	if !strings.HasPrefix(string(recent.Message.Body), "1 events\n") || !strings.Contains(string(recent.Message.Body), "POST") {
		t.Fatalf("now included old events %s", recent.Message.Body)
	}
	finishDelivery(t, s, recent, 200, end)
	put(t, s, parsed(t, "too-late", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, end)
	var frozen []byte
	if err := s.db.QueryRow("SELECT body FROM deliveries WHERE delivery_id=?", history.DeliveryID).Scan(&frozen); err != nil || !bytes.Equal(frozen, history.Message.Body) {
		t.Fatal("late arrival rewrote digest")
	}
	queueDelivery(t, s, end.Add(24*time.Hour))
	if len(deliveryPage(t, s, DeliveryQuery{}).Items) != 4 {
		t.Fatal("end-exclusive event lost")
	}
}
func TestDeliveryDigestEmptyCatchupAndRestart(t *testing.T) {
	s, path := newStore(t)
	now := ruleTime(12)
	configureDelivery(t, s, now, digestSubscription("empty", "now", true), digestSubscription("all", "now", false))
	future := now.AddDate(0, 0, 40)
	queueDelivery(t, s, future)
	if rows := deliveryPage(t, s, DeliveryQuery{}).Items; len(rows) != 31 {
		t.Fatalf("unbounded digest catchup %d", len(rows))
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	queueDelivery(t, s, future)
	if rows := deliveryPage(t, s, DeliveryQuery{}).Items; len(rows) != 40 {
		t.Fatalf("restart missed digest windows %d", len(rows))
	}
	put(t, s, parsed(t, "late-empty", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, future)
	if rows := deliveryPage(t, s, DeliveryQuery{Subscription: "empty"}).Items; len(rows) != 0 {
		t.Fatal("empty materialized boundary did not persist")
	}
}
func TestDeliveryDigestDSTWindowPersistence(t *testing.T) {
	s, _ := newStore(t)
	sub := digestSubscription("dst", "earliest_hot", false)
	sub.Digest.Timezone = "America/New_York"
	sub.Digest.At = "02:30"
	before := time.Date(2026, 3, 7, 8, 0, 0, 0, time.UTC)
	put(t, s, parsed(t, "before-dst", before.Format(time.RFC3339), nil))
	configureDelivery(t, s, before, sub)
	end := time.Date(2026, 3, 9, 7, 0, 0, 0, time.UTC)
	queueDelivery(t, s, end)
	p := deliveryPage(t, s, DeliveryQuery{})
	if len(p.Items) != 2 || *p.Items[0].WindowStart != "2026-03-07T07:30:00Z" || *p.Items[1].WindowStart != "2026-03-08T07:00:00Z" {
		t.Fatalf("DST boundaries %+v", p)
	}
}

func TestDeliveryPaginationFiltersAndSafeCounts(t *testing.T) {
	s, _ := newStore(t)
	now := ruleTime(12)
	configureDelivery(t, s, now, subscription("alpha", "earliest_hot"), subscription("beta", "earliest_hot"))
	for i := range 3 {
		put(t, s, parsed(t, fmt.Sprint(i), now.Format(time.RFC3339), nil))
	}
	queueDelivery(t, s, now)
	first := deliveryPage(t, s, DeliveryQuery{Subscription: "alpha", State: "pending", Limit: 1})
	if first.NextCursor == nil || first.Items[0].DeliveryID != "alpha:1" {
		t.Fatalf("first page %+v", first)
	}
	for _, query := range []DeliveryQuery{{Subscription: "beta", State: "pending", Cursor: *first.NextCursor}, {Subscription: "alpha", State: "dlq", Cursor: *first.NextCursor}, {State: "unknown"}, {Limit: 201}, {Cursor: "!"}} {
		if _, err := s.ListDeliveries(t.Context(), query); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("invalid query %+v %v", query, err)
		}
	}
	put(t, s, parsed(t, "later", now.Format(time.RFC3339), nil))
	queueDelivery(t, s, now)
	next := deliveryPage(t, s, DeliveryQuery{Subscription: "alpha", State: "pending", Cursor: *first.NextCursor})
	if len(next.Items) != 2 || next.Items[0].DeliveryID != "alpha:2" || next.Items[1].DeliveryID != "alpha:3" {
		t.Fatalf("unstable pagination %+v", next)
	}
	raw, _ := base64.RawURLEncoding.DecodeString(*first.NextCursor)
	for _, bad := range []string{string(raw) + "{}", strings.Replace(string(raw), `"v":1`, `"v":1,"v":1`, 1), strings.Replace(string(raw), `"v":1`, `"v":1,"extra":1`, 1)} {
		if _, err := s.ListDeliveries(t.Context(), DeliveryQuery{Subscription: "alpha", State: "pending", Cursor: base64.RawURLEncoding.EncodeToString([]byte(bad))}); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("malformed cursor %v", err)
		}
	}
	subs, err := s.ListSubscriptions(t.Context(), "", 1)
	if err != nil || subs.NextCursor == nil || len(subs.Items) != 1 || subs.Items[0].Counts.Pending != 4 {
		t.Fatalf("counts %+v %v", subs, err)
	}
	safe, _ := json.Marshal(subs)
	if bytes.Contains(safe, []byte("receiver")) || bytes.Contains(safe, []byte("synthetic")) {
		t.Fatal("private target in API")
	}
	configureDelivery(t, s, now, subscription("alpha", "earliest_hot"))
	if _, err := s.ListSubscriptions(t.Context(), *subs.NextCursor, 1); !errors.Is(err, ErrInvalidQuery) {
		t.Fatalf("changed subscriptions cursor accepted %v", err)
	}
}

func TestDeliveryMigrationPreservesM3AndSecretFreeFile(t *testing.T) {
	path := t.TempDir() + "/old.db"
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(migration1 + migration2 + migration3 + "PRAGMA user_version=3;"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO rule_definitions(rule_id,version,content_hash,definition) VALUES('kept',1,'hash','{}'); INSERT INTO config_audit(occurred_at,outcome) VALUES('2026-10-03T12:00:00Z','reloaded');`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM rule_definitions WHERE rule_id='kept'").Scan(&count); err != nil || count != 1 {
		t.Fatal("migration lost rule history")
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM config_audit").Scan(&count); err != nil || count != 1 {
		t.Fatal("migration lost audit history")
	}
	configureDelivery(t, s, ruleTime(12), subscription("safe", "earliest_hot"))
	if _, err := s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("receiver.example.invalid")) || bytes.Contains(raw, []byte("/synthetic/secret")) {
		t.Fatal("sensitive configuration persisted in DB")
	}
}

func TestDeliveryDigestEarliestHotWaitsForFirstEvent(t *testing.T) {
	s, _ := newStore(t)
	now := ruleTime(12)
	configureDelivery(t, s, now, digestSubscription("history", "earliest_hot", true))
	queueDelivery(t, s, now)
	historical := now.AddDate(0, 0, -2)
	put(t, s, parsed(t, "historical", historical.Format(time.RFC3339), map[string]any{"summary": "FIRST"}))
	queueDelivery(t, s, now)
	page := deliveryPage(t, s, DeliveryQuery{})
	if len(page.Items) != 1 || *page.Items[0].WindowStart != "2026-10-01T00:00:00Z" {
		t.Fatalf("first historical input lost %+v", page)
	}
	if work := claimDelivery(t, s, now); !strings.Contains(string(work.Message.Body), "FIRST") {
		t.Fatal("wrong first historical digest")
	}
}
