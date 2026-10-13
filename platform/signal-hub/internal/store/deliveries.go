package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

var (
	ErrNotReplayable = errors.New("delivery is not in DLQ")
	ErrInvalidReason = errors.New("replay reason must not be blank")
)

const deliveryBatch = 200
const digestBatch = 31
const deliveryLease = 2 * time.Minute
const deliveryAttempts = 12

type DeliveryWork struct {
	DeliveryID, SubscriptionID, LeaseToken string
	Message                                delivery.Message
	Attempt                                int
}
type DeliveryAttempt struct {
	At         string  `json:"at"`
	HTTPStatus *int    `json:"http_status"`
	DurationMS int64   `json:"duration_ms"`
	Error      *string `json:"error"`
}
type Delivery struct {
	DeliveryID     string           `json:"delivery_id"`
	SubscriptionID string           `json:"subscription_id"`
	State          string           `json:"state"`
	EventSeq       *int64           `json:"event_seq"`
	WindowStart    *string          `json:"window_start"`
	AttemptCount   int              `json:"attempt_count"`
	LastAttempt    *DeliveryAttempt `json:"last_attempt"`
	NextAttemptAt  *string          `json:"next_attempt_at"`
}
type DeliveryQuery struct {
	Subscription, State, Cursor string
	Limit                       int
}
type DeliveryPage struct {
	Items      []Delivery `json:"items"`
	NextCursor *string    `json:"next_cursor"`
}

// QueueDeliveries commits each batch and its projection cursors together. The
// event maximum freezes the snapshot, including events generated internally.
func (s *Store) QueueDeliveries(ctx context.Context, now time.Time, boardURL string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	states, err := loadSubscriptionsTx(ctx, tx)
	if err != nil {
		return err
	}
	var maximum int64
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(seq),0) FROM events").Scan(&maximum); err != nil {
		return unavailable(err)
	}
	for _, state := range states {
		if state.definition.Mode == "immediate" {
			err = queueImmediateTx(ctx, tx, state, maximum, now, boardURL)
		} else {
			err = queueDigestTx(ctx, tx, state, maximum, now, boardURL)
		}
		if err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}
func insertDeliveryTx(ctx context.Context, tx *sql.Tx, id, subscription string, seq *int64, window *string, message delivery.Message, now time.Time) error {
	headers, err := json.Marshal(message.Headers)
	if err != nil {
		return unavailable(err)
	}
	_, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO deliveries(delivery_id,subscription_id,event_seq,window_start,body,content_type,headers,state,next_attempt_at,next_attempt_key) VALUES(?,?,?,?,?,?,?,'pending',?,?)`, id, subscription, seq, window, message.Body, message.ContentType, headers, now.UTC().Format(time.RFC3339Nano), timeKey(now))
	if err != nil {
		return unavailable(err)
	}
	return nil
}
func queueImmediateTx(ctx context.Context, tx *sql.Tx, state subscriptionState, maximum int64, now time.Time, boardURL string) error {
	rows, err := tx.QueryContext(ctx, "SELECT seq,raw_json FROM events WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?", state.scan, maximum, deliveryBatch)
	if err != nil {
		return unavailable(err)
	}
	defer rows.Close()
	last := state.scan
	for rows.Next() {
		var seq int64
		var raw []byte
		if err := rows.Scan(&seq, &raw); err != nil {
			return unavailable(err)
		}
		e, err := event.Parse(raw)
		if err != nil {
			return unavailable(err)
		}
		if delivery.Match(state.definition, e) {
			message, err := delivery.Immediate(state.definition, seq, raw, boardURL)
			if err != nil {
				return unavailable(err)
			}
			if err := insertDeliveryTx(ctx, tx, fmt.Sprintf("%s:%d", state.definition.ID, seq), state.definition.ID, &seq, nil, message, now); err != nil {
				return err
			}
		}
		last = seq
	}
	if err := rows.Err(); err != nil {
		return unavailable(err)
	}
	rows.Close()
	if _, err := tx.ExecContext(ctx, "UPDATE subscriptions SET scan_seq=? WHERE id=?", last, state.definition.ID); err != nil {
		return unavailable(err)
	}
	return nil
}
func queueDigestTx(ctx context.Context, tx *sql.Tx, state subscriptionState, maximum int64, now time.Time, boardURL string) error {
	if state.definition.Digest == nil {
		return unavailable(errors.New("missing digest boundary"))
	}
	if state.digestStart == nil {
		var err error
		state.digestStart, err = earliestDigestStartTx(ctx, tx, state.definition, maximum)
		if err != nil {
			return err
		}
		if state.digestStart == nil {
			return nil
		}
		if _, err := tx.ExecContext(ctx, "UPDATE subscriptions SET digest_start=? WHERE id=?", state.digestStart, state.definition.ID); err != nil {
			return unavailable(err)
		}
	}
	start := time.Unix(*state.digestStart, 0).UTC()
	for range digestBatch {
		end := delivery.NextBoundary(*state.definition.Digest, start)
		if !end.After(start) {
			return unavailable(errors.New("nonadvancing digest boundary"))
		}
		if end.After(now) {
			break
		}
		rows, err := tx.QueryContext(ctx, "SELECT raw_json FROM events WHERE seq>? AND seq<=? AND time>=? AND time<? ORDER BY seq", state.activation, maximum, timeKey(start), timeKey(end))
		if err != nil {
			return unavailable(err)
		}
		items := []json.RawMessage{}
		var count int64
		for rows.Next() {
			var raw []byte
			if err := rows.Scan(&raw); err != nil {
				rows.Close()
				return unavailable(err)
			}
			e, err := event.Parse(raw)
			if err != nil {
				rows.Close()
				return unavailable(err)
			}
			if delivery.Match(state.definition, e) {
				count++
				if len(items) < 20 {
					items = append(items, json.RawMessage(raw))
				}
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return unavailable(err)
		}
		if count > 0 || !state.definition.Digest.SkipEmpty {
			message, err := delivery.DigestMessage(state.definition, items, count, start, end, boardURL)
			if err != nil {
				return unavailable(err)
			}
			window, _ := delivery.BoundaryTime(start)
			if err := insertDeliveryTx(ctx, tx, fmt.Sprintf("%s:digest:%d", state.definition.ID, start.Unix()), state.definition.ID, nil, &window, message, now); err != nil {
				return err
			}
		}
		start = end
		if _, err := tx.ExecContext(ctx, "UPDATE subscriptions SET digest_start=?,scan_seq=? WHERE id=?", start.Unix(), maximum, state.definition.ID); err != nil {
			return unavailable(err)
		}
	}
	return nil
}

// ClaimDelivery persists an attempt and an opaque fence before any network I/O.
func (s *Store) ClaimDelivery(ctx context.Context, now time.Time) (*DeliveryWork, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, unavailable(err)
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT d.delivery_id,d.subscription_id,d.cycle_attempts FROM deliveries d JOIN subscriptions s ON s.id=d.subscription_id WHERE s.active=1 AND d.state='inflight' AND d.lease_until<=? ORDER BY d.ordinal LIMIT ?`, timeKey(now), deliveryBatch)
	if err != nil {
		return nil, unavailable(err)
	}
	type expired struct {
		id, sub  string
		attempts int
	}
	expiredRows := []expired{}
	for rows.Next() {
		var row expired
		if err := rows.Scan(&row.id, &row.sub, &row.attempts); err != nil {
			rows.Close()
			return nil, unavailable(err)
		}
		expiredRows = append(expiredRows, row)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, unavailable(err)
	}
	for _, row := range expiredRows {
		if _, err := tx.ExecContext(ctx, `UPDATE delivery_attempts SET error='attempt interrupted' WHERE delivery_id=? AND attempt=(SELECT attempt_count FROM deliveries WHERE delivery_id=?)`, row.id, row.id); err != nil {
			return nil, unavailable(err)
		}
		if row.attempts >= deliveryAttempts {
			if err := markDLQTx(ctx, tx, row.id, row.sub, now); err != nil {
				return nil, err
			}
		} else {
			if _, err := tx.ExecContext(ctx, `UPDATE deliveries SET state='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=?,next_attempt_key=? WHERE delivery_id=?`, now.UTC().Format(time.RFC3339Nano), timeKey(now), row.id); err != nil {
				return nil, unavailable(err)
			}
		}
	}
	var work DeliveryWork
	var headers []byte
	err = tx.QueryRowContext(ctx, `SELECT d.delivery_id,d.subscription_id,d.body,d.content_type,d.headers,d.attempt_count+1 FROM deliveries d JOIN subscriptions s ON s.id=d.subscription_id WHERE s.active=1 AND d.state='pending' AND d.next_attempt_key<=? AND d.cycle_attempts<? ORDER BY d.ordinal LIMIT 1`, timeKey(now), deliveryAttempts).Scan(&work.DeliveryID, &work.SubscriptionID, &work.Message.Body, &work.Message.ContentType, &headers, &work.Attempt)
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.Commit(); err != nil {
			return nil, unavailable(err)
		}
		return nil, nil
	}
	if err != nil {
		return nil, unavailable(err)
	}
	if err := json.Unmarshal(headers, &work.Message.Headers); err != nil {
		return nil, unavailable(err)
	}
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, unavailable(err)
	}
	work.LeaseToken = hex.EncodeToString(token[:])
	if _, err := tx.ExecContext(ctx, `UPDATE deliveries SET state='inflight',attempt_count=attempt_count+1,cycle_attempts=cycle_attempts+1,lease_token=?,lease_until=?,next_attempt_at=NULL,next_attempt_key=NULL WHERE delivery_id=?`, work.LeaseToken, timeKey(now.Add(deliveryLease)), work.DeliveryID); err != nil {
		return nil, unavailable(err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO delivery_attempts(delivery_id,attempt,at) VALUES(?,?,?)`, work.DeliveryID, work.Attempt, now.UTC().Format(time.RFC3339Nano)); err != nil {
		return nil, unavailable(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, unavailable(err)
	}
	return &work, nil
}

// FinishDelivery ignores stale completions: a recovered attempt owns a new fence.
// Only locally generated classifications reach storage, never transport errors.
func (s *Store) FinishDelivery(ctx context.Context, work DeliveryWork, result delivery.Result, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	var token sql.NullString
	var state, sub string
	var cycle, attempt int
	err = tx.QueryRowContext(ctx, "SELECT lease_token,state,subscription_id,cycle_attempts,attempt_count FROM deliveries WHERE delivery_id=?", work.DeliveryID).Scan(&token, &state, &sub, &cycle, &attempt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return unavailable(err)
	}
	if state != "inflight" || !token.Valid || token.String != work.LeaseToken || attempt != work.Attempt {
		return nil
	}
	status := result.HTTPStatus
	if status != nil && (*status < 100 || *status > 599) {
		status = nil
	}
	success := status != nil && *status >= 200 && *status < 300
	retryable := status == nil || *status == 408 || *status == 429 || *status >= 500
	var summary *string
	if !success {
		if status == nil {
			summary = new("transport failure")
		} else {
			summary = new(fmt.Sprintf("HTTP status %d", *status))
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE delivery_attempts SET http_status=?,duration_ms=?,error=? WHERE delivery_id=? AND attempt=?`, status, max(0, result.DurationMS), summary, work.DeliveryID, attempt); err != nil {
		return unavailable(err)
	}
	if success {
		_, err = tx.ExecContext(ctx, `UPDATE deliveries SET state='succeeded',lease_token=NULL,lease_until=NULL WHERE delivery_id=?`, work.DeliveryID)
	} else if !retryable || cycle >= deliveryAttempts {
		err = markDLQTx(ctx, tx, work.DeliveryID, sub, now)
	} else {
		next := now.Add(delivery.RetryDelay(cycle, result.RetryAfter))
		_, err = tx.ExecContext(ctx, `UPDATE deliveries SET state='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=?,next_attempt_key=? WHERE delivery_id=?`, next.UTC().Format(time.RFC3339Nano), timeKey(next), work.DeliveryID)
	}
	if err != nil {
		return unavailable(err)
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}
func markDLQTx(ctx context.Context, tx *sql.Tx, id, sub string, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `UPDATE deliveries SET state='dlq',dlq_episode=dlq_episode+1,lease_token=NULL,lease_until=NULL,next_attempt_at=NULL,next_attempt_key=NULL WHERE delivery_id=?`, id); err != nil {
		return unavailable(err)
	}
	var episode int64
	if err := tx.QueryRowContext(ctx, "SELECT dlq_episode FROM deliveries WHERE delivery_id=?", id).Scan(&episode); err != nil {
		return unavailable(err)
	}
	eventID := "delivery:" + hashJSON([]any{id, episode})
	return internalEventTx(ctx, tx, map[string]any{"source": "urn:signalhub:deliveries", "id": eventID, "type": "signalhub.delivery.dlq", "subject": sub, "time": now.UTC().Format(time.RFC3339Nano), "severity": "error", "summary": "Delivery entered DLQ", "data": map[string]any{"delivery_id": id}}, now, true)
}
func (s *Store) ReplayDelivery(ctx context.Context, id, reason string, now time.Time) error {
	if strings.TrimSpace(reason) == "" || !utf8.ValidString(reason) {
		return ErrInvalidReason
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	var state string
	var active bool
	if err := tx.QueryRowContext(ctx, "SELECT d.state,s.active FROM deliveries d JOIN subscriptions s ON s.id=d.subscription_id WHERE d.delivery_id=?", id).Scan(&state, &active); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return unavailable(err)
	}
	if state != "dlq" || !active {
		return ErrNotReplayable
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log(at,actor,action,target,reason) VALUES(?,'owner','delivery.replay',?,?)`, now.UTC().Format(time.RFC3339Nano), id, reason); err != nil {
		return unavailable(err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE deliveries SET state='pending',cycle_attempts=0,next_attempt_at=?,next_attempt_key=? WHERE delivery_id=?`, now.UTC().Format(time.RFC3339Nano), timeKey(now), id); err != nil {
		return unavailable(err)
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}
