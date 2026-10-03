package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// DispatchCandidates is a bounded, read-only discovery snapshot. Claims still
// require the application's fenced compare-and-swap transaction. Recovery and
// Pending work have separate bounds so either queue cannot starve the other.
func (store *Store) DispatchCandidates(ctx context.Context, now time.Time, limit int) ([]port.RunAuthority, error) {
	if now.IsZero() || limit < 1 || limit > 128 {
		return nil, errors.New("invalid dispatch scan bounds")
	}
	var candidates []port.RunAuthority
	err := store.withConn(ctx, func(conn *sql.Conn) error {
		if _, err := conn.ExecContext(ctx, "BEGIN"); err != nil {
			return err
		}
		defer conn.ExecContext(context.Background(), "ROLLBACK")
		queries := []struct {
			sql  string
			args []any
		}{
			{`SELECT project_id,run_id FROM runs WHERE desired_action='Dispatch' AND dispatch_state='Pending' ORDER BY created_at_ns,project_id,run_id LIMIT ?`, []any{limit}},
			{`SELECT r.project_id,r.run_id FROM runs r JOIN run_leases l ON l.project_id=r.project_id AND l.run_id=r.run_id
WHERE r.dispatch_state<>'Pending' AND r.observed_state NOT IN ('Succeeded','Failed','Canceled') AND r.reconciliation_state<>'NeedsReconcile' AND l.deadline_ns<?
ORDER BY l.deadline_ns,r.project_id,r.run_id LIMIT ?`, []any{now.UnixNano(), limit}},
		}
		for _, query := range queries {
			rows, err := conn.QueryContext(ctx, query.sql, query.args...)
			if err != nil {
				return err
			}
			type key struct {
				project domain.ProjectID
				run     domain.RunID
			}
			var keys []key
			for rows.Next() {
				var value key
				if err := rows.Scan(&value.project, &value.run); err != nil {
					rows.Close()
					return err
				}
				keys = append(keys, value)
			}
			err = errors.Join(rows.Err(), rows.Close())
			if err != nil {
				return err
			}
			for _, key := range keys {
				authority, err := (transaction{conn: conn}).LoadRunAuthority(ctx, key.project, key.run)
				if err != nil {
					return err
				}
				candidates = append(candidates, authority)
			}
		}
		_, err := conn.ExecContext(ctx, "COMMIT")
		return err
	})
	return candidates, err
}
