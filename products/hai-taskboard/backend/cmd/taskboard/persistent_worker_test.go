package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/executor/fake"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

type workerClock struct{ now time.Time }

type workerGatedListener struct {
	net.Listener
	gate chan struct{}
}

func (listener workerGatedListener) Accept() (net.Conn, error) {
	<-listener.gate
	return listener.Listener.Accept()
}

func TestPersistentRuntime_WorkerFailureDrainsHandlers(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	gate := make(chan struct{})
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	address := listener.Addr().String()
	runtime, err := startRuntime(ctx, runtimeConfig{DataRoot: privateTestRoot(t), ListenAddress: address, Origin: "http://" + address, SessionToken: testSessionToken, SessionActor: "local-operator", ShutdownWindow: 20 * time.Millisecond}, workerGatedListener{listener, gate})
	if err != nil {
		listener.Close()
		t.Fatal(err)
	}
	entered, canceled, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	runtime.handlers.next = http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(entered)
		<-request.Context().Done()
		close(canceled)
		<-release
		close(finished)
	})
	close(gate)
	client := &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 3 * time.Second}
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		response, _ := client.Get("http://" + address + "/blocked")
		if response != nil {
			response.Body.Close()
		}
	}()
	timeout, stop := context.WithTimeout(t.Context(), 3*time.Second)
	defer stop()
	releaseHandler := sync.OnceFunc(func() { close(release) })
	defer func() {
		releaseHandler()
		cancel()
		<-clientDone
		client.CloseIdleConnections()
		_ = runtime.Wait(timeout)
	}()
	select {
	case <-entered:
	case <-timeout.Done():
		t.Fatal("handler never entered")
	}
	if err := runtime.store.Close(); err != nil {
		t.Fatal(err)
	} // actual poller storage failure
	result := make(chan error, 1)
	go func() { result <- runtime.Wait(timeout) }()
	select {
	case <-canceled:
	case <-timeout.Done():
		t.Fatal("worker failure did not cancel handler")
	}
	// Wait until bounded Shutdown has forced socket closure. The admitted handler
	// is deliberately still unwinding: resources must stay open until it returns.
	select {
	case <-clientDone:
	case <-timeout.Done():
		t.Fatal("forced shutdown did not close client")
	}
	select {
	case err := <-result:
		t.Fatalf("Wait returned before handler drain: %v", err)
	default:
	}
	if _, err := runtime.artifacts.root.Stat("."); err != nil {
		t.Fatalf("artifact store closed early: %v", err)
	}
	releaseHandler()
	select {
	case <-finished:
	case <-timeout.Done():
		t.Fatal("handler did not finish")
	}
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("worker failure was hidden")
		}
	case <-timeout.Done():
		t.Fatal("Wait did not join")
	}
	if _, err := runtime.artifacts.root.Stat("."); err == nil {
		t.Fatal("artifact store remained open after join")
	}
}

func (clock *workerClock) Now() time.Time { return clock.now }

type admittedTestSpecification struct{}

func (admittedTestSpecification) ValidFor(domain.ProjectID, domain.WorkItemID, []port.ACRequirement) bool {
	return true
}

type workerFixture struct {
	worker    persistentWorker
	artifacts *localArtifactStore
	root      string
	run       domain.RunID
	clock     *workerClock
}

func newWorkerFixture(t *testing.T) *workerFixture {
	t.Helper()
	root := privateTestRoot(t)
	clock := &workerClock{now: time.Now().UTC()}
	if err := ensurePrivateDirectory(filepath.Join(root, "state")); err != nil {
		t.Fatal(err)
	}
	store, err := sqlite.OpenAtRootWithClock(t.Context(), root, filepath.Join(root, "state", "taskboard.sqlite"), clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	artifacts, err := newLocalArtifactStore(filepath.Join(root, "artifacts", "sha256"))
	if err != nil {
		t.Fatal(err)
	}
	fixture := &workerFixture{root: root, clock: clock, artifacts: artifacts}
	fixture.bind(t, store)
	t.Cleanup(func() { _ = fixture.worker.store.Close(); _ = artifacts.Close() })
	app := fixture.worker.commands
	metadata := func(n int, version uint64) command.Metadata {
		return command.Metadata{CommandID: fmt.Sprintf("cmd_000000000%d", n), IdempotencyKey: fmt.Sprintf("00000000-0000-4000-8000-%012d", n), ExpectedVersion: version, IssuedAt: clock.Now(), CorrelationID: "worker-test"}
	}
	check := func(_ command.Outcome, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	check(app.CreateProject(t.Context(), "operator", command.CreateProject{Metadata: metadata(1, 0), ProjectID: testProjectID, Name: "Worker fixture", RepositoryRoot: root, ApprovedRef: "main"}))
	ac := domain.HashString("worker AC")
	err = store.Within(t.Context(), func(tx port.Transaction) error {
		if err := tx.StoreACRevision(t.Context(), port.ACRevision{ID: "acr_worker", ProjectID: testProjectID, ACID: "AC-1", Digest: ac, Content: []byte("worker AC"), CreatedAtNS: clock.Now().UnixNano()}); err != nil {
			return err
		}
		return tx.StoreDependencyRevision(t.Context(), port.DependencyRevision{ProjectID: testProjectID, Digest: domain.HashString("graph"), Content: []byte("graph"), CreatedAtNS: clock.Now().UnixNano()})
	})
	if err != nil {
		t.Fatal(err)
	}
	check(app.CreateWorkItem(t.Context(), "operator", command.CreateWorkItem{Metadata: metadata(2, 0), ProjectID: testProjectID, WorkItemID: "wi_0000000001", Title: "Worker", Goal: "Execute once", OwnerID: "operator", RequiredACRevisions: []command.ACRevision{{ACID: "AC-1", RevisionDigest: ac}}}))
	check(app.MarkReady(t.Context(), "operator", command.MarkReady{Metadata: metadata(3, 1), ProjectID: testProjectID, WorkItemID: "wi_0000000001"}))
	check(app.DispatchRun(t.Context(), "operator", command.DispatchRun{Metadata: metadata(4, 2), ProjectID: testProjectID, WorkItemID: "wi_0000000001", AdapterID: fake.AdapterID, ScenarioID: "local-success"}))
	candidates, err := store.DispatchCandidates(t.Context(), clock.Now(), 1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("pending: %v %v", candidates, err)
	}
	fixture.run = candidates[0].Run.ID
	return fixture
}

func (fixture *workerFixture) bind(t *testing.T, store *sqlite.Store) {
	t.Helper()
	adapter, err := newLocalFakeAdapter()
	if err != nil {
		t.Fatal(err)
	}
	app, err := service.New(store, fixture.clock, cryptoIDSource{}, adapter, fixture.artifacts, httpapi.NewHub(), service.Config{Operator: "operator", IdempotencyTTL: time.Hour, Specification: admittedTestSpecification{}, Completion: service.CompletionPolicy{RevisionDigest: domain.HashString("policy"), RecipeDigest: domain.HashString("recipe"), Checks: map[domain.ACID]service.VerificationRule{"AC-1": {VerifierClass: "independent"}}}})
	if err != nil {
		t.Fatal(err)
	}
	fixture.worker = persistentWorker{store: store, commands: app, executor: adapter, clock: fixture.clock, holder: "worker"}
}
func (fixture *workerFixture) reopen(t *testing.T) {
	t.Helper()
	if err := fixture.worker.store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := sqlite.OpenAtRootWithClock(t.Context(), fixture.root, filepath.Join(fixture.root, "state", "taskboard.sqlite"), fixture.clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	fixture.bind(t, store)
}
func (fixture *workerFixture) authority(t *testing.T) port.RunAuthority {
	t.Helper()
	authority, err := fixture.worker.commands.ReadRunAuthority(t.Context(), testProjectID, fixture.run)
	if err != nil {
		t.Fatal(err)
	}
	return authority
}

func TestPersistentRuntime_ExecutesPendingFakeOnce(t *testing.T) {
	fixture := newWorkerFixture(t)
	before := fixture.authority(t)
	if err := fixture.worker.scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	after := fixture.authority(t)
	if after.Run.ObservedState != "Succeeded" || after.Run.SideEffectOutcome != "Confirmed" || after.Lease.Fence.Epoch != 1 {
		t.Fatalf("authority: %+v", after)
	}
	if after.AuditCount != before.AuditCount+4 {
		t.Fatalf("want one claim and three observations: before=%d after=%d", before.AuditCount, after.AuditCount)
	}
	reader, err := fixture.artifacts.Open(t.Context(), domain.HashString("local fake result\n"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(reader)
	reader.Close()
	if err != nil || string(data) != "local fake result\n" {
		t.Fatalf("artifact %q %v", data, err)
	}
	fixture.clock.now = fixture.clock.now.Add(time.Hour)
	if err := fixture.worker.scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	repeated := fixture.authority(t)
	if repeated.AuditCount != after.AuditCount || repeated.Lease.Fence != after.Lease.Fence {
		t.Fatal("completed run dispatched again")
	}
	board, err := fixture.worker.store.ReadBoard(t.Context(), testProjectID)
	if err != nil || len(board.Items) != 1 {
		t.Fatalf("board: %v", err)
	}
	if board.Items[0].Item.Phase() == domain.PhaseDone {
		t.Fatal("Run success implied Done")
	}
}

func TestPersistentRuntime_RestartPendingAndClaimed(t *testing.T) {
	for _, claimed := range []bool{false, true} {
		t.Run(fmt.Sprint(claimed), func(t *testing.T) {
			fixture := newWorkerFixture(t)
			if claimed {
				_, err := fixture.worker.commands.ClaimDispatch(t.Context(), "old-worker", service.ClaimDispatchRequest{ProjectID: testProjectID, RunID: fixture.run, Holder: "old-worker", ExpectedRestoreGeneration: 1, LeaseDuration: workerLeaseDuration})
				if err != nil {
					t.Fatal(err)
				}
			}
			before := fixture.authority(t)
			fixture.reopen(t)
			if err := fixture.worker.scan(t.Context()); err != nil {
				t.Fatal(err)
			}
			if !claimed {
				if fixture.authority(t).Run.ObservedState != "Succeeded" {
					t.Fatal("restart lost pending work")
				}
				return
			}
			if got := fixture.authority(t); got.AuditCount != before.AuditCount {
				t.Fatal("live claimed work was touched")
			}
			fixture.clock.now = fixture.clock.now.Add(time.Minute)
			if err := fixture.worker.scan(t.Context()); err != nil {
				t.Fatal(err)
			}
			after := fixture.authority(t)
			if after.Run.ReconciliationState != "NeedsReconcile" || after.Run.SideEffectOutcome != "OutcomeUnknown" || after.Lease.Fence.Epoch != 2 || after.Run.ObservedState == "Succeeded" {
				t.Fatalf("unsafe recovery: %+v", after)
			}
			fixture.clock.now = fixture.clock.now.Add(time.Hour)
			if err := fixture.worker.scan(t.Context()); err != nil {
				t.Fatal(err)
			}
			if fixture.authority(t).AuditCount != after.AuditCount {
				t.Fatal("repeated reconciliation succession")
			}
		})
	}
}

func TestPersistentRuntime_ShutdownJoinsWorker(t *testing.T) {
	runtime, cancel, client, _, _ := startTestRuntime(t, privateTestRoot(t))
	client.CloseIdleConnections()
	cancel()
	waitRuntime(t, runtime)
	select {
	case <-runtime.waitDone:
	default:
		t.Fatal("Wait returned before resource closure")
	}
	if _, err := runtime.store.DispatchCandidates(t.Context(), time.Now(), 1); err == nil {
		t.Fatal("store still open")
	}
	// A storage failure must stop the worker; never silently spin or redispatch.
	err := (persistentWorker{store: runtime.store, clock: systemClock{}}).run(t.Context())
	if err == nil || errors.Is(err, context.Canceled) {
		t.Fatalf("worker failure was hidden: %v", err)
	}
}

func TestPersistentRuntime_ProcessPollerAndHTTP(t *testing.T) {
	fixture := newWorkerFixture(t)
	if err := fixture.worker.store.Close(); err != nil {
		t.Fatal(err)
	}
	runtime, cancel, client, baseURL, config := startTestRuntime(t, fixture.root)
	t.Cleanup(func() { client.CloseIdleConnections(); cancel(); waitRuntime(t, runtime) })
	ctx, stop := context.WithTimeout(t.Context(), 3*time.Second)
	defer stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	var board []byte
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/v1/projects/"+testProjectID+"/board", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: config.SessionToken})
		board = requireHTTPBody(t, client, req, http.StatusOK)
		if bytes.Contains(board, []byte(`"observed_state":"Succeeded"`)) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatalf("process poller did not execute pending work: %s", board)
		case <-ticker.C:
		}
	}
	if bytes.Contains(board, []byte(`"phase":"Done"`)) {
		t.Fatal("automatic Done")
	}
	for _, cursor := range []string{"", "1:0"} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/v1/projects/prj_0000000000/events", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: config.SessionToken})
		if cursor != "" {
			req.Header.Set("Last-Event-ID", cursor)
		}
		assertHTTPStatus(t, client, req, http.StatusNotFound)
	}
}

func TestPersistentRuntime_ConcurrentScansClaimOnce(t *testing.T) {
	fixture := newWorkerFixture(t)
	before := fixture.authority(t)
	results := make(chan error, 2)
	for range 2 {
		go func() { results <- fixture.worker.scan(t.Context()) }()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	after := fixture.authority(t)
	if after.Run.ObservedState != "Succeeded" || after.Lease.Fence.Epoch != 1 || after.AuditCount != before.AuditCount+4 {
		t.Fatalf("not a single execution: %+v", after)
	}
}
