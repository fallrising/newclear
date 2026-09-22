package service

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"io"
	"maps"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var errInjected = errors.New("injected transaction failure")

const (
	projectID  domain.ProjectID  = "prj_01HABCDEFGH"
	workItemID domain.WorkItemID = "wi_01HABCDEFGH"
	operator   domain.ActorID    = "operator"
)

func TestCommandTransaction_FailureInjectionRollsBackAllWrites(t *testing.T) {
	failurePoints := []string{"StoreCompletion", "UpdateWorkItem", "AppendAudit", "AppendProjectionEvent", "StoreCommandResult", "StoreIdempotency"}
	for _, point := range failurePoints {
		t.Run(point, func(t *testing.T) {
			service, store, subject := completionFixture(t)
			before := store.snapshot()
			store.failAt = point
			outcome, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
			if !errors.Is(err, errInjected) || outcome.Payload != nil {
				t.Fatalf("failure outcome = (%q,%v)", outcome.Payload, err)
			}
			if !reflect.DeepEqual(store.snapshot(), before) {
				t.Fatalf("%s left partial authoritative writes", point)
			}
		})
	}

	t.Run("dispatch-outbox", func(t *testing.T) {
		service, store := readyFixture(t)
		before := store.snapshot()
		store.failAt = "EnqueueOutbox"
		outcome, err := service.DispatchRun(t.Context(), operator, dispatchCommand())
		if !errors.Is(err, errInjected) || outcome.Payload != nil {
			t.Fatalf("dispatch failure outcome = (%q,%v)", outcome.Payload, err)
		}
		if !reflect.DeepEqual(store.snapshot(), before) {
			t.Fatal("outbox failure left a Run, phase, audit or result write")
		}
	})

	t.Run("deferred-result-reference", func(t *testing.T) {
		store := newMemoryUnit()
		store.state.projects[projectID] = port.Project{ID: projectID, Name: "project", Repository: "repo", Ref: "main", Version: 1}
		before := store.snapshot()
		callbackCompleted := false
		err := store.Within(t.Context(), func(tx port.Transaction) error {
			sequence, err := tx.AppendAudit(t.Context(), port.AuditEntry{
				GroupID: "audit-deferred", CommandID: "cmd_01HABCDEFGN", ProjectID: projectID,
				Actor: operator, Operation: "probe", SubjectDigest: domain.HashString("subject"), TimestampNS: 1,
			})
			if err != nil {
				return err
			}
			_, err = tx.AppendProjectionEvent(t.Context(), port.ProjectionEvent{
				ProjectID: projectID, PayloadDigest: domain.HashString("event"), Payload: []byte("event"), AuditSequence: sequence,
			})
			callbackCompleted = err == nil
			return err
		})
		if err == nil || !callbackCompleted || !reflect.DeepEqual(store.snapshot(), before) {
			t.Fatalf("deferred commit result = (callback %t, error %v)", callbackCompleted, err)
		}
	})
}

func TestCommand_IdempotencySameRequestAndConflict(t *testing.T) {
	service, store := readyFixture(t)
	request := dispatchCommand()
	first, err := service.DispatchRun(t.Context(), operator, request)
	if err != nil {
		t.Fatal(err)
	}
	firstCopy := bytes.Clone(first.Payload)
	first.Payload[0] ^= 0xff

	replay, err := service.DispatchRun(t.Context(), operator, request)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replayed || !bytes.Equal(replay.Payload, firstCopy) || len(store.state.runs) != 1 || len(store.state.audits) != 1 || len(store.state.events) != 1 {
		t.Fatalf("replay = (%t,%q), durable counts = (%d,%d,%d)", replay.Replayed, replay.Payload, len(store.state.runs), len(store.state.audits), len(store.state.events))
	}

	conflictRequest := request
	conflictRequest.ScenarioID = "different-scenario"
	conflict, err := service.DispatchRun(t.Context(), operator, conflictRequest)
	assertCommandError(t, err, command.CodeIdempotencyConflict)
	if len(conflict.Payload) == 0 || len(store.state.runs) != 1 || len(store.state.results) != 1 {
		t.Fatal("idempotency conflict mutated authoritative state")
	}

	key := idempotencyKey(operator, projectID, command.DispatchRunOperation, request.IdempotencyKey)
	record := store.state.idempotency[key]
	record.Tombstoned = true
	store.state.idempotency[key] = record
	expired, err := service.DispatchRun(t.Context(), operator, request)
	assertCommandError(t, err, command.CodeIdempotencyExpired)
	if len(expired.Payload) == 0 || len(store.state.runs) != 1 {
		t.Fatal("tombstoned retry was reinterpreted as a command")
	}
	record.Tombstoned = false
	record.ExpiresAtNS = fixedTime().UnixNano()
	store.state.idempotency[key] = record
	_, err = service.DispatchRun(t.Context(), operator, request)
	assertCommandError(t, err, command.CodeIdempotencyExpired)

	t.Run("stored-failure-replays-byte-exactly", func(t *testing.T) {
		service, store := readyFixture(t)
		request := dispatchCommand()
		_, requestDigest, err := command.CanonicalDispatchRun(request)
		if err != nil {
			t.Fatal(err)
		}
		failure := command.NewError(command.CodeLifecycleRejected, "recorded failure", false, []domain.RejectionCode{domain.CodeActiveOrUnknownRun}, nil)
		payload, err := command.CanonicalFailure(request.Metadata, failure)
		if err != nil {
			t.Fatal(err)
		}
		store.state.results[resultKey(projectID, request.CommandID)] = port.CommandResult{ID: request.CommandID, ProjectID: projectID, Digest: domain.HashBytes(payload), Payload: bytes.Clone(payload), TimestampNS: 1}
		store.state.idempotency[idempotencyKey(operator, projectID, command.DispatchRunOperation, request.IdempotencyKey)] = port.Idempotency{Principal: operator, ProjectID: projectID, Operation: string(command.DispatchRunOperation), Key: request.IdempotencyKey, RequestDigest: requestDigest, CommandID: request.CommandID, ExpiresAtNS: fixedTime().Add(time.Hour).UnixNano()}
		outcome, err := service.DispatchRun(t.Context(), operator, request)
		assertCommandError(t, err, command.CodeLifecycleRejected)
		if !outcome.Replayed || !bytes.Equal(outcome.Payload, payload) || len(store.state.runs) != 0 {
			t.Fatalf("stored failure replay = (%t,%q,%v)", outcome.Replayed, outcome.Payload, err)
		}
	})

	t.Run("stored-result-with-valid-digest-but-invalid-envelope-fails-closed", func(t *testing.T) {
		service, store := readyFixture(t)
		request := dispatchCommand()
		_, requestDigest, err := command.CanonicalDispatchRun(request)
		if err != nil {
			t.Fatal(err)
		}
		payload := []byte(`{"api_version":"v1","ok":true}`)
		store.state.results[resultKey(projectID, request.CommandID)] = port.CommandResult{ID: request.CommandID, ProjectID: projectID, Digest: domain.HashBytes(payload), Payload: bytes.Clone(payload), TimestampNS: 1}
		store.state.idempotency[idempotencyKey(operator, projectID, command.DispatchRunOperation, request.IdempotencyKey)] = port.Idempotency{Principal: operator, ProjectID: projectID, Operation: string(command.DispatchRunOperation), Key: request.IdempotencyKey, RequestDigest: requestDigest, CommandID: request.CommandID, ExpiresAtNS: fixedTime().Add(time.Hour).UnixNano()}
		outcome, err := service.DispatchRun(t.Context(), operator, request)
		assertCommandError(t, err, command.CodeStorageCorruption)
		if len(outcome.Payload) == 0 || len(store.state.runs) != 0 || len(store.state.results) != 1 {
			t.Fatal("invalid stored canonical result was re-executed or overwritten")
		}
	})
}

func TestCreateProjectAndWorkItem_UseDomainAndAtomicResult(t *testing.T) {
	store := newMemoryUnit()
	service := testService(t, store, true)
	project := command.CreateProject{
		Metadata:  command.Metadata{CommandID: "cmd_01HABCDEFGP", IdempotencyKey: "00000000-0000-4000-8000-000000000002", IssuedAt: fixedTime(), CorrelationID: "correlation-project"},
		ProjectID: projectID, Name: "Project", RepositoryRoot: "/repo", ApprovedRef: "main",
	}
	if _, err := service.CreateProject(t.Context(), operator, project); err != nil {
		t.Fatal(err)
	}
	workItem := command.CreateWorkItem{
		Metadata:  command.Metadata{CommandID: "cmd_01HABCDEFGQ", IdempotencyKey: "00000000-0000-4000-8000-000000000003", IssuedAt: fixedTime(), CorrelationID: "correlation-item"},
		ProjectID: projectID, WorkItemID: workItemID, Title: "Title", Goal: "Goal", OwnerID: "owner",
		RequiredACRevisions: []command.ACRevision{{ACID: "AC-1", RevisionDigest: domain.HashString("ac")}},
	}
	if _, err := service.CreateWorkItem(t.Context(), operator, workItem); err != nil {
		t.Fatal(err)
	}
	item := store.state.workItems[itemKey(projectID, workItemID)]
	if item.Phase() != domain.PhaseDraft || item.Version() != 1 || len(store.state.requirements[itemKey(projectID, workItemID)]) != 1 || len(store.state.results) != 2 || len(store.state.audits) != 2 || len(store.state.events) != 2 {
		t.Fatalf("create state = phase/version/requirements/results/audits/events %s/%d/%d/%d/%d/%d", item.Phase(), item.Version(), len(store.state.requirements[itemKey(projectID, workItemID)]), len(store.state.results), len(store.state.audits), len(store.state.events))
	}
}

func TestCompleteWorkItem_PersistentAtomicity(t *testing.T) {
	service, store, subject := completionFixture(t)
	outcome, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
	if err != nil {
		t.Fatal(err)
	}
	item := store.state.workItems[itemKey(projectID, workItemID)]
	if item.Phase() != domain.PhaseDone || item.Version() != 6 || len(store.state.completions) != 1 ||
		len(store.state.consumptions) != 1 || len(store.state.audits) != 1 || len(store.state.events) != 1 ||
		len(store.state.results) != 1 || len(store.state.idempotency) != 1 {
		t.Fatalf("atomic completion state = phase %s version %d completion/consumption/audit/event/result/idempotency %d/%d/%d/%d/%d/%d",
			item.Phase(), item.Version(), len(store.state.completions), len(store.state.consumptions), len(store.state.audits), len(store.state.events), len(store.state.results), len(store.state.idempotency))
	}
	completion := store.state.completions[0]
	if completion.Record.SubjectDigest() != subject.Digest() || completion.Actor != operator ||
		completion.Consumptions[0].Actor != operator || completion.Consumptions[0].SubjectDigest != subject.Digest() {
		t.Fatal("completion authority did not bind the exact subject and authenticated principal")
	}
	assertSuccessEnvelope(t, outcome.Payload, command.CompleteWorkItemOperation, 1, port.Cursor{Epoch: 1, Sequence: 1})
	if store.operationIndex("StoreCompletion") > store.operationIndex("UpdateWorkItem") ||
		store.operationIndex("AppendAudit") > store.operationIndex("StoreCommandResult") ||
		store.operationIndex("AppendProjectionEvent") > store.operationIndex("StoreCommandResult") {
		t.Fatal("completion, Done update or canonical result ordering was invalid")
	}
}

func TestCompleteWorkItem_StoresCompletionBeforeDoneForSQLiteTrigger(t *testing.T) {
	service, store, subject := completionFixture(t)
	if _, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject)); err != nil {
		t.Fatal(err)
	}
	completionIndex := store.operationIndex("StoreCompletion")
	doneIndex := store.operationIndex("UpdateWorkItem")
	if completionIndex < 0 || doneIndex < 0 || completionIndex >= doneIndex {
		t.Fatalf("completion/Done operation order = %d/%d", completionIndex, doneIndex)
	}
}

func TestDispatchRun_UsesConstructionTimeExecutorDeclarationOutsideTransaction(t *testing.T) {
	_, store := readyFixture(t)
	executor := &trackingExecutor{
		declaration: port.ExecutorDeclaration{
			AdapterID: "fake/v1", AdapterVersion: "1", Capabilities: []string{"start_ack"},
		},
		inTransaction:   func() bool { return store.withinActive },
		panicAfterFirst: true,
	}
	service := testServiceWithExecutor(t, store, true, executor)
	executor.declaration.AdapterVersion = "mutated"
	executor.declaration.Capabilities[0] = "lookup"
	if _, err := service.DispatchRun(t.Context(), operator, dispatchCommand()); err != nil {
		t.Fatal(err)
	}
	run := store.state.runs[resultKey(projectID, "run_01HABCDEFG1")]
	if executor.calls != 1 || executor.calledInside || run.AdapterVersion != "1" ||
		service.executorDeclaration.Capabilities[0] != "start_ack" {
		t.Fatalf("executor calls/inside/version/capabilities = %d/%t/%q/%v", executor.calls, executor.calledInside, run.AdapterVersion, service.executorDeclaration.Capabilities)
	}
}

func TestCanonicalResult_StrictOpenAPIValidation(t *testing.T) {
	metadata := metadata("cmd_01HABCDEFGJ", 1)
	result := command.Result{
		Type: "RunDispatched", ProjectID: projectID, WorkItemID: workItemID,
		RunID: "run_01HABCDEFGH", Version: 2, Phase: domain.PhaseDeveloping,
	}
	success, err := command.CanonicalSuccess(metadata, command.DispatchRunOperation, result, 3, port.Cursor{Epoch: 2, Sequence: 4})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := command.DecodeCanonicalResult(success, metadata.CommandID, command.DispatchRunOperation); err != nil {
		t.Fatalf("valid success rejected: %v", err)
	}

	successAttacks := map[string][]byte{
		"unknown-top-level":       []byte(strings.Replace(string(success), `{"api_version"`, `{"unexpected":true,"api_version"`, 1)),
		"unknown-command-member":  []byte(strings.Replace(string(success), `"command":{"command_id"`, `"command":{"unexpected":true,"command_id"`, 1)),
		"unknown-result-member":   []byte(strings.Replace(string(success), `"result":{"type"`, `"result":{"unexpected":true,"type"`, 1)),
		"unknown-audit-member":    []byte(strings.Replace(string(success), `"audit":{"sequence":3}`, `"audit":{"sequence":3,"unexpected":true}`, 1)),
		"unknown-cursor-member":   []byte(strings.Replace(string(success), `"event_sequence":4}`, `"event_sequence":4,"unexpected":true}`, 1)),
		"noncanonical-key-order":  []byte(strings.Replace(string(success), `{"api_version":"v1","ok":true`, `{"ok":true,"api_version":"v1"`, 1)),
		"noncanonical-whitespace": append([]byte{' '}, success...),
		"noncanonical-number":     []byte(strings.Replace(string(success), `"sequence":3`, `"sequence":3.0`, 1)),
		"mismatched-operation":    []byte(strings.Replace(string(success), `"operation":"DispatchRun"`, `"operation":"MarkReady"`, 1)),
		"mismatched-result-type":  []byte(strings.Replace(string(success), `"type":"RunDispatched"`, `"type":"WorkItemReady"`, 1)),
		"malformed-result-id":     []byte(strings.Replace(string(success), `"run_id":"run_01HABCDEFGH"`, `"run_id":"bad"`, 1)),
		"malformed-status":        []byte(strings.Replace(string(success), `"status":"recorded"`, `"status":"pending"`, 1)),
		"malformed-replayed":      []byte(strings.Replace(string(success), `"replayed":false`, `"replayed":true`, 1)),
		"missing-required-audit":  []byte(strings.Replace(string(success), `"audit":{"sequence":3},`, ``, 1)),
	}
	for name, payload := range successAttacks {
		t.Run("success-"+name, func(t *testing.T) {
			if _, err := command.DecodeCanonicalResult(payload, metadata.CommandID, command.DispatchRunOperation); err == nil {
				t.Fatalf("strict decoder accepted %s: %s", name, payload)
			}
		})
	}
	if _, err := command.DecodeCanonicalResult(success, "cmd_01HABCDEFGK", command.DispatchRunOperation); err == nil {
		t.Fatal("strict decoder accepted mismatched command identity")
	}

	errorCodes := []string{
		command.CodeInvalidRequest, command.CodeUnauthenticated, command.CodePermissionDenied,
		command.CodeNotFound, command.CodeVersionConflict, command.CodeIdempotencyConflict,
		command.CodeIdempotencyExpired, command.CodeStaleSubject, command.CodeImpactPlanStale,
		command.CodeLifecycleRejected, command.CodeDoneGateUnsatisfied, command.CodeCapabilityUnsupported,
		command.CodeOutcomeUnknown, command.CodeStorageCorruption, command.CodeProjectionUnavailable,
	}
	for _, code := range errorCodes {
		failure, err := command.CanonicalFailure(metadata, command.NewError(code, "stable message", false, nil, nil))
		if err != nil {
			t.Fatalf("OpenAPI error code %q rejected: %v", code, err)
		}
		decoded, err := command.DecodeCanonicalResult(failure, metadata.CommandID, command.DispatchRunOperation)
		if err != nil || decoded.Code != code {
			t.Fatalf("OpenAPI error code %q round trip = (%#v,%v)", code, decoded, err)
		}
	}
	if _, err := command.CanonicalFailure(metadata, command.NewError("unknown_failure_code", "message", false, nil, nil)); !errors.Is(err, command.ErrInvalidCommand) {
		t.Fatalf("out-of-enum failure encoding error = %v", err)
	}

	failure, err := command.CanonicalFailure(metadata, command.NewError(command.CodeDoneGateUnsatisfied, "stable message", false, []domain.RejectionCode{domain.CodeEvidenceMissing}, nil))
	if err != nil {
		t.Fatal(err)
	}
	failureAttacks := map[string][]byte{
		"unknown-top-level":       []byte(strings.Replace(string(failure), `{"api_version"`, `{"unexpected":true,"api_version"`, 1)),
		"unknown-error-member":    []byte(strings.Replace(string(failure), `"error":{"code"`, `"error":{"unexpected":true,"code"`, 1)),
		"unknown-details-member":  []byte(strings.Replace(string(failure), `"details":{"reasons"`, `"details":{"unexpected":true,"reasons"`, 1)),
		"out-of-enum-code":        []byte(strings.Replace(string(failure), command.CodeDoneGateUnsatisfied, "unknown_failure_code", 1)),
		"unknown-rejection-code":  []byte(strings.Replace(string(failure), string(domain.CodeEvidenceMissing), "unknown_reason", 1)),
		"noncanonical-key-order":  []byte(strings.Replace(string(failure), `{"api_version":"v1","ok":false`, `{"ok":false,"api_version":"v1"`, 1)),
		"noncanonical-whitespace": append([]byte{'\n'}, failure...),
		"missing-retryable":       []byte(strings.Replace(string(failure), `,"retryable":false`, ``, 1)),
	}
	for name, payload := range failureAttacks {
		t.Run("failure-"+name, func(t *testing.T) {
			if _, err := command.DecodeCanonicalResult(payload, metadata.CommandID, command.DispatchRunOperation); err == nil {
				t.Fatalf("strict decoder accepted %s: %s", name, payload)
			}
		})
	}
}

func TestDispatch_ResponseLossDoesNotDuplicateRun(t *testing.T) {
	service, store := readyFixture(t)
	request := dispatchCommand()
	first, err := service.DispatchRun(t.Context(), operator, request)
	if err != nil {
		t.Fatal(err)
	}
	store.projection.calls = nil // Simulate response loss after commit and a fresh delivery observer.
	replay, err := service.DispatchRun(t.Context(), operator, request)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replayed || !bytes.Equal(replay.Payload, first.Payload) || len(store.state.runs) != 1 || len(store.state.outbox) != 1 || len(store.projection.calls) != 0 {
		t.Fatalf("response-loss replay = replayed %t, run/outbox/publish %d/%d/%d", replay.Replayed, len(store.state.runs), len(store.state.outbox), len(store.projection.calls))
	}
}

func TestDispatch_ConcurrentSameRequestHasOneMutation(t *testing.T) {
	service, store := readyFixture(t)
	request := dispatchCommand()
	outcomes := make([]command.Outcome, 2)
	errs := make([]error, 2)
	var wait sync.WaitGroup
	for index := range 2 {
		wait.Go(func() {
			outcomes[index], errs[index] = service.DispatchRun(t.Context(), operator, request)
		})
	}
	wait.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if outcomes[0].Replayed == outcomes[1].Replayed || !bytes.Equal(outcomes[0].Payload, outcomes[1].Payload) ||
		len(store.state.runs) != 1 || len(store.state.audits) != 1 || len(store.state.events) != 1 ||
		len(store.state.results) != 1 || len(store.state.idempotency) != 1 {
		t.Fatalf("concurrent outcomes replay=%t/%t durable run/audit/event/result/idempotency=%d/%d/%d/%d/%d",
			outcomes[0].Replayed, outcomes[1].Replayed, len(store.state.runs), len(store.state.audits), len(store.state.events), len(store.state.results), len(store.state.idempotency))
	}
}

func TestCommand_AuthenticatedPrincipalIsSoleActor(t *testing.T) {
	service, store := readyFixture(t)
	commandTypes := []reflect.Type{
		reflect.TypeFor[command.CreateProject](), reflect.TypeFor[command.CreateWorkItem](),
		reflect.TypeFor[command.MarkReady](), reflect.TypeFor[command.DispatchRun](),
		reflect.TypeFor[command.CompleteWorkItem](),
	}
	for _, commandType := range commandTypes {
		for _, field := range reflect.VisibleFields(commandType) {
			if strings.EqualFold(field.Name, "actor") || strings.EqualFold(field.Name, "actorid") || strings.EqualFold(field.Name, "principal") {
				t.Fatalf("payload DTO %s exposes actor override %s", commandType.Name(), field.Name)
			}
		}
	}
	beforeCalls := store.withinCalls
	outcome, err := service.DispatchRun(t.Context(), "forged-operator", dispatchCommand())
	assertCommandError(t, err, command.CodePermissionDenied)
	if len(outcome.Payload) == 0 || store.withinCalls != beforeCalls || len(store.state.audits) != 0 {
		t.Fatal("unauthorized principal reached persistence or mutation")
	}
	if _, err := service.DispatchRun(t.Context(), operator, dispatchCommand()); err != nil {
		t.Fatal(err)
	}
	if store.state.audits[0].Actor != operator {
		t.Fatalf("audit actor = %s", store.state.audits[0].Actor)
	}
}

func TestCommand_CanonicalRequestDeterministicAndProjectOperationScoped(t *testing.T) {
	now := fixedTime()
	base := command.CreateWorkItem{
		Metadata:  command.Metadata{CommandID: "cmd_01HABCDEFGH", IdempotencyKey: "00000000-0000-4000-8000-000000000001", IssuedAt: now, CorrelationID: "correlation-1"},
		ProjectID: projectID, WorkItemID: workItemID, Title: "title", Goal: "goal", OwnerID: "owner",
		RequiredACRevisions: []command.ACRevision{{ACID: "AC-2", RevisionDigest: domain.HashString("ac-2")}, {ACID: "AC-1", RevisionDigest: domain.HashString("ac-1")}},
	}
	first, firstDigest, err := command.CanonicalCreateWorkItem(base)
	if err != nil {
		t.Fatal(err)
	}
	reordered := base
	reordered.RequiredACRevisions = slices.Clone(base.RequiredACRevisions)
	slices.Reverse(reordered.RequiredACRevisions)
	second, secondDigest, err := command.CanonicalCreateWorkItem(reordered)
	if err != nil || !bytes.Equal(first, second) || firstDigest != secondDigest {
		t.Fatalf("canonical ordering changed = (%q,%q,%v)", first, second, err)
	}
	otherProject := base
	otherProject.ProjectID = "prj_01HABCDEFGJ"
	_, otherDigest, err := command.CanonicalCreateWorkItem(otherProject)
	if err != nil || otherDigest == firstDigest {
		t.Fatal("canonical digest was not project scoped")
	}
	mark := command.MarkReady{Metadata: base.Metadata, ProjectID: base.ProjectID, WorkItemID: base.WorkItemID}
	mark.ExpectedVersion = 1
	_, markDigest, err := command.CanonicalMarkReady(mark)
	if err != nil || markDigest == firstDigest {
		t.Fatal("canonical digest was not operation scoped")
	}
}

func TestMarkReady_DerivesTrustedSpecificationFacts(t *testing.T) {
	service, store := draftFixture(t, false)
	request := markReadyCommand()
	before := store.snapshot()
	outcome, err := service.MarkReady(t.Context(), operator, request)
	assertCommandError(t, err, command.CodeLifecycleRejected)
	if len(outcome.Payload) == 0 || store.state.workItems[itemKey(projectID, workItemID)].Phase() != domain.PhaseDraft {
		t.Fatal("invalid trusted specification changed phase")
	}
	assertOnlyFailureRecorded(t, before, store.snapshot())
	recorded := bytes.Clone(outcome.Payload)
	outcome.Payload[0] ^= 0xff
	replay, err := service.MarkReady(t.Context(), operator, request)
	assertCommandError(t, err, command.CodeLifecycleRejected)
	if !replay.Replayed || !bytes.Equal(replay.Payload, recorded) {
		t.Fatal("recorded specification failure did not replay byte-exactly")
	}
	service.config.Specification = specificationPolicy(true)
	retry := markReadyCommand()
	retry.CommandID = "cmd_01HABCDEFGN"
	retry.IdempotencyKey = "00000000-0000-4000-8000-000000000004"
	if _, err := service.MarkReady(t.Context(), operator, retry); err != nil {
		t.Fatal(err)
	}
	if store.state.workItems[itemKey(projectID, workItemID)].Phase() != domain.PhaseReady {
		t.Fatal("persisted accepted AC plus trusted specification did not mark Ready")
	}
}

func TestCompleteWorkItem_ExactSubjectAndStorageCorruptionFailClosed(t *testing.T) {
	gateCases := []struct {
		name   string
		reason domain.RejectionCode
		mutate func(*port.CompletionMaterial)
	}{
		{"candidate-missing", domain.CodeCandidateMissing, func(value *port.CompletionMaterial) { value.CandidatePresent = false }},
		{"candidate-unavailable", domain.CodeCandidateUnavailable, func(value *port.CompletionMaterial) { value.CandidateAvailable = false }},
		{"active-or-unknown-run", domain.CodeActiveOrUnknownRun, func(value *port.CompletionMaterial) { value.ActiveOrUnknownRun = true }},
		{"evidence-missing", domain.CodeEvidenceMissing, func(value *port.CompletionMaterial) { value.Evidence = nil }},
		{"evidence-nonpassing", domain.CodeEvidenceNonpassing, func(value *port.CompletionMaterial) { value.Evidence[0].Verdict = "Failed" }},
		{"evidence-stale-recipe", domain.CodeEvidenceStale, func(value *port.CompletionMaterial) { value.Evidence[0].RecipeDigest = domain.HashString("old-recipe") }},
		{"evidence-artifact-missing", domain.CodeEvidenceUnavailable, func(value *port.CompletionMaterial) { value.Artifacts = nil }},
		{"evidence-artifact-unavailable", domain.CodeEvidenceUnavailable, func(value *port.CompletionMaterial) { value.Artifacts[0].Availability = "Quarantined" }},
		{"review-missing", domain.CodeReviewMissing, func(value *port.CompletionMaterial) { value.Reviews = nil }},
		{"review-rejected", domain.CodeReviewRejected, func(value *port.CompletionMaterial) { value.Reviews[0].Verdict = "Rejected" }},
		{"approval-expired", domain.CodeApprovalExpired, func(value *port.CompletionMaterial) { value.Approvals[0].ExpiresAtNS = fixedTime().UnixNano() }},
	}
	for _, test := range gateCases {
		t.Run(test.name, func(t *testing.T) {
			service, store, subject := completionFixture(t)
			material := store.state.materials[itemKey(projectID, workItemID)]
			test.mutate(&material)
			store.state.materials[itemKey(projectID, workItemID)] = material
			before := store.snapshot()
			outcome, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
			assertCommandError(t, err, command.CodeDoneGateUnsatisfied)
			assertReason(t, err, test.reason)
			if len(outcome.Payload) == 0 {
				t.Fatalf("%s changed authoritative state", test.name)
			}
			assertOnlyFailureRecorded(t, before, store.snapshot())
		})
	}

	t.Run("trusted-policy-changed", func(t *testing.T) {
		service, store, subject := completionFixture(t)
		service.config.Completion.RevisionDigest = domain.HashString("new-policy")
		before := store.snapshot()
		outcome, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
		assertCommandError(t, err, command.CodeStaleSubject)
		if len(outcome.Payload) == 0 {
			t.Fatal("stale exact subject mutated authoritative state")
		}
		assertOnlyFailureRecorded(t, before, store.snapshot())
		assertReason(t, err, domain.CodeSubjectStale)
	})

	t.Run("expected-version-conflict", func(t *testing.T) {
		service, store, subject := completionFixture(t)
		request := completeCommand(subject)
		request.ExpectedVersion = 4
		before := store.snapshot()
		outcome, err := service.CompleteWorkItem(t.Context(), operator, request)
		assertCommandError(t, err, command.CodeVersionConflict)
		assertReason(t, err, domain.CodeVersionConflict)
		if len(outcome.Payload) == 0 {
			t.Fatal("version conflict changed authoritative state")
		}
		assertOnlyFailureRecorded(t, before, store.snapshot())
	})

	t.Run("persisted-evidence-corrupt", func(t *testing.T) {
		service, store, subject := completionFixture(t)
		store.corruptMaterial = true
		before := store.snapshot()
		outcome, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
		assertCommandError(t, err, command.CodeStorageCorruption)
		if len(outcome.Payload) == 0 || !reflect.DeepEqual(store.snapshot(), before) {
			t.Fatal("storage corruption returned partial state")
		}
	})

	t.Run("non-independent-verifier", func(t *testing.T) {
		service, store, subject := completionFixture(t)
		material := store.state.materials[itemKey(projectID, workItemID)]
		material.Evidence[0].VerifierRole = "producer-run"
		store.state.materials[itemKey(projectID, workItemID)] = material
		before := store.snapshot()
		outcome, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
		assertCommandError(t, err, command.CodeDoneGateUnsatisfied)
		assertReason(t, err, domain.CodeVerifierNotIndependent)
		if len(outcome.Payload) == 0 {
			t.Fatal("non-independent evidence mutated authoritative state")
		}
		assertOnlyFailureRecorded(t, before, store.snapshot())
	})
}

func TestCommand_AllocatorMetadataIsNotPredictedAndResultIsAliasSafe(t *testing.T) {
	service, store, subject := completionFixture(t)
	store.state.nextAudit = 7
	store.state.nextEvent = 11
	outcome, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
	if err != nil {
		t.Fatal(err)
	}
	assertSuccessEnvelope(t, outcome.Payload, command.CompleteWorkItemOperation, 8, port.Cursor{Epoch: 1, Sequence: 12})
	recorded := bytes.Clone(store.state.results[resultKey(projectID, "cmd_01HABCDEFGK")].Payload)
	outcome.Payload[0] ^= 0xff
	replay, err := service.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
	if err != nil || !replay.Replayed || !bytes.Equal(replay.Payload, recorded) {
		t.Fatalf("allocator replay = (%t,%q,%v)", replay.Replayed, replay.Payload, err)
	}
}

func assertSuccessEnvelope(t *testing.T, payload []byte, operation command.Operation, audit uint64, cursor port.Cursor) {
	t.Helper()
	var decoded struct {
		APIVersion string `json:"api_version"`
		OK         bool   `json:"ok"`
		Command    struct {
			Operation command.Operation `json:"operation"`
			Status    string            `json:"status"`
			Replayed  bool              `json:"replayed"`
		} `json:"command"`
		Result struct {
			Type string `json:"type"`
		} `json:"result"`
		Audit struct {
			Sequence uint64 `json:"sequence"`
		} `json:"audit"`
		Cursor struct {
			Epoch    uint64 `json:"stream_epoch"`
			Sequence uint64 `json:"event_sequence"`
		} `json:"projection_cursor"`
		CorrelationID string `json:"correlation_id"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.APIVersion != "v1" || !decoded.OK || decoded.Command.Operation != operation || decoded.Command.Status != "recorded" || decoded.Command.Replayed || decoded.Result.Type == "" || decoded.Audit.Sequence != audit || decoded.Cursor.Epoch != cursor.Epoch || decoded.Cursor.Sequence != cursor.Sequence || decoded.CorrelationID == "" || len(decoded.CorrelationID) > 80 {
		t.Fatalf("success envelope = %#v", decoded)
	}
}

func assertCommandError(t *testing.T, err error, code string) {
	t.Helper()
	failure, ok := errors.AsType[*command.Error](err)
	if !ok || failure.Code != code {
		t.Fatalf("error = %#v, want command code %s", err, code)
	}
}

func assertReason(t *testing.T, err error, reason domain.RejectionCode) {
	t.Helper()
	failure, ok := errors.AsType[*command.Error](err)
	if !ok || !slices.Contains(failure.Reasons, reason) {
		t.Fatalf("error reasons = %#v, want %s", err, reason)
	}
}

func assertOnlyFailureRecorded(t *testing.T, before, after memoryState) {
	t.Helper()
	if len(after.results) != len(before.results)+1 || len(after.idempotency) != len(before.idempotency)+1 {
		t.Fatalf("failure result/idempotency counts = %d/%d, before %d/%d", len(after.results), len(after.idempotency), len(before.results), len(before.idempotency))
	}
	after.results = maps.Clone(before.results)
	after.idempotency = maps.Clone(before.idempotency)
	if !reflect.DeepEqual(after, before) {
		t.Fatal("recorded failure mutated aggregate, audit, outbox, event, completion, or allocator state")
	}
}

func fixedTime() time.Time { return time.Date(2026, time.September, 5, 12, 0, 0, 123, time.UTC) }

func metadata(commandID string, expected uint64) command.Metadata {
	return command.Metadata{
		CommandID: commandID, IdempotencyKey: "00000000-0000-4000-8000-000000000001",
		ExpectedVersion: expected, IssuedAt: fixedTime(), CorrelationID: "correlation-1",
	}
}

func dispatchCommand() command.DispatchRun {
	return command.DispatchRun{Metadata: metadata("cmd_01HABCDEFGJ", 1), ProjectID: projectID, WorkItemID: workItemID, AdapterID: "fake/v1", ScenarioID: "success"}
}

func markReadyCommand() command.MarkReady {
	return command.MarkReady{Metadata: metadata("cmd_01HABCDEFGM", 1), ProjectID: projectID, WorkItemID: workItemID}
}

func completeCommand(subject domain.CompletionSubject) command.CompleteWorkItem {
	return command.CompleteWorkItem{Metadata: metadata("cmd_01HABCDEFGK", 5), ProjectID: projectID, WorkItemID: workItemID, Subject: subject}
}

type specificationPolicy bool

func (policy specificationPolicy) ValidFor(domain.ProjectID, domain.WorkItemID, []port.ACRequirement) bool {
	return bool(policy)
}

type fixedClock struct{ now time.Time }

func (clock fixedClock) Now() time.Time { return clock.now }

type sequenceIDs struct{ values map[port.IDKind]int }

func (source *sequenceIDs) Next(kind port.IDKind) (string, error) {
	if source.values == nil {
		source.values = map[port.IDKind]int{}
	}
	source.values[kind]++
	prefix := map[port.IDKind]string{
		port.IDRun: "run_01HABCDEFG", port.IDAuditGroup: "audit-", port.IDOutbox: "outbox-",
		port.IDCompletionRecord: "completion-", port.IDApprovalConsumption: "consumption-",
	}[kind]
	if prefix == "" {
		return "", errors.New("unknown ID kind")
	}
	return prefix + string(rune('0'+source.values[kind])), nil
}

type executorStub struct{ declaration port.ExecutorDeclaration }

func (executor executorStub) Declaration() port.ExecutorDeclaration {
	return executor.declaration.Clone()
}

type trackingExecutor struct {
	declaration     port.ExecutorDeclaration
	inTransaction   func() bool
	panicAfterFirst bool
	calls           int
	calledInside    bool
}

func (executor *trackingExecutor) Declaration() port.ExecutorDeclaration {
	executor.calls++
	if executor.inTransaction != nil && executor.inTransaction() {
		executor.calledInside = true
	}
	if executor.panicAfterFirst && executor.calls > 1 {
		panic("executor declaration called after service construction")
	}
	return executor.declaration
}

type artifactStub struct{}

func (artifactStub) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	return domain.HashString("artifact"), 1, nil
}

func (artifactStub) Open(context.Context, domain.Digest) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("artifact")), nil
}

type projectionStub struct {
	calls []port.CommittedProjection
	fail  bool
}

func (sink *projectionStub) PublishCommitted(_ context.Context, projection port.CommittedProjection) error {
	sink.calls = append(sink.calls, projection.Clone())
	if sink.fail {
		return errors.New("projection unavailable")
	}
	return nil
}

func testService(t *testing.T, store *memoryUnit, specification specificationPolicy) *Service {
	t.Helper()
	return testServiceWithExecutor(t, store, specification, executorStub{declaration: port.ExecutorDeclaration{
		AdapterID: "fake/v1", AdapterVersion: "1", Capabilities: []string{"start_ack"},
	}})
}

func testServiceWithExecutor(t *testing.T, store *memoryUnit, specification specificationPolicy, executor port.Executor) *Service {
	t.Helper()
	service, err := New(
		store, fixedClock{now: fixedTime()}, &sequenceIDs{},
		executor,
		artifactStub{}, store.projection,
		Config{
			Operator: operator, IdempotencyTTL: time.Hour, Specification: specification,
			Completion: CompletionPolicy{
				RevisionDigest: domain.HashString("policy"), RecipeDigest: domain.HashString("recipe"), ApprovalRequired: true,
				Checks: map[domain.ACID]VerificationRule{
					"AC-1": {VerifierClass: "independent", Independent: true, ProhibitedVerifierActor: "producer", ProhibitedVerifierRunRole: "producer-run", EnvironmentDigest: domain.HashString("environment")},
				},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func readyFixture(t *testing.T) (*Service, *memoryUnit) {
	t.Helper()
	store := newMemoryUnit()
	item, err := domain.NewWorkItem(workItemID, projectID, domain.PhaseReady, 1)
	if err != nil {
		t.Fatal(err)
	}
	store.state.projects[projectID] = port.Project{ID: projectID, Name: "project", Repository: "repo", Ref: "main", Version: 1}
	store.state.workItems[itemKey(projectID, workItemID)] = item
	store.state.requirements[itemKey(projectID, workItemID)] = []port.ACRequirement{{ProjectID: projectID, WorkItemID: workItemID, ACID: "AC-1", RevisionDigest: domain.HashString("ac")}}
	return testService(t, store, true), store
}

func draftFixture(t *testing.T, specification specificationPolicy) (*Service, *memoryUnit) {
	t.Helper()
	service, store := readyFixture(t)
	item, err := domain.NewWorkItem(workItemID, projectID, domain.PhaseDraft, 1)
	if err != nil {
		t.Fatal(err)
	}
	store.state.workItems[itemKey(projectID, workItemID)] = item
	service.config.Specification = specification
	return service, store
}

func completionFixture(t *testing.T) (*Service, *memoryUnit, domain.CompletionSubject) {
	t.Helper()
	store := newMemoryUnit()
	item, err := domain.NewWorkItem(workItemID, projectID, domain.PhaseQA, 5)
	if err != nil {
		t.Fatal(err)
	}
	requirement := port.ACRequirement{ProjectID: projectID, WorkItemID: workItemID, ACID: "AC-1", RevisionDigest: domain.HashString("ac")}
	subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{
		ProjectID: projectID, WorkItemID: workItemID, WorkItemVersion: 5,
		CandidateID: "candidate-1", CandidateDigest: domain.HashString("candidate"),
		RunID: "run_01HABCDEFGH", RunInputDigest: domain.HashString("run-input"),
		RequiredACRevisions:         []domain.ACRevisionBinding{{ACID: requirement.ACID, RevisionDigest: requirement.RevisionDigest}},
		AcceptedGraphRevisionDigest: domain.HashString("graph"), PolicyRevisionDigest: domain.HashString("policy"),
		CompletionRecipeDigest: domain.HashString("recipe"),
	})
	if err != nil {
		t.Fatal(err)
	}
	material := port.CompletionMaterial{
		WorkItem:         item,
		Candidate:        port.Candidate{ID: subject.CandidateID(), ProjectID: projectID, RunID: subject.RunID(), Digest: subject.CandidateDigest(), InputSubjectDigest: domain.HashString("input-subject"), CreatedAtNS: 1},
		Run:              port.Run{ID: subject.RunID(), ProjectID: projectID, WorkItemID: workItemID, InputDigest: subject.RunInputDigest(), AdapterID: "fake/v1", AdapterVersion: "1", ScenarioID: "success", Attempt: 1, DesiredAction: "Dispatch", DispatchState: "Acknowledged", ObservedState: "Succeeded", ReconciliationState: "None", SideEffectOutcome: "Confirmed", CreatedAtNS: 1},
		CandidatePresent: true, CandidateAvailable: true, RunPresent: true,
		RequiredACRevisions: []port.ACRequirement{requirement}, GraphRevisionDigest: subject.GraphRevisionDigest(),
		Evidence:  []port.Evidence{{ID: "evidence-1", ProjectID: projectID, SubjectDigest: subject.Digest(), ACID: "AC-1", ACRevisionDigest: requirement.RevisionDigest, Verdict: "Passed", Applicability: "Current", Availability: "Present", VerifierClass: "independent", VerifierActor: "verifier", VerifierRole: "independent-run", RecipeDigest: domain.HashString("recipe"), EnvironmentDigest: domain.HashString("environment"), ArtifactDigest: domain.HashString("artifact")}},
		Reviews:   []port.Review{{ID: "review-1", ProjectID: projectID, SubjectDigest: subject.Digest(), Verdict: "Approved", Reviewer: "reviewer", Independent: true, CreatedAtNS: 1}},
		Approvals: []port.Approval{{ID: "approval-1", ProjectID: projectID, SubjectDigest: subject.Digest(), CommandKind: "CompleteWorkItem", Actor: operator, ExpiresAtNS: fixedTime().Add(time.Hour).UnixNano()}},
		Artifacts: []port.Artifact{{Digest: domain.HashString("artifact"), MediaType: "text/plain", ByteLength: 1, StorageKey: "objects/artifact", Availability: "Present"}},
	}
	store.state.projects[projectID] = port.Project{ID: projectID, Name: "project", Repository: "repo", Ref: "main", Version: 1}
	store.state.workItems[itemKey(projectID, workItemID)] = item
	store.state.requirements[itemKey(projectID, workItemID)] = []port.ACRequirement{requirement}
	store.state.materials[itemKey(projectID, workItemID)] = material
	return testService(t, store, true), store, subject
}

type memoryUnit struct {
	mu              sync.Mutex
	state           memoryState
	failAt          string
	withinCalls     int
	corruptMaterial bool
	projection      *projectionStub
	operations      []string
	withinActive    bool
}

type memoryState struct {
	projects     map[domain.ProjectID]port.Project
	workItems    map[string]domain.WorkItem
	requirements map[string][]port.ACRequirement
	materials    map[string]port.CompletionMaterial
	runs         map[string]port.Run
	results      map[string]port.CommandResult
	idempotency  map[string]port.Idempotency
	audits       []port.AuditEntry
	outbox       []port.OutboxIntent
	events       []port.ProjectionEvent
	completions  []port.Completion
	consumptions []port.ApprovalConsumption
	nextAudit    uint64
	nextEvent    uint64
}

func newMemoryUnit() *memoryUnit {
	return &memoryUnit{state: memoryState{
		projects: map[domain.ProjectID]port.Project{}, workItems: map[string]domain.WorkItem{}, requirements: map[string][]port.ACRequirement{},
		materials: map[string]port.CompletionMaterial{}, runs: map[string]port.Run{}, results: map[string]port.CommandResult{}, idempotency: map[string]port.Idempotency{},
	}, projection: &projectionStub{}}
}

func (unit *memoryUnit) Within(ctx context.Context, operation func(port.Transaction) error) error {
	unit.mu.Lock()
	defer unit.mu.Unlock()
	unit.withinCalls++
	unit.withinActive = true
	defer func() { unit.withinActive = false }()
	working := unit.state.clone()
	tx := &memoryTransaction{ctx: ctx, state: &working, failAt: unit.failAt, operations: &unit.operations, corruptMaterial: unit.corruptMaterial}
	if err := operation(tx); err != nil {
		return err
	}
	if err := working.validateCommitReferences(); err != nil {
		return err
	}
	unit.state = working
	return nil
}

func (unit *memoryUnit) snapshot() memoryState {
	unit.mu.Lock()
	defer unit.mu.Unlock()
	return unit.state.clone()
}

func (unit *memoryUnit) operationIndex(name string) int { return slices.Index(unit.operations, name) }

func (state memoryState) clone() memoryState {
	result := state
	result.projects = maps.Clone(state.projects)
	result.workItems = maps.Clone(state.workItems)
	result.requirements = make(map[string][]port.ACRequirement, len(state.requirements))
	for key, values := range state.requirements {
		result.requirements[key] = slices.Clone(values)
	}
	result.materials = make(map[string]port.CompletionMaterial, len(state.materials))
	for key, material := range state.materials {
		result.materials[key] = cloneMaterial(material)
	}
	result.runs = maps.Clone(state.runs)
	result.results = make(map[string]port.CommandResult, len(state.results))
	for key, value := range state.results {
		value.Payload = bytes.Clone(value.Payload)
		result.results[key] = value
	}
	result.idempotency = maps.Clone(state.idempotency)
	result.audits = slices.Clone(state.audits)
	result.outbox = slices.Clone(state.outbox)
	result.events = make([]port.ProjectionEvent, len(state.events))
	for index, value := range state.events {
		value.Payload = bytes.Clone(value.Payload)
		result.events[index] = value
	}
	result.completions = make([]port.Completion, len(state.completions))
	for index, value := range state.completions {
		result.completions[index] = cloneCompletion(value)
	}
	result.consumptions = slices.Clone(state.consumptions)
	return result
}

func (state memoryState) validateCommitReferences() error {
	auditGroups := make(map[string]struct{}, len(state.audits))
	for _, audit := range state.audits {
		if _, exists := state.results[resultKey(audit.ProjectID, audit.CommandID)]; !exists {
			return errors.New("commit rejected missing audit command result")
		}
		auditGroups[resultKey(audit.ProjectID, audit.GroupID)] = struct{}{}
	}
	for _, intent := range state.outbox {
		if _, exists := state.results[resultKey(intent.ProjectID, intent.CommandID)]; !exists {
			return errors.New("commit rejected missing outbox command result")
		}
		if _, exists := auditGroups[resultKey(intent.ProjectID, intent.AuditGroupID)]; !exists {
			return errors.New("commit rejected missing outbox audit group")
		}
	}
	for _, consumption := range state.consumptions {
		if _, exists := state.results[resultKey(consumption.ProjectID, consumption.CommandID)]; !exists {
			return errors.New("commit rejected missing approval-consumption command result")
		}
	}
	return nil
}

func cloneMaterial(material port.CompletionMaterial) port.CompletionMaterial {
	material.RequiredACRevisions = slices.Clone(material.RequiredACRevisions)
	material.Evidence = slices.Clone(material.Evidence)
	material.Reviews = slices.Clone(material.Reviews)
	material.Approvals = slices.Clone(material.Approvals)
	material.Artifacts = slices.Clone(material.Artifacts)
	return material
}

func cloneCompletion(value port.Completion) port.Completion {
	value.EvidenceIDs = slices.Clone(value.EvidenceIDs)
	value.ReviewIDs = slices.Clone(value.ReviewIDs)
	value.ApprovalIDs = slices.Clone(value.ApprovalIDs)
	value.Consumptions = slices.Clone(value.Consumptions)
	return value
}

type memoryTransaction struct {
	ctx             context.Context
	state           *memoryState
	failAt          string
	operations      *[]string
	corruptMaterial bool
}

func (tx *memoryTransaction) step(name string) error {
	*tx.operations = append(*tx.operations, name)
	if tx.failAt == name {
		return errInjected
	}
	return nil
}

func (tx *memoryTransaction) CreateProject(_ context.Context, value port.Project) error {
	if err := tx.step("CreateProject"); err != nil {
		return err
	}
	if _, exists := tx.state.projects[value.ID]; exists {
		return errors.New("project already exists")
	}
	tx.state.projects[value.ID] = value
	return nil
}

func (tx *memoryTransaction) CreateWorkItem(_ context.Context, value port.WorkItem) error {
	if err := tx.step("CreateWorkItem"); err != nil {
		return err
	}
	key := itemKey(value.Item.ProjectID(), value.Item.ID())
	if _, exists := tx.state.workItems[key]; exists {
		return errors.New("work item already exists")
	}
	tx.state.workItems[key] = value.Item
	return nil
}

func (tx *memoryTransaction) LoadIdempotency(_ context.Context, principal domain.ActorID, projectID domain.ProjectID, operation, key string) (port.Idempotency, error) {
	value, exists := tx.state.idempotency[idempotencyKey(principal, projectID, command.Operation(operation), key)]
	if !exists {
		return port.Idempotency{}, port.ErrNotFound
	}
	return value, nil
}

func (tx *memoryTransaction) LoadCommandResult(_ context.Context, projectID domain.ProjectID, id string) (port.CommandResult, error) {
	value, exists := tx.state.results[resultKey(projectID, id)]
	if !exists {
		return port.CommandResult{}, port.ErrNotFound
	}
	if len(value.Payload) == 0 || domain.HashBytes(value.Payload) != value.Digest {
		return port.CommandResult{}, domain.StorageCorruptionError{Reason: "corrupt command result"}
	}
	value.Payload = bytes.Clone(value.Payload)
	return value, nil
}

func (tx *memoryTransaction) LoadWorkItem(_ context.Context, projectID domain.ProjectID, workItemID domain.WorkItemID) (domain.WorkItem, error) {
	item, exists := tx.state.workItems[itemKey(projectID, workItemID)]
	if !exists {
		return domain.WorkItem{}, port.ErrNotFound
	}
	return item, nil
}

func (tx *memoryTransaction) LoadCompletionMaterial(_ context.Context, query port.CompletionMaterialQuery) (port.CompletionMaterial, error) {
	if tx.corruptMaterial {
		return port.CompletionMaterial{}, domain.StorageCorruptionError{Reason: "corrupt material"}
	}
	key := itemKey(query.ProjectID, query.WorkItemID)
	item, exists := tx.state.workItems[key]
	if !exists {
		return port.CompletionMaterial{}, port.ErrNotFound
	}
	material, exists := tx.state.materials[key]
	if !exists {
		material = port.CompletionMaterial{WorkItem: item, RequiredACRevisions: slices.Clone(tx.state.requirements[key])}
	}
	material = cloneMaterial(material)
	material.WorkItem = item
	return material, nil
}

func (tx *memoryTransaction) UpdateWorkItem(_ context.Context, item domain.WorkItem, expected uint64) error {
	if err := tx.step("UpdateWorkItem"); err != nil {
		return err
	}
	key := itemKey(item.ProjectID(), item.ID())
	current, exists := tx.state.workItems[key]
	if !exists {
		return port.ErrNotFound
	}
	if current.Version() != expected || item.Version() != expected+1 {
		return domain.Rejection{Code: domain.CodeVersionConflict}
	}
	if item.Phase() == domain.PhaseDone {
		matchingCompletion := slices.ContainsFunc(tx.state.completions, func(completion port.Completion) bool {
			return completion.Item.ProjectID() == item.ProjectID() && completion.Record.WorkItemID() == item.ID() &&
				completion.Record.ResultVersion() == item.Version() && !completion.Record.SubjectDigest().IsZero()
		})
		if !matchingCompletion {
			return errors.New("completion_record_required")
		}
	}
	tx.state.workItems[key] = item
	return nil
}

func (tx *memoryTransaction) CreateRun(_ context.Context, value port.Run) error {
	if err := tx.step("CreateRun"); err != nil {
		return err
	}
	key := resultKey(value.ProjectID, string(value.ID))
	if _, exists := tx.state.runs[key]; exists {
		return errors.New("run already exists")
	}
	tx.state.runs[key] = value
	return nil
}

func (tx *memoryTransaction) StoreACRevision(context.Context, port.ACRevision) error {
	return tx.step("StoreACRevision")
}

func (tx *memoryTransaction) RequireACRevision(_ context.Context, value port.ACRequirement) error {
	if err := tx.step("RequireACRevision"); err != nil {
		return err
	}
	key := itemKey(value.ProjectID, value.WorkItemID)
	tx.state.requirements[key] = append(tx.state.requirements[key], value)
	return nil
}

func (tx *memoryTransaction) StoreDependencyRevision(context.Context, port.DependencyRevision) error {
	return tx.step("StoreDependencyRevision")
}

func (tx *memoryTransaction) StoreCandidate(context.Context, port.Candidate) error {
	return tx.step("StoreCandidate")
}

func (tx *memoryTransaction) StoreArtifact(context.Context, port.Artifact) error {
	return tx.step("StoreArtifact")
}

func (tx *memoryTransaction) BindCandidateArtifact(context.Context, domain.ProjectID, domain.CandidateID, domain.Digest) error {
	return tx.step("BindCandidateArtifact")
}

func (tx *memoryTransaction) StoreEvidence(context.Context, port.Evidence) error {
	return tx.step("StoreEvidence")
}

func (tx *memoryTransaction) StoreReview(context.Context, port.Review) error {
	return tx.step("StoreReview")
}

func (tx *memoryTransaction) StoreApproval(context.Context, port.Approval) error {
	return tx.step("StoreApproval")
}

func (tx *memoryTransaction) StoreCompletion(_ context.Context, value port.Completion) error {
	if err := tx.step("StoreCompletion"); err != nil {
		return err
	}
	tx.state.completions = append(tx.state.completions, cloneCompletion(value))
	tx.state.consumptions = append(tx.state.consumptions, value.Consumptions...)
	return nil
}

func (tx *memoryTransaction) ConsumeApproval(_ context.Context, value port.ApprovalConsumption) error {
	if err := tx.step("ConsumeApproval"); err != nil {
		return err
	}
	tx.state.consumptions = append(tx.state.consumptions, value)
	return nil
}

func (tx *memoryTransaction) StoreCommandResult(_ context.Context, value port.CommandResult) error {
	if err := tx.step("StoreCommandResult"); err != nil {
		return err
	}
	if len(value.Payload) == 0 || domain.HashBytes(value.Payload) != value.Digest {
		return errors.New("invalid command result")
	}
	value.Payload = bytes.Clone(value.Payload)
	tx.state.results[resultKey(value.ProjectID, value.ID)] = value
	return nil
}

func (tx *memoryTransaction) StoreIdempotency(_ context.Context, value port.Idempotency) error {
	if err := tx.step("StoreIdempotency"); err != nil {
		return err
	}
	if _, exists := tx.state.results[resultKey(value.ProjectID, value.CommandID)]; !exists {
		return errors.New("missing command result")
	}
	tx.state.idempotency[idempotencyKey(value.Principal, value.ProjectID, command.Operation(value.Operation), value.Key)] = value
	return nil
}

func (tx *memoryTransaction) AppendAudit(_ context.Context, value port.AuditEntry) (uint64, error) {
	if err := tx.step("AppendAudit"); err != nil {
		return 0, err
	}
	tx.state.nextAudit++
	tx.state.audits = append(tx.state.audits, value)
	return tx.state.nextAudit, nil
}

func (tx *memoryTransaction) EnqueueOutbox(_ context.Context, value port.OutboxIntent) error {
	if err := tx.step("EnqueueOutbox"); err != nil {
		return err
	}
	tx.state.outbox = append(tx.state.outbox, value)
	return nil
}

func (tx *memoryTransaction) AppendProjectionEvent(_ context.Context, value port.ProjectionEvent) (port.Cursor, error) {
	if err := tx.step("AppendProjectionEvent"); err != nil {
		return port.Cursor{}, err
	}
	tx.state.nextEvent++
	value.Epoch, value.Sequence = 1, tx.state.nextEvent
	value.Payload = bytes.Clone(value.Payload)
	tx.state.events = append(tx.state.events, value)
	return port.Cursor{Epoch: 1, Sequence: tx.state.nextEvent}, nil
}

func itemKey(projectID domain.ProjectID, workItemID domain.WorkItemID) string {
	return string(projectID) + "/" + string(workItemID)
}

func resultKey(projectID domain.ProjectID, id string) string { return string(projectID) + "/" + id }

func idempotencyKey(principal domain.ActorID, projectID domain.ProjectID, operation command.Operation, key string) string {
	return string(principal) + "/" + string(projectID) + "/" + string(operation) + "/" + key
}

var _ port.Transaction = (*memoryTransaction)(nil)
