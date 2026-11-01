package sqlite

import (
	"bytes"
	"context"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

const admissionByteLimit = 16 << 20

func admissionCorruption() error {
	return domain.StorageCorruptionError{Reason: "proposal provenance or canonical bytes mismatch"}
}
func (tx transaction) LoadProject(ctx context.Context, id domain.ProjectID) (port.Project, error) {
	var p port.Project
	err := tx.conn.QueryRowContext(ctx, `SELECT project_id,canonical_name,repository,repository_ref,version FROM projects WHERE project_id=?`, id).Scan(&p.ID, &p.Name, &p.Repository, &p.Ref, &p.Version)
	return p, normalizeError(err)
}
func (tx transaction) loadRepositoryBinding(ctx context.Context, b specification.RepositoryBinding) (port.ApprovedRepository, []byte, error) {
	var p, id, digest, format, actor string
	var version uint64
	var data []byte
	var size int64
	err := tx.conn.QueryRowContext(ctx, `SELECT project_id,repository_binding_id,binding_version,binding_digest,object_format,approved_by_actor,length(binding_content),CASE WHEN length(binding_content)<=? THEN binding_content ELSE NULL END FROM repository_binding_versions WHERE project_id=? AND repository_binding_id=? AND binding_version=?`, admissionByteLimit, b.ProjectID, b.ID, b.Version).Scan(&p, &id, &version, &digest, &format, &actor, &size, &data)
	if err != nil {
		return port.ApprovedRepository{}, nil, normalizeError(err)
	}
	d, err := ParseStorageDigest(digest)
	if err != nil || size <= 0 || size > admissionByteLimit {
		return port.ApprovedRepository{}, nil, admissionCorruption()
	}
	v, err := port.DecodeRepositoryBinding(data, d)
	if err != nil || string(v.Binding.ProjectID) != p || v.Binding.ID != id || v.Binding.Version != version || string(v.Binding.ObjectFormat) != format || string(v.ApprovedBy) != actor {
		return port.ApprovedRepository{}, nil, admissionCorruption()
	}
	return v, data, nil
}
func (tx transaction) loadNormative(ctx context.Context, project domain.ProjectID, digest domain.Digest) ([]byte, error) {
	var data []byte
	var size int64
	err := tx.conn.QueryRowContext(ctx, `SELECT length(content),CASE WHEN length(content)<=? THEN content ELSE NULL END FROM dependency_revisions WHERE project_id=? AND graph_revision_digest=?`, admissionByteLimit, project, digest.String()).Scan(&size, &data)
	if err != nil {
		return nil, normalizeError(err)
	}
	if size <= 0 || size > admissionByteLimit || domain.HashBytes(data) != digest {
		return nil, admissionCorruption()
	}
	return data, nil
}
func (tx transaction) LoadProposal(ctx context.Context, project domain.ProjectID, digest domain.Digest) (specification.Proposal, error) {
	var p, id, format, commit, path, oid, manifest, graph string
	var version uint64
	var schema int
	var size int64
	var data []byte
	err := tx.conn.QueryRowContext(ctx, `SELECT project_id,schema_version,repository_binding_id,binding_version,object_format,commit_oid,manifest_path,manifest_blob_oid,manifest_digest,graph_revision_digest,length(canonical_content),CASE WHEN length(canonical_content)<=? THEN canonical_content ELSE NULL END FROM specification_proposals WHERE project_id=? AND proposal_digest=?`, admissionByteLimit, project, digest.String()).Scan(&p, &schema, &id, &version, &format, &commit, &path, &oid, &manifest, &graph, &size, &data)
	if err != nil {
		return specification.Proposal{}, normalizeError(err)
	}
	if size <= 0 || size > admissionByteLimit {
		return specification.Proposal{}, admissionCorruption()
	}
	proposal, err := specification.DecodeCanonicalProposal(data, digest)
	if err != nil {
		return specification.Proposal{}, admissionCorruption()
	}
	b := proposal.Binding()
	if p != string(project) || b.ProjectID != project || schema != 1 || b.ID != id || b.Version != version || string(b.ObjectFormat) != format || proposal.Commit().String() != commit || proposal.ManifestPath() != path || proposal.ManifestBlobOID().String() != oid || proposal.ManifestDigest().String() != manifest || proposal.Graph().Revision().String() != graph {
		return specification.Proposal{}, admissionCorruption()
	}
	binding, _, err := tx.loadRepositoryBinding(ctx, b)
	if err != nil {
		if errors.Is(err, port.ErrNotFound) {
			return specification.Proposal{}, admissionCorruption()
		}
		return specification.Proposal{}, err
	}
	if binding.Binding != b {
		return specification.Proposal{}, admissionCorruption()
	}
	normative, err := tx.loadNormative(ctx, project, proposal.Graph().Revision())
	if err != nil {
		if errors.Is(err, port.ErrNotFound) {
			return specification.Proposal{}, admissionCorruption()
		}
		return specification.Proposal{}, err
	}
	if !bytes.Equal(normative, proposal.NormativeJSON()) {
		return specification.Proposal{}, admissionCorruption()
	}
	return proposal, nil
}

func (tx transaction) StoreProposal(ctx context.Context, approved port.ApprovedRepository, proposal specification.Proposal, now int64) error {
	canonical, bindingDigest, err := port.CanonicalRepositoryBinding(approved)
	if err != nil || bindingDigest != approved.Binding.Digest || proposal.Binding() != approved.Binding || now <= 0 {
		return admissionCorruption()
	}
	verified, err := specification.DecodeCanonicalProposal(proposal.CanonicalJSON(), proposal.Digest())
	if err != nil || !bytes.Equal(verified.NormativeJSON(), proposal.NormativeJSON()) {
		return admissionCorruption()
	}
	// Complete every rejection/collision check before the first insert.
	binding, stored, err := tx.loadRepositoryBinding(ctx, approved.Binding)
	newBinding := errors.Is(err, port.ErrNotFound)
	if err != nil && !newBinding {
		return err
	}
	if !newBinding && (binding.Binding != approved.Binding || !bytes.Equal(stored, canonical)) {
		return admissionCorruption()
	}
	normative, err := tx.loadNormative(ctx, approved.Binding.ProjectID, proposal.Graph().Revision())
	newGraph := errors.Is(err, port.ErrNotFound)
	if err != nil && !newGraph {
		return err
	}
	if !newGraph && !bytes.Equal(normative, proposal.NormativeJSON()) {
		return admissionCorruption()
	}
	prior, err := tx.LoadProposal(ctx, approved.Binding.ProjectID, proposal.Digest())
	newProposal := errors.Is(err, port.ErrNotFound)
	if err != nil && !newProposal {
		return err
	}
	if !newProposal && !bytes.Equal(prior.CanonicalJSON(), proposal.CanonicalJSON()) {
		return admissionCorruption()
	}
	if !newProposal {
		return nil
	}
	b := approved.Binding
	if newBinding {
		_, err = tx.conn.ExecContext(ctx, `INSERT INTO repository_binding_versions(project_id,repository_binding_id,binding_version,binding_digest,object_format,binding_content,approved_by_actor,created_at_ns) VALUES(?,?,?,?,?,?,?,?)`, b.ProjectID, b.ID, b.Version, b.Digest.String(), b.ObjectFormat, canonical, approved.ApprovedBy, now)
		if err != nil {
			return normalizeError(err)
		}
	}
	if newGraph {
		if err = tx.StoreDependencyRevision(ctx, port.DependencyRevision{ProjectID: b.ProjectID, Digest: proposal.Graph().Revision(), Content: proposal.NormativeJSON(), CreatedAtNS: now}); err != nil {
			return err
		}
	}
	_, err = tx.conn.ExecContext(ctx, `INSERT INTO specification_proposals(project_id,proposal_digest,schema_version,repository_binding_id,binding_version,object_format,commit_oid,manifest_path,manifest_blob_oid,manifest_digest,graph_revision_digest,canonical_content,created_at_ns) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, b.ProjectID, proposal.Digest().String(), 1, b.ID, b.Version, b.ObjectFormat, proposal.Commit().String(), proposal.ManifestPath(), proposal.ManifestBlobOID().String(), proposal.ManifestDigest().String(), proposal.Graph().Revision().String(), proposal.CanonicalJSON(), now)
	return normalizeError(err)
}
