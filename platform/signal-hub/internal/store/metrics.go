package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

type MetricQuery struct {
	From, To, Group, Cursor string
	Limit                   int
}
type Rollup struct {
	RuleVersion int      `json:"rule_version"`
	BucketStart string   `json:"bucket_start"`
	GroupKey    string   `json:"group_key"`
	Value       *float64 `json:"value"`
	SampleCount int64    `json:"sample_count"`
	Partial     bool     `json:"partial"`
	ComputedAt  string   `json:"computed_at"`
}
type MetricPage struct {
	RuleID           string   `json:"rule_id"`
	RecomputableFrom *string  `json:"recomputable_from"`
	LastComputedAt   *string  `json:"last_computed_at"`
	Items            []Rollup `json:"items"`
	NextCursor       *string  `json:"next_cursor"`
}
type metricCursor struct {
	Version     int    `json:"v"`
	Fingerprint string `json:"f"`
	Bucket      string `json:"b"`
	RuleVersion int    `json:"r"`
	Group       string `json:"g"`
}

func (s *Store) ListMetrics(ctx context.Context, id string, q MetricQuery) (MetricPage, error) {
	page := MetricPage{RuleID: id, Items: []Rollup{}}
	if q.Limit == 0 {
		q.Limit = 100
	}
	if q.Limit < 1 || q.Limit > 200 {
		return page, invalid("limit must be 1–200")
	}
	if !utf8.ValidString(id) || !utf8.ValidString(q.Group) {
		return page, invalid("invalid UTF-8")
	}
	for _, p := range []*string{&q.From, &q.To} {
		if *p != "" {
			key, err := exactTimeKey(*p)
			if err != nil {
				return page, invalid("time bounds must be RFC3339")
			}
			*p = key
		}
	}
	if q.From != "" && q.To != "" && q.From >= q.To {
		return page, invalid("from must precede to")
	}
	fingerprint := hashJSON([]string{id, q.From, q.To, q.Group})
	var position metricCursor
	if q.Cursor != "" {
		// The selector hashes its group key, keeping cursors bounded for large groups.
		if len(q.Cursor) > 4096 {
			return page, invalid("cursor too long")
		}
		raw, err := base64.RawURLEncoding.Strict().DecodeString(q.Cursor)
		if err != nil {
			return page, invalid("malformed cursor")
		}
		if _, err := event.Decode(raw); err != nil {
			return page, invalid("malformed cursor")
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&position); err != nil {
			return page, invalid("malformed cursor")
		}
		if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
			return page, invalid("malformed cursor")
		}
		if position.Version != 1 || position.Fingerprint != fingerprint || !validTimeKey(position.Bucket) || position.RuleVersion < 1 || len(position.Group) != 64 {
			return page, invalid("cursor does not match query or position")
		}
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return page, unavailable(err)
	}
	defer tx.Rollback()
	if err := tx.QueryRowContext(ctx, "SELECT last_computed_at FROM rules_state WHERE rule_id=?", id).Scan(&page.LastComputedAt); errors.Is(err, sql.ErrNoRows) {
		return page, ErrNotFound
	} else if err != nil {
		return page, unavailable(err)
	}
	var first []byte
	err = tx.QueryRowContext(ctx, "SELECT raw_json FROM events ORDER BY time,seq LIMIT 1").Scan(&first)
	if err == nil {
		var e struct {
			Time string `json:"time"`
		}
		if err := json.Unmarshal(first, &e); err != nil {
			return page, unavailable(err)
		}
		page.RecomputableFrom = &e.Time
	} else if !errors.Is(err, sql.ErrNoRows) {
		return page, unavailable(err)
	}
	clauses := []string{"rule_id=?"}
	args := []any{id}
	for _, v := range []struct{ sql, value string }{{"bucket_key>=?", q.From}, {"bucket_key<?", q.To}, {"group_key=?", q.Group}} {
		if v.value != "" {
			clauses = append(clauses, v.sql)
			args = append(args, v.value)
		}
	}
	if q.Cursor != "" {
		// Resolve a stable logical position, not a rowid changed by recomputation.
		rows, err := tx.QueryContext(ctx, "SELECT group_key FROM rollups WHERE rule_id=? AND bucket_key=? AND rule_version=?", id, position.Bucket, position.RuleVersion)
		if err != nil {
			return page, unavailable(err)
		}
		actual := ""
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				rows.Close()
				return page, unavailable(err)
			}
			if groupDigest(key) == position.Group {
				actual = key
				break
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return page, unavailable(err)
		}
		if actual == "" {
			return page, invalid("cursor position no longer exists")
		}
		clauses = append(clauses, "(bucket_key,rule_version,group_key)>(?,?,?)")
		args = append(args, position.Bucket, position.RuleVersion, actual)
	}
	args = append(args, q.Limit+1)
	rows, err := tx.QueryContext(ctx, "SELECT rule_version,bucket_start,bucket_key,group_key,value,sample_count,partial,computed_at FROM rollups WHERE "+strings.Join(clauses, " AND ")+" ORDER BY bucket_key,rule_version,group_key LIMIT ?", args...)
	if err != nil {
		return page, unavailable(err)
	}
	defer rows.Close()
	var last metricCursor
	for rows.Next() {
		var item Rollup
		var key string
		if err := rows.Scan(&item.RuleVersion, &item.BucketStart, &key, &item.GroupKey, &item.Value, &item.SampleCount, &item.Partial, &item.ComputedAt); err != nil {
			return page, unavailable(err)
		}
		if len(page.Items) == q.Limit {
			raw, _ := json.Marshal(last)
			page.NextCursor = new(base64.RawURLEncoding.EncodeToString(raw))
			break
		}
		page.Items = append(page.Items, item)
		last = metricCursor{Version: 1, Fingerprint: fingerprint, Bucket: key, RuleVersion: item.RuleVersion, Group: groupDigest(item.GroupKey)}
	}
	if err := rows.Err(); err != nil {
		return page, unavailable(err)
	}
	return page, nil
}
