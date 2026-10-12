package store

import (
	"fmt"
	"runtime"
	"testing"
	"time"
)

// The fixed dataset models 1,000 events/day for 90 days. There is deliberately
// no wall-clock pass threshold; CI hardware differs and correctness is the gate.
func TestRuleBackfill90K(t *testing.T) {
	s, _ := newStore(t)
	r := metricRule("sum")
	r.GroupBy = []string{"subject"}
	setupRules(t, s, r)
	start := ruleTime(0).AddDate(0, 0, -90)
	now := ruleTime(0)
	tx, err := s.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for i := range 90_000 {
		at := start.Add(time.Duration(i) * 86400 * time.Second / 1000)
		e := parsed(t, fmt.Sprintf("perf-%d", i), at.Format(time.RFC3339Nano), map[string]any{"subject": fmt.Sprintf("group-%d", i%4), "data": map[string]any{"n": 1}})
		if _, err := ingestTx(t.Context(), tx, e, now); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	began := time.Now()
	if err := s.EvaluateRules(t.Context(), now); err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(began)
	runtime.ReadMemStats(&after)
	var total, samples float64
	var rows int
	if err := s.db.QueryRow("SELECT COALESCE(SUM(value),0),SUM(sample_count),COUNT(*) FROM rollups WHERE rule_id=?", r.ID).Scan(&total, &samples, &rows); err != nil {
		t.Fatal(err)
	}
	if total != 90_000 || samples != 90_000 || rows != 2161*4 {
		t.Fatalf("backfill total %f samples %f rows %d", total, samples, rows)
	}
	t.Logf("90K events / 90 days / 1h / 4 groups: backfill=%s rows=%d total_alloc_bytes=%d heap_before=%d heap_after=%d (heap samples, not peak)", elapsed, rows, after.TotalAlloc-before.TotalAlloc, before.HeapAlloc, after.HeapAlloc)
}
