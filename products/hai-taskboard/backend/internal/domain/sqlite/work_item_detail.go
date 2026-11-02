package sqlite

import (
	"context"
	"database/sql"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var _ port.WorkItemDetailReader = (*Store)(nil)

func detailCorruption() error {
	return domain.StorageCorruptionError{Reason: "invalid work item detail storage"}
}

// detailAttribution maps stored audit to WorkItems for one project snapshot.
type detailAttribution struct {
	groups   map[string][]domain.WorkItemID // audit group -> addressed WorkItems
	commands map[string]port.ResultOwner    // audit group -> decoded result owner
	subjects map[domain.Digest]domain.WorkItemID
	conflict map[domain.Digest]bool
}

func (store *Store) ReadWorkItemDetail(ctx context.Context, project domain.ProjectID, item domain.WorkItemID, decode port.ResultOwnerDecoder) (port.WorkItemDetail, error) {
	var result port.WorkItemDetail
	if decode == nil {
		return result, detailCorruption()
	}
	err := store.readProjection(ctx, func(conn *sql.Conn) error {
		var err error
		result, err = store.readWorkItemDetail(ctx, conn, project, item, decode)
		return err
	})
	if err != nil {
		return port.WorkItemDetail{}, err
	}
	return result, nil
}

// This connection must already be inside readProjection, as for the material
// index; keeping it connection-local permits WAL snapshot regression tests.
func (store *Store) readWorkItemDetail(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID, decode port.ResultOwnerDecoder) (port.WorkItemDetail, error) {
	var result port.WorkItemDetail
	var err error
	if result.Material, err = store.readWorkItemMaterialIndex(ctx, conn, project, item); err != nil {
		return result, err
	}
	result.Summary = port.BoardWorkItem{ID: item, Title: result.Material.Title, OwnerID: result.Material.OwnerID}
	if err = store.boardItem(ctx, conn, project, &result.Summary); err != nil {
		return result, err
	}
	if result.Blockers, err = detailBlockers(ctx, conn, project, item); err != nil {
		return result, err
	}
	attribution, err := detailAttribute(ctx, conn, project, decode)
	if err != nil {
		return result, err
	}
	if result.Audit, err = detailAudit(ctx, conn, project, item, attribution); err != nil {
		return result, err
	}
	if result.Reviews, err = detailReviews(ctx, conn, project, item, attribution); err != nil {
		return result, err
	}
	if result.Evidence, err = detailEvidence(ctx, conn, project, item, attribution); err != nil {
		return result, err
	}
	if result.Approvals, err = detailApprovals(ctx, conn, project, item, attribution); err != nil {
		return result, err
	}
	result.CompletionRecords, err = detailCompletions(ctx, conn, project, item)
	return result, err
}

func detailAppend[T any](list []T, value T) ([]T, error) {
	if len(list) == port.MaterialIndexRowLimit {
		return list, port.ErrWorkItemDetailCapacity
	}
	return append(list, value), nil
}

func detailDigest(text string) (domain.Digest, error) {
	digest, err := ParseStorageDigest(text)
	if err != nil {
		return digest, detailCorruption()
	}
	return digest, nil
}

func detailOptionalDigest(text sql.NullString) (*domain.Digest, error) {
	if !text.Valid {
		return nil, nil
	}
	digest, err := detailDigest(text.String)
	return &digest, err
}

func detailBlockers(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID) ([]port.DetailBlocker, error) {
	rows, err := conn.QueryContext(ctx, `SELECT blocker_id,reason,resolved_at_ns FROM work_item_blockers WHERE project_id=? AND work_item_id=? ORDER BY blocker_id COLLATE BINARY`, project, item)
	if err != nil {
		return nil, normalizeError(err)
	}
	defer rows.Close()
	result := []port.DetailBlocker{}
	for rows.Next() {
		var value port.DetailBlocker
		var resolved sql.NullInt64
		if err := rows.Scan(&value.ID, &value.Reason, &resolved); err != nil {
			return nil, normalizeError(err)
		}
		if !materialIndexValidText(value.ID, 80) || !materialIndexValidText(value.Reason, 2000) || resolved.Valid && resolved.Int64 <= 0 {
			return nil, detailCorruption()
		}
		if resolved.Valid {
			value.ResolvedAtNS = &resolved.Int64
		}
		if result, err = detailAppend(result, value); err != nil {
			return nil, err
		}
	}
	return result, normalizeError(rows.Err())
}

// detailAttribute decodes every project audit group's command result once and
// records which WorkItem each audited subject digest belongs to. Acceptance
// groups address every WorkItem their accepted revision binds.
func detailAttribute(ctx context.Context, conn *sql.Conn, project domain.ProjectID, decode port.ResultOwnerDecoder) (detailAttribution, error) {
	a := detailAttribution{groups: map[string][]domain.WorkItemID{}, commands: map[string]port.ResultOwner{}, subjects: map[domain.Digest]domain.WorkItemID{}, conflict: map[domain.Digest]bool{}}
	rows, err := conn.QueryContext(ctx, `SELECT g.audit_group_id,g.command_id,c.result_payload FROM audit_groups g LEFT JOIN command_results c ON c.project_id=g.project_id AND c.command_id=g.command_id WHERE g.project_id=?`, project)
	if err != nil {
		return a, normalizeError(err)
	}
	decoded := map[string]port.ResultOwner{}
	revisions := map[domain.Digest][]domain.WorkItemID{}
	type group struct{ id, command string }
	pending := []group{}
	for rows.Next() {
		var g group
		var payload []byte
		if err := rows.Scan(&g.id, &g.command, &payload); err != nil {
			rows.Close()
			return a, normalizeError(err)
		}
		if _, ok := decoded[g.command]; !ok {
			if payload == nil {
				rows.Close()
				return a, detailCorruption()
			}
			owner, err := decode(payload, g.command)
			if err != nil {
				rows.Close()
				return a, detailCorruption()
			}
			decoded[g.command] = owner
			if !owner.AcceptedRevisionDigest.IsZero() {
				revisions[owner.AcceptedRevisionDigest] = nil
			}
		}
		pending = append(pending, g)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return a, normalizeError(err)
	}
	if err := rows.Close(); err != nil {
		return a, normalizeError(err)
	}
	for revision := range revisions {
		bound, err := conn.QueryContext(ctx, `SELECT work_item_id FROM accepted_work_item_bindings WHERE project_id=? AND accepted_revision_digest=? ORDER BY work_item_id COLLATE BINARY`, project, revision.String())
		if err != nil {
			return a, normalizeError(err)
		}
		items := []domain.WorkItemID{}
		for bound.Next() {
			var id domain.WorkItemID
			if err := bound.Scan(&id); err != nil {
				bound.Close()
				return a, normalizeError(err)
			}
			items = append(items, id)
		}
		if err := bound.Close(); err != nil {
			return a, normalizeError(err)
		}
		revisions[revision] = items
	}
	for _, g := range pending {
		owner := decoded[g.command]
		a.commands[g.id] = owner
		switch {
		case owner.WorkItemID != "":
			a.groups[g.id] = []domain.WorkItemID{owner.WorkItemID}
		case !owner.AcceptedRevisionDigest.IsZero():
			a.groups[g.id] = revisions[owner.AcceptedRevisionDigest]
		}
	}
	entries, err := conn.QueryContext(ctx, `SELECT audit_group_id,subject_digest FROM audit_entries WHERE project_id=?`, project)
	if err != nil {
		return a, normalizeError(err)
	}
	defer entries.Close()
	for entries.Next() {
		var groupID, subject string
		if err := entries.Scan(&groupID, &subject); err != nil {
			return a, normalizeError(err)
		}
		digest, err := detailDigest(subject)
		if err != nil {
			return a, err
		}
		// Only results naming exactly one WorkItem attribute a subject.
		if owner := a.commands[groupID]; owner.WorkItemID != "" {
			if previous, seen := a.subjects[digest]; seen && previous != owner.WorkItemID {
				a.conflict[digest] = true
			}
			a.subjects[digest] = owner.WorkItemID
		}
	}
	return a, normalizeError(entries.Err())
}

// owns reports whether a stored row's subject belongs to item. A subject with
// no attributing audit entry, or attributed to two items, is corruption.
func (a detailAttribution) owns(subject domain.Digest, item domain.WorkItemID) (bool, error) {
	owner, ok := a.subjects[subject]
	if !ok || a.conflict[subject] {
		return false, detailCorruption()
	}
	return owner == item, nil
}

func detailAudit(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID, a detailAttribution) ([]port.DetailAuditEntry, error) {
	rows, err := conn.QueryContext(ctx, `SELECT e.audit_sequence,e.audit_group_id,g.command_id,e.actor_id,e.operation,e.subject_digest,e.before_digest,e.after_digest,g.created_at_ns
FROM audit_entries e JOIN audit_groups g ON g.project_id=e.project_id AND g.audit_group_id=e.audit_group_id WHERE e.project_id=? ORDER BY e.audit_sequence`, project)
	if err != nil {
		return nil, normalizeError(err)
	}
	defer rows.Close()
	result := []port.DetailAuditEntry{}
	for rows.Next() {
		var value port.DetailAuditEntry
		var subject string
		var before, after sql.NullString
		if err := rows.Scan(&value.Sequence, &value.GroupID, &value.CommandID, &value.ActorID, &value.Operation, &subject, &before, &after, &value.OccurredAtNS); err != nil {
			return nil, normalizeError(err)
		}
		if !slices.Contains(a.groups[value.GroupID], item) {
			continue
		}
		if value.SubjectDigest, err = detailDigest(subject); err != nil {
			return nil, err
		}
		if value.BeforeDigest, err = detailOptionalDigest(before); err != nil {
			return nil, err
		}
		if value.AfterDigest, err = detailOptionalDigest(after); err != nil {
			return nil, err
		}
		if value.Sequence == 0 || value.OccurredAtNS <= 0 || !materialIndexValidText(value.GroupID, 80) || !materialIndexValidText(value.CommandID, 80) || !materialIndexValidText(value.ActorID, 120) || !materialIndexValidText(value.Operation, 120) {
			return nil, detailCorruption()
		}
		value.RunID = a.commands[value.GroupID].RunID
		if result, err = detailAppend(result, value); err != nil {
			return nil, err
		}
	}
	return result, normalizeError(rows.Err())
}

func detailReviews(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID, a detailAttribution) ([]port.DetailReview, error) {
	rows, err := conn.QueryContext(ctx, `SELECT r.review_id,r.completion_subject_digest,r.reviewer_id,r.independent,r.verdict,r.created_at_ns,h.report_id
FROM reviews r LEFT JOIN human_reports h ON h.project_id=r.project_id AND h.review_id=r.review_id WHERE r.project_id=? ORDER BY r.created_at_ns,r.review_id COLLATE BINARY`, project)
	if err != nil {
		return nil, normalizeError(err)
	}
	defer rows.Close()
	result := []port.DetailReview{}
	for rows.Next() {
		var value port.DetailReview
		var subject string
		var report sql.NullString
		if err := rows.Scan(&value.ID, &subject, &value.ReviewerID, &value.Independent, &value.Verdict, &value.CreatedAtNS, &report); err != nil {
			return nil, normalizeError(err)
		}
		if value.SubjectDigest, err = detailDigest(subject); err != nil {
			return nil, err
		}
		mine, err := a.owns(value.SubjectDigest, item)
		if err != nil || !mine {
			if err != nil {
				return nil, err
			}
			continue
		}
		value.HumanReportID = report.String
		if !materialIndexValidText(value.ID, 80) || !materialIndexValidText(value.ReviewerID, 120) || value.CreatedAtNS <= 0 || !slices.Contains([]string{"Approved", "Rejected"}, value.Verdict) {
			return nil, detailCorruption()
		}
		if result, err = detailAppend(result, value); err != nil {
			return nil, err
		}
	}
	return result, normalizeError(rows.Err())
}

func detailEvidence(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID, a detailAttribution) ([]port.DetailEvidence, error) {
	rows, err := conn.QueryContext(ctx, `SELECT e.evidence_id,e.completion_subject_digest,e.ac_id,e.ac_revision_digest,e.verdict,e.applicability,e.availability,e.verifier_class,e.verifier_actor,e.verifier_role,e.recipe_digest,e.environment_digest,e.artifact_digest,h.report_id
FROM evidence e LEFT JOIN human_reports h ON h.project_id=e.project_id AND h.evidence_id=e.evidence_id WHERE e.project_id=? ORDER BY e.evidence_id COLLATE BINARY`, project)
	if err != nil {
		return nil, normalizeError(err)
	}
	defer rows.Close()
	result := []port.DetailEvidence{}
	for rows.Next() {
		var value port.DetailEvidence
		var subject, revision, recipe, environment string
		var artifact, report sql.NullString
		if err := rows.Scan(&value.ID, &subject, &value.ACID, &revision, &value.Verdict, &value.Applicability, &value.Availability, &value.VerifierClass, &value.VerifierActor, &value.VerifierRole, &recipe, &environment, &artifact, &report); err != nil {
			return nil, normalizeError(err)
		}
		if value.SubjectDigest, err = detailDigest(subject); err != nil {
			return nil, err
		}
		mine, err := a.owns(value.SubjectDigest, item)
		if err != nil || !mine {
			if err != nil {
				return nil, err
			}
			continue
		}
		for target, text := range map[*domain.Digest]string{&value.ACRevisionDigest: revision, &value.RecipeDigest: recipe, &value.EnvironmentDigest: environment} {
			if *target, err = detailDigest(text); err != nil {
				return nil, err
			}
		}
		if value.ReportArtifactDigest, err = detailOptionalDigest(artifact); err != nil {
			return nil, err
		}
		value.HumanReportID = report.String
		if !materialIndexValidText(value.ID, 80) || !materialIndexValidText(value.ACID, 120) || !materialIndexValidText(value.VerifierClass, 120) || !materialIndexValidText(value.VerifierActor, 120) || !materialIndexValidText(value.VerifierRole, 120) ||
			!slices.Contains([]string{"Passed", "Failed", "Skipped", "NotRun", "Unknown", "Error", "Inconclusive"}, value.Verdict) ||
			!slices.Contains([]string{"Current", "Stale", "Superseded"}, value.Applicability) || !slices.Contains([]string{"Present", "Unavailable"}, value.Availability) {
			return nil, detailCorruption()
		}
		if result, err = detailAppend(result, value); err != nil {
			return nil, err
		}
	}
	return result, normalizeError(rows.Err())
}

func detailApprovals(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID, a detailAttribution) ([]port.DetailApproval, error) {
	rows, err := conn.QueryContext(ctx, `SELECT p.approval_id,p.completion_subject_digest,p.actor_id,p.expires_at_ns,c.consumed_at_ns,c.completion_record_id
FROM approvals p LEFT JOIN approval_consumptions c ON c.project_id=p.project_id AND c.approval_id=p.approval_id WHERE p.project_id=? ORDER BY p.approval_id COLLATE BINARY`, project)
	if err != nil {
		return nil, normalizeError(err)
	}
	defer rows.Close()
	result := []port.DetailApproval{}
	for rows.Next() {
		var value port.DetailApproval
		var subject string
		var consumed sql.NullInt64
		var record sql.NullString
		if err := rows.Scan(&value.ID, &subject, &value.ActorID, &value.ExpiresAtNS, &consumed, &record); err != nil {
			return nil, normalizeError(err)
		}
		if value.SubjectDigest, err = detailDigest(subject); err != nil {
			return nil, err
		}
		mine, err := a.owns(value.SubjectDigest, item)
		if err != nil || !mine {
			if err != nil {
				return nil, err
			}
			continue
		}
		if !materialIndexValidText(value.ID, 80) || !materialIndexValidText(value.ActorID, 120) || value.ExpiresAtNS <= 0 || consumed.Valid != record.Valid || consumed.Valid && (consumed.Int64 <= 0 || !materialIndexValidText(record.String, 80)) {
			return nil, detailCorruption()
		}
		if consumed.Valid {
			value.ConsumedAtNS, value.CompletionRecordID = &consumed.Int64, record.String
		}
		if result, err = detailAppend(result, value); err != nil {
			return nil, err
		}
	}
	return result, normalizeError(rows.Err())
}

func detailCompletions(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID) ([]port.DetailCompletionRecord, error) {
	rows, err := conn.QueryContext(ctx, `SELECT completion_record_id,completion_subject_digest,result_work_item_version,completed_by_actor,completed_at_ns FROM completion_records WHERE project_id=? AND work_item_id=? ORDER BY completed_at_ns,completion_record_id COLLATE BINARY`, project, item)
	if err != nil {
		return nil, normalizeError(err)
	}
	result := []port.DetailCompletionRecord{}
	for rows.Next() {
		var value port.DetailCompletionRecord
		var subject string
		if err := rows.Scan(&value.ID, &subject, &value.ResultVersion, &value.CompletedBy, &value.CompletedAtNS); err != nil {
			rows.Close()
			return nil, normalizeError(err)
		}
		if value.SubjectDigest, err = detailDigest(subject); err != nil {
			rows.Close()
			return nil, err
		}
		if !materialIndexValidText(value.ID, 80) || !materialIndexValidText(value.CompletedBy, 120) || value.ResultVersion == 0 || value.CompletedAtNS <= 0 {
			rows.Close()
			return nil, detailCorruption()
		}
		if result, err = detailAppend(result, value); err != nil {
			rows.Close()
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, normalizeError(err)
	}
	if err := rows.Close(); err != nil {
		return nil, normalizeError(err)
	}
	for index := range result {
		value := &result[index]
		for _, join := range []struct {
			table, column string
			target        *[]string
		}{{"completion_record_evidence", "evidence_id", &value.EvidenceIDs}, {"completion_record_reviews", "review_id", &value.ReviewIDs}, {"completion_record_approvals", "approval_id", &value.ApprovalIDs}} {
			// Table and column names are fixed literals above.
			ids, err := conn.QueryContext(ctx, `SELECT `+join.column+` FROM `+join.table+` WHERE project_id=? AND completion_record_id=? ORDER BY `+join.column+` COLLATE BINARY`, project, value.ID)
			if err != nil {
				return nil, normalizeError(err)
			}
			*join.target = []string{}
			for ids.Next() {
				var id string
				if err := ids.Scan(&id); err != nil {
					ids.Close()
					return nil, normalizeError(err)
				}
				if !materialIndexValidText(id, 80) {
					ids.Close()
					return nil, detailCorruption()
				}
				if *join.target, err = detailAppend(*join.target, id); err != nil {
					ids.Close()
					return nil, err
				}
			}
			if err := ids.Close(); err != nil {
				return nil, normalizeError(err)
			}
		}
		if len(value.EvidenceIDs) == 0 || len(value.ReviewIDs) == 0 {
			return nil, detailCorruption()
		}
	}
	return result, nil
}
