package httpapi

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/testfixture"
)

type completionClock struct{}

func (completionClock) Now() time.Time { return time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC) }

type completionIDs struct{ count int }

func (s *completionIDs) Next(kind port.IDKind) (string, error) {
	s.count++
	if kind == port.IDRun {
		return "run_01ARZ3NDEK", nil
	}
	return fmt.Sprintf("http-completion-%s-%d", kind, s.count), nil
}

type completionExecutor struct{}

func (completionExecutor) Declaration() port.ExecutorDeclaration {
	return port.ExecutorDeclaration{AdapterID: "fake/v1", AdapterVersion: "1", Capabilities: []string{"start_ack"}, Scenarios: []string{"success"}}
}

type completionArtifacts struct{ calls int }

func (a *completionArtifacts) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	a.calls++
	return domain.Digest{}, 0, port.ErrNotFound
}
func (a *completionArtifacts) Open(context.Context, domain.Digest) (io.ReadCloser, error) {
	a.calls++
	return nil, port.ErrNotFound
}

type completionSink struct{}

func (completionSink) PublishCommitted(context.Context, port.CommittedProjection) error { return nil }

type completionSpecification struct{}

func (completionSpecification) ValidFor(domain.ProjectID, domain.WorkItemID, []port.ACRequirement) bool {
	return true
}

// Admission setup is explicitly a persistence fixture. The command service,
// command result replay and SQLite reopen below are real public boundaries.
func TestCompletionHTTP_RealSQLiteCancellationReplay(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "state.db")
	clock := completionClock{}
	store, err := sqlite.OpenAtRootWithClock(t.Context(), root, path, clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	ids := &completionIDs{}
	artifacts := &completionArtifacts{}
	policy := service.CompletionPolicy{RevisionDigest: domain.HashString("http-policy"), RecipeDigest: domain.HashString("http-recipe"), Checks: map[domain.ACID]service.VerificationRule{"AC1": {VerifierClass: "human", Independent: true, EnvironmentDigest: domain.HashString(port.FakeEnvironmentProfile)}}}
	application := func() *service.Service {
		s, e := service.New(store, clock, ids, completionExecutor{}, artifacts, completionSink{}, service.Config{Operator: "actor", IdempotencyTTL: time.Hour, Specification: completionSpecification{}, Completion: policy})
		if e != nil {
			t.Fatal(e)
		}
		return s
	}
	svc := application()
	metadata := func(i int, version uint64) command.Metadata {
		return command.Metadata{CommandID: fmt.Sprintf("cmd_%010d", i), IdempotencyKey: fmt.Sprintf("00000000-0000-4000-8000-%012d", i), ExpectedVersion: version, IssuedAt: clock.Now(), CorrelationID: "fixture"}
	}
	if _, err = svc.CreateProject(t.Context(), "actor", command.CreateProject{Metadata: metadata(1, 0), ProjectID: testProjectID, Name: "Fixture", RepositoryRoot: "display", ApprovedRef: "main"}); err != nil {
		t.Fatal(err)
	}
	work := domain.WorkItemID("wi_01ARZ3NDEK")
	if _, err = svc.CreateWorkItem(t.Context(), "actor", command.CreateWorkItem{Metadata: metadata(2, 0), ProjectID: testProjectID, WorkItemID: work, Title: "Fixture", Goal: "Fixture", OwnerID: "actor"}); err != nil {
		t.Fatal(err)
	}
	if err = testfixture.Accept(t.Context(), store, testProjectID, "actor", policy.RevisionDigest, policy.RecipeDigest, "AC1", []byte("explicit storage fixture"), []domain.WorkItemID{work}, clock.Now().UnixNano()); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.MarkReady(t.Context(), "actor", command.MarkReady{Metadata: metadata(3, 2), ProjectID: testProjectID, WorkItemID: work}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.DispatchRun(t.Context(), "actor", command.DispatchRun{Metadata: metadata(4, 3), ProjectID: testProjectID, WorkItemID: work, AdapterID: "fake/v1", ScenarioID: "success"}); err != nil {
		t.Fatal(err)
	}
	versionFour := func(r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(strings.NewReader(strings.Replace(string(b), `"expected_version":1`, `"expected_version":4`, 1)))
	}
	payload := completionFixtures()["RequestCancellation"]
	first := completionRequest(t, "RequestCancellation", payload, svc, versionFour)
	if first.Code != 200 {
		t.Fatalf("cancel %d %s", first.Code, first.Body)
	}
	var before port.RunAuthority
	if err = store.Within(t.Context(), func(tx port.Transaction) error {
		var e error
		before, e = tx.(port.AuthorityTransaction).LoadRunAuthority(t.Context(), testProjectID, "run_01ARZ3NDEK")
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if before.Run.DesiredAction != "CancelRequested" || before.Run.ObservedState != "Unknown" {
		t.Fatalf("invented confirmed stop: %+v", before.Run)
	}
	snapshot, err := (PersistedProjections{Store: store}).Snapshot(t.Context(), testProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = sqlite.OpenAtRootWithClock(t.Context(), root, path, clock.Now)
	if err != nil {
		t.Fatal(err)
	}
	svc = application()
	replay := completionRequest(t, "RequestCancellation", payload, svc, versionFour)
	if replay.Code != 200 || replay.Body.String() != first.Body.String() {
		t.Fatalf("replay changed %d %s", replay.Code, replay.Body)
	}
	stored, err := (UnitCommandResults{Unit: store}).LoadCommandResult(t.Context(), testProjectID, testCommandID)
	if err != nil || string(stored.Payload) != first.Body.String() {
		t.Fatalf("stored replay changed: %v", err)
	}
	if err = store.Within(t.Context(), func(tx port.Transaction) error {
		after, e := tx.(port.AuthorityTransaction).LoadRunAuthority(t.Context(), testProjectID, "run_01ARZ3NDEK")
		if e == nil && after != before {
			t.Errorf("replay mutated Run authority")
		}
		return e
	}); err != nil {
		t.Fatal(err)
	}

	afterSnapshot, err := (PersistedProjections{Store: store}).Snapshot(t.Context(), testProjectID)
	if err != nil || afterSnapshot.Cursor != snapshot.Cursor || !bytes.Equal(afterSnapshot.Payload, snapshot.Payload) {
		t.Fatal("replay changed durable projection")
	}
	conflict := completionRequest(t, "RequestCancellation", strings.Replace(payload, "operator intent", "different intent", 1), svc, versionFour)
	if conflict.Code != 409 {
		t.Fatalf("changed intent did not conflict: %d %s", conflict.Code, conflict.Body)
	}
	denied, err := service.New(store, clock, ids, completionExecutor{}, artifacts, completionSink{}, service.Config{Operator: "different-operator", IdempotencyTTL: time.Hour, Specification: completionSpecification{}, Completion: policy})
	if err != nil {
		t.Fatal(err)
	}
	for operation, wire := range completionFixtures() {
		w := completionRequest(t, operation, wire, denied, nil)
		if w.Code != 403 {
			t.Fatalf("trusted actor did not control %s: %d %s", operation, w.Code, w.Body)
		}
	}
	if artifacts.calls != 0 {
		t.Fatal("cancellation manufactured artifact I/O")
	}
}
