package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

func TestRuntime_RejectsUnsupportedScenarioBeforeDispatch(t *testing.T) {
	fixture := newWorkerFixture(t)
	app := fixture.worker.commands
	makeMetadata := func(number int, version uint64) command.Metadata {
		return command.Metadata{
			CommandID:       fmt.Sprintf("cmd_000000000%d", number),
			IdempotencyKey:  fmt.Sprintf("00000000-0000-4000-8000-%012d", number),
			ExpectedVersion: version,
			IssuedAt:        fixture.clock.Now(),
			CorrelationID:   "scenario-admission-test",
		}
	}
	for index, itemID := range []domain.WorkItemID{"wi_0000000002", "wi_0000000003"} {
		outcome, err := app.CreateWorkItem(t.Context(), "operator", command.CreateWorkItem{
			Metadata: makeMetadata(5+index*2, 0), ProjectID: testProjectID, WorkItemID: itemID,
			Title: "Scenario admission fixture", Goal: "Exercise the public dispatch path", OwnerID: "operator",
			RequiredACRevisions: []command.ACRevision{{ACID: "AC-1", RevisionDigest: domain.HashString("worker AC")}},
		})
		if err != nil || len(outcome.Payload) == 0 {
			t.Fatalf("create ready fixture %s: outcome=%+v err=%v", itemID, outcome, err)
		}
		outcome, err = app.MarkReady(t.Context(), "operator", command.MarkReady{
			Metadata: makeMetadata(6+index*2, 1), ProjectID: testProjectID, WorkItemID: itemID,
		})
		if err != nil || len(outcome.Payload) == 0 {
			t.Fatalf("mark fixture %s Ready: outcome=%+v err=%v", itemID, outcome, err)
		}
	}
	if err := fixture.worker.store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := fixture.artifacts.Close(); err != nil {
		t.Fatal(err)
	}

	runtime, cancel, client, baseURL, config := startTestRuntime(t, fixture.root)
	var runtimeWaitErr error
	var runtimeWaitObserved bool
	t.Cleanup(func() {
		client.CloseIdleConnections()
		cancel()
		ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		cleanupErr := runtime.Wait(ctx)
		if !runtimeWaitObserved && cleanupErr != nil {
			t.Errorf("runtime stopped unexpectedly during cleanup: %v", cleanupErr)
		}
	})

	waitForRunState := func(ctx context.Context, itemID domain.WorkItemID, expected string) bool {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			board, err := runtime.store.ReadBoard(ctx, testProjectID)
			if err != nil {
				return false
			}
			for _, item := range board.Items {
				if item.ID == itemID && item.CurrentRun != nil && item.CurrentRun.ObservedState == expected {
					return true
				}
			}
			select {
			case <-ctx.Done():
				return false
			case <-ticker.C:
			}
		}
	}
	startupContext, stopStartup := context.WithTimeout(t.Context(), 5*time.Second)
	defer stopStartup()
	if !waitForRunState(startupContext, "wi_0000000001", "Succeeded") {
		t.Fatal("registered local-success scenario did not execute")
	}

	before, err := runtime.store.ReadBoard(t.Context(), testProjectID)
	if err != nil {
		t.Fatal(err)
	}
	var unsupportedBefore uint64
	for _, item := range before.Items {
		if item.ID == "wi_0000000002" {
			unsupportedBefore = item.Item.Version()
			if item.Item.Phase() != domain.PhaseReady || item.CurrentRun != nil {
				t.Fatalf("unsupported fixture is not Ready and undispatched: phase=%s run=%+v", item.Item.Phase(), item.CurrentRun)
			}
		}
	}

	postDispatch := func(commandID, key string, itemID domain.WorkItemID, scenarioID string, expectedVersion uint64) (int, string, error) {
		body := fmt.Sprintf(`{"command_id":%q,"idempotency_key":%q,"operation":"DispatchRun","expected_version":%d,"issued_at":"2026-10-04T00:00:00Z","payload":{"work_item_id":%q,"adapter_id":%q,"scenario_id":%q}}`,
			commandID, key, expectedVersion, itemID, fake.AdapterID, scenarioID)
		request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, baseURL+"/api/v1/projects/"+string(testProjectID)+"/commands", strings.NewReader(body))
		if err != nil {
			return 0, "", err
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", config.Origin)
		request.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: config.SessionToken})
		response, err := client.Do(request)
		if err != nil {
			return 0, "", err
		}
		defer response.Body.Close()
		responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			return response.StatusCode, string(responseBody), err
		}
		return response.StatusCode, string(responseBody), nil
	}

	unsupportedStatus, unsupportedBody, unsupportedErr := postDispatch("cmd_0000000009", "00000000-0000-4000-8000-000000000009", "wi_0000000002", "unregistered-scenario", unsupportedBefore)
	positiveStatus, _, positiveErr := postDispatch("cmd_0000000010", "00000000-0000-4000-8000-000000000010", "wi_0000000003", "local-success", 2)
	positiveContext, stopPositive := context.WithTimeout(t.Context(), 5*time.Second)
	positiveSucceeded := waitForRunState(positiveContext, "wi_0000000003", "Succeeded")
	stopPositive()

	cancel()
	waitContext, stopWait := context.WithTimeout(t.Context(), 5*time.Second)
	runtimeWaitErr = runtime.Wait(waitContext)
	runtimeWaitObserved = true
	stopWait()
	workerPoisoned := runtimeWaitErr != nil

	store, reopenErr := sqlite.OpenAtRootWithClock(t.Context(), fixture.root, filepath.Join(fixture.root, "state", "taskboard.sqlite"), fixture.clock.Now)
	if reopenErr != nil {
		t.Fatalf("reopen durable scenario state after runtime stop: %v", reopenErr)
	}
	defer store.Close()
	after, boardErr := store.ReadBoard(t.Context(), testProjectID)
	unsupportedVersion := uint64(0)
	var unsupportedRun *string
	for _, item := range after.Items {
		if item.ID == "wi_0000000002" {
			unsupportedVersion = item.Item.Version()
			if item.CurrentRun != nil {
				runID := string(item.CurrentRun.ID)
				unsupportedRun = &runID
			}
		}
	}
	var unsupportedOutbox string
	var authorityErr error
	if unsupportedRun != nil {
		executor, executorErr := newLocalFakeAdapter()
		artifacts, artifactErr := newLocalArtifactStore(filepath.Join(fixture.root, "artifacts", "sha256"))
		if executorErr != nil {
			authorityErr = executorErr
		} else if artifactErr != nil {
			authorityErr = artifactErr
		} else {
			defer artifacts.Close()
			commands, serviceErr := service.New(store, systemClock{}, cryptoIDSource{}, executor, artifacts, httpapi.NewHub(), service.Config{
				Operator: "operator", IdempotencyTTL: time.Hour, Specification: admittedTestSpecification{},
				Completion: service.CompletionPolicy{RevisionDigest: domain.HashString("policy"), RecipeDigest: domain.HashString("recipe"),
					Checks: map[domain.ACID]service.VerificationRule{"AC-1": {VerifierClass: "independent"}}},
			})
			if serviceErr != nil {
				authorityErr = serviceErr
			} else {
				authority, readErr := commands.ReadRunAuthority(t.Context(), testProjectID, domain.RunID(*unsupportedRun))
				authorityErr = readErr
				unsupportedOutbox = authority.Outbox.State
			}
		}
	}
	candidates, candidateErr := store.DispatchCandidates(t.Context(), fixture.clock.Now(), 32)
	unsupportedPending := false
	for _, candidate := range candidates {
		if candidate.Run.WorkItemID == "wi_0000000002" {
			unsupportedPending = true
		}
	}
	if unsupportedErr != nil || unsupportedStatus != http.StatusUnprocessableEntity || unsupportedRun != nil || unsupportedVersion != unsupportedBefore || unsupportedPending || unsupportedOutbox != "" || authorityErr != nil || boardErr != nil || candidateErr != nil || workerPoisoned || positiveErr != nil || positiveStatus != http.StatusOK || !positiveSucceeded {
		t.Errorf("scenario admission violated: unsupported=(status %d, err %v, body %q, version %d->%d, run %v, outbox %q, pending %v, authority_err %v), worker_poisoned=%v (runtime wait %v), local_success=(status %d, err %v, succeeded %v), board_err=%v, candidates_err=%v",
			unsupportedStatus, unsupportedErr, unsupportedBody, unsupportedBefore, unsupportedVersion, unsupportedRun, unsupportedOutbox, unsupportedPending,
			authorityErr, workerPoisoned, runtimeWaitErr, positiveStatus, positiveErr, positiveSucceeded, boardErr, candidateErr)
	}
}
