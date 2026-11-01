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
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

type DeliveryCounts struct {
	Pending   int64 `json:"pending"`
	Inflight  int64 `json:"inflight"`
	Succeeded int64 `json:"succeeded"`
	DLQ       int64 `json:"dlq"`
}
type SubscriptionStatus struct {
	ID          string         `json:"id"`
	Mode        string         `json:"mode"`
	ChannelKind string         `json:"channel_kind"`
	Counts      DeliveryCounts `json:"counts"`
}
type SubscriptionPage struct {
	Items      []SubscriptionStatus `json:"items"`
	NextCursor *string              `json:"next_cursor"`
}
type subscriptionState struct {
	definition       delivery.Subscription
	hash             string
	activation, scan int64
	digestStart      *int64
}

func configureSubscriptionsTx(ctx context.Context, tx *sql.Tx, definitions []delivery.Subscription, now time.Time) error {
	raw := make([]json.RawMessage, len(definitions))
	allowlist := []string{}
	seenURL := map[string]bool{}
	for i, sub := range definitions {
		if sub.Start == "" {
			sub.Start = "now"
		}
		encoded, err := json.Marshal(sub)
		if err != nil {
			return ErrInvalidConfig
		}
		raw[i] = encoded
		if !seenURL[sub.Channel.URL] {
			allowlist = append(allowlist, sub.Channel.URL)
			seenURL[sub.Channel.URL] = true
		}
	}
	validated, err := delivery.Parse(raw, allowlist)
	if err != nil {
		return ErrInvalidConfig
	}
	var maximum int64
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(seq),0) FROM event_identities").Scan(&maximum); err != nil {
		return unavailable(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE subscriptions SET active=0"); err != nil {
		return unavailable(err)
	}
	for _, sub := range validated {
		safe := delivery.Safe(sub)
		encoded, err := json.Marshal(safe)
		if err != nil {
			return ErrInvalidConfig
		}
		hash := hashJSON(safe)
		var previous string
		err = tx.QueryRowContext(ctx, "SELECT definition_hash FROM subscriptions WHERE id=?", sub.ID).Scan(&previous)
		if err == nil {
			if previous != hash {
				return ErrInvalidConfig
			}
			if _, err := tx.ExecContext(ctx, "UPDATE subscriptions SET active=1 WHERE id=?", sub.ID); err != nil {
				return unavailable(err)
			}
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return unavailable(err)
		}
		activation := int64(0)
		if sub.Start == "now" {
			activation = maximum
		}
		var digestStart *int64
		if sub.Mode == "digest" {
			if sub.Start == "earliest_hot" {
				digestStart, err = earliestDigestStartTx(ctx, tx, sub, maximum)
				if err != nil {
					return err
				}
			} else {
				start, _ := delivery.Window(*sub.Digest, now)
				digestStart = new(start.Unix())
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO subscriptions(id,definition,definition_hash,active,activation_seq,scan_seq,digest_start) VALUES(?,?,?,1,?,?,?)`, sub.ID, encoded, hash, activation, activation, digestStart); err != nil {
			return unavailable(err)
		}
	}
	return nil
}

// An empty earliest_hot subscription waits for its first hot event before
// choosing a window; anchoring it to wall time would lose later historical input.
func earliestDigestStartTx(ctx context.Context, tx *sql.Tx, sub delivery.Subscription, maximum int64) (*int64, error) {
	var raw []byte
	err := tx.QueryRowContext(ctx, "SELECT raw_json FROM events WHERE restored=0 AND seq<=? ORDER BY time,seq LIMIT 1", maximum).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, unavailable(err)
	}
	e, err := event.Parse(raw)
	if err != nil {
		return nil, unavailable(err)
	}
	at, err := event.ParseTime(attr(e, "time"))
	if err != nil {
		return nil, unavailable(err)
	}
	start, _ := delivery.Window(*sub.Digest, at)
	return new(start.Unix()), nil
}

func loadSubscriptionsTx(ctx context.Context, tx *sql.Tx) ([]subscriptionState, error) {
	rows, err := tx.QueryContext(ctx, "SELECT definition,definition_hash,activation_seq,scan_seq,digest_start FROM subscriptions WHERE active=1 ORDER BY id")
	if err != nil {
		return nil, unavailable(err)
	}
	defer rows.Close()
	out := []subscriptionState{}
	for rows.Next() {
		var sub subscriptionState
		var raw []byte
		if err := rows.Scan(&raw, &sub.hash, &sub.activation, &sub.scan, &sub.digestStart); err != nil {
			return nil, unavailable(err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		if err := dec.Decode(&sub.definition); err != nil {
			return nil, unavailable(err)
		}
		out = append(out, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, unavailable(err)
	}
	return out, nil
}

// parseDeliveryCursor uses the same strict JSON boundary as incoming events.
func parseDeliveryCursor(raw string, into any) error {
	if len(raw) > 4096 {
		return invalid("cursor too long")
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(raw)
	if err != nil {
		return invalid("malformed cursor")
	}
	if _, err := event.Decode(decoded); err != nil {
		return invalid("malformed cursor")
	}
	dec := json.NewDecoder(bytes.NewReader(decoded))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return invalid("malformed cursor")
	}
	if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		return invalid("malformed cursor")
	}
	return nil
}
func encodedDeliveryCursor(cursor any) *string {
	raw, _ := json.Marshal(cursor)
	return new(base64.RawURLEncoding.EncodeToString(raw))
}
func deliveryLimit(limit int) (int, error) {
	if limit == 0 {
		return 100, nil
	}
	if limit < 1 || limit > 200 {
		return 0, invalid("limit must be 1–200")
	}
	return limit, nil
}

func (s *Store) ListSubscriptions(ctx context.Context, cursor string, limit int) (SubscriptionPage, error) {
	page := SubscriptionPage{Items: []SubscriptionStatus{}}
	limit, err := deliveryLimit(limit)
	if err != nil {
		return page, err
	}
	var position sourceCursor
	if cursor != "" {
		if err := parseDeliveryCursor(cursor, &position); err != nil {
			return page, err
		}
		if position.Version != 1 || position.Name == "" {
			return page, invalid("invalid cursor")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return page, unavailable(err)
	}
	defer tx.Rollback()
	states, err := loadSubscriptionsTx(ctx, tx)
	if err != nil {
		return page, err
	}
	hashes := []string{}
	exists := cursor == ""
	for _, state := range states {
		hashes = append(hashes, state.hash)
		if state.definition.ID == position.Name {
			exists = true
		}
	}
	fingerprint := hashJSON(hashes)
	if cursor != "" && (!exists || position.Fingerprint != fingerprint) {
		return page, invalid("cursor configuration or position changed")
	}
	for _, state := range states {
		sub := state.definition
		if strings.Compare(sub.ID, position.Name) <= 0 {
			continue
		}
		if len(page.Items) == limit {
			page.NextCursor = encodedDeliveryCursor(sourceCursor{Version: 1, Fingerprint: fingerprint, Name: page.Items[len(page.Items)-1].ID})
			break
		}
		item := SubscriptionStatus{ID: sub.ID, Mode: sub.Mode, ChannelKind: sub.Channel.Kind}
		err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(state='pending'),0),COALESCE(SUM(state='inflight'),0),COALESCE(SUM(state='succeeded'),0),COALESCE(SUM(state='dlq'),0) FROM deliveries WHERE subscription_id=?`, sub.ID).Scan(&item.Counts.Pending, &item.Counts.Inflight, &item.Counts.Succeeded, &item.Counts.DLQ)
		if err != nil {
			return page, unavailable(err)
		}
		page.Items = append(page.Items, item)
	}
	if err := tx.Commit(); err != nil {
		return page, unavailable(err)
	}
	return page, nil
}
