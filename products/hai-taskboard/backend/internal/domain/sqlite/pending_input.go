package sqlite

import (
	"context"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
)

var _ port.PendingInputTransaction = transaction{}

// This CAS only changes the reconciliation fact before any lease can be issued.
func (tx transaction) MarkPendingInputStale(ctx context.Context, r port.PendingInputStaleRequest) (port.RunAuthority, error) {
	result, err := tx.conn.ExecContext(ctx, `UPDATE runs SET reconciliation_state='NeedsReconcile'
WHERE project_id=? AND run_id=? AND input_digest=? AND desired_action='Dispatch' AND dispatch_state='Pending'
AND observed_state='Unknown' AND reconciliation_state='None' AND side_effect_outcome='NotApplicable'
AND EXISTS (SELECT 1 FROM instance_state WHERE id=1 AND restore_generation=?)
AND EXISTS (SELECT 1 FROM run_input_envelopes i WHERE i.project_id=runs.project_id AND i.run_id=runs.run_id AND i.input_digest=runs.input_digest)
AND EXISTS (SELECT 1 FROM outbox o WHERE o.project_id=runs.project_id AND o.run_id=runs.run_id AND o.payload_digest=runs.input_digest AND o.state='Pending' AND o.claim_epoch=0)
AND NOT EXISTS (SELECT 1 FROM run_leases l WHERE l.project_id=runs.project_id AND l.run_id=runs.run_id AND (l.epoch<>0 OR l.holder IS NOT NULL OR l.deadline_ns IS NOT NULL))`, r.ProjectID, r.RunID, r.InputDigest.String(), r.RestoreGeneration)
	if err != nil {
		return port.RunAuthority{}, normalizeError(err)
	}
	if err := requireSingleMutation(result, port.ErrNoPendingDispatch); err != nil {
		return port.RunAuthority{}, err
	}
	return tx.LoadRunAuthority(ctx, r.ProjectID, r.RunID)
}
