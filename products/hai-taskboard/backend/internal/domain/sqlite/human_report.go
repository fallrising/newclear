package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func humanReportCorruption() error {
	return domain.StorageCorruptionError{Reason: "human report provenance is invalid"}
}

func (tx transaction) HumanReportIDExists(ctx context.Context, p domain.ProjectID, id string) (bool, error) {
	var exists bool
	err := tx.conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM human_reports WHERE project_id=? AND report_id=?) OR EXISTS(SELECT 1 FROM reviews WHERE project_id=? AND review_id=?) OR EXISTS(SELECT 1 FROM evidence WHERE project_id=? AND evidence_id=?)`, p, id, p, id, p, id).Scan(&exists)
	return exists, normalizeError(err)
}
func (tx transaction) CountHumanReports(ctx context.Context, p domain.ProjectID, s domain.Digest) (int, error) {
	var n int
	err := tx.conn.QueryRowContext(ctx, `SELECT count(*) FROM (SELECT 1 FROM human_reports WHERE project_id=? AND subject_digest=? LIMIT 1025)`, p, s.String()).Scan(&n)
	return n, normalizeError(err)
}
func (tx transaction) StoreHumanReport(ctx context.Context, r port.HumanReport) error {
	if !port.ValidHumanReport(r) {
		return humanReportCorruption()
	}
	a, err := tx.loadOutputArtifact(ctx, r.Artifact.Digest)
	if err != nil {
		return err
	}
	if a != r.Artifact {
		return humanReportCorruption()
	}
	var review, evidence any
	if r.Kind == "review" {
		review = r.ID
	} else {
		evidence = r.ID
	}
	_, err = tx.conn.ExecContext(ctx, `INSERT INTO human_reports(project_id,report_id,work_item_id,run_id,subject_digest,actor_id,kind,artifact_digest,created_at_ns,lease_epoch,restore_generation,review_id,evidence_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, r.ProjectID, r.ID, r.WorkItemID, r.RunID, r.SubjectDigest.String(), r.Actor, r.Kind, r.Artifact.Digest.String(), r.CreatedAtNS, r.LeaseEpoch, r.RestoreGeneration, review, evidence)
	return normalizeError(err)
}
func (tx transaction) LoadHumanReport(ctx context.Context, p domain.ProjectID, id string) (port.HumanReport, error) {
	r := port.HumanReport{ProjectID: p, ID: id}
	var subject, digest string
	var epoch, generation int64
	var valid bool
	// Bound every variable-width persisted field before allocating it in Go.
	err := tx.conn.QueryRowContext(ctx, `SELECT
 CASE WHEN length(CAST(h.work_item_id AS BLOB)) BETWEEN 1 AND 80 THEN h.work_item_id END,
 CASE WHEN length(CAST(h.run_id AS BLOB)) BETWEEN 1 AND 80 THEN h.run_id END,
 CASE WHEN length(CAST(h.subject_digest AS BLOB))=64 THEN h.subject_digest END,
 CASE WHEN length(CAST(h.actor_id AS BLOB)) BETWEEN 1 AND 120 THEN h.actor_id END,
 CASE WHEN h.kind IN ('review','evidence') THEN h.kind END,
 CASE WHEN length(CAST(h.artifact_digest AS BLOB))=64 THEN h.artifact_digest END,
 h.created_at_ns,h.lease_epoch,h.restore_generation,
 EXISTS(SELECT 1 FROM runs WHERE project_id=h.project_id AND run_id=h.run_id AND work_item_id=h.work_item_id)
 AND ((h.kind='review' AND h.review_id=h.report_id AND h.evidence_id IS NULL AND EXISTS(SELECT 1 FROM reviews WHERE project_id=h.project_id AND review_id=h.review_id AND completion_subject_digest=h.subject_digest AND reviewer_id=h.actor_id AND independent=1 AND created_at_ns=h.created_at_ns))
 OR (h.kind='evidence' AND h.evidence_id=h.report_id AND h.review_id IS NULL AND EXISTS(SELECT 1 FROM evidence WHERE project_id=h.project_id AND evidence_id=h.evidence_id AND completion_subject_digest=h.subject_digest AND verifier_actor=h.actor_id AND verifier_class='human' AND verifier_role='human' AND artifact_digest=h.artifact_digest AND verdict='Passed' AND applicability='Current' AND availability='Present')))
 FROM human_reports h WHERE h.project_id=? AND h.report_id=?`, p, id).Scan(&r.WorkItemID, &r.RunID, &subject, &r.Actor, &r.Kind, &digest, &r.CreatedAtNS, &epoch, &generation, &valid)
	if errors.Is(err, sql.ErrNoRows) {
		return port.HumanReport{}, port.ErrNotFound
	}
	if err != nil {
		return port.HumanReport{}, errors.Join(humanReportCorruption(), normalizeError(err))
	}
	r.SubjectDigest, err = ParseStorageDigest(subject)
	if err != nil {
		return port.HumanReport{}, humanReportCorruption()
	}
	d, err := ParseStorageDigest(digest)
	if err != nil {
		return port.HumanReport{}, humanReportCorruption()
	}
	r.Artifact, err = tx.loadOutputArtifact(ctx, d)
	if err != nil {
		return port.HumanReport{}, errors.Join(humanReportCorruption(), err)
	}
	if epoch > 0 {
		r.LeaseEpoch = uint64(epoch)
	}
	if generation > 0 {
		r.RestoreGeneration = uint64(generation)
	}
	if !valid || !port.ValidHumanReport(r) {
		return port.HumanReport{}, humanReportCorruption()
	}
	return r, nil
}
