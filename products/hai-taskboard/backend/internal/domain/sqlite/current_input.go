package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var _ port.CurrentInputTransaction = transaction{}

func inputCorruption() error {
	return domain.StorageCorruptionError{Reason: "current specification or Run input mismatch"}
}

func (tx transaction) LoadCurrentSpecification(ctx context.Context, project domain.ProjectID, item domain.WorkItemID) (port.CurrentSpecification, error) {
	fail := func() (port.CurrentSpecification, error) { return port.CurrentSpecification{}, inputCorruption() }
	if project == "" || item == "" {
		return fail()
	}
	var pd, wd, bd string
	var pv, wv int64
	// Read both head identities, then require the same exact accepted revision.
	e := tx.conn.QueryRowContext(ctx, `SELECT p.accepted_revision_digest,p.head_version,w.accepted_revision_digest,w.binding_digest,w.head_version FROM project_spec_heads p JOIN work_item_spec_heads w ON w.project_id=p.project_id WHERE p.project_id=? AND w.work_item_id=?`, project, item).Scan(&pd, &pv, &wd, &bd, &wv)
	if e != nil {
		return port.CurrentSpecification{}, normalizeError(e)
	}
	digest, e := ParseStorageDigest(pd)
	binding, be := ParseStorageDigest(bd)
	if e != nil || be != nil || digest.IsZero() || binding.IsZero() || wd != pd || pv <= 0 || wv <= 0 {
		return fail()
	}
	var kind string
	if e = tx.conn.QueryRowContext(ctx, `SELECT acceptance_kind FROM accepted_spec_revisions WHERE project_id=? AND accepted_revision_digest=?`, project, pd).Scan(&kind); e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return fail()
		}
		return port.CurrentSpecification{}, normalizeError(e)
	}
	if kind == "Impact" {
		return port.CurrentSpecification{}, port.ErrUnsupportedAcceptedKind
	}
	if kind != "Initial" {
		return fail()
	}
	r, e := tx.LoadInitialAcceptance(ctx, project, digest)
	if e != nil {
		if ctx.Err() != nil {
			return port.CurrentSpecification{}, ctx.Err()
		}
		return port.CurrentSpecification{}, e
	}
	m := r.Material()
	result := port.CurrentSpecification{ProjectID: project, WorkItemID: item, ProjectHeadVersion: uint64(pv), WorkItemHeadVersion: uint64(wv), AcceptedRevisionDigest: digest, BindingDigest: binding, GraphRevisionDigest: mustStorageDigest(m.Subject.GraphDigest), PolicyRevisionDigest: mustStorageDigest(m.Subject.PolicyDigest)}
	var found *port.InitialItemBinding
	for _, b := range m.Bindings {
		if b.WorkItemID == item {
			found = &b
			break
		}
	}
	if found == nil || found.ProjectID != project {
		return fail()
	}
	_, expected, e := port.InitialBindingCanonical(*found)
	if e != nil || expected != binding || len(found.ACs) == 0 || len(found.ACs) > 256 || len(found.Nodes) == 0 {
		return fail()
	}
	for _, node := range found.Nodes {
		recipe, e := ParseStorageDigest(node.Recipe)
		if e != nil || recipe.IsZero() || (!result.RecipeDigest.IsZero() && result.RecipeDigest != recipe) {
			return fail()
		}
		result.RecipeDigest = recipe
	}
	// Independent complete bounded read: no legacy requirement fallback, and no
	// truncation can hide an extra row. Accepted-record verification checked all
	// other current item sets against the authenticated proposal as well.
	rows, e := tx.conn.QueryContext(ctx, `SELECT accepted_revision_digest,binding_digest,ac_id,ac_revision_digest FROM current_ac_requirements WHERE project_id=? AND work_item_id=? ORDER BY ac_id LIMIT 257`, project, item)
	if e != nil {
		return port.CurrentSpecification{}, normalizeError(e)
	}
	i := 0
	for rows.Next() {
		var revision, binding, ac, d string
		if e = rows.Scan(&revision, &binding, &ac, &d); e != nil {
			rows.Close()
			return port.CurrentSpecification{}, normalizeError(e)
		}
		if i >= len(found.ACs) || revision != pd || binding != bd || ac != string(found.ACs[i].ACID) || d != found.ACs[i].Digest {
			rows.Close()
			return fail()
		}
		result.Requirements = append(result.Requirements, port.ACRequirement{ProjectID: project, WorkItemID: item, ACID: domain.ACID(ac), RevisionDigest: mustStorageDigest(d)})
		i++
	}
	if e = errors.Join(rows.Err(), rows.Close()); e != nil {
		return port.CurrentSpecification{}, normalizeError(e)
	}
	if i != len(found.ACs) {
		return fail()
	}
	total := 0
	for _, a := range result.Requirements {
		var id string
		var size int
		var data []byte
		var stamp int64
		e = tx.conn.QueryRowContext(ctx, `SELECT ac_revision_id,length(content),CASE WHEN length(content)<=65536 THEN content ELSE NULL END,created_at_ns FROM ac_revisions WHERE project_id=? AND ac_id=? AND revision_digest=?`, project, a.ACID, a.RevisionDigest.String()).Scan(&id, &size, &data, &stamp)
		if e != nil {
			if errors.Is(e, sql.ErrNoRows) {
				return fail()
			}
			return port.CurrentSpecification{}, normalizeError(e)
		}
		total += size
		if size < 0 || size > 65536 || total > 512<<10 || domain.HashBytes(data) != a.RevisionDigest {
			return fail()
		}
		result.ACContents = append(result.ACContents, port.ACRevision{ID: id, ProjectID: project, ACID: a.ACID, Digest: a.RevisionDigest, Content: bytes.Clone(data), CreatedAtNS: stamp})
	}
	return result, nil
}

// checkInputRun does not require an outbox on writes: execute installs it later.
func (tx transaction) checkInputRun(ctx context.Context, id domain.RunID, v port.RunInput, outbox bool) error {
	m := v.Material()
	if id == "" {
		return inputCorruption()
	}
	var item, d, adapter, version, scenario string
	e := tx.conn.QueryRowContext(ctx, `SELECT work_item_id,input_digest,adapter_id,adapter_version,scenario_id FROM runs WHERE project_id=? AND run_id=?`, m.ProjectID, id).Scan(&item, &d, &adapter, &version, &scenario)
	if e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return inputCorruption()
		}
		return normalizeError(e)
	}
	if item != string(m.WorkItemID) || d != v.Digest().String() || adapter != m.AdapterID || version != m.AdapterVersion || scenario != m.ScenarioID {
		return inputCorruption()
	}
	if !outbox {
		return nil
	}
	rows, e := tx.conn.QueryContext(ctx, `SELECT payload_digest FROM outbox WHERE project_id=? AND run_id=? LIMIT 2`, m.ProjectID, id)
	if e != nil {
		return normalizeError(e)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var stored string
		if e = rows.Scan(&stored); e != nil {
			return normalizeError(e)
		}
		count++
		if stored != d || count > 1 {
			return inputCorruption()
		}
	}
	if e = rows.Err(); e != nil {
		return normalizeError(e)
	}
	if count != 1 {
		return inputCorruption()
	}
	return nil
}
func (tx transaction) loadInputBytes(ctx context.Context, project domain.ProjectID, run domain.RunID) (port.RunInputEnvelope, error) {
	var item, d string
	var codec, size int
	var data []byte
	e := tx.conn.QueryRowContext(ctx, `SELECT work_item_id,codec_version,input_digest,length(canonical_content),CASE WHEN length(canonical_content)<=? THEN canonical_content ELSE NULL END FROM run_input_envelopes WHERE project_id=? AND run_id=?`, port.RunInputLimit, project, run).Scan(&item, &codec, &d, &size, &data)
	if e != nil {
		return port.RunInputEnvelope{}, normalizeError(e)
	}
	digest, e := ParseStorageDigest(d)
	if e != nil || codec != 1 || size <= 0 || size > port.RunInputLimit {
		return port.RunInputEnvelope{}, inputCorruption()
	}
	input, e := port.DecodeRunInput(data, digest)
	if e != nil {
		return port.RunInputEnvelope{}, e
	}
	m := input.Material()
	if m.ProjectID != project || string(m.WorkItemID) != item {
		return port.RunInputEnvelope{}, inputCorruption()
	}
	return port.RunInputEnvelope{RunID: run, Input: input}, nil
}
func (tx transaction) StoreRunInput(ctx context.Context, envelope port.RunInputEnvelope) error {
	v, e := port.DecodeRunInput(envelope.Input.CanonicalJSON(), envelope.Input.Digest())
	if e != nil {
		return e
	}
	if e = tx.checkInputRun(ctx, envelope.RunID, v, false); e != nil {
		return e
	}
	m := v.Material()
	existing, e := tx.loadInputBytes(ctx, m.ProjectID, envelope.RunID)
	if e == nil { // Exact replay verifies the bytes actually persisted.
		if existing.Input.Digest() != v.Digest() || !bytes.Equal(existing.Input.CanonicalJSON(), v.CanonicalJSON()) {
			return inputCorruption()
		}
		return nil
	}
	if !errors.Is(e, port.ErrNotFound) {
		return e
	}
	_, e = tx.conn.ExecContext(ctx, `INSERT INTO run_input_envelopes(project_id,run_id,work_item_id,codec_version,input_digest,canonical_content) VALUES(?,?,?,1,?,?)`, m.ProjectID, envelope.RunID, m.WorkItemID, v.Digest().String(), v.CanonicalJSON())
	return normalizeError(e)
}
func (tx transaction) LoadRunInput(ctx context.Context, project domain.ProjectID, run domain.RunID) (port.RunInputEnvelope, error) {
	if project == "" || run == "" {
		return port.RunInputEnvelope{}, inputCorruption()
	}
	envelope, e := tx.loadInputBytes(ctx, project, run)
	if e != nil {
		return port.RunInputEnvelope{}, e
	}
	if e = tx.checkInputRun(ctx, run, envelope.Input, true); e != nil {
		return port.RunInputEnvelope{}, e
	}
	return envelope, nil
}
