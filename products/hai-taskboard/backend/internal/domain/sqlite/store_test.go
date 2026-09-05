package sqlite

import (
	"bytes"
	"context"
	"errors"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/internal/rehydrationcap"
)

const capabilityImport = "github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/internal/rehydrationcap"

var errForcedFailure = errors.New("forced transaction failure")

func TestSQLiteV1_MigrationPragmasAndConstraints(t *testing.T) {
	ctx := t.Context()
	store := openTestStore(t)
	defer store.Close()

	identity, err := store.Identity(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if identity.EngineVersion == "" || identity.MigrationSum != migrationChecksum() {
		t.Fatalf("identity = %#v", identity)
	}
	t.Logf("linked SQLite engine %s", identity.EngineVersion)

	var foreignKeys, synchronous, timeout int
	var journalMode string
	mustScan(t, store, "PRAGMA foreign_keys", &foreignKeys)
	mustScan(t, store, "PRAGMA journal_mode", &journalMode)
	mustScan(t, store, "PRAGMA synchronous", &synchronous)
	mustScan(t, store, "PRAGMA busy_timeout", &timeout)
	if foreignKeys != 1 || strings.ToLower(journalMode) != "wal" || synchronous != 2 || timeout != busyTimeoutMS {
		t.Fatalf("pragmas = (%d,%s,%d,%d)", foreignKeys, journalMode, synchronous, timeout)
	}

	if _, err := store.db.ExecContext(ctx, `INSERT INTO artifacts (digest,media_type,byte_length,storage_key,availability) VALUES (?,'text/plain',0,'object','Present')`, strings.ToUpper(domain.HashString("artifact").String())); err == nil {
		t.Fatal("uppercase digest passed storage constraint")
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE schema_migrations SET checksum='changed' WHERE version=1"); err == nil {
		t.Fatal("migration checksum row was mutable")
	}
	mustCreateProject(t, store)
	item := mustWorkItem(t, "item-1", "project-1", domain.PhaseQA, 5)
	mustCreateWorkItem(t, store, item)
	if _, err := store.db.ExecContext(ctx, "UPDATE work_items SET phase='Done',version=6 WHERE project_id='project-1' AND work_item_id='item-1'"); err == nil {
		t.Fatal("Done update without CompletionRecord succeeded")
	}
	assertForeignKeysClean(t, store)
}

func TestSQLiteDigestStorageDomainRoundTrip(t *testing.T) {
	digest := domain.HashString("candidate")
	stored, err := StorageDigest(digest)
	if err != nil {
		t.Fatal(err)
	}
	rehydrated, err := ParseStorageDigest(stored)
	if err != nil || rehydrated != digest {
		t.Fatalf("round trip = (%s,%v)", rehydrated, err)
	}
	for _, value := range []string{"sha256:" + stored, strings.ToUpper(stored), stored[:63], strings.Repeat("g", 64), strings.Repeat("0", 64)} {
		if _, err := ParseStorageDigest(value); err == nil {
			t.Fatalf("invalid storage digest accepted: %q", value)
		}
	}
}

func TestSQLiteHistoryAndControlledPathAttacks(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "escape-link")); err != nil {
		t.Fatal(err)
	}
	outsideDB := filepath.Join(outside, "outside.db")
	if err := os.WriteFile(outsideDB, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideDB, filepath.Join(root, "escape-file.db")); err != nil {
		t.Fatal(err)
	}
	paths := []string{
		"relative.db",
		filepath.Join(root, "..", "escape.db"),
		filepath.Join(root, "injected.db?pragma=foreign_keys(0)"),
		filepath.Join(root, "injected.db#fragment"),
		filepath.Join(root, "encoded%3F_pragma%3Dforeign_keys(0).db"),
		filepath.Join(root, "escape-link", "state.db"),
		filepath.Join(root, "escape-file.db"),
	}
	for _, path := range paths {
		if _, err := OpenAtRootWithClock(ctx, root, path, fixedClock(42)); !errors.Is(err, ErrInvalidPath) {
			t.Fatalf("path %q error = %v", path, err)
		}
	}
	store, err := OpenAtRootWithClock(ctx, root, filepath.Join(root, "state.db"), fixedClock(42))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	mustCreateProject(t, store)
	insertDoneWorkItem(t, store, "project-1", "history-item", 8)
	insertValidCompletion(t, store, "project-1", "history-item", 6, "completion-1", "first")
	insertValidCompletion(t, store, "project-1", "history-item", 8, "completion-2", "second")
	loaded, err := store.LoadWorkItem(ctx, "project-1", "history-item")
	if err != nil || loaded.Phase() != domain.PhaseDone || loaded.Version() != 8 {
		t.Fatalf("current completion = (%#v,%v)", loaded, err)
	}
	var count int
	mustScan(t, store, `SELECT COUNT(*) FROM completion_records WHERE project_id='project-1' AND work_item_id='history-item'`, &count)
	if count != 2 {
		t.Fatalf("history count = %d", count)
	}
	var appliedAt int64
	mustScan(t, store, `SELECT applied_at_ns FROM schema_migrations WHERE version=1`, &appliedAt)
	if appliedAt != 42 {
		t.Fatalf("migration timestamp = %d", appliedAt)
	}
}

func TestUnitOfWork_PublicPortSuccessReplayAndFailureInjection(t *testing.T) {
	failurePoints := []string{"run", "materials", "result", "completion", "aggregate", "idempotency", "audit", "outbox", "projection"}
	for _, point := range failurePoints {
		t.Run("rollback-after-"+point, func(t *testing.T) {
			store, completed := commandFixture(t)
			defer store.Close()
			err := runCommandTransaction(t.Context(), store, completed, point)
			if !errors.Is(err, errForcedFailure) {
				t.Fatalf("failure = %v", err)
			}
			assertCommandWrites(t, store, 0, domain.PhaseQA, 5, 0)
		})
	}
	t.Run("rollback-at-consumption-seam", func(t *testing.T) {
		store, completed := commandFixture(t)
		defer store.Close()
		if err := runCommandTransaction(t.Context(), store, completed, "consumption-seam"); err == nil || errors.Is(err, errForcedFailure) {
			t.Fatalf("consumption seam failure = %v", err)
		}
		assertCommandWrites(t, store, 0, domain.PhaseQA, 5, 0)
	})

	store, completed := commandFixture(t)
	defer store.Close()
	if err := runCommandTransaction(t.Context(), store, completed, ""); err != nil {
		t.Fatal(err)
	}
	assertCommandWrites(t, store, 1, domain.PhaseDone, 6, 1)
	loaded, err := store.LoadWorkItem(t.Context(), "project-1", "item-transaction")
	if err != nil || loaded.Phase() != domain.PhaseDone || loaded.Version() != 6 {
		t.Fatalf("multi-approval completion load = (%#v,%v)", loaded, err)
	}

	var unit port.UnitOfWork = store
	err = unit.Within(t.Context(), func(tx port.Transaction) error {
		idempotency, err := tx.LoadIdempotency(t.Context(), "operator", "project-1", "CompleteWorkItem", "key-1")
		if err != nil || idempotency.CommandID != "command-1" || idempotency.RequestDigest != domain.HashString("request") {
			return errors.New("idempotency replay mismatch")
		}
		result, err := tx.LoadCommandResult(t.Context(), "project-1", idempotency.CommandID)
		if err != nil || result.Digest != domain.HashBytes(canonicalCommandSuccessPayload()) || !bytes.Equal(result.Payload, canonicalCommandSuccessPayload()) {
			return errors.New("command result replay mismatch")
		}
		material, err := tx.LoadCompletionMaterial(t.Context(), completionQuery(completed.Record.SubjectDigest()))
		if err != nil {
			return err
		}
		if !material.CandidatePresent || !material.CandidateAvailable || !material.RunPresent || material.ActiveOrUnknownRun || material.Candidate.ID != "candidate-1" || material.Run.AdapterID != "fake/custom" || material.Run.AdapterVersion != "adapter/7" || material.Run.ScenarioID != "scenario-9" || material.Run.Attempt != 3 || len(material.RequiredACRevisions) != 1 || material.GraphRevisionDigest != domain.HashString("graph") || len(material.Evidence) != 1 || len(material.Reviews) != 1 || len(material.Approvals) != 2 || len(material.Artifacts) != 1 {
			return errors.New("completion material mismatch")
		}
		missingQuery := completionQuery(completed.Record.SubjectDigest())
		missingQuery.CandidateID, missingQuery.RunID = "missing-candidate", "missing-run"
		missing, err := tx.LoadCompletionMaterial(t.Context(), missingQuery)
		if err != nil || missing.CandidatePresent || missing.CandidateAvailable || missing.RunPresent {
			return errors.New("missing candidate facts did not fail closed")
		}
		otherSubjectQuery := completionQuery(domain.HashString("other-subject"))
		otherSubject, err := tx.LoadCompletionMaterial(t.Context(), otherSubjectQuery)
		if err != nil || len(otherSubject.Evidence) != 0 || len(otherSubject.Reviews) != 0 || len(otherSubject.Approvals) != 0 || len(otherSubject.Artifacts) != 0 {
			return errors.New("completion material crossed subject boundary")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := store.CreateProject(t.Context(), port.Project{ID: "project-2", Name: "project-2", Repository: "repo", Ref: "main", Version: 1}); err != nil {
		t.Fatal(err)
	}
	err = unit.Within(t.Context(), func(tx port.Transaction) error {
		_, err := tx.LoadCommandResult(t.Context(), "project-2", "command-1")
		return err
	})
	if !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("cross-project result lookup = %v", err)
	}
	err = unit.Within(t.Context(), func(tx port.Transaction) error {
		if _, err := tx.LoadIdempotency(t.Context(), "missing", "project-1", "CompleteWorkItem", "absent"); !errors.Is(err, port.ErrNotFound) {
			return errors.New("idempotency absence did not use port.ErrNotFound")
		}
		_, err := tx.LoadCommandResult(t.Context(), "project-1", "absent")
		return err
	})
	if !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("absent replay lookup = %v", err)
	}

	var before, after any
	if err := store.db.QueryRowContext(t.Context(), `SELECT before_digest,after_digest FROM audit_entries WHERE audit_sequence=1`).Scan(&before, &after); err != nil {
		t.Fatal(err)
	}
	if before != nil || after == nil {
		t.Fatalf("audit digests = (%v,%v)", before, after)
	}
	var completedAt, consumedAt int64
	if err := store.db.QueryRowContext(t.Context(), `SELECT completed_at_ns FROM completion_records WHERE project_id='project-1' AND completion_record_id='completion-1'`).Scan(&completedAt); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRowContext(t.Context(), `SELECT consumed_at_ns FROM approval_consumptions WHERE project_id='project-1' AND approval_consumption_id='consumption-1'`).Scan(&consumedAt); err != nil {
		t.Fatal(err)
	}
	if completedAt != 21 || consumedAt != 21 {
		t.Fatalf("completion timestamps = (%d,%d)", completedAt, consumedAt)
	}
	assertSQLRejected(t, store, `UPDATE approval_consumptions SET consuming_actor='other' WHERE project_id='project-1' AND approval_consumption_id='consumption-1'`)
	assertSQLRejected(t, store, `DELETE FROM approval_consumptions WHERE project_id='project-1' AND approval_consumption_id='consumption-1'`)
	err = unit.Within(t.Context(), func(tx port.Transaction) error {
		_, err := tx.AppendProjectionEvent(t.Context(), port.ProjectionEvent{ProjectID: "project-1", Epoch: 99, Sequence: 99, PayloadDigest: domain.HashString("forged"), Payload: []byte("forged"), AuditSequence: 1})
		return err
	})
	if err == nil {
		t.Fatal("forged projection cursor accepted")
	}
	assertCommandWrites(t, store, 1, domain.PhaseDone, 6, 1)
}

func TestStoreCompletion_ApprovalConsumptionSetValidationBeforeWrite(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*port.Completion)
	}{
		{"duplicate-approval-id", func(value *port.Completion) { value.ApprovalIDs[1] = value.ApprovalIDs[0] }},
		{"missing-consumption", func(value *port.Completion) { value.Consumptions = value.Consumptions[:1] }},
		{"extra-consumption", func(value *port.Completion) { value.ApprovalIDs = value.ApprovalIDs[:1] }},
		{"duplicate-consumption-id", func(value *port.Completion) { value.Consumptions[1].ID = value.Consumptions[0].ID }},
		{"duplicate-consumed-approval", func(value *port.Completion) { value.Consumptions[1].ApprovalID = value.Consumptions[0].ApprovalID }},
		{"unjoined-approval", func(value *port.Completion) { value.Consumptions[1].ApprovalID = "approval-extra" }},
		{"wrong-project", func(value *port.Completion) { value.Consumptions[1].ProjectID = "project-2" }},
		{"wrong-subject", func(value *port.Completion) { value.Consumptions[1].SubjectDigest = domain.HashString("wrong") }},
		{"wrong-completion", func(value *port.Completion) { value.Consumptions[1].CompletionRecordID = "other-completion" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store, completed := commandFixture(t)
			defer store.Close()
			err := store.Within(t.Context(), func(tx port.Transaction) error {
				if err := tx.CreateRun(t.Context(), completionRun()); err != nil {
					return err
				}
				if err := writeCompletionMaterials(t.Context(), tx, completed.Record.SubjectDigest()); err != nil {
					return err
				}
				payload := canonicalCommandSuccessPayload()
				if err := tx.StoreCommandResult(t.Context(), port.CommandResult{ID: "command-1", ProjectID: "project-1", Digest: domain.HashBytes(payload), Payload: payload, TimestampNS: 20}); err != nil {
					return err
				}
				value := port.Completion{
					Item:         completed.Item,
					Record:       completed.Record,
					Actor:        "operator",
					TimestampNS:  21,
					EvidenceIDs:  []domain.EvidenceID{"evidence-1"},
					ReviewIDs:    []domain.ReviewID{"review-1"},
					ApprovalIDs:  []domain.ApprovalID{"approval-1", "approval-2"},
					Consumptions: approvalConsumptions(completed.Record.SubjectDigest()),
				}
				test.mutate(&value)
				if err := tx.StoreCompletion(t.Context(), value); !errors.Is(err, domain.ErrStorageCorruption) {
					return errors.New("invalid consumption set was not rejected as storage corruption")
				}
				concrete := tx.(transaction)
				for _, table := range []string{"completion_records", "completion_record_evidence", "completion_record_reviews", "completion_record_approvals", "approval_consumptions"} {
					var count int
					if err := concrete.conn.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil {
						return err
					}
					if count != 0 {
						return errors.New("invalid consumption set wrote completion state")
					}
				}
				return errForcedFailure
			})
			if !errors.Is(err, errForcedFailure) {
				t.Fatal(err)
			}
			assertCommandWrites(t, store, 0, domain.PhaseQA, 5, 0)
		})
	}
}

func TestCommandResult_CanonicalPayloadReplayAndCorruption(t *testing.T) {
	tests := []struct {
		name, commandID string
		payload         []byte
	}{
		{"success", "command-1", canonicalCommandSuccessPayload()},
		{"failure", "command-failure", canonicalCommandFailurePayload()},
	}
	for _, test := range tests {
		t.Run("response-loss-"+test.name, func(t *testing.T) {
			store := openTestStore(t)
			defer store.Close()
			mustCreateProject(t, store)
			original := bytes.Clone(test.payload)
			digest := domain.HashBytes(original)
			if err := store.Within(t.Context(), func(tx port.Transaction) error {
				if err := tx.StoreCommandResult(t.Context(), port.CommandResult{ID: test.commandID, ProjectID: "project-1", Digest: digest, Payload: original, TimestampNS: 20}); err != nil {
					return err
				}
				return tx.StoreIdempotency(t.Context(), port.Idempotency{Principal: "operator", ProjectID: "project-1", Operation: "operation-" + test.name, Key: "key-" + test.name, RequestDigest: domain.HashString("request-" + test.name), CommandID: test.commandID, ExpiresAtNS: 999})
			}); err != nil {
				t.Fatal(err)
			}
			original[0] ^= 0xff
			load := func() port.CommandResult {
				t.Helper()
				var loaded port.CommandResult
				err := store.Within(t.Context(), func(tx port.Transaction) error {
					idempotency, err := tx.LoadIdempotency(t.Context(), "operator", "project-1", "operation-"+test.name, "key-"+test.name)
					if err != nil || idempotency.CommandID != test.commandID {
						return errors.New("idempotency replay did not recover command identity")
					}
					loaded, err = tx.LoadCommandResult(t.Context(), "project-1", idempotency.CommandID)
					return err
				})
				if err != nil {
					t.Fatal(err)
				}
				return loaded
			}
			first := load()
			if first.Digest != digest || !bytes.Equal(first.Payload, test.payload) {
				t.Fatalf("first replay = (%s,%q)", first.Digest, first.Payload)
			}
			first.Payload[0] ^= 0xff
			second := load()
			if !bytes.Equal(second.Payload, test.payload) {
				t.Fatalf("caller mutation changed replay = %q", second.Payload)
			}
			var count int
			mustScan(t, store, `SELECT COUNT(*) FROM command_results`, &count)
			if count != 1 {
				t.Fatalf("response-loss replay command count = %d", count)
			}
		})
	}

	t.Run("write-digest-mismatch", func(t *testing.T) {
		store := openTestStore(t)
		defer store.Close()
		mustCreateProject(t, store)
		payload := canonicalCommandSuccessPayload()
		err := store.Within(t.Context(), func(tx port.Transaction) error {
			return tx.StoreCommandResult(t.Context(), port.CommandResult{ID: "command-1", ProjectID: "project-1", Digest: domain.HashString("wrong"), Payload: payload, TimestampNS: 20})
		})
		if err == nil {
			t.Fatal("digest/payload mismatch was accepted")
		}
		var count int
		mustScan(t, store, `SELECT COUNT(*) FROM command_results`, &count)
		if count != 0 {
			t.Fatalf("mismatched command result count = %d", count)
		}
	})

	t.Run("corrupt-stored-payload", func(t *testing.T) {
		store := openTestStore(t)
		defer store.Close()
		mustCreateProject(t, store)
		payload := canonicalCommandSuccessPayload()
		if err := store.Within(t.Context(), func(tx port.Transaction) error {
			return tx.StoreCommandResult(t.Context(), port.CommandResult{ID: "command-1", ProjectID: "project-1", Digest: domain.HashBytes(payload), Payload: payload, TimestampNS: 20})
		}); err != nil {
			t.Fatal(err)
		}
		mustExec(t, store, `DROP TRIGGER command_results_immutable_update`)
		mustExec(t, store, `UPDATE command_results SET result_payload=x'74616d7065726564' WHERE project_id='project-1' AND command_id='command-1'`)
		var loaded port.CommandResult
		err := store.Within(t.Context(), func(tx port.Transaction) error {
			var err error
			loaded, err = tx.LoadCommandResult(t.Context(), "project-1", "command-1")
			return err
		})
		if !errors.Is(err, domain.ErrStorageCorruption) || loaded.ID != "" || loaded.ProjectID != "" || loaded.Digest != (domain.Digest{}) || loaded.Payload != nil || loaded.TimestampNS != 0 {
			t.Fatalf("corrupt replay = (%#v,%v)", loaded, err)
		}
	})
}

func TestCompletionMaterial_VerifierRoleRoundTripAndDomainReconstruction(t *testing.T) {
	store, _ := commandFixture(t)
	defer store.Close()
	subject := completionSubject(t)
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		if err := tx.CreateRun(t.Context(), completionRun()); err != nil {
			return err
		}
		return writeCompletionMaterialsWithRole(t.Context(), tx, subject.Digest(), "producer-run")
	}); err != nil {
		t.Fatal(err)
	}
	var material port.CompletionMaterial
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		var err error
		material, err = tx.LoadCompletionMaterial(t.Context(), completionQuery(subject.Digest()))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if len(material.Evidence) != 1 || material.Evidence[0].VerifierRole != "producer-run" || material.Evidence[0].VerifierActor != "verifier" || material.Evidence[0].VerifierClass != "independent" {
		t.Fatalf("persisted verifier identity = %#v", material.Evidence)
	}
	persisted := material.Evidence[0]
	evidence, err := domain.NewEvidence(domain.EvidenceConfig{
		ID: persisted.ID, SubjectDigest: persisted.SubjectDigest, CheckID: domain.CheckID(persisted.ACID), State: domain.EvidenceState(persisted.Verdict), Applicability: domain.EvidenceApplicability(persisted.Applicability), Availability: domain.EvidenceAvailability(persisted.Availability), VerifierActor: persisted.VerifierActor, VerifierRole: persisted.VerifierRole, VerifierClass: persisted.VerifierClass,
	})
	if err != nil {
		t.Fatal(err)
	}
	persistedReview := material.Reviews[0]
	review, err := domain.NewReview(persistedReview.ID, persistedReview.SubjectDigest, domain.ReviewVerdict(persistedReview.Verdict), persistedReview.Reviewer, persistedReview.Independent)
	if err != nil {
		t.Fatal(err)
	}
	codes := domain.EvaluateCompletion(domain.CompletionInput{
		WorkItem: material.WorkItem, ExpectedVersion: material.WorkItem.Version(), RequestedSubject: subject, CurrentSubject: subject, CandidatePresent: material.CandidatePresent, CandidateAvailable: material.CandidateAvailable, ActiveOrUnknownRun: material.ActiveOrUnknownRun,
		RequiredChecks: []domain.CheckRequirement{{CheckID: domain.CheckID(persisted.ACID), VerifierClass: persisted.VerifierClass, Independent: true, ProhibitedVerifierRunRole: "producer-run"}}, Evidence: []domain.Evidence{evidence}, Review: &review, RecordID: "completion-role-check",
	})
	if len(codes) != 1 || !slices.Contains(codes, domain.CodeVerifierNotIndependent) {
		t.Fatalf("reconstructed verifier role codes = %v", codes)
	}
}

func TestSQLiteImmutableIdentityTriggersAllowStateTransitions(t *testing.T) {
	store, completed := commandFixture(t)
	defer store.Close()
	if err := runCommandTransaction(t.Context(), store, completed, ""); err != nil {
		t.Fatal(err)
	}
	extraPayload := canonicalCommandFailurePayload()
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		if err := tx.CreateRun(t.Context(), port.Run{ID: "run-extra", ProjectID: "project-1", WorkItemID: "item-transaction", InputDigest: domain.HashString("extra-input"), AdapterID: "fake/v1", AdapterVersion: "v1", ScenarioID: "extra", Attempt: 2, DesiredAction: "Dispatch", DispatchState: "Pending", ObservedState: "Unknown", ReconciliationState: "None", SideEffectOutcome: "NotApplicable", CreatedAtNS: 30}); err != nil {
			return err
		}
		return tx.StoreCommandResult(t.Context(), port.CommandResult{ID: "command-extra", ProjectID: "project-1", Digest: domain.HashBytes(extraPayload), Payload: extraPayload, TimestampNS: 30})
	}); err != nil {
		t.Fatal(err)
	}

	attacks := []string{
		`UPDATE command_results SET result_payload=x'7b7d' WHERE project_id='project-1' AND command_id='command-extra'`,
		`DELETE FROM command_results WHERE project_id='project-1' AND command_id='command-extra'`,
		`UPDATE projection_events SET payload=x'6368616e676564' WHERE stream_epoch=1 AND event_sequence=1`,
		`DELETE FROM projection_events WHERE stream_epoch=1 AND event_sequence=1`,
		`UPDATE runs SET input_digest='` + domain.HashString("changed-run-input").String() + `' WHERE project_id='project-1' AND run_id='run-extra'`,
		`DELETE FROM runs WHERE project_id='project-1' AND run_id='run-extra'`,
		`UPDATE idempotency_records SET canonical_request_digest='` + domain.HashString("changed-request").String() + `' WHERE principal_id='operator' AND project_id='project-1' AND operation='CompleteWorkItem' AND idempotency_key='key-1'`,
		`DELETE FROM idempotency_records WHERE principal_id='operator' AND project_id='project-1' AND operation='CompleteWorkItem' AND idempotency_key='key-1'`,
		`UPDATE outbox SET payload_digest='` + domain.HashString("changed-outbox").String() + `' WHERE project_id='project-1' AND intent_id='outbox-1'`,
		`DELETE FROM outbox WHERE project_id='project-1' AND intent_id='outbox-1'`,
	}
	for _, attack := range attacks {
		assertSQLRejected(t, store, attack)
	}

	mustExec(t, store, `UPDATE runs SET desired_action='CancelRequested',dispatch_state='Sent',observed_state='Running',reconciliation_state='NeedsReconcile',side_effect_outcome='OutcomeUnknown' WHERE project_id='project-1' AND run_id='run-extra'`)
	mustExec(t, store, `UPDATE idempotency_records SET tombstoned=1 WHERE principal_id='operator' AND project_id='project-1' AND operation='CompleteWorkItem' AND idempotency_key='key-1'`)
	mustExec(t, store, `UPDATE outbox SET state='Claimed',claim_epoch=1,claimed_at_ns=99 WHERE project_id='project-1' AND intent_id='outbox-1'`)
	var desiredAction, dispatchState, observedState, reconciliationState, sideEffectOutcome string
	mustScan(t, store, `SELECT desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome FROM runs WHERE project_id='project-1' AND run_id='run-extra'`, &desiredAction, &dispatchState, &observedState, &reconciliationState, &sideEffectOutcome)
	if desiredAction != "CancelRequested" || dispatchState != "Sent" || observedState != "Running" || reconciliationState != "NeedsReconcile" || sideEffectOutcome != "OutcomeUnknown" {
		t.Fatalf("allowed Run state update = (%s,%s,%s,%s,%s)", desiredAction, dispatchState, observedState, reconciliationState, sideEffectOutcome)
	}
	var tombstoned, claimEpoch int
	var state string
	var claimedAt int64
	mustScan(t, store, `SELECT tombstoned FROM idempotency_records WHERE principal_id='operator' AND project_id='project-1' AND operation='CompleteWorkItem' AND idempotency_key='key-1'`, &tombstoned)
	mustScan(t, store, `SELECT state,claim_epoch,claimed_at_ns FROM outbox WHERE project_id='project-1' AND intent_id='outbox-1'`, &state, &claimEpoch, &claimedAt)
	if tombstoned != 1 || state != "Claimed" || claimEpoch != 1 || claimedAt != 99 {
		t.Fatalf("allowed tombstone/outbox state = (%d,%s,%d,%d)", tombstoned, state, claimEpoch, claimedAt)
	}
	assertForeignKeysClean(t, store)
}

func TestSQLiteBusyIsTypedAndBounded(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "state.db")
	first, err := OpenAtRootWithClock(t.Context(), root, path, fixedClock(1))
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := OpenAtRootWithClock(t.Context(), root, path, fixedClock(1))
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	entered := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		finished <- first.Within(t.Context(), func(port.Transaction) error {
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	started := time.Now()
	err = second.Within(t.Context(), func(port.Transaction) error { return nil })
	elapsed := time.Since(started)
	close(release)
	if holdErr := <-finished; holdErr != nil {
		t.Fatal(holdErr)
	}
	if !errors.Is(err, ErrBusy) || elapsed < 4500*time.Millisecond || elapsed > 7*time.Second {
		t.Fatalf("busy result = (%v,%s)", err, elapsed)
	}
	synthetic := errors.New("synthetic SQLITE_BUSY database is locked")
	if normalized := normalizeError(synthetic); errors.Is(normalized, ErrBusy) || normalized != synthetic {
		t.Fatalf("synthetic error classified as busy: %v", normalized)
	}
}

func TestSQLiteLoad_DoneRequiresMatchingCompletionRecord(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*testing.T, *Store)
	}{
		{"missing-record", func(t *testing.T, store *Store) {}},
		{"wrong-project", corruptWrongProject},
		{"wrong-item", corruptWrongItem},
		{"wrong-version", corruptWrongVersion},
		{"invalid-subject", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{subject: strings.Repeat("0", 64)})
		}},
		{"missing-evidence-join", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{omitEvidenceJoin: true})
		}},
		{"mismatched-evidence-subject", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{mismatchEvidence: true})
		}},
		{"missing-review-join", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{omitReviewJoin: true})
		}},
		{"mismatched-review-subject", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{mismatchReview: true})
		}},
		{"missing-approval-join", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{omitApprovalJoin: true})
		}},
		{"mismatched-approval-subject", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{mismatchApproval: true})
		}},
		{"missing-approval-consumption", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{omitApprovalConsumption: true})
		}},
		{"duplicate-approval-consumption", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{corruptConsumption: "duplicate"})
		}},
		{"unjoined-approval-consumption", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{corruptConsumption: "unjoined"})
		}},
		{"wrong-project-approval-consumption", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{corruptConsumption: "wrong-project"})
		}},
		{"wrong-subject-approval-consumption", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{corruptConsumption: "wrong-subject"})
		}},
		{"missing-artifact", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{missingArtifact: true})
		}},
		{"non-present-artifact", func(t *testing.T, store *Store) {
			insertCompletionVariant(t, store, completionVariant{artifactAvailability: "Missing"})
		}},
		{"duplicate-current-record", corruptDuplicateCompletion},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := openTestStore(t)
			defer store.Close()
			mustCreateProject(t, store)
			insertDoneWorkItem(t, store, "project-1", "done-item", 6)
			test.mutate(t, store)
			item, err := store.LoadWorkItem(t.Context(), "project-1", "done-item")
			if !errors.Is(err, domain.ErrStorageCorruption) || item.ID() != "" || item.ProjectID() != "" || item.Version() != 0 {
				t.Fatalf("load = (%#v,%v)", item, err)
			}
		})
	}

	t.Run("valid", func(t *testing.T) {
		store := openTestStore(t)
		defer store.Close()
		mustCreateProject(t, store)
		insertDoneWorkItem(t, store, "project-1", "done-item", 6)
		insertCompletionVariant(t, store, completionVariant{})
		item, err := store.LoadWorkItem(t.Context(), "project-1", "done-item")
		if err != nil || item.ID() != "done-item" || item.Phase() != domain.PhaseDone || item.Version() != 6 {
			t.Fatalf("valid load = (%#v,%v)", item, err)
		}
	})

	t.Run("valid-approval-free", func(t *testing.T) {
		store := openTestStore(t)
		defer store.Close()
		mustCreateProject(t, store)
		insertDoneWorkItem(t, store, "project-1", "done-item", 6)
		insertApprovalFreeCompletion(t, store)
		item, err := store.LoadWorkItem(t.Context(), "project-1", "done-item")
		if err != nil || item.ID() != "done-item" || item.Phase() != domain.PhaseDone || item.Version() != 6 {
			t.Fatalf("approval-free load = (%#v,%v)", item, err)
		}
	})
}

func TestRehydrationCapabilityImportArchitecture(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller path unavailable")
	}
	backendRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
	internalRoot := filepath.Join(backendRoot, "internal")
	err := filepath.WalkDir(internalRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".go" {
			return nil
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, imported := range parsed.Imports {
			if strings.Trim(imported.Path.Value, `"`) != capabilityImport {
				continue
			}
			rel, err := filepath.Rel(backendRoot, filepath.Dir(path))
			if err != nil {
				return err
			}
			if rel != filepath.Join("internal", "domain") && rel != filepath.Join("internal", "domain", "sqlite") {
				t.Errorf("unauthorized capability import: %s", path)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if t.Failed() {
		t.FailNow()
	}
}

func TestSQLiteProjectAssociationsFailClosed(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()
	mustCreateProjectID(t, store, "project-a")
	mustCreateProjectID(t, store, "project-b")
	insertPlainWorkItem(t, store, "project-a", "item-a", domain.PhaseQA, 5)
	insertPlainWorkItem(t, store, "project-b", "item-b", domain.PhaseQA, 5)
	digest := domain.HashString("association").String()
	mustExec(t, store, `INSERT INTO ac_revisions (project_id,ac_revision_id,ac_id,revision_digest,content,created_at_ns) VALUES ('project-b','rev-b','AC-1',?,x'01',1)`, digest)
	assertSQLRejected(t, store, `INSERT INTO work_item_ac_requirements (project_id,work_item_id,ac_id,revision_digest) VALUES ('project-a','item-a','AC-1',?)`, digest)
	mustExec(t, store, `INSERT INTO dependency_revisions (project_id,graph_revision_digest,content,created_at_ns) VALUES ('project-b',?,x'01',1)`, digest)
	assertSQLRejected(t, store, `INSERT INTO dependency_edges (project_id,graph_revision_digest,from_id,to_id,kind) VALUES ('project-a',?,'A','B','depends_on')`, digest)
	mustExec(t, store, fullRunInsert("project-b", "run-b", "item-b"), digest)
	assertSQLRejected(t, store, fullRunInsert("project-a", "run-cross", "item-b"), digest)
	assertSQLRejected(t, store, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES ('project-a','completion-cross','item-b',6,?,'actor',1,1,1,0)`, digest)
	mustExec(t, store, `INSERT INTO command_results (project_id,command_id,result_digest,result_payload,created_at_ns) VALUES ('project-b','command-b',?,?,1)`, digest, []byte("association"))
	assertSQLRejected(t, store, `INSERT INTO idempotency_records (principal_id,project_id,operation,idempotency_key,canonical_request_digest,result_command_id,expires_at_ns,tombstoned) VALUES ('actor','project-a','op','key',?,'command-b',2,0)`, digest)
	mustExec(t, store, `INSERT INTO command_results (project_id,command_id,result_digest,result_payload,created_at_ns) VALUES ('project-a','command-a',?,?,1)`, digest, []byte("association"))
	mustExec(t, store, `INSERT INTO approvals (project_id,approval_id,completion_subject_digest,command_kind,actor_id,expires_at_ns) VALUES ('project-b','approval-b',?,'CompleteWorkItem','actor',2)`, digest)
	insertCompletionShell(t, store, "project-a", "item-a", "completion-a", digest)
	assertSQLRejected(t, store, `INSERT INTO approval_consumptions (project_id,approval_consumption_id,completion_record_id,approval_id,command_id,completion_subject_digest,consuming_actor,consumed_at_ns) VALUES ('project-a','consume-a','completion-a','approval-b','command-a',?,'actor',1)`, digest)
	mustExec(t, store, `INSERT INTO approvals (project_id,approval_id,completion_subject_digest,command_kind,actor_id,expires_at_ns) VALUES ('project-a','approval-a',?,'CompleteWorkItem','actor',2)`, digest)
	insertCompletionShell(t, store, "project-b", "item-b", "completion-b", digest)
	assertSQLRejected(t, store, `INSERT INTO approval_consumptions (project_id,approval_consumption_id,completion_record_id,approval_id,command_id,completion_subject_digest,consuming_actor,consumed_at_ns) VALUES ('project-a','consume-cross-completion','completion-b','approval-a','command-a',?,'actor',1)`, digest)
	assertSQLRejected(t, store, `INSERT INTO audit_groups (project_id,audit_group_id,command_id,actor_id,created_at_ns) VALUES ('project-a','audit-cross','command-b','actor',1)`)
	mustExec(t, store, `INSERT INTO audit_groups (project_id,audit_group_id,command_id,actor_id,created_at_ns) VALUES ('project-b','audit-b','command-b','actor',1)`)
	mustExec(t, store, `INSERT INTO audit_entries (audit_sequence,project_id,audit_group_id,actor_id,operation,subject_digest) VALUES (1,'project-b','audit-b','actor','op',?)`, digest)
	assertSQLRejected(t, store, `INSERT INTO outbox (project_id,intent_id,command_id,audit_group_id,run_id,payload_digest,state,claim_epoch,created_at_ns) VALUES ('project-a','outbox-a','command-b','audit-b','run-b',?,'Pending',0,1)`, digest)
	assertSQLRejected(t, store, `INSERT INTO projection_events (stream_epoch,event_sequence,project_id,payload_digest,payload,audit_sequence) VALUES (1,1,'project-a',?,x'01',1)`, digest)

	mustExec(t, store, `INSERT INTO evidence (project_id,evidence_id,completion_subject_digest,ac_id,ac_revision_digest,verdict,applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest) VALUES ('project-b','evidence-b',?,'AC-1',?,'Passed','Current','Present','independent','actor','independent-run',?,?)`, digest, digest, digest, digest)
	assertSQLRejected(t, store, `INSERT INTO completion_record_evidence (project_id,completion_record_id,evidence_id) VALUES ('project-a','completion-a','evidence-b')`)
	assertForeignKeysClean(t, store)
}

func TestResolveBlocker_OptimisticFailureAndRace(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()
	mustCreateProject(t, store)
	item := mustWorkItem(t, "blocked-item", "project-1", domain.PhaseDraft, 1)
	// Persist version one with the blocker: blocker membership is orthogonal and
	// does not require reproducing a prior command in this fixture.
	if err := store.CreateWorkItem(t.Context(), port.WorkItem{Item: item, Title: "title", Goal: "goal", Owner: "owner"}); err != nil {
		t.Fatal(err)
	}
	mustExec(t, store, `INSERT INTO work_item_blockers (project_id,work_item_id,blocker_id,reason) VALUES ('project-1','blocked-item','blocker-1','reason')`)
	if _, err := store.ResolveBlocker(t.Context(), "project-1", "blocked-item", 2, "blocker-1", 90); !hasRejection(err, domain.CodeVersionConflict) {
		t.Fatalf("stale version = %v", err)
	}
	if _, err := store.ResolveBlocker(t.Context(), "project-1", "blocked-item", 1, "missing", 91); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("missing blocker = %v", err)
	}
	var unresolvedAt any
	var initialVersion uint64
	if err := store.db.QueryRowContext(t.Context(), `SELECT resolved_at_ns FROM work_item_blockers WHERE project_id='project-1' AND work_item_id='blocked-item' AND blocker_id='blocker-1'`).Scan(&unresolvedAt); err != nil {
		t.Fatal(err)
	}
	mustScan(t, store, `SELECT version FROM work_items WHERE project_id='project-1' AND work_item_id='blocked-item'`, &initialVersion)
	if unresolvedAt != nil || initialVersion != 1 {
		t.Fatalf("failed blocker path mutated state = (%v,%d)", unresolvedAt, initialVersion)
	}
	resolved, err := store.ResolveBlocker(t.Context(), "project-1", "blocked-item", 1, "blocker-1", 92)
	if err != nil || resolved.Version() != 2 {
		t.Fatalf("resolve = (%#v,%v)", resolved, err)
	}
	if _, err := store.ResolveBlocker(t.Context(), "project-1", "blocked-item", 2, "blocker-1", 93); !errors.Is(err, port.ErrNotFound) {
		t.Fatalf("already resolved = %v", err)
	}
	assertBlockerState(t, store, 2, 92)

	raceRoot := t.TempDir()
	racePath := filepath.Join(raceRoot, "race.db")
	first, err := OpenAtRootWithClock(t.Context(), raceRoot, racePath, fixedClock(1))
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	mustCreateProject(t, first)
	insertPlainWorkItem(t, first, "project-1", "race-item", domain.PhaseDraft, 1)
	mustExec(t, first, `INSERT INTO work_item_blockers (project_id,work_item_id,blocker_id,reason) VALUES ('project-1','race-item','race-blocker','reason')`)
	second, err := OpenAtRootWithClock(t.Context(), raceRoot, racePath, fixedClock(1))
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	start := make(chan struct{})
	results := make(chan error, 2)
	for index, candidate := range []*Store{first, second} {
		go func() {
			<-start
			_, err := candidate.ResolveBlocker(t.Context(), "project-1", "race-item", 1, "race-blocker", int64(101+index))
			results <- err
		}()
	}
	close(start)
	firstErr, secondErr := <-results, <-results
	successes := 0
	conflicts := 0
	for _, err := range []error{firstErr, secondErr} {
		if err == nil {
			successes++
		} else if hasRejection(err, domain.CodeVersionConflict) {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("race results = (%v,%v)", firstErr, secondErr)
	}
	var version uint64
	var resolvedAt int64
	mustScan(t, first, `SELECT version FROM work_items WHERE project_id='project-1' AND work_item_id='race-item'`, &version)
	mustScan(t, first, `SELECT resolved_at_ns FROM work_item_blockers WHERE project_id='project-1' AND work_item_id='race-item' AND blocker_id='race-blocker'`, &resolvedAt)
	if version != 2 || (resolvedAt != 101 && resolvedAt != 102) {
		t.Fatalf("race durable state = (%d,%d)", version, resolvedAt)
	}
}

func runCommandTransaction(ctx context.Context, unit port.UnitOfWork, completed completedPair, failureAfter string) error {
	return unit.Within(ctx, func(tx port.Transaction) error {
		if err := tx.CreateRun(ctx, completionRun()); err != nil {
			return err
		}
		if failureAfter == "run" {
			return errForcedFailure
		}
		if err := writeCompletionMaterials(ctx, tx, completed.Record.SubjectDigest()); err != nil {
			return err
		}
		if failureAfter == "materials" {
			return errForcedFailure
		}
		payload := canonicalCommandSuccessPayload()
		if err := tx.StoreCommandResult(ctx, port.CommandResult{ID: "command-1", ProjectID: "project-1", Digest: domain.HashBytes(payload), Payload: payload, TimestampNS: 20}); err != nil {
			return err
		}
		if failureAfter == "result" {
			return errForcedFailure
		}
		consumptions := approvalConsumptions(completed.Record.SubjectDigest())
		if failureAfter == "consumption-seam" {
			consumptions[1].CommandID = "missing-command"
		}
		if err := tx.StoreCompletion(ctx, port.Completion{Item: completed.Item, Record: completed.Record, Actor: "operator", TimestampNS: 21, EvidenceIDs: []domain.EvidenceID{"evidence-1"}, ReviewIDs: []domain.ReviewID{"review-1"}, ApprovalIDs: []domain.ApprovalID{"approval-1", "approval-2"}, Consumptions: consumptions}); err != nil {
			return err
		}
		if failureAfter == "completion" {
			return errForcedFailure
		}
		if err := tx.UpdateWorkItem(ctx, completed.Item, 5); err != nil {
			return err
		}
		if failureAfter == "aggregate" {
			return errForcedFailure
		}
		if err := tx.StoreIdempotency(ctx, port.Idempotency{Principal: "operator", ProjectID: "project-1", Operation: "CompleteWorkItem", Key: "key-1", RequestDigest: domain.HashString("request"), CommandID: "command-1", ExpiresAtNS: 999}); err != nil {
			return err
		}
		if failureAfter == "idempotency" {
			return errForcedFailure
		}
		auditSequence, err := tx.AppendAudit(ctx, port.AuditEntry{GroupID: "audit-1", CommandID: "command-1", ProjectID: "project-1", Actor: "operator", Operation: "CompleteWorkItem", SubjectDigest: completed.Record.SubjectDigest(), AfterDigest: domain.HashString("after"), TimestampNS: 22})
		if err != nil {
			return err
		}
		if auditSequence != 1 {
			return errors.New("unexpected audit sequence")
		}
		if failureAfter == "audit" {
			return errForcedFailure
		}
		if err := tx.EnqueueOutbox(ctx, port.OutboxIntent{ID: "outbox-1", CommandID: "command-1", AuditGroupID: "audit-1", ProjectID: "project-1", RunID: "run-1", PayloadDigest: domain.HashString("outbox"), TimestampNS: 23}); err != nil {
			return err
		}
		if failureAfter == "outbox" {
			return errForcedFailure
		}
		cursor, err := tx.AppendProjectionEvent(ctx, port.ProjectionEvent{ProjectID: "project-1", PayloadDigest: domain.HashString("event"), Payload: []byte("event"), AuditSequence: auditSequence})
		if err != nil {
			return err
		}
		if cursor != (port.Cursor{Epoch: 1, Sequence: 1}) {
			return errors.New("unexpected projection cursor")
		}
		if failureAfter == "projection" {
			return errForcedFailure
		}
		return nil
	})
}

func completionRun() port.Run {
	return port.Run{ID: "run-1", ProjectID: "project-1", WorkItemID: "item-transaction", InputDigest: domain.HashString("run-input"), AdapterID: "fake/custom", AdapterVersion: "adapter/7", ScenarioID: "scenario-9", Attempt: 3, DesiredAction: "Dispatch", DispatchState: "Acknowledged", ObservedState: "Succeeded", ReconciliationState: "None", SideEffectOutcome: "Confirmed", CreatedAtNS: 10}
}

func completionSubject(t *testing.T) domain.CompletionSubject {
	t.Helper()
	subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{
		ProjectID: "project-1", WorkItemID: "item-transaction", WorkItemVersion: 5,
		CandidateID: "candidate-1", CandidateDigest: domain.HashString("candidate"),
		RunID: "run-1", RunInputDigest: domain.HashString("run-input"),
		RequiredACRevisions:         []domain.ACRevisionBinding{{ACID: "AC-1", RevisionDigest: domain.HashString("ac")}},
		AcceptedGraphRevisionDigest: domain.HashString("graph"),
		PolicyRevisionDigest:        domain.HashString("policy"),
		CompletionRecipeDigest:      domain.HashString("recipe"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return subject
}

func canonicalCommandSuccessPayload() []byte {
	return []byte(`{"api_version":"v1","ok":true,"command":{"command_id":"command-1","operation":"CompleteWorkItem","status":"recorded","replayed":false},"result":{"type":"WorkItemCompleted"},"audit":{"sequence":1},"projection_cursor":{"stream_epoch":1,"event_sequence":1},"correlation_id":"correlation-1"}`)
}

func canonicalCommandFailurePayload() []byte {
	return []byte(`{"api_version":"v1","ok":false,"command_id":"command-failure","error":{"code":"version_conflict","message":"version conflict","retryable":false},"correlation_id":"correlation-2"}`)
}

func approvalConsumptions(subject domain.Digest) []port.ApprovalConsumption {
	return []port.ApprovalConsumption{
		{ID: "consumption-1", ProjectID: "project-1", CompletionRecordID: "completion-1", ApprovalID: "approval-1", CommandID: "command-1", SubjectDigest: subject, Actor: "operator", TimestampNS: 21},
		{ID: "consumption-2", ProjectID: "project-1", CompletionRecordID: "completion-1", ApprovalID: "approval-2", CommandID: "command-1", SubjectDigest: subject, Actor: "operator", TimestampNS: 21},
	}
}

func writeCompletionMaterials(ctx context.Context, tx port.Transaction, subject domain.Digest) error {
	return writeCompletionMaterialsWithRole(ctx, tx, subject, "independent-run")
}

func writeCompletionMaterialsWithRole(ctx context.Context, tx port.Transaction, subject domain.Digest, verifierRole string) error {
	values := []func() error{
		func() error {
			return tx.StoreACRevision(ctx, port.ACRevision{ID: "ac-revision-1", ProjectID: "project-1", ACID: "AC-1", Digest: domain.HashString("ac"), Content: []byte("AC"), CreatedAtNS: 11})
		},
		func() error {
			return tx.RequireACRevision(ctx, port.ACRequirement{ProjectID: "project-1", WorkItemID: "item-transaction", ACID: "AC-1", RevisionDigest: domain.HashString("ac")})
		},
		func() error {
			return tx.StoreDependencyRevision(ctx, port.DependencyRevision{ProjectID: "project-1", Digest: domain.HashString("graph"), Content: []byte("graph"), CreatedAtNS: 12})
		},
		func() error {
			return tx.StoreCandidate(ctx, port.Candidate{ID: "candidate-1", ProjectID: "project-1", RunID: "run-1", Digest: domain.HashString("candidate"), InputSubjectDigest: domain.HashString("input-subject"), CreatedAtNS: 13})
		},
		func() error {
			return tx.StoreArtifact(ctx, port.Artifact{Digest: domain.HashString("artifact"), MediaType: "text/plain", ByteLength: 4, StorageKey: "objects/artifact", Availability: "Present"})
		},
		func() error {
			return tx.BindCandidateArtifact(ctx, "project-1", "candidate-1", domain.HashString("artifact"))
		},
		func() error {
			return tx.StoreEvidence(ctx, port.Evidence{ID: "evidence-1", ProjectID: "project-1", SubjectDigest: subject, ACID: "AC-1", ACRevisionDigest: domain.HashString("ac"), Verdict: "Passed", Applicability: "Current", Availability: "Present", VerifierClass: "independent", VerifierActor: "verifier", VerifierRole: verifierRole, RecipeDigest: domain.HashString("recipe"), EnvironmentDigest: domain.HashString("environment"), ArtifactDigest: domain.HashString("artifact")})
		},
		func() error {
			return tx.StoreReview(ctx, port.Review{ID: "review-1", ProjectID: "project-1", SubjectDigest: subject, Verdict: "Approved", Reviewer: "reviewer", Independent: true, CreatedAtNS: 14})
		},
		func() error {
			return tx.StoreApproval(ctx, port.Approval{ID: "approval-1", ProjectID: "project-1", SubjectDigest: subject, CommandKind: "CompleteWorkItem", Actor: "operator", ExpiresAtNS: 999})
		},
		func() error {
			return tx.StoreApproval(ctx, port.Approval{ID: "approval-2", ProjectID: "project-1", SubjectDigest: subject, CommandKind: "CompleteWorkItem", Actor: "operator", ExpiresAtNS: 999})
		},
	}
	for _, write := range values {
		if err := write(); err != nil {
			return err
		}
	}
	return nil
}

type completedPair struct {
	Item   domain.WorkItem
	Record domain.CompletionRecord
}

func commandFixture(t *testing.T) (*Store, completedPair) {
	t.Helper()
	store := openTestStore(t)
	mustCreateProject(t, store)
	mustCreateWorkItem(t, store, mustWorkItem(t, "item-transaction", "project-1", domain.PhaseQA, 5))
	subject := domain.HashString("completion-subject")
	capability, load := rehydrationcap.NewCompletedLoad("item-transaction", "project-1", 6, nil, "completion-1", subject.String())
	item, record, err := domain.RehydrateCompletedWorkItem(capability, load)
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	return store, completedPair{Item: item, Record: record}
}

func completionQuery(subject domain.Digest) port.CompletionMaterialQuery {
	return port.CompletionMaterialQuery{ProjectID: "project-1", WorkItemID: "item-transaction", CandidateID: "candidate-1", RunID: "run-1", SubjectDigest: subject, GraphRevisionDigest: domain.HashString("graph")}
}

func assertCommandWrites(t *testing.T, store *Store, want int, phase domain.Phase, version, nextEvent uint64) {
	t.Helper()
	tables := []string{"runs", "ac_revisions", "work_item_ac_requirements", "dependency_revisions", "candidates", "artifacts", "candidate_artifacts", "evidence", "reviews", "approvals", "approval_consumptions", "completion_records", "completion_record_evidence", "completion_record_reviews", "completion_record_approvals", "command_results", "idempotency_records", "audit_groups", "audit_entries", "outbox", "projection_events"}
	for _, table := range tables {
		var count int
		mustScan(t, store, "SELECT COUNT(*) FROM "+table, &count)
		wantRows := want
		if table == "approvals" || table == "approval_consumptions" || table == "completion_record_approvals" {
			wantRows *= 2
		}
		if count != wantRows {
			t.Fatalf("%s count = %d, want %d", table, count, wantRows)
		}
	}
	var gotPhase domain.Phase
	var gotVersion, gotNext uint64
	if err := store.db.QueryRowContext(t.Context(), `SELECT phase,version FROM work_items WHERE project_id='project-1' AND work_item_id='item-transaction'`).Scan(&gotPhase, &gotVersion); err != nil {
		t.Fatal(err)
	}
	mustScan(t, store, `SELECT next_event_sequence FROM instance_state WHERE id=1`, &gotNext)
	if gotPhase != phase || gotVersion != version || gotNext != nextEvent {
		t.Fatalf("durable state = (%s,%d,%d)", gotPhase, gotVersion, gotNext)
	}
	assertForeignKeysClean(t, store)
}

type completionVariant struct {
	subject                 string
	omitEvidenceJoin        bool
	mismatchEvidence        bool
	omitReviewJoin          bool
	mismatchReview          bool
	omitApprovalJoin        bool
	mismatchApproval        bool
	omitApprovalConsumption bool
	corruptConsumption      string
	missingArtifact         bool
	artifactAvailability    string
}

func insertCompletionVariant(t *testing.T, store *Store, variant completionVariant) {
	t.Helper()
	subject := variant.subject
	if subject == "" {
		subject = domain.HashString("subject").String()
	}
	other := domain.HashString("other-subject").String()
	evidenceSubject, reviewSubject, approvalSubject := subject, subject, subject
	if variant.mismatchEvidence {
		evidenceSubject = other
	}
	if variant.mismatchReview {
		reviewSubject = other
	}
	if variant.mismatchApproval {
		approvalSubject = other
	}
	digest := domain.HashString("material").String()
	mustExec(t, store, `INSERT INTO ac_revisions (project_id,ac_revision_id,ac_id,revision_digest,content,created_at_ns) VALUES ('project-1','revision-1','AC-1',?,x'01',1)`, digest)
	artifactAvailability := variant.artifactAvailability
	if artifactAvailability == "" {
		artifactAvailability = "Present"
	}
	artifact := any(nil)
	if !variant.missingArtifact {
		artifact = digest
		mustExec(t, store, `INSERT INTO artifacts (digest,media_type,byte_length,storage_key,availability) VALUES (?,'text/plain',1,'object',?)`, digest, artifactAvailability)
	}
	mustExec(t, store, `INSERT INTO evidence (project_id,evidence_id,completion_subject_digest,ac_id,ac_revision_digest,verdict,applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest,artifact_digest) VALUES ('project-1','evidence-1',?,'AC-1',?,'Passed','Current','Present','independent','verifier','independent-run',?,?,?)`, evidenceSubject, digest, digest, digest, artifact)
	mustExec(t, store, `INSERT INTO reviews (project_id,review_id,completion_subject_digest,verdict,reviewer_id,independent,created_at_ns) VALUES ('project-1','review-1',?,'Approved','reviewer',1,1)`, reviewSubject)
	mustExec(t, store, `INSERT INTO approvals (project_id,approval_id,completion_subject_digest,command_kind,actor_id,expires_at_ns) VALUES ('project-1','approval-1',?,'CompleteWorkItem','operator',999)`, approvalSubject)
	approvalCount := 1
	if variant.corruptConsumption == "duplicate" {
		approvalCount = 2
		mustExec(t, store, `INSERT INTO approvals (project_id,approval_id,completion_subject_digest,command_kind,actor_id,expires_at_ns) VALUES ('project-1','approval-2',?,'CompleteWorkItem','operator',999)`, approvalSubject)
	}
	mustExec(t, store, `INSERT INTO command_results (project_id,command_id,result_digest,result_payload,created_at_ns) VALUES ('project-1','command-1',?,?,1)`, digest, []byte("material"))
	insertCompletionShellWithApprovalCount(t, store, "project-1", "done-item", "completion-1", subject, approvalCount)
	if !variant.omitEvidenceJoin {
		mustExec(t, store, `INSERT INTO completion_record_evidence (project_id,completion_record_id,evidence_id) VALUES ('project-1','completion-1','evidence-1')`)
	}
	if !variant.omitReviewJoin {
		mustExec(t, store, `INSERT INTO completion_record_reviews (project_id,completion_record_id,review_id) VALUES ('project-1','completion-1','review-1')`)
	}
	if !variant.omitApprovalJoin {
		mustExec(t, store, `INSERT INTO completion_record_approvals (project_id,completion_record_id,approval_id) VALUES ('project-1','completion-1','approval-1')`)
		if approvalCount == 2 {
			mustExec(t, store, `INSERT INTO completion_record_approvals (project_id,completion_record_id,approval_id) VALUES ('project-1','completion-1','approval-2')`)
		}
	}
	if variant.corruptConsumption != "" {
		insertCorruptApprovalConsumption(t, store, variant.corruptConsumption, subject, other)
	} else if !variant.omitApprovalConsumption {
		mustExec(t, store, `INSERT INTO approval_consumptions (project_id,approval_consumption_id,completion_record_id,approval_id,command_id,completion_subject_digest,consuming_actor,consumed_at_ns) VALUES ('project-1','consumption-1','completion-1','approval-1','command-1',?,'operator',1)`, subject)
	}
}

func insertCorruptApprovalConsumption(t *testing.T, store *Store, corruption, subject, otherSubject string) {
	t.Helper()
	mustExec(t, store, `DROP TRIGGER approval_consumptions_immutable_update`)
	mustExec(t, store, `DROP TRIGGER approval_consumptions_immutable_delete`)
	mustExec(t, store, `ALTER TABLE approval_consumptions RENAME TO approval_consumptions_valid`)
	mustExec(t, store, `CREATE TABLE approval_consumptions (project_id TEXT,approval_consumption_id TEXT,completion_record_id TEXT,approval_id TEXT,command_id TEXT,completion_subject_digest TEXT,consuming_actor TEXT,consumed_at_ns INTEGER)`)
	switch corruption {
	case "duplicate":
		for _, id := range []string{"consumption-1", "consumption-2"} {
			mustExec(t, store, `INSERT INTO approval_consumptions VALUES ('project-1',?,'completion-1','approval-1','command-1',?,'operator',1)`, id, subject)
		}
	case "unjoined":
		mustExec(t, store, `INSERT INTO approval_consumptions VALUES ('project-1','consumption-1','completion-1','approval-unjoined','command-1',?,'operator',1)`, subject)
	case "wrong-project":
		mustExec(t, store, `INSERT INTO approval_consumptions VALUES ('project-2','consumption-1','completion-1','approval-1','command-1',?,'operator',1)`, subject)
	case "wrong-subject":
		mustExec(t, store, `INSERT INTO approval_consumptions VALUES ('project-1','consumption-1','completion-1','approval-1','command-1',?,'operator',1)`, otherSubject)
	default:
		t.Fatalf("unknown approval consumption corruption %q", corruption)
	}
}

func insertApprovalFreeCompletion(t *testing.T, store *Store) {
	t.Helper()
	subject := domain.HashString("subject").String()
	digest := domain.HashString("material").String()
	mustExec(t, store, `INSERT INTO ac_revisions (project_id,ac_revision_id,ac_id,revision_digest,content,created_at_ns) VALUES ('project-1','revision-1','AC-1',?,x'01',1)`, digest)
	mustExec(t, store, `INSERT INTO artifacts (digest,media_type,byte_length,storage_key,availability) VALUES (?,'text/plain',1,'object','Present')`, digest)
	mustExec(t, store, `INSERT INTO evidence (project_id,evidence_id,completion_subject_digest,ac_id,ac_revision_digest,verdict,applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest,artifact_digest) VALUES ('project-1','evidence-1',?,'AC-1',?,'Passed','Current','Present','independent','verifier','independent-run',?,?,?)`, subject, digest, digest, digest, digest)
	mustExec(t, store, `INSERT INTO reviews (project_id,review_id,completion_subject_digest,verdict,reviewer_id,independent,created_at_ns) VALUES ('project-1','review-1',?,'Approved','reviewer',1,1)`, subject)
	mustExec(t, store, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES ('project-1','completion-1','done-item',6,?,'operator',1,1,1,0)`, subject)
	mustExec(t, store, `INSERT INTO completion_record_evidence VALUES ('project-1','completion-1','evidence-1')`)
	mustExec(t, store, `INSERT INTO completion_record_reviews VALUES ('project-1','completion-1','review-1')`)
}

func corruptWrongProject(t *testing.T, store *Store) {
	mustCreateProjectID(t, store, "project-2")
	insertDoneWorkItem(t, store, "project-2", "done-item", 6)
	digest := domain.HashString("subject").String()
	mustExec(t, store, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES ('project-2','wrong-project','done-item',6,?,'actor',1,1,1,1)`, digest)
}

func corruptWrongItem(t *testing.T, store *Store) {
	insertDoneWorkItem(t, store, "project-1", "other-item", 6)
	digest := domain.HashString("subject").String()
	mustExec(t, store, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES ('project-1','wrong-item','other-item',6,?,'actor',1,1,1,1)`, digest)
}

func corruptWrongVersion(t *testing.T, store *Store) {
	digest := domain.HashString("subject").String()
	mustExec(t, store, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES ('project-1','wrong-version','done-item',5,?,'actor',1,1,1,1)`, digest)
}

func corruptDuplicateCompletion(t *testing.T, store *Store) {
	t.Helper()
	mustExec(t, store, `DROP TRIGGER work_items_done_requires_completion`)
	mustExec(t, store, `ALTER TABLE completion_records RENAME TO completion_records_valid`)
	mustExec(t, store, `CREATE TABLE completion_records (project_id TEXT,completion_record_id TEXT,work_item_id TEXT,result_work_item_version INTEGER,completion_subject_digest TEXT,completed_by_actor TEXT,completed_at_ns INTEGER,evidence_count INTEGER,review_count INTEGER,approval_count INTEGER)`)
	digest := domain.HashString("subject").String()
	for _, id := range []string{"duplicate-1", "duplicate-2"} {
		mustExec(t, store, `INSERT INTO completion_records VALUES ('project-1',?,'done-item',6,?,'actor',1,1,1,1)`, id, digest)
	}
}

func insertValidCompletion(t *testing.T, store *Store, projectID, workItemID string, version uint64, recordID, subjectSeed string) {
	t.Helper()
	subject := domain.HashString(subjectSeed).String()
	digest := domain.HashString(recordID + "-material").String()
	acID := recordID + "-ac"
	evidenceID := domain.EvidenceID(recordID + "-evidence")
	reviewID := domain.ReviewID(recordID + "-review")
	approvalID := domain.ApprovalID(recordID + "-approval")
	commandID := recordID + "-command"
	consumptionID := recordID + "-consumption"
	mustExec(t, store, `INSERT INTO ac_revisions (project_id,ac_revision_id,ac_id,revision_digest,content,created_at_ns) VALUES (?,?,?,?,x'01',1)`, projectID, recordID+"-revision", acID, digest)
	mustExec(t, store, `INSERT INTO artifacts (digest,media_type,byte_length,storage_key,availability) VALUES (?,'text/plain',1,?,'Present')`, digest, recordID+"-object")
	mustExec(t, store, `INSERT INTO evidence (project_id,evidence_id,completion_subject_digest,ac_id,ac_revision_digest,verdict,applicability,availability,verifier_class,verifier_actor,verifier_role,recipe_digest,environment_digest,artifact_digest) VALUES (?,?,?,?,?,'Passed','Current','Present','independent','verifier','independent-run',?,?,?)`, projectID, evidenceID, subject, acID, digest, digest, digest, digest)
	mustExec(t, store, `INSERT INTO reviews (project_id,review_id,completion_subject_digest,verdict,reviewer_id,independent,created_at_ns) VALUES (?,?,?,'Approved','reviewer',1,1)`, projectID, reviewID, subject)
	mustExec(t, store, `INSERT INTO approvals (project_id,approval_id,completion_subject_digest,command_kind,actor_id,expires_at_ns) VALUES (?,?,?,'CompleteWorkItem','operator',999)`, projectID, approvalID, subject)
	mustExec(t, store, `INSERT INTO command_results (project_id,command_id,result_digest,result_payload,created_at_ns) VALUES (?,?,?,?,1)`, projectID, commandID, digest, []byte(recordID+"-material"))
	mustExec(t, store, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES (?,?,?,?,?,'operator',42,1,1,1)`, projectID, recordID, workItemID, version, subject)
	mustExec(t, store, `INSERT INTO completion_record_evidence VALUES (?,?,?)`, projectID, recordID, evidenceID)
	mustExec(t, store, `INSERT INTO completion_record_reviews VALUES (?,?,?)`, projectID, recordID, reviewID)
	mustExec(t, store, `INSERT INTO completion_record_approvals VALUES (?,?,?)`, projectID, recordID, approvalID)
	mustExec(t, store, `INSERT INTO approval_consumptions VALUES (?,?,?,?,?,?,?,42)`, projectID, consumptionID, recordID, approvalID, commandID, subject, "operator")
}

func insertCompletionShell(t *testing.T, store *Store, projectID, workItemID, recordID, subject string) {
	t.Helper()
	insertCompletionShellWithApprovalCount(t, store, projectID, workItemID, recordID, subject, 1)
}

func insertCompletionShellWithApprovalCount(t *testing.T, store *Store, projectID, workItemID, recordID, subject string, approvalCount int) {
	t.Helper()
	mustExec(t, store, `INSERT INTO completion_records (project_id,completion_record_id,work_item_id,result_work_item_version,completion_subject_digest,completed_by_actor,completed_at_ns,evidence_count,review_count,approval_count) VALUES (?,?,?,6,?,'operator',1,1,1,?)`, projectID, recordID, workItemID, subject, approvalCount)
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	root := t.TempDir()
	store, err := OpenAtRootWithClock(t.Context(), root, filepath.Join(root, "taskboard.db"), fixedClock(42))
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func fixedClock(timestamp int64) func() time.Time {
	return func() time.Time { return time.Unix(0, timestamp).UTC() }
}

func mustCreateProject(t *testing.T, store *Store) { mustCreateProjectID(t, store, "project-1") }

func mustCreateProjectID(t *testing.T, store *Store, id domain.ProjectID) {
	t.Helper()
	if err := store.CreateProject(t.Context(), port.Project{ID: id, Name: string(id), Repository: "repo", Ref: "main", Version: 1}); err != nil {
		t.Fatal(err)
	}
}

func mustWorkItem(t *testing.T, id domain.WorkItemID, projectID domain.ProjectID, phase domain.Phase, version uint64) domain.WorkItem {
	t.Helper()
	item, err := domain.NewWorkItem(id, projectID, phase, version)
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func mustCreateWorkItem(t *testing.T, store *Store, item domain.WorkItem) {
	t.Helper()
	if err := store.CreateWorkItem(t.Context(), port.WorkItem{Item: item, Title: "title", Goal: "goal", Owner: "owner"}); err != nil {
		t.Fatal(err)
	}
}

func insertDoneWorkItem(t *testing.T, store *Store, projectID, workItemID string, version uint64) {
	t.Helper()
	insertPlainWorkItem(t, store, projectID, workItemID, domain.PhaseDone, version)
}

func insertPlainWorkItem(t *testing.T, store *Store, projectID, workItemID string, phase domain.Phase, version uint64) {
	t.Helper()
	mustExec(t, store, `INSERT INTO work_items (project_id,work_item_id,title,goal,owner_id,phase,version) VALUES (?,?,'title','goal','owner',?,?)`, projectID, workItemID, phase, version)
}

func fullRunInsert(projectID, runID, workItemID string) string {
	return `INSERT INTO runs (project_id,run_id,work_item_id,input_digest,adapter_id,adapter_version,scenario_id,attempt,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome,created_at_ns) VALUES ('` + projectID + `','` + runID + `','` + workItemID + `',?,'fake','v1','scenario',1,'Dispatch','Pending','Unknown','None','NotApplicable',1)`
}

func mustExec(t *testing.T, store *Store, query string, args ...any) {
	t.Helper()
	if _, err := store.db.ExecContext(t.Context(), query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

func assertSQLRejected(t *testing.T, store *Store, query string, args ...any) {
	t.Helper()
	if _, err := store.db.ExecContext(t.Context(), query, args...); err == nil {
		t.Fatalf("cross-project SQL accepted: %s", query)
	}
}

func mustScan(t *testing.T, store *Store, query string, destinations ...any) {
	t.Helper()
	if err := store.db.QueryRowContext(t.Context(), query).Scan(destinations...); err != nil {
		t.Fatal(err)
	}
}

func assertForeignKeysClean(t *testing.T, store *Store) {
	t.Helper()
	rows, err := store.db.QueryContext(t.Context(), "PRAGMA foreign_key_check")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Fatal("foreign_key_check reported a violation")
	}
}

func assertBlockerState(t *testing.T, store *Store, wantVersion uint64, wantResolvedAt int64) {
	t.Helper()
	var version uint64
	var resolvedAt int64
	mustScan(t, store, `SELECT version FROM work_items WHERE project_id='project-1' AND work_item_id='blocked-item'`, &version)
	mustScan(t, store, `SELECT resolved_at_ns FROM work_item_blockers WHERE project_id='project-1' AND work_item_id='blocked-item' AND blocker_id='blocker-1'`, &resolvedAt)
	if version != wantVersion || resolvedAt != wantResolvedAt {
		t.Fatalf("blocker state = (%d,%d)", version, resolvedAt)
	}
}

func hasRejection(err error, code domain.RejectionCode) bool {
	rejection, ok := errors.AsType[domain.Rejection](err)
	return ok && rejection.Code == code
}
