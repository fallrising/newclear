package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func (tx transaction) LoadInitialAcceptanceState(ctx context.Context, project domain.ProjectID, ids []domain.WorkItemID) (port.InitialAcceptanceState, error) {
	s := port.InitialAcceptanceState{}
	if len(ids) == 0 || len(ids) > 256 {
		return s, admissionCorruption()
	}
	var e error
	s.Project, e = tx.LoadProject(ctx, project)
	if e != nil {
		return s, e
	}
	if e = tx.conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM project_spec_heads WHERE project_id=?)`, project).Scan(&s.ProjectHead); e != nil {
		return s, normalizeError(e)
	}
	seen := map[domain.WorkItemID]bool{}
	for _, id := range ids {
		if seen[id] {
			return s, admissionCorruption()
		}
		seen[id] = true
		item, e := tx.LoadWorkItem(ctx, project, id)
		if e != nil {
			return s, e
		}
		var head, run bool
		if e = tx.conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM work_item_spec_heads WHERE project_id=? AND work_item_id=?), EXISTS(SELECT 1 FROM runs WHERE project_id=? AND work_item_id=?)`, project, id, project, id).Scan(&head, &run); e != nil {
			return s, normalizeError(e)
		}
		s.Items = append(s.Items, item)
		s.ItemHeads = append(s.ItemHeads, head)
		s.RunHistory = append(s.RunHistory, run)
	}
	return s, nil
}
func initialACID(project domain.ProjectID, id domain.ACID, digest domain.Digest) string {
	return "ac_initial_" + domain.HashString(string(project)+"\x00"+string(id)+"\x00"+digest.String()).String()
}
func (tx transaction) verifyInitialAC(ctx context.Context, a port.ACRevision) (bool, error) {
	// Each predicate selects a unique key. Inspect both possible rows so an exact
	// legacy tuple cannot hide an occupied deterministic identity.
	rows, e := tx.conn.QueryContext(ctx, `SELECT project_id,ac_id,revision_digest,length(content),CASE WHEN length(content)<=65536 THEN content ELSE NULL END FROM ac_revisions WHERE (project_id=? AND ac_id=? AND revision_digest=?) OR (project_id=? AND ac_revision_id=?) LIMIT 2`, a.ProjectID, a.ACID, a.Digest.String(), a.ProjectID, initialACID(a.ProjectID, a.ACID, a.Digest))
	if e != nil {
		return false, normalizeError(e)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var p, ac, d string
		var size int
		var content []byte
		if e = rows.Scan(&p, &ac, &d, &size, &content); e != nil {
			return false, normalizeError(e)
		}
		if found || p != string(a.ProjectID) || ac != string(a.ACID) || d != a.Digest.String() || size < 0 || size > 65536 || domain.HashBytes(content) != a.Digest || !bytes.Equal(content, a.Content) {
			return false, admissionCorruption()
		}
		found = true
	}
	return found, normalizeError(rows.Err())
}
func (tx transaction) StoreInitialAcceptance(ctx context.Context, r port.InitialAcceptedRecord, acs []port.ACRevision, now int64) error {
	m := r.Material()
	p, e := tx.LoadProposal(ctx, m.Subject.ProjectID, mustStorageDigest(m.Subject.ProposalDigest))
	if e != nil {
		return e
	}
	verified, e := port.DecodeInitialAcceptedRecord(r.CanonicalJSON(), r.Digest(), p)
	if e != nil {
		return e
	}
	m = verified.Material()
	ids := make([]domain.WorkItemID, len(m.Subject.WorkItems))
	for i, w := range m.Subject.WorkItems {
		ids[i] = w.WorkItemID
	}
	s, e := tx.LoadInitialAcceptanceState(ctx, m.Subject.ProjectID, ids)
	if e != nil {
		return e
	}
	if s.ProjectHead || s.Project.Version != m.Subject.ExpectedVersion {
		return domain.Rejection{Code: domain.CodeVersionConflict}
	}
	for i, w := range m.Subject.WorkItems {
		if s.ItemHeads[i] || s.RunHistory[i] || s.Items[i].Phase() != domain.PhaseDraft || s.Items[i].Version() != w.ExpectedVersion {
			return domain.Rejection{Code: domain.CodeVersionConflict}
		}
	}
	if len(acs) != len(m.ACs) || now <= 0 {
		return admissionCorruption()
	}
	existing := make([]bool, len(acs))
	total := 0
	for i, a := range acs {
		total += len(a.Content)
		if a.ProjectID != m.Subject.ProjectID || a.ACID != m.ACs[i].ACID || a.Digest.String() != m.ACs[i].Digest || domain.HashBytes(a.Content) != a.Digest || len(a.Content) > 65536 || total > 512<<10 {
			return admissionCorruption()
		}
		existing[i], e = tx.verifyInitialAC(ctx, a)
		if e != nil {
			return e
		}
	}
	// All errors after this point must roll back the enclosing command transaction.
	for i, a := range acs {
		if !existing[i] {
			if a.Content == nil {
				a.Content = []byte{}
			}
			a.ID = initialACID(a.ProjectID, a.ACID, a.Digest)
			a.CreatedAtNS = now
			if e = tx.StoreACRevision(ctx, a); e != nil {
				return e
			}
		}
	}
	project := m.Subject.ProjectID
	digest := r.Digest().String()
	_, e = tx.conn.ExecContext(ctx, `INSERT INTO accepted_spec_revisions(project_id,accepted_revision_digest,proposal_digest,graph_revision_digest,normative_binding_digest,policy_revision_digest,acceptance_subject_digest,canonical_content,acceptance_kind,base_accepted_revision_digest,impact_plan_digest,activation_decision_digest,decision_value,accepted_by_actor,created_at_ns) VALUES(?,?,?,?,?,?,?,?,'Initial',NULL,NULL,NULL,NULL,?,?)`, project, digest, m.Subject.ProposalDigest, m.Subject.GraphDigest, m.NormativeBindingDigest, m.Subject.PolicyDigest, m.SubjectDigest, r.CanonicalJSON(), m.Actor, now)
	if e != nil {
		return normalizeError(e)
	}
	for _, a := range m.ACs {
		_, e = tx.conn.ExecContext(ctx, `INSERT INTO accepted_revision_acs(project_id,accepted_revision_digest,ac_id,ac_revision_digest) VALUES(?,?,?,?)`, project, digest, a.ACID, a.Digest)
		if e != nil {
			return normalizeError(e)
		}
	}
	for _, b := range m.Bindings {
		data, bd, e := port.InitialBindingCanonical(b)
		if e != nil {
			return e
		}
		_, e = tx.conn.ExecContext(ctx, `INSERT INTO accepted_work_item_bindings(project_id,accepted_revision_digest,work_item_id,binding_digest,canonical_content) VALUES(?,?,?,?,?)`, project, digest, b.WorkItemID, bd.String(), data)
		if e != nil {
			return normalizeError(e)
		}
		for _, a := range b.ACs {
			_, e = tx.conn.ExecContext(ctx, `INSERT INTO accepted_work_item_requirements(project_id,accepted_revision_digest,work_item_id,binding_digest,ac_id,ac_revision_digest) VALUES(?,?,?,?,?,?)`, project, digest, b.WorkItemID, bd.String(), a.ACID, a.Digest)
			if e != nil {
				return normalizeError(e)
			}
		}
	}
	_, e = tx.conn.ExecContext(ctx, `INSERT INTO project_spec_heads(project_id,accepted_revision_digest,head_version) VALUES(?,?,1)`, project, digest)
	if e != nil {
		return normalizeError(e)
	}
	for _, b := range m.Bindings {
		_, bd, _ := port.InitialBindingCanonical(b)
		_, e = tx.conn.ExecContext(ctx, `INSERT INTO work_item_spec_heads(project_id,work_item_id,accepted_revision_digest,binding_digest,head_version) VALUES(?,?,?,?,1)`, project, b.WorkItemID, digest, bd.String())
		if e != nil {
			return normalizeError(e)
		}
		for _, a := range b.ACs {
			_, e = tx.conn.ExecContext(ctx, `INSERT INTO current_ac_requirements(project_id,work_item_id,accepted_revision_digest,binding_digest,ac_id,ac_revision_digest) VALUES(?,?,?,?,?,?)`, project, b.WorkItemID, digest, bd.String(), a.ACID, a.Digest)
			if e != nil {
				return normalizeError(e)
			}
		}
	}
	result, e := tx.conn.ExecContext(ctx, `UPDATE projects SET version=version+1 WHERE project_id=? AND version=?`, project, m.Subject.ExpectedVersion)
	if e != nil {
		return normalizeError(e)
	}
	n, e := result.RowsAffected()
	if e != nil || n != 1 {
		return domain.Rejection{Code: domain.CodeVersionConflict}
	}
	for i, w := range m.Subject.WorkItems {
		next, e := s.Items[i].AdvanceDraftSpecificationVersion(w.ExpectedVersion)
		if e != nil {
			return e
		}
		if e = tx.UpdateWorkItem(ctx, next, w.ExpectedVersion); e != nil {
			return e
		}
	}
	return ctx.Err()
}
func mustStorageDigest(s string) domain.Digest { d, _ := domain.ParseDigest(s); return d }
func (tx transaction) LoadInitialAcceptance(ctx context.Context, project domain.ProjectID, digest domain.Digest) (port.InitialAcceptedRecord, error) {
	fail := func() (port.InitialAcceptedRecord, error) { return port.InitialAcceptedRecord{}, admissionCorruption() }
	var proposal, graph, normative, policy, subject, kind, actor string
	var size int
	var data []byte
	var base, plan, decision, value sql.NullString
	e := tx.conn.QueryRowContext(ctx, `SELECT proposal_digest,graph_revision_digest,normative_binding_digest,policy_revision_digest,acceptance_subject_digest,acceptance_kind,accepted_by_actor,base_accepted_revision_digest,impact_plan_digest,activation_decision_digest,decision_value,length(canonical_content),CASE WHEN length(canonical_content)<=? THEN canonical_content ELSE NULL END FROM accepted_spec_revisions WHERE project_id=? AND accepted_revision_digest=?`, port.InitialAcceptanceLimit, project, digest.String()).Scan(&proposal, &graph, &normative, &policy, &subject, &kind, &actor, &base, &plan, &decision, &value, &size, &data)
	if e != nil {
		return port.InitialAcceptedRecord{}, normalizeError(e)
	}
	if size <= 0 || size > port.InitialAcceptanceLimit || kind != "Initial" || base.Valid || plan.Valid || decision.Valid || value.Valid {
		return fail()
	}
	p, e := tx.LoadProposal(ctx, project, mustStorageDigest(proposal))
	if e != nil {
		return fail()
	}
	r, e := port.DecodeInitialAcceptedRecord(data, digest, p)
	if e != nil {
		return fail()
	}
	m := r.Material()
	if m.Subject.ProjectID != project || m.Subject.ProposalDigest != proposal || m.Subject.GraphDigest != graph || m.NormativeBindingDigest != normative || m.Subject.PolicyDigest != policy || m.SubjectDigest != subject || string(m.Actor) != actor {
		return fail()
	}
	if e = tx.checkInitialRows(ctx, project, digest, m); e != nil {
		return fail()
	}
	return r, nil
}
func (tx transaction) checkInitialRows(ctx context.Context, project domain.ProjectID, digest domain.Digest, m port.InitialAcceptedMaterial) error {
	// Count first to reject extras, then verify each complete identity against regenerated material.
	count := func(table string, want int) error {
		var n int
		e := tx.conn.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE project_id=? AND accepted_revision_digest=?", project, digest.String()).Scan(&n)
		if e != nil {
			return e
		}
		if n != want {
			return admissionCorruption()
		}
		return nil
	}
	reqCount := 0
	for _, b := range m.Bindings {
		reqCount += len(b.ACs)
	}
	for table, n := range map[string]int{"accepted_revision_acs": len(m.ACs), "accepted_work_item_bindings": len(m.Bindings), "accepted_work_item_requirements": reqCount} {
		if e := count(table, n); e != nil {
			return e
		}
	}
	totalContent := 0
	for _, a := range m.ACs {
		var d string
		if e := tx.conn.QueryRowContext(ctx, `SELECT ac_revision_digest FROM accepted_revision_acs WHERE project_id=? AND accepted_revision_digest=? AND ac_id=?`, project, digest.String(), a.ACID).Scan(&d); e != nil || d != a.Digest {
			return admissionCorruption()
		}
		var content []byte
		var size int
		e := tx.conn.QueryRowContext(ctx, `SELECT length(content),CASE WHEN length(content)<=65536 THEN content ELSE NULL END FROM ac_revisions WHERE project_id=? AND ac_id=? AND revision_digest=?`, project, a.ACID, a.Digest).Scan(&size, &content)
		totalContent += size
		if e != nil || size < 0 || size > 65536 || totalContent > 512<<10 || domain.HashBytes(content).String() != a.Digest {
			return admissionCorruption()
		}
	}
	for _, b := range m.Bindings {
		data, bd, _ := port.InitialBindingCanonical(b)
		var stored []byte
		var d string
		var size int
		e := tx.conn.QueryRowContext(ctx, `SELECT binding_digest,length(canonical_content),CASE WHEN length(canonical_content)<=? THEN canonical_content ELSE NULL END FROM accepted_work_item_bindings WHERE project_id=? AND accepted_revision_digest=? AND work_item_id=?`, port.InitialAcceptanceLimit, project, digest.String(), b.WorkItemID).Scan(&d, &size, &stored)
		if e != nil || d != bd.String() || size <= 0 || size > port.InitialAcceptanceLimit || !bytes.Equal(stored, data) {
			return admissionCorruption()
		}
		for _, a := range b.ACs {
			var n int
			e = tx.conn.QueryRowContext(ctx, `SELECT count(*) FROM accepted_work_item_requirements WHERE project_id=? AND accepted_revision_digest=? AND work_item_id=? AND binding_digest=? AND ac_id=? AND ac_revision_digest=?`, project, digest.String(), b.WorkItemID, bd.String(), a.ACID, a.Digest).Scan(&n)
			if e != nil || n != 1 {
				return admissionCorruption()
			}
		}
	}
	var current string
	e := tx.conn.QueryRowContext(ctx, `SELECT accepted_revision_digest FROM project_spec_heads WHERE project_id=?`, project).Scan(&current)
	if errors.Is(e, sql.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	if current != digest.String() {
		return nil
	}
	if e = count("work_item_spec_heads", len(m.Bindings)); e != nil {
		return e
	}
	if e = count("current_ac_requirements", reqCount); e != nil {
		return e
	}
	for _, b := range m.Bindings {
		_, bd, _ := port.InitialBindingCanonical(b)
		var n int
		e = tx.conn.QueryRowContext(ctx, `SELECT count(*) FROM work_item_spec_heads WHERE project_id=? AND work_item_id=? AND accepted_revision_digest=? AND binding_digest=? AND head_version>0`, project, b.WorkItemID, digest.String(), bd.String()).Scan(&n)
		if e != nil || n != 1 {
			return admissionCorruption()
		}
		for _, a := range b.ACs {
			e = tx.conn.QueryRowContext(ctx, `SELECT count(*) FROM current_ac_requirements WHERE project_id=? AND work_item_id=? AND accepted_revision_digest=? AND binding_digest=? AND ac_id=? AND ac_revision_digest=?`, project, b.WorkItemID, digest.String(), bd.String(), a.ACID, a.Digest).Scan(&n)
			if e != nil || n != 1 {
				return fmt.Errorf("%w", admissionCorruption())
			}
		}
	}
	return nil
}
