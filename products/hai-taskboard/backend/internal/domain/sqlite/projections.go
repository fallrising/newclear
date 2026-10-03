package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// readProjection pins both authoritative rows and stream metadata to one WAL
// snapshot. It never acquires the application's immediate write transaction.
func (store *Store) readProjection(ctx context.Context, read func(*sql.Conn) error) error {
	return store.withConn(ctx, func(conn *sql.Conn) error {
		if _, err := conn.ExecContext(ctx, "BEGIN"); err != nil {
			return normalizeError(err)
		}
		defer func() { _, _ = conn.ExecContext(context.Background(), "ROLLBACK") }()
		return read(conn)
	})
}

func projectionPosition(ctx context.Context, conn *sql.Conn, projectID domain.ProjectID) (port.Cursor, uint64, error) {
	var cursor port.Cursor
	var minimum uint64
	err := conn.QueryRowContext(ctx, `SELECT i.stream_epoch,i.next_event_sequence,COALESCE(r.minimum_retained_sequence,1)
FROM projects p CROSS JOIN instance_state i LEFT JOIN stream_retention r ON r.project_id=p.project_id AND r.stream_epoch=i.stream_epoch
WHERE p.project_id=? AND i.id=1`, projectID).Scan(&cursor.Epoch, &cursor.Sequence, &minimum)
	if err != nil {
		return port.Cursor{}, 0, normalizeError(err)
	}
	if cursor.Epoch == 0 || minimum > cursor.Sequence+1 {
		return port.Cursor{}, 0, domain.StorageCorruptionError{Reason: "invalid projection position"}
	}
	return cursor, minimum, nil
}

// ReadBoard reads row DTOs, not transport JSON. Done rows still pass the
// established guarded rehydration path before they can appear on a board.
func (store *Store) ReadBoard(ctx context.Context, projectID domain.ProjectID) (port.PersistedBoard, error) {
	var result port.PersistedBoard
	err := store.readProjection(ctx, func(conn *sql.Conn) error {
		var err error
		result.Cursor, result.MinimumSequence, err = projectionPosition(ctx, conn, projectID)
		if err != nil {
			return err
		}
		result.ProjectID = projectID
		rows, err := conn.QueryContext(ctx, `SELECT work_item_id,title,owner_id FROM work_items WHERE project_id=? ORDER BY work_item_id`, projectID)
		if err != nil {
			return normalizeError(err)
		}
		for rows.Next() {
			var value port.BoardWorkItem
			if err := rows.Scan(&value.ID, &value.Title, &value.OwnerID); err != nil {
				rows.Close()
				return normalizeError(err)
			}
			result.Items = append(result.Items, value)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return normalizeError(err)
		}
		if err := rows.Close(); err != nil {
			return normalizeError(err)
		}
		for index := range result.Items {
			value := &result.Items[index]
			value.Item, err = store.loadWorkItem(ctx, conn, projectID, value.ID)
			if err != nil {
				return err
			}
			if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM work_item_ac_requirements WHERE project_id=? AND work_item_id=?`, projectID, value.ID).Scan(&value.RequiredACCount); err != nil {
				return normalizeError(err)
			}
			var run port.BoardRun
			err = conn.QueryRowContext(ctx, `SELECT run_id,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome FROM runs WHERE project_id=? AND work_item_id=? ORDER BY created_at_ns DESC,run_id DESC LIMIT 1`, projectID, value.ID).Scan(&run.ID, &run.DesiredAction, &run.DispatchState, &run.ObservedState, &run.ReconciliationState, &run.SideEffectOutcome)
			if err == nil {
				value.CurrentRun = &run
			} else if !errors.Is(err, sql.ErrNoRows) {
				return normalizeError(err)
			}
		}
		return nil
	})
	if err != nil {
		return port.PersistedBoard{}, err
	}
	return result, nil
}

// ReadProjectionEvents respects the global allocator. A foreign-project gap
// cannot be represented by the V1 contiguous project stream: require a new
// snapshot instead of inventing event identities or leaking foreign payloads.
func (store *Store) ReadProjectionEvents(ctx context.Context, projectID domain.ProjectID, after port.Cursor) (port.PersistedReplay, error) {
	var result port.PersistedReplay
	err := store.readProjection(ctx, func(conn *sql.Conn) error {
		var err error
		result.Cursor, result.MinimumSequence, err = projectionPosition(ctx, conn, projectID)
		if err != nil {
			return err
		}
		if after.Epoch != result.Cursor.Epoch {
			return nil
		}
		if after.Sequence > result.Cursor.Sequence {
			return domain.StorageCorruptionError{Reason: "projection cursor beyond high water"}
		}
		if result.MinimumSequence > 0 && after.Sequence < result.MinimumSequence-1 {
			return nil
		}
		if result.Cursor.Sequence-after.Sequence > 128 {
			result.MinimumSequence = result.Cursor.Sequence + 1
			return nil
		}
		rows, err := conn.QueryContext(ctx, `SELECT event_sequence,project_id,payload_digest,length(payload),CASE WHEN length(payload)<=1048576 THEN payload END
FROM projection_events WHERE stream_epoch=? AND event_sequence>? AND event_sequence<=? ORDER BY event_sequence`, result.Cursor.Epoch, after.Sequence, result.Cursor.Sequence)
		if err != nil {
			return normalizeError(err)
		}
		defer rows.Close()
		previous, totalBytes, foreign := after.Sequence, 0, false
		for rows.Next() {
			var event port.CommittedProjection
			var digestText string
			var size int
			event.Cursor.Epoch = result.Cursor.Epoch
			if err := rows.Scan(&event.Cursor.Sequence, &event.ProjectID, &digestText, &size, &event.Payload); err != nil {
				return normalizeError(err)
			}
			digest, err := ParseStorageDigest(digestText)
			if err != nil || size < 1 || size > 1048576 || event.Cursor.Sequence != previous+1 || domain.HashBytes(event.Payload) != digest {
				return domain.StorageCorruptionError{Reason: "corrupt projection replay"}
			}
			previous = event.Cursor.Sequence
			totalBytes += size
			if totalBytes > 1048576 {
				result.Events = nil
				result.MinimumSequence = result.Cursor.Sequence + 1
				return nil
			}
			if event.ProjectID != projectID {
				foreign = true
			} else {
				result.Events = append(result.Events, event)
			}
		}
		if err := rows.Err(); err != nil {
			return normalizeError(err)
		}
		if previous != result.Cursor.Sequence {
			return domain.StorageCorruptionError{Reason: "missing projection event"}
		}
		if foreign || totalBytes > 1048576 {
			result.Events = nil
			result.MinimumSequence = result.Cursor.Sequence + 1
		}
		return nil
	})
	if err != nil {
		return port.PersistedReplay{}, err
	}
	return result, nil
}
