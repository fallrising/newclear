package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"mime"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var _ port.RunOutputTransaction = transaction{}

func outputCorruption() error {
	return domain.StorageCorruptionError{Reason: "Run output association or artifact metadata mismatch"}
}

func verifiedOutputArtifact(a port.Artifact) bool {
	media, params, err := mime.ParseMediaType(a.MediaType)
	return err == nil && media != "" && len(a.MediaType) <= 160 && !strings.ContainsRune(a.MediaType, 0) && mime.FormatMediaType(media, params) == a.MediaType && !a.Digest.IsZero() && a.ByteLength <= math.MaxInt64 && a.StorageKey == "sha256:"+a.Digest.String() && a.Availability == "Present"
}

func (tx transaction) LoadRunOutputs(ctx context.Context, project domain.ProjectID, run domain.RunID) ([]port.RunOutput, error) {
	if project == "" || run == "" {
		return nil, outputCorruption()
	}
	var input string
	if err := tx.conn.QueryRowContext(ctx, `SELECT CASE WHEN length(CAST(input_digest AS BLOB))=64 THEN input_digest ELSE NULL END FROM runs WHERE project_id=? AND run_id=?`, project, run).Scan(&input); err != nil {
		return nil, outputReadError(ctx, err)
	}
	inputDigest, err := ParseStorageDigest(input)
	if err != nil || inputDigest.IsZero() {
		return nil, outputCorruption()
	}
	rows, err := tx.conn.QueryContext(ctx, `SELECT CASE WHEN length(CAST(o.artifact_digest AS BLOB))=64 THEN o.artifact_digest ELSE NULL END,CASE WHEN length(CAST(o.input_digest AS BLOB))=64 THEN o.input_digest ELSE NULL END,o.lease_epoch,o.restore_generation,CASE WHEN length(CAST(a.digest AS BLOB))=64 THEN a.digest ELSE NULL END,CASE WHEN length(CAST(a.media_type AS BLOB)) BETWEEN 1 AND 160 THEN a.media_type ELSE NULL END,a.byte_length,CASE WHEN length(CAST(a.storage_key AS BLOB))=71 THEN a.storage_key ELSE NULL END,CASE WHEN length(CAST(a.availability AS BLOB))<=11 THEN a.availability ELSE NULL END FROM run_output_artifacts o LEFT JOIN artifacts a ON a.digest=o.artifact_digest WHERE o.project_id=? AND o.run_id=? ORDER BY o.artifact_digest LIMIT ?`, project, run, port.RunOutputLimit+1)
	if err != nil {
		return nil, normalizeError(err)
	}
	result := []port.RunOutput{}
	var readErr error
	for rows.Next() {
		if len(result) == port.RunOutputLimit {
			readErr = domain.StorageCorruptionError{Reason: "Run output capacity exceeded"}
			break
		}
		var digest, storedInput, artifactDigest string
		var epoch, generation, length int64
		var a port.Artifact
		if readErr = rows.Scan(&digest, &storedInput, &epoch, &generation, &artifactDigest, &a.MediaType, &length, &a.StorageKey, &a.Availability); readErr != nil {
			break
		}
		d, e := ParseStorageDigest(digest)
		ad, ae := ParseStorageDigest(artifactDigest)
		a.Digest = ad
		if length >= 0 {
			a.ByteLength = uint64(length)
		}
		if e != nil || ae != nil || d != ad || storedInput != input || epoch <= 0 || generation <= 0 || length < 0 || !verifiedOutputArtifact(a) {
			readErr = outputCorruption()
			break
		}
		result = append(result, port.RunOutput{ProjectID: project, RunID: run, InputDigest: inputDigest, ArtifactDigest: d, LeaseEpoch: uint64(epoch), RestoreGeneration: uint64(generation), Artifact: a})
	}
	if err = errors.Join(readErr, rows.Err(), rows.Close()); err != nil {
		return nil, outputReadError(ctx, err)
	}
	return result, nil
}

func (tx transaction) StoreRunOutput(ctx context.Context, w port.RunOutputWrite) error {
	f := w.Fence
	if f.ProjectID == "" || f.RunID == "" || f.InputDigest.IsZero() || f.Holder == "" || f.Epoch == 0 || f.Epoch > math.MaxInt64 || f.RestoreGeneration == 0 || f.RestoreGeneration > math.MaxInt64 || w.ArtifactDigest.IsZero() {
		return outputCorruption()
	}
	authority, err := tx.LoadRunAuthority(ctx, f.ProjectID, f.RunID)
	if err != nil {
		return err
	}
	if authority.Run.InputDigest != f.InputDigest || authority.RestoreGeneration != f.RestoreGeneration || authority.Lease.Fence.Holder != f.Holder || authority.Lease.Fence.Epoch != f.Epoch || authority.Lease.DeadlineNS < w.PublishedAtNS || authority.Outbox.ClaimEpoch != f.Epoch {
		return port.FenceRejection{Reason: "output publisher does not own unexpired current Run fence"}
	}
	r := authority.Run
	if r.ObservedState != "Succeeded" || r.ReconciliationState != "None" || r.SideEffectOutcome != "Confirmed" || r.DispatchState != "Acknowledged" || authority.Outbox.State != "Acknowledged" {
		return outputCorruption()
	}
	a, err := tx.loadOutputArtifact(ctx, w.ArtifactDigest)
	if err != nil {
		return err
	}
	if !verifiedOutputArtifact(a) {
		return outputCorruption()
	}
	outputs, err := tx.LoadRunOutputs(ctx, f.ProjectID, f.RunID)
	if err != nil {
		return err
	}
	for _, existing := range outputs {
		if existing.ArtifactDigest == w.ArtifactDigest {
			if existing.InputDigest != f.InputDigest || existing.LeaseEpoch != f.Epoch || existing.RestoreGeneration != f.RestoreGeneration || existing.Artifact != a {
				return outputCorruption()
			}
			return nil
		}
	}
	if len(outputs) == port.RunOutputLimit {
		return domain.StorageCorruptionError{Reason: "Run output capacity exceeded"}
	}
	_, err = tx.conn.ExecContext(ctx, `INSERT INTO run_output_artifacts(project_id,run_id,artifact_digest,input_digest,lease_epoch,restore_generation) VALUES(?,?,?,?,?,?)`, f.ProjectID, f.RunID, w.ArtifactDigest.String(), f.InputDigest.String(), f.Epoch, f.RestoreGeneration)
	return normalizeError(err)
}

// SQL bounds metadata before allocation; a malformed or missing historical join
// is corruption rather than an unclassified SQL conversion error.
func outputReadError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return errors.Join(ctx.Err(), err)
	}
	return errors.Join(outputCorruption(), normalizeError(err))
}
func (tx transaction) loadOutputArtifact(ctx context.Context, d domain.Digest) (port.Artifact, error) {
	var a port.Artifact
	var digest string
	var length int64
	err := tx.conn.QueryRowContext(ctx, `SELECT CASE WHEN length(CAST(digest AS BLOB))=64 THEN digest ELSE NULL END,CASE WHEN length(CAST(media_type AS BLOB)) BETWEEN 1 AND 160 THEN media_type ELSE NULL END,byte_length,CASE WHEN length(CAST(storage_key AS BLOB))=71 THEN storage_key ELSE NULL END,CASE WHEN length(CAST(availability AS BLOB))<=11 THEN availability ELSE NULL END FROM artifacts WHERE digest=?`, d.String()).Scan(&digest, &a.MediaType, &length, &a.StorageKey, &a.Availability)
	if errors.Is(err, sql.ErrNoRows) {
		return port.Artifact{}, normalizeError(err)
	}
	if err != nil {
		return port.Artifact{}, outputReadError(ctx, err)
	}
	parsed, err := ParseStorageDigest(digest)
	if err != nil || parsed != d || length < 0 {
		return port.Artifact{}, outputCorruption()
	}
	a.Digest = parsed
	a.ByteLength = uint64(length)
	if !verifiedOutputArtifact(a) {
		return port.Artifact{}, outputCorruption()
	}
	return a, nil
}
