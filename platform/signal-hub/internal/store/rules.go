package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
)

// ConfigureRuntime commits all source/rule/subscription changes and optional audit as one unit.
// Evaluation happens separately so an unavailable projection never swaps credentials halfway.
func (s *Store) ConfigureRuntime(ctx context.Context, sources []config.Source, definitions []rules.Rule, now time.Time, audit bool, subscriptions ...[]delivery.Subscription) error {
	raw := make([]json.RawMessage, len(definitions))
	for i, r := range definitions {
		b, err := json.Marshal(r)
		if err != nil {
			return fmt.Errorf("%w: rule encoding", ErrInvalidConfig)
		}
		raw[i] = b
	}
	validated, err := rules.Parse(raw)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidConfig, err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	for _, r := range validated {
		hash, err := r.Hash()
		if err != nil {
			return fmt.Errorf("%w: rule hash", ErrInvalidConfig)
		}
		var previous string
		err = tx.QueryRowContext(ctx, "SELECT content_hash FROM rule_definitions WHERE rule_id=? AND version=?", r.ID, r.Version).Scan(&previous)
		if err == nil && hash != previous {
			return fmt.Errorf("%w: rule %s version %d already has different content", ErrInvalidConfig, r.ID, r.Version)
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return unavailable(err)
		}
	}
	if err := configureSourcesTx(ctx, tx, sources, now); err != nil {
		return err
	}
	// Preserve old activation for deciding whether backfill is required.
	type activation struct {
		version int
		active  bool
	}
	old := map[string]activation{}
	rows, err := tx.QueryContext(ctx, "SELECT rule_id,version,active FROM rules_state")
	if err != nil {
		return unavailable(err)
	}
	for rows.Next() {
		var id string
		var a activation
		if err := rows.Scan(&id, &a.version, &a.active); err != nil {
			rows.Close()
			return unavailable(err)
		}
		old[id] = a
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return unavailable(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE rules_state SET active=0"); err != nil {
		return unavailable(err)
	}
	for _, r := range validated {
		hash, _ := r.Hash()
		definition, _ := json.Marshal(r)
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO rule_definitions(rule_id,version,content_hash,definition) VALUES(?,?,?,?)", r.ID, r.Version, hash, definition); err != nil {
			return unavailable(err)
		}
		previous, exists := old[r.ID]
		backfill := !exists || !previous.active || previous.version != r.Version
		if _, err := tx.ExecContext(ctx, `INSERT INTO rules_state(rule_id,version,active,needs_backfill) VALUES(?,?,1,1) ON CONFLICT(rule_id) DO UPDATE SET version=excluded.version,active=1,needs_backfill=CASE WHEN ? THEN 1 ELSE needs_backfill END,failures=CASE WHEN ? THEN 0 ELSE failures END,failure_emitted=CASE WHEN ? THEN 0 ELSE failure_emitted END`, r.ID, r.Version, backfill, backfill, backfill); err != nil {
			return unavailable(err)
		}
	}
	if len(subscriptions) > 1 {
		return ErrInvalidConfig
	}
	if len(subscriptions) == 1 {
		if err := configureSubscriptionsTx(ctx, tx, subscriptions[0], now); err != nil {
			return err
		}
	}
	if audit {
		if err := configAuditTx(ctx, tx, "reloaded", now); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}
func (s *Store) ActiveRules(ctx context.Context) ([]rules.Rule, error) {
	out := []rules.Rule{}
	rows, err := s.db.QueryContext(ctx, `SELECT d.definition FROM rules_state s JOIN rule_definitions d ON d.rule_id=s.rule_id AND d.version=s.version WHERE s.active=1 ORDER BY s.rule_id`)
	if err != nil {
		return nil, unavailable(err)
	}
	defer rows.Close()
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return nil, unavailable(err)
		}
		parsed, err := rules.Parse([]json.RawMessage{raw})
		if err != nil {
			return nil, unavailable(err)
		}
		out = append(out, parsed[0])
	}
	if err := rows.Err(); err != nil {
		return nil, unavailable(err)
	}
	return out, nil
}
func (s *Store) RecordConfigRejected(ctx context.Context, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	if err := configAuditTx(ctx, tx, "rejected", now); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}
func configAuditTx(ctx context.Context, tx *sql.Tx, outcome string, now time.Time) error {
	result, err := tx.ExecContext(ctx, "INSERT INTO config_audit(occurred_at,outcome) VALUES(?,?)", now.UTC().Format(time.RFC3339Nano), outcome)
	if err != nil {
		return unavailable(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return unavailable(err)
	}
	return internalEventTx(ctx, tx, map[string]any{"source": "urn:signalhub:config", "id": fmt.Sprintf("config:%d", id), "type": "signalhub.config." + outcome, "time": now.UTC().Format(time.RFC3339Nano), "summary": "Runtime configuration " + outcome}, now, false)
}
func internalEventTx(ctx context.Context, tx *sql.Tx, fields map[string]any, now time.Time, immutableDuplicate bool) error {
	fields["specversion"] = "1.0"
	raw, err := json.Marshal(fields)
	if err != nil {
		return unavailable(err)
	}
	e, err := event.Parse(raw)
	if err != nil {
		return unavailable(err)
	}
	if immutableDuplicate {
		var seq int64
		err := tx.QueryRowContext(ctx, "SELECT seq FROM events WHERE source=? AND id=?", fields["source"], fields["id"]).Scan(&seq)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return unavailable(err)
		}
	}
	_, err = ingestTx(ctx, tx, e, now)
	return err
}
func stableRuleID(value any) (string, error) {
	raw, err := rules.Canonical(value)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(raw)
	return "rule:" + hex.EncodeToString(hash[:]), nil
}

func groupDigest(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}
