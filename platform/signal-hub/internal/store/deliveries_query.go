package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"
)

type deliveryCursor struct {
	Version     int    `json:"v"`
	Fingerprint string `json:"f"`
	ID          string `json:"id"`
	Maximum     int64  `json:"max"`
}

func (s *Store) ListDeliveries(ctx context.Context, q DeliveryQuery) (DeliveryPage, error) {
	page := DeliveryPage{Items: []Delivery{}}
	limit, err := deliveryLimit(q.Limit)
	if err != nil {
		return page, err
	}
	if !utf8.ValidString(q.Subscription) {
		return page, invalid("invalid UTF-8")
	}
	switch q.State {
	case "", "pending", "inflight", "succeeded", "dlq":
	default:
		return page, invalid("invalid delivery state")
	}
	fingerprint := hashJSON([]string{q.Subscription, q.State})
	var position deliveryCursor
	if q.Cursor != "" {
		if err := parseDeliveryCursor(q.Cursor, &position); err != nil {
			return page, err
		}
		if position.Version != 1 || position.Fingerprint != fingerprint || position.ID == "" || position.Maximum < 1 {
			return page, invalid("cursor query or position changed")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return page, unavailable(err)
	}
	defer tx.Rollback()
	if q.Cursor == "" {
		if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(ordinal),0) FROM deliveries").Scan(&position.Maximum); err != nil {
			return page, unavailable(err)
		}
	} else {
		var subscription string
		var ordinal int64
		err := tx.QueryRowContext(ctx, "SELECT subscription_id,ordinal FROM deliveries WHERE delivery_id=?", position.ID).Scan(&subscription, &ordinal)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && (ordinal > position.Maximum || (q.Subscription != "" && subscription != q.Subscription))) {
			return page, invalid("cursor position changed")
		}
		if err != nil {
			return page, unavailable(err)
		}
	}
	where := []string{"d.ordinal<=?", "d.delivery_id>?"}
	args := []any{position.Maximum, position.ID}
	if q.Subscription != "" {
		where = append(where, "d.subscription_id=?")
		args = append(args, q.Subscription)
	}
	if q.State != "" {
		where = append(where, "d.state=?")
		args = append(args, q.State)
	}
	args = append(args, limit+1)
	rows, err := tx.QueryContext(ctx, `SELECT d.delivery_id,d.subscription_id,d.state,d.event_seq,d.window_start,d.attempt_count,d.next_attempt_at,a.at,a.http_status,a.duration_ms,a.error FROM deliveries d LEFT JOIN delivery_attempts a ON a.delivery_id=d.delivery_id AND a.attempt=d.attempt_count WHERE `+strings.Join(where, " AND ")+" ORDER BY d.delivery_id LIMIT ?", args...)
	if err != nil {
		return page, unavailable(err)
	}
	defer rows.Close()
	for rows.Next() {
		var item Delivery
		var at *string
		var status *int
		var duration *int64
		var summary *string
		if err := rows.Scan(&item.DeliveryID, &item.SubscriptionID, &item.State, &item.EventSeq, &item.WindowStart, &item.AttemptCount, &item.NextAttemptAt, &at, &status, &duration, &summary); err != nil {
			return page, unavailable(err)
		}
		if len(page.Items) == limit {
			page.NextCursor = encodedDeliveryCursor(deliveryCursor{Version: 1, Fingerprint: fingerprint, ID: page.Items[len(page.Items)-1].DeliveryID, Maximum: position.Maximum})
			break
		}
		if at != nil {
			item.LastAttempt = &DeliveryAttempt{At: *at, HTTPStatus: status, Error: summary}
			if duration != nil {
				item.LastAttempt.DurationMS = *duration
			}
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return page, unavailable(err)
	}
	rows.Close()
	if err := tx.Commit(); err != nil {
		return page, unavailable(err)
	}
	return page, nil
}
