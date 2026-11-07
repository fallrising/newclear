package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"maps"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var _ port.PolicyProfileRegistrar = (*Store)(nil)

func policyConfigurationError() error {
	return errors.New("project completion policy registration requires compatible configuration and history")
}
func policyCorruption() error {
	return domain.StorageCorruptionError{Reason: "project completion policy registration or accepted history mismatch"}
}

// RegisterPolicyProfiles runs before runtime construction. It never repairs persisted history.
func (s *Store) RegisterPolicyProfiles(ctx context.Context, selected map[domain.ProjectID]port.PolicyProfile, now int64) error {
	if len(selected) > 32 || now <= 0 {
		return policyConfigurationError()
	}
	selected = maps.Clone(selected)
	for id, p := range selected {
		v, err := port.DecodePolicyProfile(p.CanonicalJSON(), p.Digest())
		if err != nil || v.Material().ProjectID != id {
			return policyConfigurationError()
		}
	}
	return s.immediate(ctx, func(conn *sql.Conn) error {
		rows, err := conn.QueryContext(ctx, `SELECT project_id,codec_version,revision_digest,length(canonical_content),CASE WHEN length(canonical_content)<=262144 THEN canonical_content ELSE NULL END,registered_at_ns FROM project_completion_policies ORDER BY project_id LIMIT 33`)
		if err != nil {
			return normalizeError(err)
		}
		stored := map[domain.ProjectID]port.PolicyProfile{}
		for rows.Next() {
			var id domain.ProjectID
			var version, size int
			var digest string
			var data []byte
			var stamp int64
			if err = rows.Scan(&id, &version, &digest, &size, &data, &stamp); err != nil {
				rows.Close()
				return normalizeError(err)
			}
			d, e := ParseStorageDigest(digest)
			p, decodeErr := port.DecodePolicyProfile(data, d)
			if e != nil || decodeErr != nil || version != 1 || size < 1 || size > port.PolicyProfilesLimit || stamp <= 0 || p.Material().ProjectID != id || len(stored) >= 32 {
				rows.Close()
				return policyCorruption()
			}
			chosen, ok := selected[id]
			if !ok || p.Digest() != chosen.Digest() || !bytes.Equal(p.CanonicalJSON(), chosen.CanonicalJSON()) {
				rows.Close()
				return policyConfigurationError()
			}
			stored[id] = p
		}
		if err = errors.Join(rows.Err(), rows.Close()); err != nil {
			return normalizeError(err)
		}
		// Validate all projects before inserting any registration; writer lock covers both phases.
		for _, id := range slices.Sorted(maps.Keys(selected)) {
			var count int
			if err = conn.QueryRowContext(ctx, `SELECT count(*) FROM projects WHERE project_id=?`, id).Scan(&count); err != nil {
				return normalizeError(err)
			}
			if count != 1 {
				return policyConfigurationError()
			}
			_, registered := stored[id]
			if err = checkPolicyHistory(ctx, conn, id, selected[id], registered); err != nil {
				return err
			}
		}
		for _, id := range slices.Sorted(maps.Keys(selected)) {
			if _, ok := stored[id]; ok {
				continue
			}
			p := selected[id]
			if _, err = conn.ExecContext(ctx, `INSERT INTO project_completion_policies(project_id,codec_version,revision_digest,canonical_content,registered_at_ns) VALUES(?,1,?,?,?)`, id, p.Digest().String(), p.CanonicalJSON(), now); err != nil {
				return normalizeError(err)
			}
		}
		return nil
	})
}

func checkPolicyHistory(ctx context.Context, conn *sql.Conn, id domain.ProjectID, p port.PolicyProfile, registered bool) error {
	counts := map[string]int{}
	for _, table := range []string{"accepted_spec_revisions", "project_spec_heads", "work_item_spec_heads", "current_ac_requirements", "runs"} {
		var n int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE project_id=?", id).Scan(&n); err != nil {
			return normalizeError(err)
		}
		counts[table] = n
	}
	// Inspect references even on first registration: a dangling row is corruption,
	// not a headless project or a candidate for implicit policy adoption.
	for _, query := range []string{
		`SELECT count(*) FROM project_spec_heads h LEFT JOIN accepted_spec_revisions a ON a.project_id=h.project_id AND a.accepted_revision_digest=h.accepted_revision_digest WHERE h.project_id=? AND a.accepted_revision_digest IS NULL`,
		`SELECT count(*) FROM work_item_spec_heads w LEFT JOIN project_spec_heads p ON p.project_id=w.project_id AND p.accepted_revision_digest=w.accepted_revision_digest LEFT JOIN accepted_work_item_bindings b ON b.project_id=w.project_id AND b.accepted_revision_digest=w.accepted_revision_digest AND b.work_item_id=w.work_item_id AND b.binding_digest=w.binding_digest WHERE w.project_id=? AND (p.project_id IS NULL OR b.project_id IS NULL)`,
		`SELECT count(*) FROM current_ac_requirements r LEFT JOIN work_item_spec_heads w ON w.project_id=r.project_id AND w.work_item_id=r.work_item_id AND w.accepted_revision_digest=r.accepted_revision_digest AND w.binding_digest=r.binding_digest LEFT JOIN accepted_work_item_requirements a ON a.project_id=r.project_id AND a.accepted_revision_digest=r.accepted_revision_digest AND a.work_item_id=r.work_item_id AND a.binding_digest=r.binding_digest AND a.ac_id=r.ac_id AND a.ac_revision_digest=r.ac_revision_digest WHERE r.project_id=? AND (w.project_id IS NULL OR a.project_id IS NULL)`,
	} {
		var orphaned int
		if err := conn.QueryRowContext(ctx, query, id).Scan(&orphaned); err != nil {
			return normalizeError(err)
		}
		if orphaned != 0 {
			return policyCorruption()
		}
	}
	if counts["project_spec_heads"] == 0 && (counts["work_item_spec_heads"] != 0 || counts["current_ac_requirements"] != 0) {
		return policyCorruption()
	}
	if !registered {
		for _, n := range counts {
			if n != 0 {
				return policyConfigurationError()
			}
		}
		return nil
	}
	if counts["project_spec_heads"] == 0 {
		if counts["accepted_spec_revisions"] != 0 || counts["runs"] != 0 {
			return policyCorruption()
		}
		return nil
	}
	if counts["project_spec_heads"] != 1 || counts["accepted_spec_revisions"] != 1 {
		return policyCorruption()
	}
	var head string
	var version int64
	if err := conn.QueryRowContext(ctx, `SELECT accepted_revision_digest,head_version FROM project_spec_heads WHERE project_id=?`, id).Scan(&head, &version); err != nil {
		return normalizeError(err)
	}
	d, err := ParseStorageDigest(head)
	if err != nil || version <= 0 {
		return policyCorruption()
	}
	record, err := (transaction{conn: conn}).LoadInitialAcceptance(ctx, id, d)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return policyCorruption()
	}
	m, profile := record.Material(), p.Material()
	if m.Subject.PolicyDigest != p.Digest().String() {
		return policyConfigurationError()
	}
	checks := map[domain.ACID]bool{}
	for _, rule := range profile.Rules {
		checks[rule.ACID] = true
	}
	for _, ac := range m.ACs {
		if !checks[ac.ACID] {
			return policyConfigurationError()
		}
	}
	required := 0
	for _, binding := range m.Bindings {
		required += len(binding.ACs)
		for _, node := range binding.Nodes {
			if node.Recipe != profile.RecipeDigest {
				return policyConfigurationError()
			}
		}
	}
	if counts["work_item_spec_heads"] != len(m.Bindings) || counts["current_ac_requirements"] != required {
		return policyCorruption()
	}
	return nil
}
