// Package sqlite implements the SQLite V1 persistence boundary.
package sqlite

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/internal/rehydrationcap"
	sqlitedriver "modernc.org/sqlite"
	sqlitelib "modernc.org/sqlite/lib"
)

const (
	migrationVersion = 1
	busyTimeoutMS    = 5000
)

//go:embed migrations/0001_v1.sql
var v1Migration string

var (
	ErrInvalidPath = errors.New("SQLite database path must be absolute and controlled")
	ErrBusy        = errors.New("SQLite busy")
)

type BusyError struct{ cause error }

func (err BusyError) Error() string        { return ErrBusy.Error() }
func (err BusyError) Unwrap() error        { return err.cause }
func (err BusyError) Is(target error) bool { return target == ErrBusy }

type Store struct {
	db *sql.DB
}

type SQLiteIdentity struct {
	EngineVersion string
	MigrationSum  string
}

// OpenAtRootWithClock makes both path authority and mutation timestamps explicit.
func OpenAtRootWithClock(ctx context.Context, root, databasePath string, now func() time.Time) (*Store, error) {
	if !controlledPath(root, databasePath) || now == nil {
		return nil, ErrInvalidPath
	}
	dsn := databaseURI(databasePath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open SQLite: %w", err)
	}
	// Serialize writers and ensure every usable pooled connection gets the
	// startup PRAGMAs before use. SQLite WAL still permits other processes to
	// read the database.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Store{db: db}
	if err := store.withConn(ctx, func(conn *sql.Conn) error {
		if err := configure(conn, ctx); err != nil {
			return err
		}
		if err := migrate(conn, ctx, now().UTC().UnixNano()); err != nil {
			return err
		}
		return assertEngine(conn, ctx)
	}); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func controlledPath(root, path string) bool {
	if !filepath.IsAbs(root) || !filepath.IsAbs(path) || filepath.Clean(root) != root || filepath.Clean(path) != path ||
		strings.ContainsAny(path, "?#%") || strings.Contains(strings.ToLower(path), "_pragma") {
		return false
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return false
	}
	resolvedParent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil || !pathWithin(resolvedRoot, resolvedParent) {
		return false
	}
	if _, err := os.Lstat(path); err == nil {
		resolvedPath, resolveErr := filepath.EvalSymlinks(path)
		return resolveErr == nil && pathWithin(resolvedRoot, resolvedPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return false
	}
	return true
}

func pathWithin(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (store *Store) Close() error { return store.db.Close() }

func (store *Store) Identity(ctx context.Context) (SQLiteIdentity, error) {
	var identity SQLiteIdentity
	err := store.withConn(ctx, func(conn *sql.Conn) error {
		if err := conn.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&identity.EngineVersion); err != nil {
			return normalizeError(err)
		}
		identity.MigrationSum = migrationChecksum()
		return nil
	})
	return identity, err
}

func (store *Store) CreateProject(ctx context.Context, project port.Project) error {
	if project.ID == "" || project.Name == "" || project.Repository == "" || project.Ref == "" || project.Version == 0 {
		return fmt.Errorf("invalid project")
	}
	return store.immediate(ctx, func(conn *sql.Conn) error {
		_, err := conn.ExecContext(ctx, `INSERT INTO projects (project_id, canonical_name, repository, repository_ref, version)
VALUES (?, ?, ?, ?, ?)`, project.ID, project.Name, project.Repository, project.Ref, project.Version)
		return normalizeError(err)
	})
}

func (store *Store) LoadProject(ctx context.Context, id domain.ProjectID) (port.Project, error) {
	var project port.Project
	err := store.withConn(ctx, func(conn *sql.Conn) error {
		err := conn.QueryRowContext(ctx, `SELECT project_id, canonical_name, repository, repository_ref, version
FROM projects WHERE project_id = ?`, id).Scan(&project.ID, &project.Name, &project.Repository, &project.Ref, &project.Version)
		return normalizeError(err)
	})
	return project, err
}

func (store *Store) CreateWorkItem(ctx context.Context, value port.WorkItem) error {
	item := value.Item
	if item.Phase() == domain.PhaseDone || value.Title == "" || value.Goal == "" || value.Owner == "" {
		return fmt.Errorf("invalid work item")
	}
	return store.immediate(ctx, func(conn *sql.Conn) error {
		_, err := conn.ExecContext(ctx, `INSERT INTO work_items
(work_item_id, project_id, title, goal, owner_id, phase, version) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			item.ID(), item.ProjectID(), value.Title, value.Goal, value.Owner, item.Phase(), item.Version())
		if err != nil {
			return normalizeError(err)
		}
		for _, blocker := range item.Blockers() {
			if _, err := conn.ExecContext(ctx, `INSERT INTO work_item_blockers
(work_item_id, project_id, blocker_id, reason, resolved_at_ns) VALUES (?, ?, ?, ?, NULL)`,
				item.ID(), item.ProjectID(), blocker.ID, blocker.Reason); err != nil {
				return normalizeError(err)
			}
		}
		return nil
	})
}

func (store *Store) UpdateWorkItem(ctx context.Context, item domain.WorkItem, expectedVersion uint64) error {
	if expectedVersion == 0 || item.Version() != expectedVersion+1 {
		return domain.Rejection{Code: domain.CodeVersionConflict}
	}
	return store.immediate(ctx, func(conn *sql.Conn) error {
		result, err := conn.ExecContext(ctx, `UPDATE work_items SET phase = ?, version = ?
WHERE project_id = ? AND work_item_id = ? AND version = ?`, item.Phase(), item.Version(), item.ProjectID(), item.ID(), expectedVersion)
		if err != nil {
			return normalizeError(err)
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return normalizeError(err)
		}
		if changed != 1 {
			return domain.Rejection{Code: domain.CodeVersionConflict}
		}
		return nil
	})
}

func (store *Store) AddBlocker(ctx context.Context, projectID domain.ProjectID, workItemID domain.WorkItemID, expectedVersion uint64, blocker domain.Blocker) (domain.WorkItem, error) {
	item, err := store.LoadWorkItem(ctx, projectID, workItemID)
	if err != nil {
		return domain.WorkItem{}, err
	}
	next, err := item.AddBlocker(expectedVersion, blocker)
	if err != nil {
		return domain.WorkItem{}, err
	}
	err = store.immediate(ctx, func(conn *sql.Conn) error {
		result, err := conn.ExecContext(ctx, `UPDATE work_items SET version = ? WHERE project_id = ? AND work_item_id = ? AND version = ?`, next.Version(), projectID, workItemID, expectedVersion)
		if err != nil {
			return normalizeError(err)
		}
		changed, err := result.RowsAffected()
		if err != nil || changed != 1 {
			return domain.Rejection{Code: domain.CodeVersionConflict}
		}
		_, err = conn.ExecContext(ctx, `INSERT INTO work_item_blockers (work_item_id, project_id, blocker_id, reason, resolved_at_ns) VALUES (?, ?, ?, ?, NULL)`, workItemID, projectID, blocker.ID, blocker.Reason)
		return normalizeError(err)
	})
	return next, err
}

func (store *Store) ResolveBlocker(ctx context.Context, projectID domain.ProjectID, workItemID domain.WorkItemID, expectedVersion uint64, blockerID domain.BlockerID, resolvedAtNS int64) (domain.WorkItem, error) {
	var next domain.WorkItem
	err := store.immediate(ctx, func(conn *sql.Conn) error {
		item, err := store.loadWorkItem(ctx, conn, projectID, workItemID)
		if err != nil {
			return err
		}
		if item.Version() != expectedVersion {
			return domain.Rejection{Code: domain.CodeVersionConflict}
		}
		next, err = item.RemoveBlocker(expectedVersion, blockerID)
		if err != nil {
			return port.ErrNotFound
		}
		result, err := conn.ExecContext(ctx, `UPDATE work_item_blockers SET resolved_at_ns = ? WHERE work_item_id = ? AND project_id = ? AND blocker_id = ? AND resolved_at_ns IS NULL`, resolvedAtNS, workItemID, projectID, blockerID)
		if err != nil {
			return normalizeError(err)
		}
		changed, err := result.RowsAffected()
		if err != nil || changed != 1 {
			return port.ErrNotFound
		}
		result, err = conn.ExecContext(ctx, `UPDATE work_items SET version = ? WHERE project_id = ? AND work_item_id = ? AND version = ?`, next.Version(), projectID, workItemID, expectedVersion)
		if err != nil {
			return normalizeError(err)
		}
		changed, err = result.RowsAffected()
		if err != nil || changed != 1 {
			return domain.Rejection{Code: domain.CodeVersionConflict}
		}
		return nil
	})
	return next, err
}

func (store *Store) LoadWorkItem(ctx context.Context, projectID domain.ProjectID, workItemID domain.WorkItemID) (domain.WorkItem, error) {
	var item domain.WorkItem
	err := store.withConn(ctx, func(conn *sql.Conn) error {
		var err error
		item, err = store.loadWorkItem(ctx, conn, projectID, workItemID)
		return err
	})
	return item, err
}

func (store *Store) loadWorkItem(ctx context.Context, conn *sql.Conn, projectID domain.ProjectID, workItemID domain.WorkItemID) (domain.WorkItem, error) {
	var phase domain.Phase
	var version uint64
	if err := conn.QueryRowContext(ctx, `SELECT phase, version FROM work_items WHERE project_id = ? AND work_item_id = ?`, projectID, workItemID).Scan(&phase, &version); err != nil {
		return domain.WorkItem{}, normalizeError(err)
	}
	blockers, err := loadBlockers(ctx, conn, projectID, workItemID)
	if err != nil {
		return domain.WorkItem{}, err
	}
	if phase != domain.PhaseDone {
		return domain.RehydrateWorkItem(workItemID, projectID, phase, version, blockers)
	}
	var item domain.WorkItem
	err = store.loadDone(ctx, conn, projectID, workItemID, version, blockers, &item)
	return item, err
}

func (store *Store) loadDone(ctx context.Context, conn *sql.Conn, projectID domain.ProjectID, workItemID domain.WorkItemID, version uint64, blockers []domain.Blocker, destination *domain.WorkItem) error {
	rows, err := conn.QueryContext(ctx, `SELECT completion_record_id, completion_subject_digest, evidence_count, review_count, approval_count FROM completion_records
WHERE project_id = ? AND work_item_id = ? AND result_work_item_version = ?`, projectID, workItemID, version)
	if err != nil {
		return normalizeError(err)
	}
	defer rows.Close()
	var recordID domain.CompletionRecordID
	var subject string
	var evidenceCount, reviewCount, approvalCount int
	if !rows.Next() {
		return domain.StorageCorruptionError{Reason: "missing completion record"}
	}
	if err := rows.Scan(&recordID, &subject, &evidenceCount, &reviewCount, &approvalCount); err != nil {
		return normalizeError(err)
	}
	if rows.Next() {
		return domain.StorageCorruptionError{Reason: "duplicate completion record"}
	}
	if err := rows.Err(); err != nil {
		return normalizeError(err)
	}
	if err := verifyCompletionJoins(ctx, conn, projectID, recordID, subject, evidenceCount, reviewCount, approvalCount); err != nil {
		return err
	}
	if _, err := ParseStorageDigest(subject); err != nil {
		return domain.StorageCorruptionError{Reason: "invalid completion subject digest"}
	}
	capability, load := rehydrationcap.NewCompletedLoad(string(workItemID), string(projectID), version, toCapabilityBlockers(blockers), string(recordID), subject)
	loaded, _, err := domain.RehydrateCompletedWorkItem(capability, load)
	if err != nil {
		return err
	}
	*destination = loaded
	return nil
}

func loadBlockers(ctx context.Context, conn *sql.Conn, projectID domain.ProjectID, workItemID domain.WorkItemID) ([]domain.Blocker, error) {
	rows, err := conn.QueryContext(ctx, `SELECT blocker_id, reason FROM work_item_blockers WHERE project_id = ? AND work_item_id = ? AND resolved_at_ns IS NULL ORDER BY blocker_id`, projectID, workItemID)
	if err != nil {
		return nil, normalizeError(err)
	}
	defer rows.Close()
	result := make([]domain.Blocker, 0)
	for rows.Next() {
		var blocker domain.Blocker
		if err := rows.Scan(&blocker.ID, &blocker.Reason); err != nil {
			return nil, normalizeError(err)
		}
		result = append(result, blocker)
	}
	return result, normalizeError(rows.Err())
}

func verifyCompletionJoins(ctx context.Context, conn *sql.Conn, projectID domain.ProjectID, recordID domain.CompletionRecordID, subject string, expectedEvidence, expectedReviews, expectedApprovals int) error {
	checks := []struct {
		query, reason string
		expected      int
	}{
		{`SELECT COUNT(*), COALESCE(SUM(CASE WHEN e.evidence_id IS NULL OR e.completion_subject_digest <> ? OR e.artifact_digest IS NULL OR a.digest IS NULL OR a.availability <> 'Present' THEN 1 ELSE 0 END),0) FROM completion_record_evidence cre LEFT JOIN evidence e ON e.project_id = cre.project_id AND e.evidence_id = cre.evidence_id LEFT JOIN artifacts a ON a.digest = e.artifact_digest WHERE cre.project_id = ? AND cre.completion_record_id = ?`, "corrupt completion evidence join", expectedEvidence},
		{`SELECT COUNT(*), COALESCE(SUM(CASE WHEN r.review_id IS NULL OR r.completion_subject_digest <> ? THEN 1 ELSE 0 END),0) FROM completion_record_reviews crr LEFT JOIN reviews r ON r.project_id = crr.project_id AND r.review_id = crr.review_id WHERE crr.project_id = ? AND crr.completion_record_id = ?`, "corrupt completion review join", expectedReviews},
		{`SELECT COUNT(*), COALESCE(SUM(CASE WHEN a.approval_id IS NULL OR a.completion_subject_digest <> ? THEN 1 ELSE 0 END),0) FROM completion_record_approvals cra LEFT JOIN approvals a ON a.project_id = cra.project_id AND a.approval_id = cra.approval_id WHERE cra.project_id = ? AND cra.completion_record_id = ?`, "corrupt completion approval join", expectedApprovals},
	}
	for _, check := range checks {
		var count, invalid int
		if err := conn.QueryRowContext(ctx, check.query, subject, projectID, recordID).Scan(&count, &invalid); err != nil {
			return normalizeError(err)
		}
		if count != check.expected || invalid != 0 {
			return domain.StorageCorruptionError{Reason: check.reason}
		}
	}
	var consumptionCount, invalidConsumptions int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(CASE WHEN cra.approval_id IS NULL OR a.approval_id IS NULL OR c.completion_subject_digest<>? OR a.completion_subject_digest<>? THEN 1 ELSE 0 END),0) FROM approval_consumptions c LEFT JOIN completion_record_approvals cra ON cra.project_id=c.project_id AND cra.completion_record_id=c.completion_record_id AND cra.approval_id=c.approval_id LEFT JOIN approvals a ON a.project_id=c.project_id AND a.approval_id=c.approval_id WHERE c.project_id=? AND c.completion_record_id=?`, subject, subject, projectID, recordID).Scan(&consumptionCount, &invalidConsumptions); err != nil {
		return normalizeError(err)
	}
	if consumptionCount != expectedApprovals || invalidConsumptions != 0 {
		return domain.StorageCorruptionError{Reason: "corrupt approval consumption"}
	}
	var nonUnitConsumptionGroups int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM (SELECT cra.approval_id FROM completion_record_approvals cra LEFT JOIN approval_consumptions c ON c.project_id=cra.project_id AND c.completion_record_id=cra.completion_record_id AND c.approval_id=cra.approval_id WHERE cra.project_id=? AND cra.completion_record_id=? GROUP BY cra.approval_id HAVING COUNT(c.approval_consumption_id)<>1)`, projectID, recordID).Scan(&nonUnitConsumptionGroups); err != nil {
		return normalizeError(err)
	}
	if nonUnitConsumptionGroups != 0 {
		return domain.StorageCorruptionError{Reason: "corrupt approval consumption"}
	}
	return nil
}

func (store *Store) withConn(ctx context.Context, operation func(*sql.Conn) error) error {
	conn, err := store.db.Conn(ctx)
	if err != nil {
		return normalizeError(err)
	}
	defer conn.Close()
	if err := configure(conn, ctx); err != nil {
		return err
	}
	return operation(conn)
}

func (store *Store) immediate(ctx context.Context, operation func(*sql.Conn) error) error {
	return store.withConn(ctx, func(conn *sql.Conn) error {
		if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
			return normalizeError(err)
		}
		committed := false
		defer func() {
			if !committed {
				_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
			}
		}()
		if err := operation(conn); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
			return normalizeError(err)
		}
		committed = true
		return nil
	})
}

// Within is the only transaction seam exposed to application services. The
// callback receives port.Transaction, never a concrete SQLite connection.
func (store *Store) Within(ctx context.Context, operation func(port.Transaction) error) error {
	return store.immediate(ctx, func(conn *sql.Conn) error { return operation(transaction{store: store, conn: conn}) })
}

type transaction struct {
	store *Store
	conn  *sql.Conn
}

func (tx transaction) CreateProject(ctx context.Context, project port.Project) error {
	if project.ID == "" || project.Name == "" || project.Repository == "" || project.Ref == "" || project.Version == 0 {
		return fmt.Errorf("invalid project")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO projects (project_id,canonical_name,repository,repository_ref,version) VALUES (?,?,?,?,?)`, project.ID, project.Name, project.Repository, project.Ref, project.Version)
	return normalizeError(err)
}

func (tx transaction) CreateWorkItem(ctx context.Context, value port.WorkItem) error {
	item := value.Item
	if item.Phase() == domain.PhaseDone || value.Title == "" || value.Goal == "" || value.Owner == "" {
		return fmt.Errorf("invalid work item")
	}
	if _, err := tx.conn.ExecContext(ctx, `INSERT INTO work_items (project_id,work_item_id,title,goal,owner_id,phase,version) VALUES (?,?,?,?,?,?,?)`, item.ProjectID(), item.ID(), value.Title, value.Goal, value.Owner, item.Phase(), item.Version()); err != nil {
		return normalizeError(err)
	}
	for _, blocker := range item.Blockers() {
		if _, err := tx.conn.ExecContext(ctx, `INSERT INTO work_item_blockers (project_id,work_item_id,blocker_id,reason,resolved_at_ns) VALUES (?,?,?,?,NULL)`, item.ProjectID(), item.ID(), blocker.ID, blocker.Reason); err != nil {
			return normalizeError(err)
		}
	}
	return nil
}

func (tx transaction) LoadIdempotency(ctx context.Context, principal domain.ActorID, projectID domain.ProjectID, operation, key string) (port.Idempotency, error) {
	var v port.Idempotency
	var digest string
	var tombstone int
	err := tx.conn.QueryRowContext(ctx, `SELECT principal_id,project_id,operation,idempotency_key,canonical_request_digest,result_command_id,expires_at_ns,tombstoned FROM idempotency_records WHERE principal_id=? AND project_id=? AND operation=? AND idempotency_key=?`, principal, projectID, operation, key).Scan(&v.Principal, &v.ProjectID, &v.Operation, &v.Key, &digest, &v.CommandID, &v.ExpiresAtNS, &tombstone)
	if err == nil {
		v.RequestDigest, err = ParseStorageDigest(digest)
		v.Tombstoned = tombstone != 0
	}
	return v, normalizeError(err)
}
func (tx transaction) LoadCommandResult(ctx context.Context, projectID domain.ProjectID, id string) (port.CommandResult, error) {
	var v port.CommandResult
	var digest string
	err := tx.conn.QueryRowContext(ctx, `SELECT command_id,project_id,result_digest,result_payload,created_at_ns FROM command_results WHERE project_id=? AND command_id=?`, projectID, id).Scan(&v.ID, &v.ProjectID, &digest, &v.Payload, &v.TimestampNS)
	if err != nil {
		return port.CommandResult{}, normalizeError(err)
	}
	v.Digest, err = ParseStorageDigest(digest)
	if err != nil || len(v.Payload) == 0 || domain.HashBytes(v.Payload) != v.Digest {
		return port.CommandResult{}, domain.StorageCorruptionError{Reason: "corrupt command result"}
	}
	v.Payload = bytes.Clone(v.Payload)
	return v, nil
}

func (tx transaction) LoadWorkItem(ctx context.Context, projectID domain.ProjectID, workItemID domain.WorkItemID) (domain.WorkItem, error) {
	return tx.store.loadWorkItem(ctx, tx.conn, projectID, workItemID)
}

func (tx transaction) LoadCompletionMaterial(ctx context.Context, query port.CompletionMaterialQuery) (port.CompletionMaterial, error) {
	var material port.CompletionMaterial
	item, err := tx.LoadWorkItem(ctx, query.ProjectID, query.WorkItemID)
	if err != nil {
		return material, err
	}
	material.WorkItem = item

	var candidateDigest, inputSubjectDigest, runInputDigest string
	err = tx.conn.QueryRowContext(ctx, `SELECT c.candidate_id,c.project_id,c.run_id,c.candidate_digest,c.input_subject_digest,c.created_at_ns,
r.work_item_id,r.input_digest,r.adapter_id,r.adapter_version,r.scenario_id,r.attempt,r.desired_action,r.dispatch_state,r.observed_state,r.reconciliation_state,r.side_effect_outcome,r.created_at_ns
FROM candidates c JOIN runs r ON r.project_id=c.project_id AND r.run_id=c.run_id
WHERE c.project_id=? AND c.candidate_id=? AND c.run_id=? AND r.work_item_id=?`, query.ProjectID, query.CandidateID, query.RunID, query.WorkItemID).Scan(
		&material.Candidate.ID, &material.Candidate.ProjectID, &material.Candidate.RunID, &candidateDigest, &inputSubjectDigest, &material.Candidate.CreatedAtNS,
		&material.Run.WorkItemID, &runInputDigest, &material.Run.AdapterID, &material.Run.AdapterVersion, &material.Run.ScenarioID, &material.Run.Attempt,
		&material.Run.DesiredAction, &material.Run.DispatchState, &material.Run.ObservedState, &material.Run.ReconciliationState, &material.Run.SideEffectOutcome, &material.Run.CreatedAtNS,
	)
	if errors.Is(err, sql.ErrNoRows) {
		material.CandidatePresent = false
	} else if err != nil {
		return port.CompletionMaterial{}, normalizeError(err)
	} else {
		material.Candidate.Digest, err = ParseStorageDigest(candidateDigest)
		if err != nil {
			return port.CompletionMaterial{}, domain.StorageCorruptionError{Reason: "invalid candidate digest"}
		}
		material.Candidate.InputSubjectDigest, err = ParseStorageDigest(inputSubjectDigest)
		if err != nil {
			return port.CompletionMaterial{}, domain.StorageCorruptionError{Reason: "invalid candidate subject"}
		}
		material.Run.InputDigest, err = ParseStorageDigest(runInputDigest)
		if err != nil {
			return port.CompletionMaterial{}, domain.StorageCorruptionError{Reason: "invalid run input"}
		}
		material.Run.ID, material.Run.ProjectID = query.RunID, query.ProjectID
		material.CandidatePresent, material.RunPresent = true, true
	}
	var activeOrUnknown int
	if err := tx.conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM runs WHERE project_id=? AND work_item_id=? AND (observed_state IN ('Unknown','Starting','Running') OR reconciliation_state='NeedsReconcile' OR side_effect_outcome='OutcomeUnknown'))`, query.ProjectID, query.WorkItemID).Scan(&activeOrUnknown); err != nil {
		return port.CompletionMaterial{}, normalizeError(err)
	}
	material.ActiveOrUnknownRun = activeOrUnknown != 0

	rows, err := tx.conn.QueryContext(ctx, `SELECT ac_id,revision_digest FROM work_item_ac_requirements WHERE project_id=? AND work_item_id=? ORDER BY ac_id,revision_digest`, query.ProjectID, query.WorkItemID)
	if err != nil {
		return port.CompletionMaterial{}, normalizeError(err)
	}
	for rows.Next() {
		var requirement port.ACRequirement
		var digest string
		if err := rows.Scan(&requirement.ACID, &digest); err != nil {
			rows.Close()
			return port.CompletionMaterial{}, normalizeError(err)
		}
		requirement.ProjectID, requirement.WorkItemID = query.ProjectID, query.WorkItemID
		requirement.RevisionDigest, err = ParseStorageDigest(digest)
		if err != nil {
			rows.Close()
			return port.CompletionMaterial{}, domain.StorageCorruptionError{Reason: "invalid AC digest"}
		}
		material.RequiredACRevisions = append(material.RequiredACRevisions, requirement)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return port.CompletionMaterial{}, normalizeError(err)
	}
	if err := rows.Close(); err != nil {
		return port.CompletionMaterial{}, normalizeError(err)
	}
	if err := tx.conn.QueryRowContext(ctx, `SELECT graph_revision_digest FROM dependency_revisions WHERE project_id=? AND graph_revision_digest=?`, query.ProjectID, query.GraphRevisionDigest.String()).Scan(&candidateDigest); errors.Is(err, sql.ErrNoRows) {
		candidateDigest = ""
	} else if err != nil {
		return port.CompletionMaterial{}, normalizeError(err)
	}
	if candidateDigest != "" {
		material.GraphRevisionDigest, err = ParseStorageDigest(candidateDigest)
		if err != nil {
			return port.CompletionMaterial{}, domain.StorageCorruptionError{Reason: "invalid graph digest"}
		}
	}
	if err := tx.loadEvidence(ctx, query, &material); err != nil {
		return port.CompletionMaterial{}, err
	}
	if err := tx.loadReviews(ctx, query, &material); err != nil {
		return port.CompletionMaterial{}, err
	}
	if err := tx.loadApprovals(ctx, query, &material); err != nil {
		return port.CompletionMaterial{}, err
	}
	var candidateArtifactCount, unavailableCount int
	if err := tx.conn.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN a.availability<>'Present' THEN 1 ELSE 0 END),0) FROM candidate_artifacts ca JOIN artifacts a ON a.digest=ca.artifact_digest WHERE ca.project_id=? AND ca.candidate_id=?`, query.ProjectID, query.CandidateID).Scan(&candidateArtifactCount, &unavailableCount); err != nil {
		return port.CompletionMaterial{}, normalizeError(err)
	}
	material.CandidateAvailable = material.CandidatePresent && candidateArtifactCount > 0 && unavailableCount == 0
	return material, nil
}

func (tx transaction) loadEvidence(ctx context.Context, query port.CompletionMaterialQuery, material *port.CompletionMaterial) error {
	rows, err := tx.conn.QueryContext(ctx, `SELECT e.evidence_id,e.ac_id,e.ac_revision_digest,e.verdict,e.applicability,e.availability,e.verifier_class,e.verifier_actor,e.verifier_role,e.recipe_digest,e.environment_digest,e.artifact_digest,a.media_type,a.byte_length,a.storage_key,a.availability
FROM evidence e LEFT JOIN artifacts a ON a.digest=e.artifact_digest WHERE e.project_id=? AND e.completion_subject_digest=? ORDER BY e.evidence_id`, query.ProjectID, query.SubjectDigest.String())
	if err != nil {
		return normalizeError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var value port.Evidence
		var acDigest, recipeDigest, environmentDigest string
		var artifactDigest, mediaType, storageKey, artifactAvailability sql.NullString
		var byteLength sql.NullInt64
		if err := rows.Scan(&value.ID, &value.ACID, &acDigest, &value.Verdict, &value.Applicability, &value.Availability, &value.VerifierClass, &value.VerifierActor, &value.VerifierRole, &recipeDigest, &environmentDigest, &artifactDigest, &mediaType, &byteLength, &storageKey, &artifactAvailability); err != nil {
			return normalizeError(err)
		}
		value.ProjectID, value.SubjectDigest = query.ProjectID, query.SubjectDigest
		if value.ACRevisionDigest, err = ParseStorageDigest(acDigest); err != nil {
			return domain.StorageCorruptionError{Reason: "invalid evidence AC digest"}
		}
		if value.RecipeDigest, err = ParseStorageDigest(recipeDigest); err != nil {
			return domain.StorageCorruptionError{Reason: "invalid evidence recipe"}
		}
		if value.EnvironmentDigest, err = ParseStorageDigest(environmentDigest); err != nil {
			return domain.StorageCorruptionError{Reason: "invalid evidence environment"}
		}
		if artifactDigest.Valid {
			value.ArtifactDigest, err = ParseStorageDigest(artifactDigest.String)
			if err != nil || !mediaType.Valid || !byteLength.Valid || byteLength.Int64 < 0 || !storageKey.Valid || !artifactAvailability.Valid {
				return domain.StorageCorruptionError{Reason: "invalid evidence artifact"}
			}
			material.Artifacts = append(material.Artifacts, port.Artifact{Digest: value.ArtifactDigest, MediaType: mediaType.String, ByteLength: uint64(byteLength.Int64), StorageKey: storageKey.String, Availability: artifactAvailability.String})
		}
		material.Evidence = append(material.Evidence, value)
	}
	return normalizeError(rows.Err())
}

func (tx transaction) loadReviews(ctx context.Context, query port.CompletionMaterialQuery, material *port.CompletionMaterial) error {
	rows, err := tx.conn.QueryContext(ctx, `SELECT review_id,verdict,reviewer_id,independent,created_at_ns FROM reviews WHERE project_id=? AND completion_subject_digest=? ORDER BY created_at_ns,review_id`, query.ProjectID, query.SubjectDigest.String())
	if err != nil {
		return normalizeError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var review port.Review
		if err := rows.Scan(&review.ID, &review.Verdict, &review.Reviewer, &review.Independent, &review.CreatedAtNS); err != nil {
			return normalizeError(err)
		}
		review.ProjectID, review.SubjectDigest = query.ProjectID, query.SubjectDigest
		material.Reviews = append(material.Reviews, review)
	}
	return normalizeError(rows.Err())
}

func (tx transaction) loadApprovals(ctx context.Context, query port.CompletionMaterialQuery, material *port.CompletionMaterial) error {
	rows, err := tx.conn.QueryContext(ctx, `SELECT approval_id,command_kind,actor_id,expires_at_ns FROM approvals WHERE project_id=? AND completion_subject_digest=? ORDER BY approval_id`, query.ProjectID, query.SubjectDigest.String())
	if err != nil {
		return normalizeError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var approval port.Approval
		if err := rows.Scan(&approval.ID, &approval.CommandKind, &approval.Actor, &approval.ExpiresAtNS); err != nil {
			return normalizeError(err)
		}
		approval.ProjectID, approval.SubjectDigest = query.ProjectID, query.SubjectDigest
		material.Approvals = append(material.Approvals, approval)
	}
	return normalizeError(rows.Err())
}
func (tx transaction) UpdateWorkItem(ctx context.Context, item domain.WorkItem, expected uint64) error {
	if expected == 0 || item.Version() != expected+1 {
		return domain.Rejection{Code: domain.CodeVersionConflict}
	}
	r, err := tx.conn.ExecContext(ctx, `UPDATE work_items SET phase=?, version=? WHERE project_id=? AND work_item_id=? AND version=?`, item.Phase(), item.Version(), item.ProjectID(), item.ID(), expected)
	if err != nil {
		return normalizeError(err)
	}
	n, err := r.RowsAffected()
	if err != nil || n != 1 {
		return domain.Rejection{Code: domain.CodeVersionConflict}
	}
	return nil
}
func (tx transaction) CreateRun(ctx context.Context, value port.Run) error {
	if value.ID == "" || value.ProjectID == "" || value.WorkItemID == "" || value.InputDigest.IsZero() || value.AdapterID == "" || value.AdapterVersion == "" || value.ScenarioID == "" || value.Attempt == 0 || value.CreatedAtNS <= 0 {
		return fmt.Errorf("invalid run")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO runs (project_id,run_id,work_item_id,input_digest,adapter_id,adapter_version,scenario_id,attempt,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome,created_at_ns) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.ProjectID, value.ID, value.WorkItemID, value.InputDigest.String(), value.AdapterID, value.AdapterVersion, value.ScenarioID, value.Attempt, value.DesiredAction, value.DispatchState, value.ObservedState, value.ReconciliationState, value.SideEffectOutcome, value.CreatedAtNS)
	return normalizeError(err)
}

func (tx transaction) StoreACRevision(ctx context.Context, value port.ACRevision) error {
	if value.ID == "" || value.ProjectID == "" || value.ACID == "" || value.Digest.IsZero() || value.CreatedAtNS <= 0 {
		return fmt.Errorf("invalid AC revision")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO ac_revisions (project_id,ac_revision_id,ac_id,revision_digest,content,created_at_ns) VALUES (?,?,?,?,?,?)`, value.ProjectID, value.ID, value.ACID, value.Digest.String(), value.Content, value.CreatedAtNS)
	return normalizeError(err)
}

func (tx transaction) RequireACRevision(ctx context.Context, value port.ACRequirement) error {
	if value.ProjectID == "" || value.WorkItemID == "" || value.ACID == "" || value.RevisionDigest.IsZero() {
		return fmt.Errorf("invalid AC requirement")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO work_item_ac_requirements (project_id,work_item_id,ac_id,revision_digest) VALUES (?,?,?,?)`, value.ProjectID, value.WorkItemID, value.ACID, value.RevisionDigest.String())
	return normalizeError(err)
}

func (tx transaction) StoreDependencyRevision(ctx context.Context, value port.DependencyRevision) error {
	if value.ProjectID == "" || value.Digest.IsZero() || value.CreatedAtNS <= 0 {
		return fmt.Errorf("invalid dependency revision")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO dependency_revisions (project_id,graph_revision_digest,content,created_at_ns) VALUES (?,?,?,?)`, value.ProjectID, value.Digest.String(), value.Content, value.CreatedAtNS)
	return normalizeError(err)
}

func (tx transaction) StoreCandidate(ctx context.Context, value port.Candidate) error {
	if value.ID == "" || value.ProjectID == "" || value.RunID == "" || value.Digest.IsZero() || value.InputSubjectDigest.IsZero() || value.CreatedAtNS <= 0 {
		return fmt.Errorf("invalid candidate")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO candidates (project_id,candidate_id,run_id,candidate_digest,input_subject_digest,created_at_ns) VALUES (?,?,?,?,?,?)`, value.ProjectID, value.ID, value.RunID, value.Digest.String(), value.InputSubjectDigest.String(), value.CreatedAtNS)
	return normalizeError(err)
}

func (tx transaction) StoreArtifact(ctx context.Context, value port.Artifact) error {
	if value.Digest.IsZero() || value.MediaType == "" || value.StorageKey == "" {
		return fmt.Errorf("invalid artifact")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO artifacts (digest,media_type,byte_length,storage_key,availability) VALUES (?,?,?,?,?)`, value.Digest.String(), value.MediaType, value.ByteLength, value.StorageKey, value.Availability)
	return normalizeError(err)
}

func (tx transaction) BindCandidateArtifact(ctx context.Context, projectID domain.ProjectID, candidateID domain.CandidateID, digest domain.Digest) error {
	if projectID == "" || candidateID == "" || digest.IsZero() {
		return fmt.Errorf("invalid candidate artifact")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO candidate_artifacts (project_id,candidate_id,artifact_digest) VALUES (?,?,?)`, projectID, candidateID, digest.String())
	return normalizeError(err)
}

func (tx transaction) StoreEvidence(ctx context.Context, value port.Evidence) error {
	if value.ID == "" || value.ProjectID == "" || value.SubjectDigest.IsZero() || value.ACID == "" || value.ACRevisionDigest.IsZero() || value.VerifierClass == "" || value.VerifierActor == "" || value.VerifierRole == "" || value.RecipeDigest.IsZero() || value.EnvironmentDigest.IsZero() {
		return fmt.Errorf("invalid evidence")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO evidence (project_id,evidence_id,completion_subject_digest,ac_id,ac_revision_digest,verdict,applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest,artifact_digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.ProjectID, value.ID, value.SubjectDigest.String(), value.ACID, value.ACRevisionDigest.String(), value.Verdict, value.Applicability, value.Availability, value.VerifierClass, value.VerifierActor, value.VerifierRole, value.RecipeDigest.String(), value.EnvironmentDigest.String(), nullableDigest(value.ArtifactDigest))
	return normalizeError(err)
}

func (tx transaction) StoreReview(ctx context.Context, value port.Review) error {
	if value.ID == "" || value.ProjectID == "" || value.SubjectDigest.IsZero() || value.Reviewer == "" || value.CreatedAtNS <= 0 {
		return fmt.Errorf("invalid review")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO reviews (project_id,review_id,completion_subject_digest,verdict,reviewer_id,independent,created_at_ns) VALUES (?,?,?,?,?,?,?)`, value.ProjectID, value.ID, value.SubjectDigest.String(), value.Verdict, value.Reviewer, value.Independent, value.CreatedAtNS)
	return normalizeError(err)
}

func (tx transaction) StoreApproval(ctx context.Context, value port.Approval) error {
	if value.ID == "" || value.ProjectID == "" || value.SubjectDigest.IsZero() || value.CommandKind == "" || value.Actor == "" || value.ExpiresAtNS <= 0 {
		return fmt.Errorf("invalid approval")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO approvals (project_id,approval_id,completion_subject_digest,command_kind,actor_id,expires_at_ns) VALUES (?,?,?,?,?,?)`, value.ProjectID, value.ID, value.SubjectDigest.String(), value.CommandKind, value.Actor, value.ExpiresAtNS)
	return normalizeError(err)
}

func (tx transaction) StoreCompletion(ctx context.Context, value port.Completion) error {
	if value.Item.Phase() != domain.PhaseDone || value.Record.WorkItemID() != value.Item.ID() || value.Record.ResultVersion() != value.Item.Version() || value.Record.SubjectDigest().IsZero() || value.Actor == "" || value.TimestampNS <= 0 || len(value.EvidenceIDs) == 0 || len(value.ReviewIDs) == 0 {
		return domain.StorageCorruptionError{Reason: "invalid completion write"}
	}
	if err := validateApprovalConsumptions(value); err != nil {
		return err
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES (?,?,?,?,?,?,?,?,?,?)`, value.Item.ProjectID(), value.Record.ID(), value.Item.ID(), value.Record.ResultVersion(), value.Record.SubjectDigest().String(), value.Actor, value.TimestampNS, len(value.EvidenceIDs), len(value.ReviewIDs), len(value.ApprovalIDs))
	if err != nil {
		return normalizeError(err)
	}
	for _, id := range value.EvidenceIDs {
		if _, err := tx.conn.ExecContext(ctx, `INSERT INTO completion_record_evidence (project_id,completion_record_id,evidence_id) VALUES (?,?,?)`, value.Item.ProjectID(), value.Record.ID(), id); err != nil {
			return normalizeError(err)
		}
	}
	for _, id := range value.ReviewIDs {
		if _, err := tx.conn.ExecContext(ctx, `INSERT INTO completion_record_reviews (project_id,completion_record_id,review_id) VALUES (?,?,?)`, value.Item.ProjectID(), value.Record.ID(), id); err != nil {
			return normalizeError(err)
		}
	}
	for _, id := range value.ApprovalIDs {
		if _, err := tx.conn.ExecContext(ctx, `INSERT INTO completion_record_approvals (project_id,completion_record_id,approval_id) VALUES (?,?,?)`, value.Item.ProjectID(), value.Record.ID(), id); err != nil {
			return normalizeError(err)
		}
	}
	for _, consumption := range value.Consumptions {
		if err := tx.ConsumeApproval(ctx, consumption); err != nil {
			return err
		}
	}
	return verifyCompletionJoins(ctx, tx.conn, value.Item.ProjectID(), value.Record.ID(), value.Record.SubjectDigest().String(), len(value.EvidenceIDs), len(value.ReviewIDs), len(value.ApprovalIDs))
}

func validateApprovalConsumptions(value port.Completion) error {
	if len(value.ApprovalIDs) != len(value.Consumptions) {
		return domain.StorageCorruptionError{Reason: "invalid approval consumption set"}
	}
	approvals := make(map[domain.ApprovalID]struct{}, len(value.ApprovalIDs))
	for _, approvalID := range value.ApprovalIDs {
		if approvalID == "" {
			return domain.StorageCorruptionError{Reason: "invalid approval consumption set"}
		}
		if _, duplicate := approvals[approvalID]; duplicate {
			return domain.StorageCorruptionError{Reason: "invalid approval consumption set"}
		}
		approvals[approvalID] = struct{}{}
	}
	consumptionIDs := make(map[string]struct{}, len(value.Consumptions))
	consumedApprovals := make(map[domain.ApprovalID]struct{}, len(value.Consumptions))
	for _, consumption := range value.Consumptions {
		_, joined := approvals[consumption.ApprovalID]
		_, duplicateID := consumptionIDs[consumption.ID]
		_, duplicateApproval := consumedApprovals[consumption.ApprovalID]
		if consumption.ID == "" || consumption.CommandID == "" || consumption.Actor == "" || consumption.TimestampNS <= 0 || consumption.SubjectDigest.IsZero() || consumption.ProjectID != value.Item.ProjectID() || consumption.CompletionRecordID != value.Record.ID() || consumption.SubjectDigest != value.Record.SubjectDigest() || !joined || duplicateID || duplicateApproval {
			return domain.StorageCorruptionError{Reason: "invalid approval consumption set"}
		}
		consumptionIDs[consumption.ID] = struct{}{}
		consumedApprovals[consumption.ApprovalID] = struct{}{}
	}
	return nil
}

func (tx transaction) ConsumeApproval(ctx context.Context, value port.ApprovalConsumption) error {
	if value.ID == "" || value.ProjectID == "" || value.CompletionRecordID == "" || value.ApprovalID == "" || value.CommandID == "" || value.SubjectDigest.IsZero() || value.Actor == "" || value.TimestampNS <= 0 {
		return fmt.Errorf("invalid approval consumption")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO approval_consumptions (project_id,approval_consumption_id,completion_record_id,approval_id,command_id,completion_subject_digest,consuming_actor,consumed_at_ns) VALUES (?,?,?,?,?,?,?,?)`, value.ProjectID, value.ID, value.CompletionRecordID, value.ApprovalID, value.CommandID, value.SubjectDigest.String(), value.Actor, value.TimestampNS)
	return normalizeError(err)
}
func (tx transaction) StoreCommandResult(ctx context.Context, value port.CommandResult) error {
	if value.ID == "" || value.ProjectID == "" || value.Digest.IsZero() || len(value.Payload) == 0 || domain.HashBytes(value.Payload) != value.Digest || value.TimestampNS <= 0 {
		return fmt.Errorf("invalid command result")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO command_results (command_id,project_id,result_digest,result_payload,created_at_ns) VALUES (?,?,?,?,?)`, value.ID, value.ProjectID, value.Digest.String(), bytes.Clone(value.Payload), value.TimestampNS)
	return normalizeError(err)
}
func (tx transaction) StoreIdempotency(ctx context.Context, value port.Idempotency) error {
	if value.Principal == "" || value.ProjectID == "" || value.Operation == "" || value.Key == "" || value.RequestDigest.IsZero() || value.CommandID == "" || value.ExpiresAtNS <= 0 {
		return fmt.Errorf("invalid idempotency record")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO idempotency_records (principal_id,project_id,operation,idempotency_key,canonical_request_digest,result_command_id,expires_at_ns,tombstoned) VALUES (?,?,?,?,?,?,?,?)`, value.Principal, value.ProjectID, value.Operation, value.Key, value.RequestDigest.String(), value.CommandID, value.ExpiresAtNS, value.Tombstoned)
	return normalizeError(err)
}
func (tx transaction) AppendAudit(ctx context.Context, value port.AuditEntry) (uint64, error) {
	if value.GroupID == "" || value.CommandID == "" || value.ProjectID == "" || value.Actor == "" || value.Operation == "" || value.SubjectDigest.IsZero() || value.TimestampNS <= 0 {
		return 0, fmt.Errorf("invalid audit entry")
	}
	if _, err := tx.conn.ExecContext(ctx, `INSERT INTO audit_groups (project_id,audit_group_id,command_id,actor_id,created_at_ns) VALUES (?,?,?,?,?)`, value.ProjectID, value.GroupID, value.CommandID, value.Actor, value.TimestampNS); err != nil {
		return 0, normalizeError(err)
	}
	var sequence uint64
	if err := tx.conn.QueryRowContext(ctx, `SELECT COALESCE(MAX(audit_sequence),0)+1 FROM audit_entries`).Scan(&sequence); err != nil {
		return 0, normalizeError(err)
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO audit_entries (audit_sequence,project_id,audit_group_id,actor_id,operation,subject_digest,before_digest,after_digest) VALUES (?,?,?,?,?,?,?,?)`, sequence, value.ProjectID, value.GroupID, value.Actor, value.Operation, value.SubjectDigest.String(), nullableDigest(value.BeforeDigest), nullableDigest(value.AfterDigest))
	return sequence, normalizeError(err)
}
func (tx transaction) EnqueueOutbox(ctx context.Context, value port.OutboxIntent) error {
	if value.ID == "" || value.CommandID == "" || value.AuditGroupID == "" || value.ProjectID == "" || value.PayloadDigest.IsZero() || value.TimestampNS <= 0 {
		return fmt.Errorf("invalid outbox intent")
	}
	_, err := tx.conn.ExecContext(ctx, `INSERT INTO outbox (project_id,intent_id,command_id,audit_group_id,run_id,payload_digest,state,claim_epoch,created_at_ns) VALUES (?,?,?,?,?,?,'Pending',0,?)`, value.ProjectID, value.ID, value.CommandID, value.AuditGroupID, value.RunID, value.PayloadDigest.String(), value.TimestampNS)
	return normalizeError(err)
}
func (tx transaction) AppendProjectionEvent(ctx context.Context, value port.ProjectionEvent) (port.Cursor, error) {
	if value.ProjectID == "" || value.PayloadDigest.IsZero() || value.AuditSequence == 0 {
		return port.Cursor{}, fmt.Errorf("invalid projection event")
	}
	if value.Epoch != 0 || value.Sequence != 0 {
		return port.Cursor{}, fmt.Errorf("projection cursor is allocator-owned")
	}
	var epoch, next uint64
	if err := tx.conn.QueryRowContext(ctx, `SELECT stream_epoch,next_event_sequence FROM instance_state WHERE id=1`).Scan(&epoch, &next); err != nil {
		return port.Cursor{}, normalizeError(err)
	}
	previous := next
	next++
	result, err := tx.conn.ExecContext(ctx, `UPDATE instance_state SET next_event_sequence=? WHERE id=1 AND stream_epoch=? AND next_event_sequence=?`, next, epoch, previous)
	if err != nil {
		return port.Cursor{}, normalizeError(err)
	}
	changed, err := result.RowsAffected()
	if err != nil || changed != 1 {
		return port.Cursor{}, fmt.Errorf("projection sequence allocation conflict")
	}
	_, err = tx.conn.ExecContext(ctx, `INSERT INTO projection_events (stream_epoch,event_sequence,project_id,payload_digest,payload,audit_sequence) VALUES (?,?,?,?,?,?)`, epoch, next, value.ProjectID, value.PayloadDigest.String(), value.Payload, value.AuditSequence)
	return port.Cursor{Epoch: epoch, Sequence: next}, normalizeError(err)
}

func nullableDigest(value domain.Digest) any {
	if value.IsZero() {
		return nil
	}
	return value.String()
}

func configure(conn *sql.Conn, ctx context.Context) error {
	for _, pragma := range []string{"PRAGMA foreign_keys = ON", "PRAGMA journal_mode = WAL", "PRAGMA synchronous = FULL", "PRAGMA busy_timeout = 5000"} {
		if _, err := conn.ExecContext(ctx, pragma); err != nil {
			return normalizeError(err)
		}
	}
	var foreignKeys, synchronous, busyTimeout int
	var journalMode string
	if err := conn.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		return normalizeError(err)
	}
	if err := conn.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err != nil {
		return normalizeError(err)
	}
	if err := conn.QueryRowContext(ctx, "PRAGMA synchronous").Scan(&synchronous); err != nil {
		return normalizeError(err)
	}
	if err := conn.QueryRowContext(ctx, "PRAGMA busy_timeout").Scan(&busyTimeout); err != nil {
		return normalizeError(err)
	}
	if foreignKeys != 1 || strings.ToLower(journalMode) != "wal" || synchronous != 2 || busyTimeout != busyTimeoutMS {
		return fmt.Errorf("SQLite pragma assertion failed")
	}
	return nil
}

func migrate(conn *sql.Conn, ctx context.Context, appliedAtNS int64) error {
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
version INTEGER PRIMARY KEY CHECK(version > 0), checksum TEXT NOT NULL UNIQUE, applied_at_ns INTEGER NOT NULL)`); err != nil {
		return normalizeError(err)
	}
	checksum := migrationChecksum()
	var applied string
	err := conn.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version = ?", migrationVersion).Scan(&applied)
	if err == nil {
		if applied != checksum {
			return fmt.Errorf("schema migration checksum mismatch")
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return normalizeError(err)
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return normalizeError(err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		}
	}()
	if _, err := conn.ExecContext(ctx, v1Migration); err != nil {
		return normalizeError(err)
	}
	if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations (version, checksum, applied_at_ns) VALUES (?, ?, ?)", migrationVersion, checksum, appliedAtNS); err != nil {
		return normalizeError(err)
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return normalizeError(err)
	}
	committed = true
	return nil
}

func assertEngine(conn *sql.Conn, ctx context.Context) error {
	var version string
	if err := conn.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&version); err != nil {
		return normalizeError(err)
	}
	parts := strings.Split(version, ".")
	if len(parts) < 3 {
		return fmt.Errorf("invalid SQLite engine version %q", version)
	}
	major, majorErr := strconv.Atoi(parts[0])
	minor, minorErr := strconv.Atoi(parts[1])
	patch, patchErr := strconv.Atoi(parts[2])
	if majorErr != nil || minorErr != nil || patchErr != nil || major < 3 || (major == 3 && (minor < 51 || minor == 51 && patch < 3)) {
		return fmt.Errorf("SQLite engine %q is below 3.51.3", version)
	}
	return nil
}

func databaseURI(path string) string {
	uri := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	query := url.Values{}
	query.Add("_pragma", "foreign_keys(1)")
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "synchronous(FULL)")
	query.Add("_pragma", "busy_timeout(5000)")
	uri.RawQuery = query.Encode()
	return uri.String()
}

func migrationChecksum() string {
	sum := sha256.Sum256([]byte(v1Migration))
	return fmt.Sprintf("%x", sum)
}

// ParseStorageDigest converts only the V1 bare storage spelling to a domain
// digest. HTTP's sha256: prefix belongs exclusively to the later HTTP codec.
func ParseStorageDigest(value string) (domain.Digest, error) {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) || strings.Contains(value, "sha256:") {
		return domain.Digest{}, domain.ErrInvalidDigest
	}
	digest, err := domain.ParseDigest(value)
	if err != nil || digest.IsZero() {
		return domain.Digest{}, domain.ErrInvalidDigest
	}
	return digest, nil
}

func StorageDigest(value domain.Digest) (string, error) {
	if value.IsZero() {
		return "", domain.ErrInvalidDigest
	}
	encoded := value.String()
	if _, err := ParseStorageDigest(encoded); err != nil {
		return "", err
	}
	return encoded, nil
}

func toCapabilityBlockers(source []domain.Blocker) []rehydrationcap.Blocker {
	result := make([]rehydrationcap.Blocker, len(source))
	for index, blocker := range source {
		result[index] = rehydrationcap.Blocker{ID: string(blocker.ID), Reason: blocker.Reason}
	}
	return result
}

func normalizeError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return port.ErrNotFound
	}
	if sqliteErr, ok := errors.AsType[*sqlitedriver.Error](err); ok && sqliteErr.Code()&0xff == sqlitelib.SQLITE_BUSY {
		return BusyError{cause: err}
	}
	return err
}

var _ port.Persistence = (*Store)(nil)
