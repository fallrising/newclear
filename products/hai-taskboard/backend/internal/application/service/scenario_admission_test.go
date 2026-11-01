package service

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
)

func TestDispatchRun_RejectsUnsupportedScenarioWithoutMutation(t *testing.T) {
	application, store := readyFixture(t)
	request := dispatchCommand()
	request.ScenarioID = "unregistered"
	before := store.snapshot()
	first, err := application.DispatchRun(t.Context(), operator, request)
	assertCommandError(t, err, command.CodeLifecycleRejected)
	if len(store.state.runs) != 0 || len(store.state.outbox) != 0 || len(store.state.audits) != 0 ||
		len(store.state.events) != 0 || !reflect.DeepEqual(store.state.workItems[itemKey(projectID, workItemID)], before.workItems[itemKey(projectID, workItemID)]) {
		t.Fatal("unsupported scenario mutated work or dispatch state")
	}
	replay, err := application.DispatchRun(t.Context(), operator, request)
	assertCommandError(t, err, command.CodeLifecycleRejected)
	if !replay.Replayed || !bytes.Equal(first.Payload, replay.Payload) || len(store.state.results) != 1 {
		t.Fatal("unsupported scenario rejection was not replayed exactly once")
	}
	request.ScenarioID = "success"
	_, err = application.DispatchRun(t.Context(), operator, request)
	assertCommandError(t, err, command.CodeIdempotencyConflict)
}

func TestDispatchRun_UnauthorizedScenarioRequestWritesNothing(t *testing.T) {
	application, store := readyFixture(t)
	request := dispatchCommand()
	request.ScenarioID = "unregistered"
	_, err := application.DispatchRun(t.Context(), "other-actor", request)
	assertCommandError(t, err, command.CodePermissionDenied)
	if store.withinCalls != 0 || len(store.state.results) != 0 {
		t.Fatal("unauthorized scenario request reached persistence")
	}
}

func TestService_RejectsInvalidScenarioDeclarations(t *testing.T) {
	application, _ := readyFixture(t)
	for _, scenarios := range [][]string{nil, {""}, {"success", "success"}, {"contains space"}, {strings.Repeat("x", 129)}} {
		t.Run(strings.Join(scenarios, ","), func(t *testing.T) {
			_, err := New(application.unit, application.clock, application.ids, executorStub{declaration: port.ExecutorDeclaration{
				AdapterID: "fake/v1", AdapterVersion: "1", Scenarios: scenarios,
			}}, application.artifacts, application.projections, application.config)
			if err == nil {
				t.Fatalf("invalid scenario declaration accepted: %v", scenarios)
			}
		})
	}
}

func TestDispatchRun_UsesImmutableScenarioDeclaration(t *testing.T) {
	_, store := readyFixture(t)
	executor := &trackingExecutor{declaration: port.ExecutorDeclaration{
		AdapterID: "fake/v1", AdapterVersion: "1", Scenarios: []string{"success"},
	}, inTransaction: func() bool { return store.withinActive }, panicAfterFirst: true}
	application := testServiceWithExecutor(t, store, true, executor)
	executor.declaration.Scenarios[0] = "unregistered"
	if _, err := application.DispatchRun(t.Context(), operator, dispatchCommand()); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 1 || executor.calledInside {
		t.Fatal("dispatch consulted executor after construction or within transaction")
	}
}
