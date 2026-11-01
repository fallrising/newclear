package store

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
)

func metricRule(fn string) rules.Rule {
	field := "data.n"
	if fn == "count" {
		field = ""
	}
	return rules.Rule{ID: fn, Version: 1, Title: fn, Filter: rules.Filter{Types: []string{"test.event"}}, Aggregation: rules.Aggregation{Fn: fn, Field: field}, Bucket: "1h"}
}
func ruleTime(hour int) time.Time { return time.Date(2026, 10, 3, hour, 0, 0, 0, time.UTC) }
func setupRules(t *testing.T, s *Store, rr ...rules.Rule) {
	t.Helper()
	if err := s.ConfigureRuntime(t.Context(), nil, rr, ruleTime(12), false); err != nil {
		t.Fatal(err)
	}
}
func metricPage(t *testing.T, s *Store, id string, q MetricQuery) MetricPage {
	t.Helper()
	p, err := s.ListMetrics(t.Context(), id, q)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func TestRuleAggregatesEmptyAndLate(t *testing.T) {
	for _, fn := range []string{"count", "count_distinct", "sum", "min", "max", "avg"} {
		t.Run(fn, func(t *testing.T) {
			s, _ := newStore(t)
			r := metricRule(fn)
			r.ID = "aggregate"
			setupRules(t, s, r)
			for i, data := range []map[string]any{{"n": 2}, {"n": 4}, {"n": 4}, {"n": "x"}, {"n": nil}, {}} {
				put(t, s, parsed(t, fmt.Sprint(i), ruleTime(10).Add(time.Minute).Format(time.RFC3339), map[string]any{"data": data}))
			}
			if err := s.EvaluateRules(t.Context(), ruleTime(12).Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			p := metricPage(t, s, r.ID, MetricQuery{})
			if len(p.Items) != 3 {
				t.Fatalf("rows %d", len(p.Items))
			}
			first := p.Items[0]
			want := map[string]float64{"count": 6, "count_distinct": 4, "sum": 10, "min": 2, "max": 4, "avg": 10.0 / 3}[fn]
			samples := map[string]int64{"count": 6, "count_distinct": 5, "sum": 3, "min": 3, "max": 3, "avg": 3}[fn]
			if first.Value == nil || *first.Value != want || first.SampleCount != samples || first.Partial {
				t.Fatalf("first %+v want %f samples %d", first, want, samples)
			}
			for _, item := range p.Items[1:] {
				if item.SampleCount != 0 {
					t.Fatalf("empty samples %+v", item)
				}
				zero := fn == "count" || fn == "count_distinct" || fn == "sum"
				if zero && (item.Value == nil || *item.Value != 0) || !zero && item.Value != nil {
					t.Fatalf("empty %s %+v", fn, item)
				}
			}
			if !p.Items[2].Partial {
				t.Fatal("current bucket not partial")
			}
			put(t, s, parsed(t, "late", ruleTime(11).Add(time.Minute).Format(time.RFC3339), map[string]any{"data": map[string]any{"n": 9}}))
			if err := s.EvaluateRules(t.Context(), ruleTime(12).Add(2*time.Minute)); err != nil {
				t.Fatal(err)
			}
			p = metricPage(t, s, r.ID, MetricQuery{})
			if p.Items[1].Value == nil || p.Items[1].SampleCount != 1 {
				t.Fatal("late event not absorbed")
			}
		})
	}
}
func TestRuleCardinalityDeterministicAndMissingGroups(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	r.GroupBy = []string{"data.group"}
	setupRules(t, s, r)
	for i := 204; i >= 0; i-- {
		put(t, s, parsed(t, fmt.Sprint(i), ruleTime(10).Format(time.RFC3339), map[string]any{"data": map[string]any{"group": fmt.Sprintf("%03d", i)}}))
	}
	if err := s.EvaluateRules(t.Context(), ruleTime(11)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{To: ruleTime(11).Format(time.RFC3339), Limit: 200})
	if len(p.Items) != 200 || p.NextCursor != nil {
		t.Fatalf("cardinality %d", len(p.Items))
	}
	last := p.Items[199]
	if last.GroupKey != "__other__" || last.Value == nil || *last.Value != 6 {
		t.Fatalf("overflow %+v", last)
	}
	if p.Items[198].GroupKey != `["198"]` {
		t.Fatal("selection not canonical")
	}
	p = metricPage(t, s, r.ID, MetricQuery{From: ruleTime(11).Format(time.RFC3339), Limit: 200})
	if len(p.Items) != 200 {
		t.Fatal("empty groups not retained")
	}
	for _, v := range p.Items {
		if *v.Value != 0 {
			t.Fatal("nonempty carried group")
		}
	}
	// At exactly 200 groups there is no overflow; real '__other__' has a JSON-array key.
	s2, _ := newStore(t)
	setupRules(t, s2, r)
	for i := range 200 {
		group := fmt.Sprint(i)
		if i == 0 {
			group = "__other__"
		}
		put(t, s2, parsed(t, fmt.Sprint(i), ruleTime(10).Format(time.RFC3339), map[string]any{"data": map[string]any{"group": group}}))
	}
	if err := s2.EvaluateRules(t.Context(), ruleTime(10)); err != nil {
		t.Fatal(err)
	}
	p = metricPage(t, s2, r.ID, MetricQuery{Limit: 200})
	for _, v := range p.Items {
		if v.GroupKey == "__other__" {
			t.Fatal("unexpected overflow at 200")
		}
	}
}
func TestVersionGuardAtomicRuntimeAndHistoricalRules(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	source := config.Source{Name: "producer", SourcePrefix: "urn:producer:", AllowedTypes: []string{"test.event"}}
	if err := s.ConfigureRuntime(t.Context(), []config.Source{source}, []rules.Rule{r}, ruleTime(10), false); err != nil {
		t.Fatal(err)
	}
	put(t, s, parsed(t, "first", ruleTime(10).Format(time.RFC3339), nil))
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	changed := r
	changed.Title = "Changed"
	source.SourcePrefix = "urn:changed:"
	if err := s.ConfigureRuntime(t.Context(), []config.Source{source}, []rules.Rule{changed}, ruleTime(12), true); !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("guard %v", err)
	}
	sources, err := s.ListSources(t.Context(), SourceQuery{}, ruleTime(12))
	if err != nil || sources.Items[0].SourcePrefix != "urn:producer:" {
		t.Fatalf("partial source configuration %+v %v", sources, err)
	}
	var audit int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM config_audit").Scan(&audit); err != nil || audit != 0 {
		t.Fatal("rejected activation audit persisted")
	}
	changed.Version = 2
	setupRules(t, s, changed)
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{})
	for _, v := range p.Items {
		if v.RuleVersion != 2 {
			t.Fatal("recomputable old version retained")
		}
	}
	// Reusing a historical version with changed content is rejected; exact rollback is accepted.
	changed.Version = 1
	if err := s.ConfigureRuntime(t.Context(), nil, []rules.Rule{changed}, ruleTime(12), false); !errors.Is(err, ErrInvalidConfig) {
		t.Fatal("historical guard missing")
	}
	setupRules(t, s, r)
	setupRules(t, s)
	if defs, err := s.ActiveRules(t.Context()); err != nil || len(defs) != 0 {
		t.Fatalf("active removed rule %v %v", defs, err)
	}
	if len(metricPage(t, s, r.ID, MetricQuery{}).Items) == 0 {
		t.Fatal("retained rule not queryable")
	}
	if err := s.RecordConfigRejected(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
}
func thresholdRule() rules.Rule {
	r := metricRule("count")
	r.Threshold = &rules.Threshold{Op: ">=", Value: 1, ForBuckets: 2, Severity: "warning"}
	r.GroupBy = []string{"subject"}
	return r
}
func TestThresholdReplayRestartRecoveryAndImmutablePayload(t *testing.T) {
	s, path := newStore(t)
	r := thresholdRule()
	setupRules(t, s, r)
	for _, hour := range []int{8, 9, 10} {
		put(t, s, parsed(t, fmt.Sprint(hour), ruleTime(hour).Format(time.RFC3339), map[string]any{"subject": "job"}))
	}
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	events, err := s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if err != nil || len(events.Items) != 1 {
		t.Fatalf("crossed %d %v", len(events.Items), err)
	}
	first := events.Items[0].Event
	if err := s.EvaluateRules(t.Context(), ruleTime(13)); err != nil {
		t.Fatal(err)
	}
	events, err = s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if err != nil || len(events.Items) != 2 {
		t.Fatalf("recovered %d %v", len(events.Items), err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for range 2 {
		if err := s.BackfillRule(t.Context(), r.ID, ruleTime(8).Format(time.RFC3339), ruleTime(13)); err != nil {
			t.Fatal(err)
		}
	}
	put(t, s, parsed(t, "late-threshold", ruleTime(9).Add(time.Minute).Format(time.RFC3339), map[string]any{"subject": "job"}))
	if err := s.BackfillRule(t.Context(), r.ID, ruleTime(8).Format(time.RFC3339), ruleTime(13)); err != nil {
		t.Fatal(err)
	}
	events, err = s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if err != nil || len(events.Items) != 2 {
		t.Fatalf("duplicate transitions %d %v", len(events.Items), err)
	}
	if !reflect.DeepEqual(events.Items[1].Event, first) {
		t.Fatal("original threshold payload mutated")
	}
	var crossed bool
	var streak int
	if err := s.db.QueryRow("SELECT crossed,streak FROM threshold_state WHERE rule_id=?", r.ID).Scan(&crossed, &streak); err != nil || crossed || streak != 0 {
		t.Fatalf("durable state %v %d %v", crossed, streak, err)
	}
}
func TestMetricsCursorStrictAndBounds(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	setupRules(t, s, r)
	put(t, s, parsed(t, "one", ruleTime(8).Format(time.RFC3339), nil))
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{Limit: 2})
	if len(p.Items) != 2 || p.NextCursor == nil {
		t.Fatal("first page")
	}
	next := metricPage(t, s, r.ID, MetricQuery{Limit: 200, Cursor: *p.NextCursor})
	if len(next.Items) != 3 || next.NextCursor != nil {
		t.Fatalf("next %+v", next)
	}
	for _, q := range []MetricQuery{{Limit: 201}, {Limit: -1}, {From: "invalid"}, {From: ruleTime(10).Format(time.RFC3339), To: ruleTime(9).Format(time.RFC3339)}, {Cursor: "!!!"}, {Cursor: *p.NextCursor, Group: "[]"}, {Cursor: *p.NextCursor, From: ruleTime(9).Format(time.RFC3339)}} {
		if _, err := s.ListMetrics(t.Context(), r.ID, q); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("query %+v %v", q, err)
		}
	}
	bounded := metricPage(t, s, r.ID, MetricQuery{From: ruleTime(9).Format(time.RFC3339), To: ruleTime(11).Format(time.RFC3339)})
	if len(bounded.Items) != 2 {
		t.Fatal("bounds not half open")
	}
	if _, err := s.ListMetrics(t.Context(), "missing", MetricQuery{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing %v", err)
	}
}
func TestRuleFailureIsolationDurableEpisodes(t *testing.T) {
	s, path := newStore(t)
	bad := metricRule("sum")
	bad.ID = "bad"
	good := metricRule("count")
	setupRules(t, s, bad, good)
	for i := range 2 {
		put(t, s, parsed(t, fmt.Sprint(i), ruleTime(10).Format(time.RFC3339), map[string]any{"data": map[string]any{"n": 1e308}}))
	}
	for range 3 {
		if err := s.EvaluateRules(t.Context(), ruleTime(12)); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("expected overflowing aggregate %v", err)
		}
	}
	if len(metricPage(t, s, good.ID, MetricQuery{}).Items) == 0 || len(metricPage(t, s, bad.ID, MetricQuery{}).Items) != 0 {
		t.Fatal("failure not isolated and atomic")
	}
	events, err := s.List(t.Context(), Query{Type: "signalhub.rule.eval.failed"})
	if err != nil || len(events.Items) != 1 {
		t.Fatalf("failure event %d %v", len(events.Items), err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err == nil {
		t.Fatal("failure disappeared")
	}
	events, _ = s.List(t.Context(), Query{Type: "signalhub.rule.eval.failed"})
	if len(events.Items) != 1 {
		t.Fatal("failure repeated after restart")
	}
	// Explicit narrow backfill succeeds and resets the failure episode; the old failing range is retried afterward.
	if err := s.BackfillRule(t.Context(), bad.ID, ruleTime(11).Format(time.RFC3339), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if err := s.EvaluateRules(t.Context(), ruleTime(12)); err == nil {
			t.Fatal("failure disappeared")
		}
	}
	events, _ = s.List(t.Context(), Query{Type: "signalhub.rule.eval.failed"})
	if len(events.Items) != 2 {
		t.Fatal("second failure episode missing")
	}
}
func TestAncientRangeAndCanceledEvaluationDoNotWrite(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	r.Bucket = "5m"
	setupRules(t, s, r)
	put(t, s, parsed(t, "ancient", "0001-01-01T00:00:00Z", nil))
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("range guard %v", err)
	}
	if len(metricPage(t, s, r.ID, MetricQuery{}).Items) != 0 {
		t.Fatal("guard partially wrote")
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if err := s.EvaluateRules(canceled, ruleTime(12)); err == nil {
		t.Fatal("canceled evaluation succeeded")
	}
	if err := s.BackfillRule(t.Context(), r.ID, ruleTime(11).Format(time.RFC3339), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
}

func TestVersionRetainsHistoryOutsideRecomputableInterval(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	setupRules(t, s, r)
	put(t, s, parsed(t, "hot", ruleTime(10).Format(time.RFC3339), nil))
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	// A retained rollup simulates history whose original events were archived.
	if _, err := s.db.Exec(`INSERT INTO rollups(rule_id,rule_version,bucket_start,bucket_key,group_key,value,sample_count,partial,computed_at) VALUES(?,?,?,?,?,4,4,0,?)`, r.ID, 1, ruleTime(9).Format(time.RFC3339), timeKey(ruleTime(9)), "[]", ruleTime(12).Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	r.Version = 2
	setupRules(t, s, r)
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{})
	if len(p.Items) != 4 || p.Items[0].RuleVersion != 1 || p.Items[1].RuleVersion != 2 {
		t.Fatalf("version boundary %+v", p.Items)
	}
}
func TestMetricAncientDatesOrderingAndOffsetBounds(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	setupRules(t, s, r)
	ancient := time.Date(999, 12, 31, 22, 0, 0, 0, time.UTC)
	put(t, s, parsed(t, "ancient", ancient.Format(time.RFC3339), nil))
	if err := s.EvaluateRules(t.Context(), ancient.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{From: "0999-12-31T23:00:00+01:00", To: "1000-01-01T02:00:00+01:00", Limit: 2})
	if len(p.Items) != 2 || p.Items[0].BucketStart != "0999-12-31T22:00:00Z" || p.NextCursor == nil {
		t.Fatalf("ancient page %+v", p)
	}
	p = metricPage(t, s, r.ID, MetricQuery{From: "0999-12-31T23:00:00+01:00", To: "1000-01-01T02:00:00+01:00", Cursor: *p.NextCursor})
	if len(p.Items) != 1 || p.Items[0].BucketStart != "1000-01-01T00:00:00Z" {
		t.Fatalf("ancient next %+v", p)
	}
}
func TestThresholdNullPartialAndMissingGroup(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("avg")
	r.GroupBy = []string{"data.group"}
	r.Threshold = &rules.Threshold{Op: ">", Value: 0, ForBuckets: 1, Severity: "notice"}
	setupRules(t, s, r)
	put(t, s, parsed(t, "missing-group", ruleTime(10).Format(time.RFC3339), map[string]any{"data": map[string]any{"n": 2}}))
	if err := s.EvaluateRules(t.Context(), ruleTime(10).Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	p, _ := s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if len(p.Items) != 0 {
		t.Fatal("partial bucket emitted threshold")
	}
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	p, _ = s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if len(p.Items) != 2 {
		t.Fatalf("null group crossed/recovered %+v", p)
	}
	metric := metricPage(t, s, r.ID, MetricQuery{From: ruleTime(11).Format(time.RFC3339)})
	if metric.Items[0].GroupKey != "[null]" || metric.Items[0].Value != nil {
		t.Fatal("null group or empty aggregate lost")
	}
}

func TestRuntimeAuditFailureRollsBackSourcesAndRules(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	source := config.Source{Name: "producer", SourcePrefix: "urn:before:", AllowedTypes: []string{"test.event"}}
	if err := s.ConfigureRuntime(t.Context(), []config.Source{source}, []rules.Rule{r}, ruleTime(10), false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER fail_config_audit BEFORE INSERT ON config_audit BEGIN SELECT RAISE(ABORT,'synthetic unavailable audit'); END;`); err != nil {
		t.Fatal(err)
	}
	source.SourcePrefix = "urn:after:"
	r.Version = 2
	if err := s.ConfigureRuntime(t.Context(), []config.Source{source}, []rules.Rule{r}, ruleTime(12), true); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected unavailable audit: %v", err)
	}
	defs, err := s.ActiveRules(t.Context())
	if err != nil || len(defs) != 1 || defs[0].Version != 1 {
		t.Fatalf("partial rules %+v %v", defs, err)
	}
	sources, err := s.ListSources(t.Context(), SourceQuery{}, ruleTime(12))
	if err != nil || sources.Items[0].SourcePrefix != "urn:before:" {
		t.Fatalf("partial sources %+v %v", sources, err)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM rule_definitions WHERE version=2").Scan(&count); err != nil || count != 0 {
		t.Fatalf("uncommitted version retained %d %v", count, err)
	}
	if _, err := s.db.Exec("DROP TRIGGER fail_config_audit"); err != nil {
		t.Fatal(err)
	}
	if err := s.ConfigureRuntime(t.Context(), []config.Source{source}, []rules.Rule{r}, ruleTime(12), true); err != nil {
		t.Fatal(err)
	}
	events, err := s.List(t.Context(), Query{Type: "signalhub.config.reloaded"})
	if err != nil || len(events.Items) != 1 {
		t.Fatalf("successful reload event %d %v", len(events.Items), err)
	}
}
func TestMalformedMetricsCursorAndThresholdIdentity(t *testing.T) {
	s, _ := newStore(t)
	r := thresholdRule()
	setupRules(t, s, r)
	for _, hour := range []int{8, 9} {
		put(t, s, parsed(t, fmt.Sprint(hour), ruleTime(hour).Format(time.RFC3339), map[string]any{"subject": "job"}))
	}
	if err := s.EvaluateRules(t.Context(), ruleTime(10)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{Limit: 1})
	raw, err := base64.RawURLEncoding.DecodeString(*p.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{string(raw) + "{}", strings.Replace(string(raw), `"v":1`, `"v":1,"v":1`, 1), strings.Replace(string(raw), `"v":1`, `"v":1,"unknown":true`, 1)} {
		cursor := base64.RawURLEncoding.EncodeToString([]byte(bad))
		if _, err := s.ListMetrics(t.Context(), r.ID, MetricQuery{Cursor: cursor}); !errors.Is(err, ErrInvalidQuery) {
			t.Fatalf("malformed cursor accepted %s %v", bad, err)
		}
	}
	var unknown map[string]any
	if err := json.Unmarshal(raw, &unknown); err != nil {
		t.Fatal(err)
	}
	unknown["g"] = strings.Repeat("0", 64)
	unknownRaw, err := json.Marshal(unknown)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ListMetrics(t.Context(), r.ID, MetricQuery{Cursor: base64.RawURLEncoding.EncodeToString(unknownRaw)}); !errors.Is(err, ErrInvalidQuery) {
		t.Fatalf("unknown cursor position accepted: %v", err)
	}
	events, err := s.List(t.Context(), Query{Type: "signalhub.rule.threshold.crossed"})
	if err != nil || len(events.Items) != 1 {
		t.Fatalf("threshold event %v %v", events, err)
	}
	var fields map[string]any
	if err := json.Unmarshal(events.Items[0].Event, &fields); err != nil {
		t.Fatal(err)
	}
	canonical := `["count",1,"[\"job\"]","2026-10-03T09:00:00Z","crossed"]`
	hash := sha256.Sum256([]byte(canonical))
	if fields["id"] != "rule:"+hex.EncodeToString(hash[:]) {
		t.Fatalf("stable threshold id %s", fields["id"])
	}
	var conflicts int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM ingest_conflicts").Scan(&conflicts); err != nil || conflicts != 0 {
		t.Fatalf("internal duplicate conflict %d %v", conflicts, err)
	}
}

func TestLargeGroupThresholdAndCompactCursor(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	r.GroupBy = []string{"data.group"}
	r.Threshold = &rules.Threshold{Op: ">", Value: 0, ForBuckets: 1, Severity: "warning"}
	setupRules(t, s, r)
	large := strings.Repeat(`"`, 8100)
	put(t, s, parsed(t, "large-group", ruleTime(10).Format(time.RFC3339), map[string]any{"data": map[string]any{"group": large}}))
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{Limit: 1})
	if p.NextCursor == nil || len(*p.NextCursor) > 1024 {
		t.Fatalf("cursor length %d", len(*p.NextCursor))
	}
	next := metricPage(t, s, r.ID, MetricQuery{Cursor: *p.NextCursor})
	if len(next.Items) != 2 {
		t.Fatal("large group pagination")
	}
	events, err := s.List(t.Context(), Query{Type: "signalhub.rule.threshold.crossed"})
	if err != nil || len(events.Items) != 1 {
		t.Fatalf("threshold events %d %v", len(events.Items), err)
	}
	var e struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(events.Items[0].Event, &e); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(p.Items[0].GroupKey))
	if e.Data["group_key_sha256"] != hex.EncodeToString(hash[:]) {
		t.Fatal("missing canonical group digest")
	}
	if _, exists := e.Data["group_key"]; exists {
		t.Fatal("large raw key repeated in event")
	}
}
func TestEvaluationCatchesUpAfterRestart(t *testing.T) {
	s, path := newStore(t)
	r := metricRule("count")
	setupRules(t, s, r)
	put(t, s, parsed(t, "before-restart", ruleTime(10).Format(time.RFC3339), nil))
	if err := s.EvaluateRules(t.Context(), ruleTime(10).Add(30*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.EvaluateRules(t.Context(), ruleTime(14)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{})
	if len(p.Items) != 5 {
		t.Fatalf("missed downtime buckets: %+v", p.Items)
	}
	for _, item := range p.Items[:4] {
		if item.Partial {
			t.Fatalf("past bucket permanently partial: %+v", item)
		}
	}
}

func TestEvictedGroupsRecoverWithoutIncreasingRollupCap(t *testing.T) {
	s, path := newStore(t)
	r := metricRule("count")
	r.GroupBy = []string{"subject"}
	r.Threshold = &rules.Threshold{Op: ">=", Value: 1, ForBuckets: 1, Severity: "warning"}
	setupRules(t, s, r)
	for i := range 200 {
		put(t, s, parsed(t, fmt.Sprintf("old-%03d", i), ruleTime(10).Format(time.RFC3339), map[string]any{"subject": fmt.Sprintf("old-%03d", i)}))
	}
	if err := s.EvaluateRules(t.Context(), ruleTime(11)); err != nil {
		t.Fatal(err)
	}
	put(t, s, parsed(t, "new", ruleTime(11).Format(time.RFC3339), map[string]any{"subject": "aaa-new"}))
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	var recovered int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM events WHERE type='signalhub.rule.threshold.recovered'").Scan(&recovered); err != nil || recovered != 200 {
		t.Fatalf("recovered old groups=%d want200 err=%v", recovered, err)
	}
	var rowCount int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM rollups WHERE rule_id=? AND bucket_key=?", r.ID, timeKey(ruleTime(11))).Scan(&rowCount); err != nil || rowCount != 200 {
		t.Fatalf("rollup cap %d %v", rowCount, err)
	}
	expectedID, err := stableRuleID([]any{r.ID, r.Version, `["old-199"]`, ruleTime(11).Format(time.RFC3339), "recovered"})
	if err != nil {
		t.Fatal(err)
	}
	var original []byte
	if err := s.db.QueryRow("SELECT raw_json FROM events WHERE source=? AND id=?", "urn:signalhub:rules:"+r.ID, expectedID).Scan(&original); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	var after []byte
	if err := s.db.QueryRow("SELECT raw_json FROM events WHERE source=? AND id=?", "urn:signalhub:rules:"+r.ID, expectedID).Scan(&after); err != nil || !reflect.DeepEqual(original, after) {
		t.Fatalf("recovery replay changed payload %v", err)
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM events WHERE type='signalhub.rule.threshold.recovered'").Scan(&recovered); err != nil || recovered != 200 {
		t.Fatalf("restart duplicated recovery %d %v", recovered, err)
	}
}
func TestRetainedGroupUnionConservesOverflowCount(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	r.GroupBy = []string{"subject"}
	setupRules(t, s, r)
	for i := range 200 {
		put(t, s, parsed(t, fmt.Sprintf("old-%03d", i), ruleTime(10).Format(time.RFC3339), map[string]any{"subject": fmt.Sprintf("old-%03d", i)}))
	}
	if err := s.EvaluateRules(t.Context(), ruleTime(11)); err != nil {
		t.Fatal(err)
	}
	put(t, s, parsed(t, "new", ruleTime(11).Format(time.RFC3339), map[string]any{"subject": "zzz-new"}))
	if err := s.EvaluateRules(t.Context(), ruleTime(12)); err != nil {
		t.Fatal(err)
	}
	p := metricPage(t, s, r.ID, MetricQuery{From: ruleTime(11).Format(time.RFC3339), To: ruleTime(12).Format(time.RFC3339), Limit: 200})
	if len(p.Items) != 200 {
		t.Fatalf("rows %d", len(p.Items))
	}
	for _, v := range p.Items[:199] {
		if v.Value == nil || *v.Value != 0 || v.SampleCount != 0 {
			t.Fatalf("retained group not empty %+v", v)
		}
	}
	overflow := p.Items[199]
	if overflow.GroupKey != "__other__" || overflow.Value == nil || *overflow.Value != 1 || overflow.SampleCount != 1 {
		t.Fatalf("overflow loses count %+v", overflow)
	}
}

func seedThresholdRows(t *testing.T, s *Store, r rules.Rule, values map[int]float64) {
	t.Helper()
	for hour, value := range values {
		if _, err := s.db.Exec(`INSERT INTO rollups(rule_id,rule_version,bucket_start,bucket_key,group_key,value,sample_count,partial,computed_at) VALUES(?,?,?,?,?,?,1,0,?)`, r.ID, r.Version, ruleTime(hour).Format(time.RFC3339), timeKey(ruleTime(hour)), `["job"]`, value, ruleTime(16).Format(time.RFC3339)); err != nil {
			t.Fatal(err)
		}
	}
}
func replayStoredThresholds(t *testing.T, s *Store, r rules.Rule, now time.Time) {
	t.Helper()
	tx, err := s.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := replayThresholds(t.Context(), tx, r, now); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
func TestThresholdMissingRunReentryAndRestart(t *testing.T) {
	s, path := newStore(t)
	r := thresholdRule()
	setupRules(t, s, r)
	// These retained rows model a group leaving/re-entering a recomputed cap.
	// Missing10 only partially recovers; its true reentry11 resets that streak.
	// Explicit false12 plus missing13 recover; true14+15 then cross again.
	seedThresholdRows(t, s, r, map[int]float64{8: 1, 9: 1, 11: 1, 12: 0, 14: 1, 15: 1})
	replayStoredThresholds(t, s, r, ruleTime(16))
	events, err := s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if err != nil || len(events.Items) != 3 {
		t.Fatalf("gap transitions %d %v", len(events.Items), err)
	}
	recoveryID, err := stableRuleID([]any{r.ID, r.Version, `["job"]`, ruleTime(13).Format(time.RFC3339), "recovered"})
	if err != nil {
		t.Fatal(err)
	}
	var recoveryTime string
	if err := s.db.QueryRow("SELECT json_extract(raw_json,'$.time') FROM events WHERE id=?", recoveryID).Scan(&recoveryTime); err != nil || recoveryTime != ruleTime(14).Format(time.RFC3339) {
		t.Fatalf("recovery bucket/time %s %v", recoveryTime, err)
	}
	replayStoredThresholds(t, s, r, ruleTime(17))
	var crossed bool
	var streak int
	if err := s.db.QueryRow("SELECT crossed,streak FROM threshold_state WHERE rule_id=?", r.ID).Scan(&crossed, &streak); err != nil || !crossed || streak != 1 {
		t.Fatalf("partial recovery streak %v %d %v", crossed, streak, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for range 2 {
		replayStoredThresholds(t, s, r, ruleTime(18))
	}
	events, err = s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if err != nil || len(events.Items) != 4 {
		t.Fatalf("restart recovery %d %v", len(events.Items), err)
	}
	if err := s.db.QueryRow("SELECT crossed,streak FROM threshold_state WHERE rule_id=?", r.ID).Scan(&crossed, &streak); err != nil || crossed || streak != 0 {
		t.Fatalf("final recovered state %v %d %v", crossed, streak, err)
	}
}
func TestThresholdMissingBucketsNeverSatisfyPredicate(t *testing.T) {
	for _, fn := range []string{"count", "count_distinct", "sum", "min", "max", "avg"} {
		t.Run(fn, func(t *testing.T) {
			s, _ := newStore(t)
			r := metricRule(fn)
			r.ID = "empty"
			r.GroupBy = []string{"subject"}
			r.Threshold = &rules.Threshold{Op: ">=", Value: 0, ForBuckets: 2, Severity: "info"}
			setupRules(t, s, r)
			seedThresholdRows(t, s, r, map[int]float64{8: 1, 9: 1})
			replayStoredThresholds(t, s, r, ruleTime(12))
			var crossed bool
			if err := s.db.QueryRow("SELECT crossed FROM threshold_state WHERE rule_id=?", r.ID).Scan(&crossed); err != nil {
				t.Fatal(err)
			}
			if crossed {
				t.Fatalf("%s empty threshold crossed=%v", fn, crossed)
			}
		})
	}
}

func TestMissingGroupNeverSatisfiesZeroThreshold(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("count")
	r.GroupBy = []string{"subject"}
	r.Threshold = &rules.Threshold{Op: "<=", Value: 0, ForBuckets: 1, Severity: "info"}
	setupRules(t, s, r)
	seedThresholdRows(t, s, r, map[int]float64{8: 1})
	replayStoredThresholds(t, s, r, ruleTime(12))
	events, err := s.List(t.Context(), Query{Type: "signalhub.rule.threshold.*"})
	if err != nil || len(events.Items) != 0 {
		t.Fatalf("missing row satisfied <=0: %d transitions, %v", len(events.Items), err)
	}
	// A present empty count row is an explicit zero and can satisfy <=0.
	seedThresholdRows(t, s, r, map[int]float64{12: 0})
	replayStoredThresholds(t, s, r, ruleTime(13))
	events, err = s.List(t.Context(), Query{Type: "signalhub.rule.threshold.crossed"})
	if err != nil || len(events.Items) != 1 {
		t.Fatalf("present zero did not satisfy <=0: %d %v", len(events.Items), err)
	}
}

func TestThresholdLongMissingRunHasStableRecoveryTime(t *testing.T) {
	s, _ := newStore(t)
	r := thresholdRule()
	setupRules(t, s, r)
	ancient := time.Date(1000, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range 2 {
		at := ancient.Add(time.Duration(i) * time.Hour)
		if _, err := s.db.Exec(`INSERT INTO rollups(rule_id,rule_version,bucket_start,bucket_key,group_key,value,sample_count,partial,computed_at) VALUES(?,?,?,?,?,1,1,0,?)`, r.ID, r.Version, at.Format(time.RFC3339), timeKey(at), `["job"]`, ruleTime(12).Format(time.RFC3339)); err != nil {
			t.Fatal(err)
		}
	}
	replayStoredThresholds(t, s, r, ruleTime(12))
	recoveryID, err := stableRuleID([]any{r.ID, r.Version, `["job"]`, ancient.Add(3 * time.Hour).Format(time.RFC3339), "recovered"})
	if err != nil {
		t.Fatal(err)
	}
	var at, valueType string
	if err := s.db.QueryRow("SELECT json_extract(raw_json,'$.time'),json_type(raw_json,'$.data.value') FROM events WHERE id=?", recoveryID).Scan(&at, &valueType); err != nil || at != ancient.Add(4*time.Hour).Format(time.RFC3339) || valueType != "null" {
		t.Fatalf("long gap recovery %s value=%s err=%v", at, valueType, err)
	}
}
