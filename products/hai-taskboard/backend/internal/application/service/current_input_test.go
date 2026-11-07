package service

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/testfixture"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestAdmission_CurrentHeadsOwnReadinessAndDispatch(t *testing.T) {
	svc, store, db, acceptance := initialFixture(t)
	rule := svc.config.Completion.Checks["AC-A"]
	rule.EnvironmentDigest = domain.HashString(port.FakeEnvironmentProfile)
	svc.config.Completion.Checks["AC-A"] = rule
	if _, err := svc.AcceptInitialSpecification(t.Context(), operator, acceptance); err != nil {
		t.Fatal(err)
	}
	ready := command.MarkReady{Metadata: initialMetadata(50, 2), ProjectID: projectID, WorkItemID: workItemID}
	if _, err := svc.MarkReady(t.Context(), operator, ready); err != nil {
		t.Fatalf("verified accepted heads must grant Ready: %v", err)
	}
	dispatch := command.DispatchRun{Metadata: initialMetadata(51, 3), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"}
	if _, err := svc.DispatchRun(t.Context(), operator, dispatch); err != nil {
		t.Fatal(err)
	}
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		var id domain.RunID
		if err := db.QueryRow("SELECT run_id FROM runs").Scan(&id); err != nil {
			return err
		}
		envelope, err := tx.(port.CurrentInputTransaction).LoadRunInput(t.Context(), projectID, id)
		if err != nil {
			return err
		}
		if envelope.Input.Material().ReadyVersion != 3 {
			t.Fatalf("Ready version = %d", envelope.Input.Material().ReadyVersion)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func acceptedReadyInput(t *testing.T) (*Service, *sqlite.Store, *sql.DB, command.DispatchRun) {
	return acceptedReadyInputPolicy(t, nil)
}

func acceptedReadyInputPolicy(t *testing.T, profile *port.PolicyProfile) (*Service, *sqlite.Store, *sql.DB, command.DispatchRun) {
	t.Helper()
	svc, store, db, q := initialFixture(t)
	if profile != nil {
		svc.config.ProjectPolicies = map[domain.ProjectID]port.PolicyProfile{projectID: *profile}
		q.PolicyRevisionDigest = profile.Digest()
		if err := store.Within(t.Context(), func(tx port.Transaction) error {
			p, err := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), projectID, q.ProposalDigest)
			if err != nil {
				return err
			}
			_, q.AcceptanceSubjectDigest, err = port.CanonicalInitialAcceptanceSubject(port.NewInitialAcceptanceSubject(projectID, q.ExpectedVersion, p, q.PolicyRevisionDigest, q.WorkItems))
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	rule := svc.config.Completion.Checks["AC-A"]
	rule.EnvironmentDigest = domain.HashString(port.FakeEnvironmentProfile)
	svc.config.Completion.Checks["AC-A"] = rule
	if _, err := svc.AcceptInitialSpecification(t.Context(), operator, q); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkReady(t.Context(), operator, command.MarkReady{Metadata: initialMetadata(50, 2), ProjectID: projectID, WorkItemID: workItemID}); err != nil {
		t.Fatal(err)
	}
	return svc, store, db, command.DispatchRun{Metadata: initialMetadata(51, 3), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"}
}
func dispatchAccepted(t *testing.T, svc *Service, db *sql.DB, q command.DispatchRun) domain.RunID {
	t.Helper()
	if _, err := svc.DispatchRun(t.Context(), operator, q); err != nil {
		t.Fatal(err)
	}
	var id domain.RunID
	if err := db.QueryRow("SELECT run_id FROM runs").Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
func claimInput(id domain.RunID) ClaimDispatchRequest {
	return ClaimDispatchRequest{ProjectID: projectID, RunID: id, Holder: "worker", ExpectedRestoreGeneration: 1, LeaseDuration: time.Minute}
}

func TestAdmission_ClaimCurrentInputsBeforeLease(t *testing.T) {
	for _, kind := range []string{"policy", "recipe", "environment", "missing_environment", "class", "independent", "actor", "role", "approval", "base", "adapter", "scenario", "missing_heads"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := acceptedReadyInput(t)
			id := dispatchAccepted(t, svc, db, q)
			rule := svc.config.Completion.Checks["AC-A"]
			switch kind {
			case "policy":
				svc.config.Completion.RevisionDigest = domain.HashString("changed")
			case "recipe":
				svc.config.Completion.RecipeDigest = domain.HashString("changed")
			case "environment":
				rule.EnvironmentDigest = domain.HashString("changed")
			case "missing_environment":
				rule.EnvironmentDigest = domain.Digest{}
			case "class":
				rule.VerifierClass = "changed"
			case "independent":
				rule.Independent = !rule.Independent
			case "actor":
				rule.ProhibitedVerifierActor = "changed"
			case "role":
				rule.ProhibitedVerifierRunRole = "changed"
			case "approval":
				svc.config.Completion.ApprovalRequired = !svc.config.Completion.ApprovalRequired
			case "base":
				svc.config.Completion.IntegrationBaseDigest = domain.HashString("changed")
			case "adapter":
				svc.executorDeclaration.AdapterVersion = "2"
			case "scenario":
				svc.executorDeclaration.Scenarios = []string{"other"}
			case "missing_heads":
				if _, err := db.Exec("DELETE FROM work_item_spec_heads"); err != nil {
					t.Fatal(err)
				}
			}
			svc.config.Completion.Checks["AC-A"] = rule
			if _, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id)); !errors.Is(err, port.ErrStaleRunInput) {
				t.Fatalf("stale claim = %v", err)
			} else if outcome, ok := errors.AsType[port.StaleRunInputError](err); !ok || outcome.ProjectID != projectID || outcome.RunID != id || outcome.InputDigest.IsZero() {
				t.Fatalf("untyped stale outcome %v", err)
			}
			var dispatch, observed, reconcile, effects string
			var leases int
			if err := db.QueryRow("SELECT dispatch_state,observed_state,reconciliation_state,side_effect_outcome FROM runs").Scan(&dispatch, &observed, &reconcile, &effects); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT count(*) FROM run_leases").Scan(&leases); err != nil {
				t.Fatal(err)
			}
			if dispatch != "Pending" || observed != "Unknown" || reconcile != "NeedsReconcile" || effects != "NotApplicable" || leases != 0 {
				t.Fatalf("stale facts %s %s %s %s leases %d", dispatch, observed, reconcile, effects, leases)
			}
			candidates, err := store.DispatchCandidates(t.Context(), fixedTime(), 1)
			if err != nil || len(candidates) != 0 {
				t.Fatalf("stale rediscovered %v %v", candidates, err)
			}
			var audits, events int
			if err := db.QueryRow("SELECT count(*) FROM audit_entries WHERE operation='PendingInputStale'").Scan(&audits); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow("SELECT count(*) FROM projection_events").Scan(&events); err != nil {
				t.Fatal(err)
			}
			if audits != 1 || events != 7 {
				t.Fatalf("stale audit/events %d/%d", audits, events)
			}
			if _, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id)); !errors.Is(err, port.ErrNoPendingDispatch) {
				t.Fatalf("repeat = %v", err)
			}
		})
	}
}
func TestAdmission_InputWriteAndStaleAuditRollback(t *testing.T) {
	for _, table := range []string{"work_items", "runs", "run_input_envelopes", "audit_entries", "outbox", "projection_events", "command_results", "idempotency_records"} {
		t.Run(table, func(t *testing.T) {
			svc, _, db, q := acceptedReadyInput(t)
			before := inputCounts(t, db)
			action := "INSERT"
			if table == "work_items" {
				action = "UPDATE"
			}
			if _, err := db.Exec("CREATE TRIGGER input_fault BEFORE " + action + " ON " + table + " BEGIN SELECT RAISE(ABORT,'input fault'); END"); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.DispatchRun(t.Context(), operator, q); err == nil {
				t.Fatal("fault accepted")
			}
			if got := inputCounts(t, db); !reflect.DeepEqual(got, before) {
				t.Fatalf("partial writes %v -> %v", before, got)
			}
		})
	}
	for _, table := range []string{"runs", "audit_entries", "projection_events"} {
		t.Run("stale_"+table, func(t *testing.T) {
			svc, _, db, q := acceptedReadyInput(t)
			id := dispatchAccepted(t, svc, db, q)
			before := inputCounts(t, db)
			svc.config.Completion.ApprovalRequired = !svc.config.Completion.ApprovalRequired
			action := "INSERT"
			if table == "runs" {
				action = "UPDATE"
			}
			if _, err := db.Exec("CREATE TRIGGER stale_fault BEFORE " + action + " ON " + table + " BEGIN SELECT RAISE(ABORT,'stale fault'); END"); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id)); err == nil || errors.Is(err, port.ErrStaleRunInput) {
				t.Fatalf("committed stale returned for rollback %v", err)
			}
			if got := inputCounts(t, db); !reflect.DeepEqual(got, before) {
				t.Fatalf("partial stale %v -> %v", before, got)
			}
		})
	}
}
func inputCounts(t *testing.T, db *sql.DB) []any {
	t.Helper()
	var result []any
	for _, table := range []string{"runs", "run_input_envelopes", "outbox", "run_leases", "audit_entries", "projection_events", "command_results", "idempotency_records"} {
		var n int
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		result = append(result, n)
	}
	var v int
	var phase string
	if err := db.QueryRow("SELECT version,phase FROM work_items WHERE work_item_id=?", workItemID).Scan(&v, &phase); err != nil {
		t.Fatal(err)
	}
	result = append(result, v, phase)
	var state string
	err := db.QueryRow("SELECT reconciliation_state FROM runs").Scan(&state)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	return append(result, state)
}
func TestAdmission_LegacyAndCorruptInputFailClosed(t *testing.T) {
	for _, kind := range []string{"legacy", "canonical", "partial_requirements", "outbox"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := acceptedReadyInput(t)
			id := dispatchAccepted(t, svc, db, q)
			var commands []string
			switch kind {
			case "legacy":
				commands = []string{"DROP TRIGGER run_input_envelopes_no_delete", "DELETE FROM run_input_envelopes"}
			case "canonical":
				commands = []string{"DROP TRIGGER run_input_envelopes_no_update", "UPDATE run_input_envelopes SET canonical_content=x'7b7d'"}
			case "partial_requirements":
				commands = []string{"DELETE FROM current_ac_requirements"}
			case "outbox":
				commands = []string{"DROP TRIGGER outbox_immutable_identity_update", "UPDATE outbox SET payload_digest='" + domain.HashString("changed").String() + "'"}
			}
			for _, sql := range commands {
				if _, err := db.Exec(sql); err != nil {
					t.Fatal(err)
				}
			}
			before := inputCounts(t, db)
			_, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id))
			if kind == "legacy" {
				if !errors.Is(err, port.ErrNoPendingDispatch) {
					t.Fatal(err)
				}
				rows, e := store.DispatchCandidates(t.Context(), fixedTime(), 1)
				if e != nil || len(rows) != 0 {
					t.Fatal(rows, e)
				}
			} else if !errors.Is(err, domain.ErrStorageCorruption) {
				t.Fatalf("corrupt input = %v", err)
			}
			if got := inputCounts(t, db); !reflect.DeepEqual(got, before) {
				t.Fatalf("failed claim changed history %v", got)
			}
		})
	}
}
func TestAdmission_InputReplayReopenAndConcurrentClaim(t *testing.T) {
	svc, store, db, q := acceptedReadyInput(t)
	original, err := svc.DispatchRun(t.Context(), operator, q)
	if err != nil {
		t.Fatal(err)
	}
	var id domain.RunID
	if err := db.QueryRow("SELECT run_id FROM runs").Scan(&id); err != nil {
		t.Fatal(err)
	}
	var path string
	var seq int
	var name string
	if err := db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	svc.unit = reopened
	svc.config.Completion.RecipeDigest = domain.HashString("unavailable")
	replay, err := svc.DispatchRun(t.Context(), operator, q)
	if err != nil || !replay.Replayed || !bytes.Equal(original.Payload, replay.Payload) {
		t.Fatalf("replay %v", err)
	}
	svc.config.Completion.RecipeDigest = domain.HashString("initial recipe")
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	for range 4 {
		wg.Go(func() {
			_, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				wins++
			} else if !errors.Is(err, port.ErrNoPendingDispatch) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("claims %d", wins)
	}
}

func TestAdmission_ReadinessRequiresVerifiedAuthority(t *testing.T) {
	for _, kind := range []string{"legacy_boolean", "policy", "recipe", "missing_rule", "unknown_environment"} {
		t.Run(kind, func(t *testing.T) {
			svc, _, db, q := initialFixture(t)
			rule := svc.config.Completion.Checks["AC-A"]
			rule.EnvironmentDigest = domain.HashString(port.FakeEnvironmentProfile)
			svc.config.Completion.Checks["AC-A"] = rule
			if kind != "legacy_boolean" {
				if _, err := svc.AcceptInitialSpecification(t.Context(), operator, q); err != nil {
					t.Fatal(err)
				}
			}
			switch kind {
			case "legacy_boolean":
				svc.config.Specification = specificationPolicy(true)
			case "policy":
				svc.config.Completion.RevisionDigest = domain.HashString("changed")
			case "recipe":
				svc.config.Completion.RecipeDigest = domain.HashString("changed")
			case "missing_rule":
				delete(svc.config.Completion.Checks, "AC-A")
			case "unknown_environment":
				rule.EnvironmentDigest = domain.Digest{}
				svc.config.Completion.Checks["AC-A"] = rule
			}
			version := uint64(2)
			if kind == "legacy_boolean" {
				version = 1
			}
			if _, err := svc.MarkReady(t.Context(), operator, command.MarkReady{Metadata: initialMetadata(50, version), ProjectID: projectID, WorkItemID: workItemID}); err == nil {
				t.Fatal("invalid authority granted Ready")
			}
			var phase string
			if err := db.QueryRow("SELECT phase FROM work_items").Scan(&phase); err != nil || phase != "Draft" {
				t.Fatal(phase, err)
			}
		})
	}
}

type inputPostwriteUnit struct {
	base  port.UnitOfWork
	after func() error
}

func (u inputPostwriteUnit) Within(ctx context.Context, f func(port.Transaction) error) error {
	return u.base.Within(ctx, func(tx port.Transaction) error {
		return f(inputPostwriteTransaction{CurrentInputTransaction: tx.(port.CurrentInputTransaction), after: u.after})
	})
}

type inputPostwriteTransaction struct {
	port.CurrentInputTransaction
	after func() error
}

func (tx inputPostwriteTransaction) StoreRunInput(ctx context.Context, v port.RunInputEnvelope) error {
	if err := tx.CurrentInputTransaction.StoreRunInput(ctx, v); err != nil {
		return err
	}
	return tx.after()
}
func TestAdmission_InputPostwriteRecordableAndCancellationRollback(t *testing.T) {
	for _, kind := range []string{"recordable", "cancellation"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := acceptedReadyInput(t)
			before := inputCounts(t, db)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			svc.unit = inputPostwriteUnit{base: store, after: func() error {
				if kind == "cancellation" {
					cancel()
					return nil
				}
				return command.NewError(command.CodeVersionConflict, "after input write", false, nil, nil)
			}}
			if _, err := svc.DispatchRun(ctx, operator, q); err == nil {
				t.Fatal("postwrite error committed")
			}
			if got := inputCounts(t, db); !reflect.DeepEqual(got, before) {
				t.Fatalf("partial postwrite %v -> %v", before, got)
			}
		})
	}
}

func TestAdmission_ExpiredLegacyRecoveryAndStaleCAS(t *testing.T) {
	svc, store, db, q := acceptedReadyInput(t)
	id := dispatchAccepted(t, svc, db, q)
	envelope, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id))
	if err != nil {
		t.Fatal(err)
	}
	before := inputCounts(t, db)
	err = store.Within(t.Context(), func(tx port.Transaction) error {
		_, err := tx.(port.PendingInputTransaction).MarkPendingInputStale(t.Context(), port.PendingInputStaleRequest{ProjectID: projectID, RunID: id, InputDigest: envelope.Fence.InputDigest, RestoreGeneration: 1})
		return err
	})
	if !errors.Is(err, port.ErrNoPendingDispatch) {
		t.Fatalf("stale CAS did not lose to claim: %v", err)
	}
	if !reflect.DeepEqual(before, inputCounts(t, db)) {
		t.Fatal("losing stale CAS mutated claim")
	}
	for _, sql := range []string{"DROP TRIGGER run_input_envelopes_no_delete", "DELETE FROM run_input_envelopes"} {
		if _, err := db.Exec(sql); err != nil {
			t.Fatal(err)
		}
	}
	svc.clock = fixedClock{now: fixedTime().Add(2 * time.Minute)}
	candidates, err := store.DispatchCandidates(t.Context(), svc.clock.Now(), 1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("expired legacy hidden %v %v", candidates, err)
	}
	recovered, err := svc.ClaimExpiredRunForReconciliation(t.Context(), "successor", ClaimReconciliationRequest{PreviousFence: envelope.Fence, Successor: "successor", LeaseDuration: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Run.ReconciliationState != "NeedsReconcile" || recovered.Run.SideEffectOutcome != "OutcomeUnknown" {
		t.Fatalf("legacy recovery %+v", recovered)
	}
}

// These cases model a different verified current view at the application port;
// accepted-record byte corruption is separately exercised against the real reader.
func TestAdmission_ModeledVerifiedSemanticChangesRejectClaim(t *testing.T) {
	for _, kind := range []string{"binding", "graph", "ac_revision", "ac_set"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, q := acceptedReadyInput(t)
			id := dispatchAccepted(t, svc, db, q)
			var view port.CurrentSpecification
			if err := store.Within(t.Context(), func(tx port.Transaction) error {
				var err error
				view, err = tx.(port.CurrentInputTransaction).LoadCurrentSpecification(t.Context(), projectID, workItemID)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "binding":
				view.BindingDigest = domain.HashString("new verified binding")
			case "graph":
				view.GraphRevisionDigest = domain.HashString("new verified graph")
			case "ac_revision":
				view.Requirements[0].RevisionDigest = domain.HashString("new verified AC")
			case "ac_set":
				view.Requirements = append(view.Requirements, port.ACRequirement{ProjectID: projectID, WorkItemID: workItemID, ACID: "AC-B", RevisionDigest: domain.HashString("new verified AC")})
				svc.config.Completion.Checks["AC-B"] = svc.config.Completion.Checks["AC-A"]
			}
			svc.unit = testfixture.VerifiedInputUnit{Base: store, View: view}
			if _, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id)); !errors.Is(err, port.ErrStaleRunInput) {
				t.Fatal(err)
			}
		})
	}
}
