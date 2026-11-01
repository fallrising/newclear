package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var _ port.MaterialIndexReader = (*Store)(nil)

var materialIndexProjectID = regexp.MustCompile(`^prj_[0-9A-HJKMNP-TV-Z]{10,26}$`)
var materialIndexWorkID = regexp.MustCompile(`^wi_[0-9A-HJKMNP-TV-Z]{10,26}$`)
var materialIndexRunID = regexp.MustCompile(`^run_[0-9A-HJKMNP-TV-Z]{10,26}$`)

func materialIndexCorruption() error {
	return domain.StorageCorruptionError{Reason: "invalid material index storage"}
}

// All SQL fragments passed to these helpers are fixed implementation literals.
// Preflight scans only counts and predicates, never unbounded stored strings.
// The deferred transaction makes the subsequent bounded materialization safe.
func materialIndexText(column string, maximum int) string {
	return fmt.Sprintf("(typeof(%s)='text' AND length(CAST(%s AS BLOB)) BETWEEN 1 AND %d)", column, column, maximum)
}
func materialIndexInteger(column string, minimum int) string {
	return fmt.Sprintf("(typeof(%s)='integer' AND %s>=%d)", column, column, minimum)
}
func materialIndexPreflight(ctx context.Context, conn *sql.Conn, from, valid string, limit int, args ...any) (int, error) {
	var count, invalid int
	query := fmt.Sprintf(`SELECT COUNT(*),COALESCE(SUM(bad),0) FROM (SELECT CASE WHEN %s THEN 0 ELSE 1 END AS bad FROM %s LIMIT %d)`, valid, from, limit+1)
	if err := conn.QueryRowContext(ctx, query, args...).Scan(&count, &invalid); err != nil {
		return 0, normalizeError(err)
	}
	// Known corruption in the bounded preflight wins over capacity. Rows
	// beyond the scanned window are deliberately not materialized or audited.
	if invalid != 0 {
		return 0, materialIndexCorruption()
	}
	if count > limit {
		if limit == 1 {
			return 0, materialIndexCorruption()
		}
		return 0, port.ErrMaterialIndexCapacity
	}
	return count, nil
}
func materialIndexValidText(value string, maximum int) bool {
	if len(value) == 0 || len(value) > maximum || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func (store *Store) ReadWorkItemMaterialIndex(ctx context.Context, project domain.ProjectID, item domain.WorkItemID) (port.WorkItemMaterialIndex, error) {
	var result port.WorkItemMaterialIndex
	err := store.readProjection(ctx, func(conn *sql.Conn) error {
		var err error
		result, err = store.readWorkItemMaterialIndex(ctx, conn, project, item)
		return err
	})
	if err != nil {
		return port.WorkItemMaterialIndex{}, err
	}
	return result, nil
}

// This connection must already be inside readProjection; keeping the helper
// connection-local also permits deterministic WAL snapshot regression tests.
func (store *Store) readWorkItemMaterialIndex(ctx context.Context, conn *sql.Conn, project domain.ProjectID, item domain.WorkItemID) (port.WorkItemMaterialIndex, error) {
	result := port.WorkItemMaterialIndex{ProjectID: project, WorkItemID: item, RequiredACRevisions: []port.MaterialIndexAC{}, Runs: []port.MaterialIndexRun{}, Candidates: []port.MaterialIndexCandidate{}}
	if !materialIndexProjectID.MatchString(string(project)) || !materialIndexWorkID.MatchString(string(item)) {
		return result, port.ErrNotFound
	}
	scope := []any{project, item}
	from := `work_items w JOIN projects p ON p.project_id=w.project_id WHERE w.project_id=? AND w.work_item_id=?`
	valid := strings.Join([]string{materialIndexText("w.title", 240), materialIndexText("w.goal", 8000), materialIndexText("w.owner_id", 120), materialIndexText("w.phase", 10), materialIndexInteger("w.version", 1)}, " AND ")
	count, err := materialIndexPreflight(ctx, conn, from, valid, 1, scope...)
	if err != nil {
		return result, err
	}
	if count != 1 {
		return result, port.ErrNotFound
	}
	if err := conn.QueryRowContext(ctx, `SELECT title,goal,owner_id FROM work_items WHERE project_id=? AND work_item_id=?`, scope...).Scan(&result.Title, &result.Goal, &result.OwnerID); err != nil {
		return result, normalizeError(err)
	}
	if !materialIndexValidText(result.Title, 240) || !materialIndexValidText(result.Goal, 8000) || !materialIndexValidText(string(result.OwnerID), 120) {
		return result, materialIndexCorruption()
	}
	if err := materialIndexBlockers(ctx, conn, scope); err != nil {
		return result, err
	}
	loaded, err := store.loadWorkItem(ctx, conn, project, item)
	if err != nil {
		return result, err
	}
	result.Phase, result.Version = loaded.Phase(), loaded.Version()
	if err := materialIndexHeads(ctx, conn, &result); err != nil {
		return result, err
	}
	if err := materialIndexHistory(ctx, conn, &result); err != nil {
		return result, err
	}
	count, err = materialIndexPreflight(ctx, conn, `instance_state WHERE id=1`, strings.Join([]string{materialIndexInteger("stream_epoch", 1), materialIndexInteger("next_event_sequence", 0), materialIndexInteger("restore_generation", 1)}, " AND "), 1)
	if err != nil {
		return result, err
	}
	if count != 1 {
		return result, materialIndexCorruption()
	}
	// Identical high-water semantics to projectionPosition: this is the last
	// allocated event sequence, not a newly allocated or reserved cursor.
	if err := conn.QueryRowContext(ctx, `SELECT stream_epoch,next_event_sequence,restore_generation FROM instance_state WHERE id=1`).Scan(&result.Cursor.Epoch, &result.Cursor.Sequence, &result.RestoreGeneration); err != nil {
		return result, normalizeError(err)
	}
	return result, nil
}

func materialIndexBlockers(ctx context.Context, conn *sql.Conn, scope []any) error {
	var count, size, invalid int64
	err := conn.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(bytes),0),COALESCE(SUM(bad),0) FROM (
 SELECT length(CAST(blocker_id AS BLOB))+length(CAST(reason AS BLOB)) AS bytes,
 CASE WHEN typeof(blocker_id)='text' AND typeof(reason)='text' THEN 0 ELSE 1 END AS bad
 FROM work_item_blockers WHERE project_id=? AND work_item_id=? AND resolved_at_ns IS NULL LIMIT 1025)`, scope...).Scan(&count, &size, &invalid)
	if err != nil {
		return normalizeError(err)
	}
	if invalid != 0 {
		return materialIndexCorruption()
	}
	if count > port.MaterialIndexRowLimit || size > port.MaterialIndexBlockerByteLimit {
		return port.ErrMaterialIndexCapacity
	}
	return nil
}

func materialIndexHeads(ctx context.Context, conn *sql.Conn, result *port.WorkItemMaterialIndex) error {
	scope := []any{result.ProjectID, result.WorkItemID}
	count, err := materialIndexPreflight(ctx, conn, `work_item_spec_heads WHERE project_id=? AND work_item_id=?`, materialIndexText("accepted_revision_digest", 64)+" AND "+materialIndexText("binding_digest", 64)+" AND "+materialIndexInteger("head_version", 1), 1, scope...)
	if err != nil {
		return err
	}
	if count == 0 {
		var orphan bool
		if err := conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM current_ac_requirements WHERE project_id=? AND work_item_id=?)`, scope...).Scan(&orphan); err != nil {
			return normalizeError(err)
		}
		if orphan {
			return materialIndexCorruption()
		}
		result.RequiredACRevisions, err = materialIndexACs(ctx, conn, `work_item_ac_requirements WHERE project_id=? AND work_item_id=?`, "revision_digest", false, scope...)
		return err
	}
	var revision, binding string
	accepted := &port.MaterialIndexSpecification{}
	if err := conn.QueryRowContext(ctx, `SELECT accepted_revision_digest,binding_digest,head_version FROM work_item_spec_heads WHERE project_id=? AND work_item_id=?`, scope...).Scan(&revision, &binding, &accepted.WorkItemHeadVersion); err != nil {
		return normalizeError(err)
	}
	accepted.AcceptedRevisionDigest, err = ParseStorageDigest(revision)
	if err != nil {
		return materialIndexCorruption()
	}
	accepted.BindingDigest, err = ParseStorageDigest(binding)
	if err != nil {
		return materialIndexCorruption()
	}
	relation := `project_spec_heads p JOIN accepted_spec_revisions a ON a.project_id=p.project_id AND a.accepted_revision_digest=p.accepted_revision_digest JOIN accepted_work_item_bindings b ON b.project_id=a.project_id AND b.accepted_revision_digest=a.accepted_revision_digest WHERE p.project_id=? AND b.work_item_id=? AND p.accepted_revision_digest=? AND b.binding_digest=?`
	args := []any{result.ProjectID, result.WorkItemID, revision, binding}
	count, err = materialIndexPreflight(ctx, conn, relation, strings.Join([]string{materialIndexInteger("p.head_version", 1), materialIndexText("a.graph_revision_digest", 64), materialIndexText("a.policy_revision_digest", 64), materialIndexText("a.acceptance_kind", 7)}, " AND "), 1, args...)
	if err != nil {
		return err
	}
	if count != 1 {
		return materialIndexCorruption()
	}
	var graph, policy string
	if err := conn.QueryRowContext(ctx, `SELECT p.head_version,a.graph_revision_digest,a.policy_revision_digest,a.acceptance_kind FROM `+relation, args...).Scan(&accepted.ProjectHeadVersion, &graph, &policy, &accepted.AcceptanceKind); err != nil {
		return normalizeError(err)
	}
	accepted.GraphRevisionDigest, err = ParseStorageDigest(graph)
	if err != nil {
		return materialIndexCorruption()
	}
	accepted.PolicyRevisionDigest, err = ParseStorageDigest(policy)
	if err != nil || !slices.Contains([]string{"Initial", "Impact"}, accepted.AcceptanceKind) {
		return materialIndexCorruption()
	}
	// Read the whole current set, including rows whose identities are corrupt;
	// filtering by the desired revision/binding would hide these rows.
	current := `current_ac_requirements WHERE project_id=? AND work_item_id=?`
	_, err = materialIndexPreflight(ctx, conn, current, `typeof(accepted_revision_digest)='text' AND accepted_revision_digest=? AND typeof(binding_digest)='text' AND binding_digest=?`, port.MaterialIndexRowLimit, revision, binding, result.ProjectID, result.WorkItemID)
	if err != nil {
		return err
	}
	result.RequiredACRevisions, err = materialIndexACs(ctx, conn, current, "ac_revision_digest", true, scope...)
	if err != nil {
		return err
	}
	expected, err := materialIndexACs(ctx, conn, `accepted_work_item_requirements WHERE project_id=? AND work_item_id=? AND accepted_revision_digest=?`, "ac_revision_digest", true, result.ProjectID, result.WorkItemID, revision)
	if err != nil {
		return err
	}
	// Exact equality checks missing as well as extra current requirements. The
	// binding column is independently checked, rather than used as a row filter.
	_, err = materialIndexPreflight(ctx, conn, `accepted_work_item_requirements WHERE project_id=? AND work_item_id=? AND accepted_revision_digest=?`, `typeof(binding_digest)='text' AND binding_digest=?`, port.MaterialIndexRowLimit, binding, result.ProjectID, result.WorkItemID, revision)
	if err != nil {
		return err
	}
	if !slices.Equal(result.RequiredACRevisions, expected) {
		return materialIndexCorruption()
	}
	result.Accepted = accepted
	return nil
}

func materialIndexACs(ctx context.Context, conn *sql.Conn, from, digestColumn string, accepted bool, args ...any) ([]port.MaterialIndexAC, error) {
	maximum := 80
	if accepted {
		maximum = 120
	}
	result := []port.MaterialIndexAC{}
	table, _, _ := strings.Cut(from, " WHERE ")
	// Check scoped FK identities without reading AC contents or interpreting
	// accepted canonical payloads. Corrupt orphan rows must not look complete.
	valid := materialIndexText("ac_id", maximum) + " AND " + materialIndexText(digestColumn, 64)
	valid += fmt.Sprintf(" AND EXISTS(SELECT 1 FROM ac_revisions a WHERE a.project_id=%s.project_id AND a.ac_id=%s.ac_id AND a.revision_digest=%s.%s)", table, table, table, digestColumn)
	if accepted {
		valid += fmt.Sprintf(" AND EXISTS(SELECT 1 FROM accepted_revision_acs a WHERE a.project_id=%s.project_id AND a.accepted_revision_digest=%s.accepted_revision_digest AND a.ac_id=%s.ac_id AND a.ac_revision_digest=%s.%s)", table, table, table, table, digestColumn)
	}
	_, err := materialIndexPreflight(ctx, conn, from, valid, port.MaterialIndexRowLimit, args...)
	if err != nil {
		return nil, err
	}
	rows, err := conn.QueryContext(ctx, `SELECT ac_id,`+digestColumn+` FROM `+from+` ORDER BY ac_id COLLATE BINARY,`+digestColumn+` COLLATE BINARY LIMIT 1025`, args...)
	if err != nil {
		return nil, normalizeError(err)
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var value port.MaterialIndexAC
		var digest string
		if err := rows.Scan(&value.ACID, &digest); err != nil {
			return nil, normalizeError(err)
		}
		value.RevisionDigest, err = ParseStorageDigest(digest)
		if err != nil || seen[value.ACID] || (!accepted && !materialIndexValidText(value.ACID, 80)) || (accepted && !domain.ValidACID(value.ACID)) {
			return nil, materialIndexCorruption()
		}
		seen[value.ACID] = true
		result = append(result, value)
	}
	return result, normalizeError(rows.Err())
}

func materialIndexHistory(ctx context.Context, conn *sql.Conn, result *port.WorkItemMaterialIndex) error {
	scope := []any{result.ProjectID, result.WorkItemID}
	from := `runs WHERE project_id=? AND work_item_id=?`
	predicates := []string{materialIndexText("run_id", 30), materialIndexText("input_digest", 64), materialIndexInteger("created_at_ns", 1)}
	for _, column := range []string{"desired_action", "dispatch_state", "observed_state", "reconciliation_state", "side_effect_outcome"} {
		predicates = append(predicates, materialIndexText(column, 20))
	}
	if _, err := materialIndexPreflight(ctx, conn, from, strings.Join(predicates, " AND "), port.MaterialIndexRowLimit, scope...); err != nil {
		return err
	}
	if err := materialIndexRuns(ctx, conn, result); err != nil {
		return err
	}
	from = `candidates c JOIN runs r ON r.project_id=c.project_id AND r.run_id=c.run_id WHERE r.project_id=? AND r.work_item_id=?`
	valid := strings.Join([]string{materialIndexText("c.candidate_id", 80), materialIndexText("c.run_id", 30), materialIndexText("c.candidate_digest", 64), materialIndexText("c.input_subject_digest", 64), materialIndexInteger("c.created_at_ns", 1)}, " AND ")
	if _, err := materialIndexPreflight(ctx, conn, from, valid, port.MaterialIndexRowLimit, scope...); err != nil {
		return err
	}
	rows, err := conn.QueryContext(ctx, `SELECT c.candidate_id,c.run_id,c.candidate_digest,c.input_subject_digest,c.created_at_ns FROM `+from+` ORDER BY c.created_at_ns,c.candidate_id COLLATE BINARY LIMIT 1025`, scope...)
	if err != nil {
		return normalizeError(err)
	}
	defer rows.Close()
	seen := map[domain.CandidateID]bool{}
	for rows.Next() {
		var value port.MaterialIndexCandidate
		var digest, input string
		if err := rows.Scan(&value.CandidateID, &value.RunID, &digest, &input, &value.CreatedAtNS); err != nil {
			return normalizeError(err)
		}
		value.CandidateDigest, err = ParseStorageDigest(digest)
		if err != nil {
			return materialIndexCorruption()
		}
		value.InputSubjectDigest, err = ParseStorageDigest(input)
		if err != nil || !materialIndexValidText(string(value.CandidateID), 80) || !materialIndexRunID.MatchString(string(value.RunID)) || seen[value.CandidateID] {
			return materialIndexCorruption()
		}
		seen[value.CandidateID] = true
		result.Candidates = append(result.Candidates, value)
	}
	return normalizeError(rows.Err())
}
func materialIndexRuns(ctx context.Context, conn *sql.Conn, result *port.WorkItemMaterialIndex) error {
	rows, err := conn.QueryContext(ctx, `SELECT run_id,input_digest,created_at_ns,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome FROM runs WHERE project_id=? AND work_item_id=? ORDER BY created_at_ns,run_id COLLATE BINARY LIMIT 1025`, result.ProjectID, result.WorkItemID)
	if err != nil {
		return normalizeError(err)
	}
	defer rows.Close()
	seen := map[domain.RunID]bool{}
	for rows.Next() {
		var value port.MaterialIndexRun
		var digest string
		if err := rows.Scan(&value.RunID, &digest, &value.CreatedAtNS, &value.DesiredAction, &value.DispatchState, &value.ObservedState, &value.ReconciliationState, &value.SideEffectOutcome); err != nil {
			return normalizeError(err)
		}
		value.InputDigest, err = ParseStorageDigest(digest)
		if err != nil || !materialIndexRunID.MatchString(string(value.RunID)) || seen[value.RunID] ||
			!slices.Contains([]string{"None", "Dispatch", "CancelRequested"}, value.DesiredAction) ||
			!slices.Contains([]string{"Pending", "Claimed", "Sent", "Acknowledged", "FailedToDispatch"}, value.DispatchState) ||
			!slices.Contains([]string{"Unknown", "Starting", "Running", "Succeeded", "Failed", "Canceled"}, value.ObservedState) ||
			!slices.Contains([]string{"None", "NeedsReconcile", "Reconciled"}, value.ReconciliationState) ||
			!slices.Contains([]string{"NotApplicable", "Confirmed", "OutcomeUnknown"}, value.SideEffectOutcome) {
			return materialIndexCorruption()
		}
		seen[value.RunID] = true
		result.Runs = append(result.Runs, value)
	}
	return normalizeError(rows.Err())
}
