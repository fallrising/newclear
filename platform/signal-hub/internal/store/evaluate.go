package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
)

// MaxEvaluationBuckets is an operational guard, never a silent truncation.
const MaxEvaluationBuckets = 1_000_000

func (s *Store) EvaluateRules(ctx context.Context, now time.Time) error {
	definitions, err := s.ActiveRules(ctx)
	if err != nil {
		return err
	}
	var failures []error
	for _, r := range definitions {
		if err := s.evaluateRule(ctx, r, "", now); err != nil {
			failures = append(failures, fmt.Errorf("rule %s: %w", r.ID, err))
			if recordErr := s.recordRuleFailure(ctx, r, now); recordErr != nil {
				failures = append(failures, recordErr)
			}
		}
	}
	return errors.Join(failures...)
}
func (s *Store) BackfillRule(ctx context.Context, id, from string, now time.Time) error {
	if _, err := event.ParseTime(from); err != nil {
		return invalid("backfill from must be RFC3339")
	}
	definitions, err := s.ActiveRules(ctx)
	if err != nil {
		return err
	}
	for _, r := range definitions {
		if r.ID == id {
			return s.evaluateRule(ctx, r, from, now)
		}
	}
	return ErrNotFound
}
func (s *Store) evaluateRule(ctx context.Context, r rules.Rule, manual string, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	var backfill bool
	var version int
	var lastComputed *string
	err = tx.QueryRowContext(ctx, "SELECT version,needs_backfill,last_computed_at FROM rules_state WHERE rule_id=? AND active=1", r.ID).Scan(&version, &backfill, &lastComputed)
	if err != nil {
		return unavailable(err)
	}
	if version != r.Version {
		return unavailable(errors.New("rule activation changed"))
	}
	current := r.Start(now)
	start := maxTime(current.Add(-2*r.Duration()), current.Add(-24*time.Hour))
	// Complete the last partial bucket and every missed bucket after downtime.
	if lastComputed != nil {
		previous, err := event.ParseTime(*lastComputed)
		if err != nil {
			return unavailable(err)
		}
		if previous = r.Start(previous); previous.Before(start) {
			start = previous
		}
	}
	if manual != "" {
		t, _ := event.ParseTime(manual)
		if t.After(now) {
			return invalid("backfill from must not be after now")
		}
		start = r.Start(t)
	} else if backfill {
		var raw []byte
		err := tx.QueryRowContext(ctx, "SELECT raw_json FROM events ORDER BY time,seq LIMIT 1").Scan(&raw)
		if err == nil {
			var item struct {
				Time string `json:"time"`
			}
			if err := json.Unmarshal(raw, &item); err != nil {
				return unavailable(err)
			}
			at, err := event.ParseTime(item.Time)
			if err != nil {
				return unavailable(err)
			}
			start = r.Start(at)
			if start.After(current) {
				start = current
			}
		} else if errors.Is(err, sql.ErrNoRows) {
			start = current
		} else {
			return unavailable(err)
		}
	}
	// Unix seconds cover the complete supported civil range; Duration subtraction would overflow.
	count := (current.Unix()-start.Unix())/int64(r.Duration()/time.Second) + 1
	if count < 1 || count > MaxEvaluationBuckets {
		return unavailable(fmt.Errorf("evaluation exceeds %d buckets; choose a narrower backfill interval", MaxEvaluationBuckets))
	}
	if err := ctx.Err(); err != nil {
		return unavailable(err)
	}
	// Missing archived inputs cannot be interpreted as zeroes. In particular,
	// manual backfill and changed versions must not erase retained old rollups.
	var missing bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM event_identities i WHERE i.time>=? AND i.time<? AND NOT EXISTS(SELECT 1 FROM events e WHERE e.seq=i.seq))`, timeKey(start), timeKey(current.Add(r.Duration()))).Scan(&missing); err != nil {
		return unavailable(err)
	}
	if missing {
		return unavailable(errors.New("import archived history before recomputation"))
	}
	// Disk-backed scratch stores values/distinct keys; Go memory is bounded to one event and 200 groups.
	if _, err := tx.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS metric_input(group_key TEXT NOT NULL,value_text TEXT,number REAL);
 CREATE TEMP TABLE IF NOT EXISTS metric_groups(group_key TEXT PRIMARY KEY);
 CREATE TEMP TABLE IF NOT EXISTS metric_selected(group_key TEXT PRIMARY KEY);
 DELETE FROM metric_groups; DELETE FROM metric_input; DELETE FROM metric_selected;`); err != nil {
		return unavailable(err)
	}
	previous := []string{}
	if len(r.GroupBy) == 0 {
		previous = []string{"[]"}
	} else {
		rows, err := tx.QueryContext(ctx, `SELECT group_key FROM rollups WHERE rule_id=? AND rule_version=? AND bucket_key=(SELECT MAX(bucket_key) FROM rollups WHERE rule_id=? AND rule_version=? AND bucket_key<?) ORDER BY group_key LIMIT 200`, r.ID, r.Version, r.ID, r.Version, timeKey(start))
		if err != nil {
			return unavailable(err)
		}
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				rows.Close()
				return unavailable(err)
			}
			previous = append(previous, key)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return unavailable(err)
		}
	}
	if backfill || manual != "" {
		if _, err := tx.ExecContext(ctx, "DELETE FROM rollups WHERE rule_id=? AND rule_version<>? AND bucket_key>=? AND bucket_key<=?", r.ID, r.Version, timeKey(start), timeKey(current)); err != nil {
			return unavailable(err)
		}
	}
	for bucket := start; !bucket.After(current); bucket = bucket.Add(r.Duration()) {
		if err := ctx.Err(); err != nil {
			return unavailable(err)
		}
		previous, err = computeBucket(ctx, tx, r, bucket, now, previous)
		if err != nil {
			return err
		}
	}
	if r.Threshold != nil {
		if err := replayThresholds(ctx, tx, r, now); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE rules_state SET needs_backfill=0,failures=0,failure_emitted=0,last_computed_at=? WHERE rule_id=?", now.UTC().Format(time.RFC3339Nano), r.ID); err != nil {
		return unavailable(err)
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}
func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
func computeBucket(ctx context.Context, tx *sql.Tx, r rules.Rule, bucket, now time.Time, previous []string) ([]string, error) {
	if _, err := tx.ExecContext(ctx, "DELETE FROM metric_input; DELETE FROM metric_groups; DELETE FROM metric_selected;"); err != nil {
		return nil, unavailable(err)
	}
	groupStmt, err := tx.PrepareContext(ctx, "INSERT OR IGNORE INTO metric_groups(group_key) VALUES(?)")
	if err != nil {
		return nil, unavailable(err)
	}
	defer groupStmt.Close()
	for _, key := range previous {
		if _, err := groupStmt.ExecContext(ctx, key); err != nil {
			return nil, unavailable(err)
		}
	}
	inputStmt, err := tx.PrepareContext(ctx, "INSERT INTO metric_input(group_key,value_text,number) VALUES(?,?,?)")
	if err != nil {
		return nil, unavailable(err)
	}
	defer inputStmt.Close()
	end := bucket.Add(r.Duration())
	rows, err := tx.QueryContext(ctx, "SELECT raw_json FROM events WHERE time>=? AND time<? ORDER BY time,seq", timeKey(bucket), timeKey(end))
	if err != nil {
		return nil, unavailable(err)
	}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
		decoded, err := event.Decode(raw)
		if err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
		fields, ok := decoded.(map[string]any)
		if !ok {
			rows.Close()
			return nil, unavailable(errors.New("invalid stored event"))
		}
		if !r.Matches(fields) {
			continue
		}
		key, err := r.GroupKey(fields)
		if err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
		if _, err := groupStmt.ExecContext(ctx, key); err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
		var text any
		var number any
		if value, present := rules.Lookup(fields, r.Aggregation.Field); present {
			canonical, err := rules.Canonical(value)
			if err != nil {
				rows.Close()
				return nil, unavailable(err)
			}
			text = string(canonical)
			if n, ok := value.(json.Number); ok {
				f, err := n.Float64()
				if err != nil {
					rows.Close()
					return nil, unavailable(err)
				}
				number = f
			}
		}
		if _, err := inputStmt.ExecContext(ctx, key, text, number); err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, unavailable(err)
	}
	rows, err = tx.QueryContext(ctx, "SELECT group_key FROM metric_groups ORDER BY group_key LIMIT 201")
	if err != nil {
		return nil, unavailable(err)
	}
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, unavailable(err)
	}
	if len(keys) > 200 {
		keys = append(keys[:199], "__other__")
	}
	values := map[string]Rollup{}
	for _, key := range keys {
		item := Rollup{RuleVersion: r.Version, BucketStart: bucket.Format(time.RFC3339), GroupKey: key, Partial: end.After(now), ComputedAt: now.UTC().Format(time.RFC3339Nano)}
		if r.Aggregation.Fn == "count" || r.Aggregation.Fn == "count_distinct" || r.Aggregation.Fn == "sum" {
			item.Value = new(float64(0))
		}
		values[key] = item
		if _, err := tx.ExecContext(ctx, "INSERT INTO metric_selected(group_key) VALUES(?)", key); err != nil {
			return nil, unavailable(err)
		}
	}
	aggregate := map[string]string{"count": "COUNT(*)", "count_distinct": "COUNT(DISTINCT value_text)", "sum": "COALESCE(SUM(number),0)", "min": "MIN(number)", "max": "MAX(number)", "avg": "AVG(number)"}[r.Aggregation.Fn]
	samples := "COUNT(number)"
	if r.Aggregation.Fn == "count" {
		samples = "COUNT(*)"
	} else if r.Aggregation.Fn == "count_distinct" {
		samples = "COUNT(value_text)"
	}
	rows, err = tx.QueryContext(ctx, `WITH mapped AS (SELECT CASE WHEN group_key IN (SELECT group_key FROM metric_selected) THEN group_key ELSE '__other__' END AS g,value_text,number FROM metric_input) SELECT g,`+aggregate+","+samples+" FROM mapped GROUP BY g")
	if err != nil {
		return nil, unavailable(err)
	}
	for rows.Next() {
		var key string
		var value *float64
		var count int64
		if err := rows.Scan(&key, &value, &count); err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
		if value != nil && (math.IsInf(*value, 0) || math.IsNaN(*value)) {
			rows.Close()
			return nil, unavailable(errors.New("non-finite aggregate"))
		}
		item := values[key]
		item.Value = value
		item.SampleCount = count
		values[key] = item
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, unavailable(err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM rollups WHERE rule_id=? AND rule_version=? AND bucket_key=?", r.ID, r.Version, timeKey(bucket)); err != nil {
		return nil, unavailable(err)
	}
	for _, key := range keys {
		v := values[key]
		if _, err := tx.ExecContext(ctx, "INSERT INTO rollups(rule_id,rule_version,bucket_start,bucket_key,group_key,value,sample_count,partial,computed_at) VALUES(?,?,?,?,?,?,?,?,?)", r.ID, v.RuleVersion, v.BucketStart, timeKey(bucket), v.GroupKey, v.Value, v.SampleCount, v.Partial, v.ComputedAt); err != nil {
			return nil, unavailable(err)
		}
	}
	return keys, nil
}

// thresholdReplay reconstructs one group's state from retained complete buckets.
// Missing buckets have no value and never satisfy the predicate, unlike a
// materialized empty count/sum row with value zero. Runs need at most one
// transition, so historical gaps do not require one iteration per bucket.
type thresholdReplay struct {
	rule    rules.Rule
	group   string
	last    time.Time
	hasLast bool
	crossed bool
	streak  int64
}

func addRuleBuckets(start time.Time, count int64, duration time.Duration) time.Time {
	return time.Unix(start.Unix()+count*int64(duration/time.Second), 0).UTC()
}
func (state *thresholdReplay) consume(ctx context.Context, tx *sql.Tx, start time.Time, count int64, value *float64, now time.Time) error {
	if count <= 0 {
		return nil
	}
	satisfied := state.rule.Threshold.Satisfied(value)
	if satisfied == state.crossed {
		state.streak = 0
	} else {
		remaining := int64(state.rule.Threshold.ForBuckets) - state.streak
		if count < remaining {
			state.streak += count
		} else {
			at := addRuleBuckets(start, remaining-1, state.rule.Duration())
			state.crossed = satisfied
			state.streak = 0
			transition := "recovered"
			if state.crossed {
				transition = "crossed"
			}
			bucket := at.Format(time.RFC3339)
			id, err := stableRuleID([]any{state.rule.ID, state.rule.Version, state.group, bucket, transition})
			if err != nil {
				return unavailable(err)
			}
			fields := map[string]any{"source": "urn:signalhub:rules:" + state.rule.ID, "id": id, "type": "signalhub.rule.threshold." + transition, "subject": state.rule.ID, "time": at.Add(state.rule.Duration()).Format(time.RFC3339), "severity": state.rule.Threshold.Severity, "summary": "Rule " + state.rule.ID + " threshold " + transition, "data": thresholdData(state.rule, state.group, bucket, value, transition)}
			if err := internalEventTx(ctx, tx, fields, now, true); err != nil {
				return err
			}
		}
	}
	state.last = addRuleBuckets(start, count-1, state.rule.Duration())
	state.hasLast = true
	return nil
}
func (state *thresholdReplay) missingUntil(ctx context.Context, tx *sql.Tx, until, now time.Time) error {
	if !state.hasLast {
		return nil
	}
	start := state.last.Add(state.rule.Duration())
	count := (until.Unix() - start.Unix()) / int64(state.rule.Duration()/time.Second)
	return state.consume(ctx, tx, start, count, nil, now)
}
func replayThresholds(ctx context.Context, tx *sql.Tx, r rules.Rule, now time.Time) error {
	rows, err := tx.QueryContext(ctx, "SELECT group_key,bucket_start,value FROM rollups WHERE rule_id=? AND rule_version=? AND partial=0 ORDER BY group_key,bucket_key", r.ID, r.Version)
	if err != nil {
		return unavailable(err)
	}
	defer rows.Close()
	var state thresholdReplay
	save := func() error {
		if state.group == "" {
			return nil
		}
		if err := state.missingUntil(ctx, tx, r.Start(now), now); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO threshold_state(rule_id,rule_version,group_key,last_bucket,crossed,streak) VALUES(?,?,?,?,?,?) ON CONFLICT(rule_id,rule_version,group_key) DO UPDATE SET last_bucket=excluded.last_bucket,crossed=excluded.crossed,streak=excluded.streak`, r.ID, r.Version, state.group, state.last.Format(time.RFC3339), state.crossed, state.streak)
		if err != nil {
			return unavailable(err)
		}
		return nil
	}
	for rows.Next() {
		var key, start string
		var value *float64
		if err := rows.Scan(&key, &start, &value); err != nil {
			return unavailable(err)
		}
		at, err := event.ParseTime(start)
		if err != nil {
			return unavailable(err)
		}
		if key != state.group {
			if err := save(); err != nil {
				return err
			}
			state = thresholdReplay{rule: r, group: key}
		}
		if err := state.missingUntil(ctx, tx, at, now); err != nil {
			return err
		}
		if err := state.consume(ctx, tx, at, 1, value, now); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return unavailable(err)
	}
	return save()
}
func (s *Store) recordRuleFailure(ctx context.Context, r rules.Rule, now time.Time) error {
	if ctx.Err() != nil {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	var count, episode int64
	var emitted bool
	if err := tx.QueryRowContext(ctx, "SELECT failures,failure_episode,failure_emitted FROM rules_state WHERE rule_id=? AND version=?", r.ID, r.Version).Scan(&count, &episode, &emitted); err != nil {
		return unavailable(err)
	}
	if count == 0 {
		episode++
	}
	count = min(count+1, 3)
	if count == 3 && !emitted {
		id, err := stableRuleID([]any{r.ID, r.Version, "failure", episode})
		if err != nil {
			return unavailable(err)
		}
		if err := internalEventTx(ctx, tx, map[string]any{"source": "urn:signalhub:rules:" + r.ID, "id": id, "type": "signalhub.rule.eval.failed", "time": now.UTC().Format(time.RFC3339Nano), "subject": r.ID, "severity": "error", "summary": "Rule evaluation failed repeatedly", "data": map[string]any{"rule_id": r.ID, "rule_version": r.Version}}, now, true); err != nil {
			return err
		}
		emitted = true
	}
	if _, err := tx.ExecContext(ctx, "UPDATE rules_state SET failures=?,failure_episode=?,failure_emitted=? WHERE rule_id=?", count, episode, emitted, r.ID); err != nil {
		return unavailable(err)
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}

// Full group keys stay in rollups and identity hashing. Bound event payload
// expansion independently so all valid input group values remain evaluable.
func thresholdData(r rules.Rule, key, start string, value *float64, state string) map[string]any {
	data := map[string]any{"rule_id": r.ID, "rule_version": r.Version, "group_key_sha256": groupDigest(key), "bucket_start": start, "value": value, "state": state}
	if len(key) <= 1024 {
		data["group_key"] = key
	}
	return data
}
