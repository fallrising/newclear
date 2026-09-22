package fake

import (
	"context"
	"errors"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestFakeAdapter_CapabilitiesFailClosed(t *testing.T) {
	scenario := mustScenario(t, "basic", nil, []Step{{Tick: 0, Kind: ObservationDispatchReceived}})

	if _, err := NewAdapter([]Capability{CapabilityStartAck, CapabilityStartAck}, []Scenario{scenario}, nil); !errors.Is(err, ErrInvalidScenario) {
		t.Fatalf("duplicate capability error = %v", err)
	}
	if _, err := NewAdapter([]Capability{"shell"}, []Scenario{scenario}, nil); !errors.Is(err, ErrInvalidScenario) {
		t.Fatalf("unknown capability error = %v", err)
	}
	lookupScenario := mustScenario(t, "lookup", []Capability{CapabilityLookup}, []Step{
		{Tick: 0, Kind: ObservationDispatchReceived},
		{Tick: 1, Kind: ObservationLookupUnknown},
	})
	if _, err := NewAdapter(nil, []Scenario{lookupScenario}, nil); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("undeclared scenario capability error = %v", err)
	}

	capabilities := []Capability{CapabilityStartAck, CapabilityHeartbeat}
	adapter, err := NewAdapter(capabilities, []Scenario{scenario}, nil)
	if err != nil {
		t.Fatal(err)
	}
	capabilities[0] = CapabilityLookup
	declaration := adapter.Declaration()
	if declaration.AdapterID != AdapterID || declaration.AdapterVersion != AdapterVersion ||
		!slices.Equal(declaration.Capabilities, []string{"heartbeat", "start_ack"}) {
		t.Fatalf("declaration = %#v", declaration)
	}
	declaration.Capabilities[0] = "network"
	if adapter.Declaration().Capabilities[0] != "heartbeat" {
		t.Fatal("declaration retained caller alias")
	}

	session, _, err := adapter.Dispatch(t.Context(), DispatchRequest{Fence: testFence(), ScenarioID: scenario.ID()})
	if err != nil {
		t.Fatal(err)
	}
	nextBefore, tickBefore := session.Cursor()
	transcriptBefore := session.Transcript()
	if _, err := session.Lookup(t.Context(), TickRequest{Fence: testFence(), Tick: 9}); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("unsupported lookup error = %v", err)
	}
	nextAfter, tickAfter := session.Cursor()
	if nextAfter != nextBefore || tickAfter != tickBefore || !reflect.DeepEqual(session.Transcript(), transcriptBefore) || len(session.Rejections()) != 0 {
		t.Fatal("unsupported operation mutated the session")
	}
}

func TestFakeAdapter_ScriptedStartHeartbeatCheckpointAndUnknown(t *testing.T) {
	artifactBytes := []byte("checkpoint-v1")
	scenario := mustScenario(t, "recovery", allCapabilities(), []Step{
		{Tick: 0, Kind: ObservationDispatchReceived, Message: "received"},
		{Tick: 1, Kind: ObservationStartAcknowledged, Message: "started"},
		{Tick: 2, Kind: ObservationHeartbeat, Message: "alive"},
		{Tick: 3, Kind: ObservationCheckpoint, Artifact: &Artifact{Name: "checkpoints/state.json", MediaType: "application/json", Bytes: artifactBytes}},
		{Tick: 4, Kind: ObservationTimeout, Message: "deadline"},
		{Tick: 5, Kind: ObservationLookupUnknown, Message: "handle unknown"},
	})
	artifactBytes[0] = 'X'

	firstWriter := &recordingWriter{}
	first := runRecoveryScenario(t, scenario, firstWriter)
	secondWriter := &recordingWriter{}
	second := runRecoveryScenario(t, scenario, secondWriter)
	if !reflect.DeepEqual(first, second) || !reflect.DeepEqual(firstWriter.calls, secondWriter.calls) {
		t.Fatalf("nondeterministic transcript:\n%#v\n%#v", first, second)
	}
	if got := string(first[3].ArtifactBytes); got != "checkpoint-v1" {
		t.Fatalf("artifact bytes = %q", got)
	}
	first[3].ArtifactBytes[0] = 'Z'
	if got := string(firstWriter.calls[0].bytes); got != "checkpoint-v1" {
		t.Fatalf("writer retained output alias: %q", got)
	}
}

func TestRunRecovery_ExpiryDoesNotImplyStoppedOrRetry(t *testing.T) {
	fence := testFence()
	worker, err := NewWorker(fence)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.Accept(observation(fence, 1, 0, ObservationDispatchReceived)); err != nil {
		t.Fatal(err)
	}
	if err := worker.ExpireLease(fence); err != nil {
		t.Fatal(err)
	}
	before := worker.Snapshot()
	if before.Lifecycle != LifecycleNeedsReconcile || before.SideEffectOutcome != SideEffectUnknown || !before.LeaseExpired || before.Redispatches != 0 {
		t.Fatalf("expiry snapshot = %#v", before)
	}
	if err := worker.Accept(observation(fence, 2, 1, ObservationTerminalSuccess)); !errors.Is(err, ErrTerminalPublication) {
		t.Fatalf("late terminal error = %v", err)
	}
	after := worker.Snapshot()
	if after.NextSequence != before.NextSequence || after.Lifecycle != before.Lifecycle || after.SideEffectOutcome != before.SideEffectOutcome || after.Redispatches != 0 {
		t.Fatalf("late result changed accepted state: before=%#v after=%#v", before, after)
	}
	if len(after.Rejections) != len(before.Rejections)+1 {
		t.Fatal("late terminal rejection was not recorded")
	}
}

func TestAdapterObservation_RejectsStaleEpochOrRestoreGeneration(t *testing.T) {
	expected := testFence()
	worker, err := NewWorker(expected)
	if err != nil {
		t.Fatal(err)
	}
	attacks := []Fence{
		withFence(expected, func(value *Fence) { value.RunID = "other-run" }),
		withFence(expected, func(value *Fence) { value.InputDigest = domain.HashString("other-input") }),
		withFence(expected, func(value *Fence) { value.LeaseHolder = "other-worker" }),
		withFence(expected, func(value *Fence) { value.LeaseEpoch-- }),
		withFence(expected, func(value *Fence) { value.RestoreGeneration++ }),
	}
	for _, attack := range attacks {
		if err := worker.Accept(observation(attack, 1, 0, ObservationDispatchReceived)); !errors.Is(err, ErrFenceRejected) {
			t.Fatalf("fence %#v error = %v", attack, err)
		}
	}
	snapshot := worker.Snapshot()
	if snapshot.NextSequence != 1 || snapshot.Lifecycle != LifecycleQueued || len(snapshot.Accepted) != 0 || len(snapshot.Rejections) != len(attacks) {
		t.Fatalf("rejected observations changed accepted state: %#v", snapshot)
	}
	if err := worker.Accept(observation(expected, 1, 0, ObservationDispatchReceived)); err != nil {
		t.Fatal(err)
	}
	if got := worker.Snapshot(); got.NextSequence != 2 || got.Lifecycle != LifecycleStarting {
		t.Fatalf("current observation snapshot = %#v", got)
	}

	scenario := mustScenario(t, "fenced-session", nil, []Step{{Tick: 0, Kind: ObservationDispatchReceived}})
	adapter, err := NewAdapter(nil, []Scenario{scenario}, nil)
	if err != nil {
		t.Fatal(err)
	}
	session, _, err := adapter.Dispatch(t.Context(), DispatchRequest{Fence: expected, ScenarioID: scenario.ID()})
	if err != nil {
		t.Fatal(err)
	}
	next, tick := session.Cursor()
	if _, err := session.Poll(t.Context(), TickRequest{Fence: attacks[4], Tick: 3}); !errors.Is(err, ErrFenceRejected) {
		t.Fatalf("session stale generation error = %v", err)
	}
	gotNext, gotTick := session.Cursor()
	if gotNext != next || gotTick != tick || len(session.Rejections()) != 1 {
		t.Fatal("rejected session request advanced cursor")
	}
}

func TestFakeAdapter_HasNoShellNetworkOrExternalWriteCapability(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	entries, err := os.ReadDir(filepath.Dir(currentFile))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), filepath.Join(filepath.Dir(currentFile), entry.Name()), nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imported := range parsed.Imports {
			name, err := strconv.Unquote(imported.Path.Value)
			if err != nil {
				t.Fatal(err)
			}
			forbidden := name == "os" || name == "os/exec" || name == "syscall" || name == "database/sql" ||
				name == "net" || strings.HasPrefix(name, "net/") || strings.Contains(name, "/domain/sqlite") ||
				strings.Contains(name, "/transport/")
			if forbidden {
				t.Errorf("production Fake import %q in %s", name, entry.Name())
			}
		}
	}

	for _, name := range []string{"..", "../escape", "/absolute", `C:\\host`, "https://host/object", "a/../b", ""} {
		_, err := NewScenario("bad-artifact", nil, []Step{
			{Tick: 0, Kind: ObservationDispatchReceived},
			{Tick: 1, Kind: ObservationTerminalSuccess, Artifact: &Artifact{Name: name, MediaType: "text/plain", Bytes: []byte("x")}},
		})
		if !errors.Is(err, ErrInvalidScenario) {
			t.Errorf("artifact name %q error = %v", name, err)
		}
	}
}

func TestFakeAdapter_CancelLookupAliasAndInvalidScenarios(t *testing.T) {
	lookup := mustScenario(t, "lost-start", []Capability{CapabilityStartAck, CapabilityLookup}, []Step{
		{Tick: 0, Kind: ObservationDispatchReceived},
		{Tick: 1, Kind: ObservationStartLost},
		{Tick: 2, Kind: ObservationLookupUnknown},
	})
	adapter, err := NewAdapter([]Capability{CapabilityLookup, CapabilityStartAck}, []Scenario{lookup}, nil)
	if err != nil {
		t.Fatal(err)
	}
	session, dispatched, err := adapter.Dispatch(t.Context(), DispatchRequest{Fence: testFence(), ScenarioID: lookup.ID()})
	if err != nil {
		t.Fatal(err)
	}
	worker, _ := NewWorker(testFence())
	acceptAll(t, worker, dispatched)
	started, err := session.Poll(t.Context(), TickRequest{Fence: testFence(), Tick: 1})
	if err != nil {
		t.Fatal(err)
	}
	acceptAll(t, worker, started)
	lookedUp, err := session.Lookup(t.Context(), TickRequest{Fence: testFence(), Tick: 2})
	if err != nil {
		t.Fatal(err)
	}
	acceptAll(t, worker, lookedUp)
	if got := worker.Snapshot(); got.Lifecycle != LifecycleNeedsReconcile || got.SideEffectOutcome != SideEffectUnknown || got.Redispatches != 0 {
		t.Fatalf("lookup unknown snapshot = %#v", got)
	}
	if _, err := session.Poll(t.Context(), TickRequest{Fence: testFence(), Tick: 1}); !errors.Is(err, ErrTickRegressed) {
		t.Fatalf("regressed tick error = %v", err)
	}

	cancel := mustScenario(t, "cancel", []Capability{CapabilityCancelAck}, []Step{
		{Tick: 0, Kind: ObservationDispatchReceived},
		{Tick: 2, Kind: ObservationCancelAcknowledged},
	})
	cancelAdapter, err := NewAdapter([]Capability{CapabilityCancelAck}, []Scenario{cancel}, nil)
	if err != nil {
		t.Fatal(err)
	}
	cancelSession, first, err := cancelAdapter.Dispatch(t.Context(), DispatchRequest{Fence: testFence(), ScenarioID: cancel.ID()})
	if err != nil {
		t.Fatal(err)
	}
	cancelWorker, _ := NewWorker(testFence())
	acceptAll(t, cancelWorker, first)
	if err := cancelWorker.RequestCancellation(testFence()); err != nil {
		t.Fatal(err)
	}
	if pending := cancelWorker.Snapshot(); pending.Lifecycle == LifecycleCanceled || pending.SideEffectOutcome != SideEffectUnknown {
		t.Fatalf("unconfirmed cancellation snapshot = %#v", pending)
	}
	acknowledgement, err := cancelSession.RequestCancel(t.Context(), TickRequest{Fence: testFence(), Tick: 2})
	if err != nil {
		t.Fatal(err)
	}
	acceptAll(t, cancelWorker, acknowledgement)
	if got := cancelWorker.Snapshot(); got.Lifecycle != LifecycleCanceled || got.SideEffectOutcome != SideEffectConfirmed || !got.CancelRequested {
		t.Fatalf("cancel snapshot = %#v", got)
	}

	invalid := [][]Step{
		nil,
		{{Tick: 1, Kind: ObservationDispatchReceived}},
		{{Tick: 0, Kind: ObservationHeartbeat}},
		{{Tick: 0, Kind: ObservationDispatchReceived}, {Tick: 0, Kind: ObservationDispatchReceived}},
		{{Tick: 0, Kind: ObservationDispatchReceived}, {Tick: 2, Kind: ObservationHeartbeat}, {Tick: 1, Kind: ObservationTerminalSuccess}},
		{{Tick: 0, Kind: "executable_callback"}},
	}
	for _, steps := range invalid {
		if _, err := NewScenario("invalid", nil, steps); !errors.Is(err, ErrInvalidScenario) {
			t.Errorf("invalid steps %#v error = %v", steps, err)
		}
	}
}

func TestFakeAdapter_T068FailClosedRegressions(t *testing.T) {
	t.Run("media-type-syntax", func(t *testing.T) {
		for _, mediaType := range []string{"text/", "/plain", "text /plain"} {
			_, err := NewScenario("bad-media", nil, []Step{
				{Tick: 0, Kind: ObservationDispatchReceived},
				{Tick: 1, Kind: ObservationTerminalSuccess, Artifact: &Artifact{Name: "result.txt", MediaType: mediaType, Bytes: []byte("x")}},
			})
			if !errors.Is(err, ErrInvalidScenario) {
				t.Errorf("media type %q error = %v", mediaType, err)
			}
		}
		for _, mediaType := range []string{"text/plain", "application/json", "text/plain; charset=utf-8"} {
			if _, err := NewScenario("valid-media", nil, []Step{
				{Tick: 0, Kind: ObservationDispatchReceived},
				{Tick: 1, Kind: ObservationTerminalSuccess, Artifact: &Artifact{Name: "result.txt", MediaType: mediaType, Bytes: []byte("x")}},
			}); err != nil {
				t.Errorf("valid media type %q error = %v", mediaType, err)
			}
		}
	})

	t.Run("unsupported-operation-precedes-fence", func(t *testing.T) {
		scenario := mustScenario(t, "unsupported", nil, []Step{{Tick: 0, Kind: ObservationDispatchReceived}})
		adapter, err := NewAdapter(nil, []Scenario{scenario}, nil)
		if err != nil {
			t.Fatal(err)
		}
		session, _, err := adapter.Dispatch(t.Context(), DispatchRequest{Fence: testFence(), ScenarioID: scenario.ID()})
		if err != nil {
			t.Fatal(err)
		}
		stale := withFence(testFence(), func(value *Fence) { value.RestoreGeneration++ })
		nextBefore, tickBefore := session.Cursor()
		transcriptBefore := session.Transcript()
		for _, invoke := range []func() error{
			func() error { _, err := session.Lookup(t.Context(), TickRequest{Fence: stale, Tick: 3}); return err },
			func() error {
				_, err := session.RequestCancel(t.Context(), TickRequest{Fence: stale, Tick: 3})
				return err
			},
		} {
			if err := invoke(); !errors.Is(err, ErrCapabilityUnsupported) {
				t.Fatalf("unsupported stale request error = %v", err)
			}
		}
		nextAfter, tickAfter := session.Cursor()
		if nextAfter != nextBefore || tickAfter != tickBefore || !reflect.DeepEqual(session.Transcript(), transcriptBefore) || len(session.Rejections()) != 0 {
			t.Fatal("unsupported stale request mutated session")
		}
	})

	t.Run("invalid-observation-is-visible", func(t *testing.T) {
		worker, err := NewWorker(testFence())
		if err != nil {
			t.Fatal(err)
		}
		if err := worker.Accept(observation(testFence(), 1, 0, ObservationDispatchReceived)); err != nil {
			t.Fatal(err)
		}
		before := worker.Snapshot()
		invalid := observation(testFence(), 2, 1, ObservationCheckpoint)
		invalid.ArtifactName = "state.json"
		invalid.ArtifactBytes = []byte("actual")
		invalid.ArtifactDigest = domain.HashString("different")
		if err := worker.Accept(invalid); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("invalid artifact error = %v", err)
		}
		after := worker.Snapshot()
		if after.NextSequence != before.NextSequence || after.LastTick != before.LastTick || after.Lifecycle != before.Lifecycle ||
			after.SideEffectOutcome != before.SideEffectOutcome || !reflect.DeepEqual(after.Accepted, before.Accepted) || len(after.Rejections) != len(before.Rejections)+1 {
			t.Fatalf("invalid observation state: before=%#v after=%#v", before, after)
		}
	})

	t.Run("terminal-requires-running", func(t *testing.T) {
		for _, terminal := range []ObservationKind{ObservationTerminalSuccess, ObservationTerminalFailure} {
			worker, err := NewWorker(testFence())
			if err != nil {
				t.Fatal(err)
			}
			if err := worker.Accept(observation(testFence(), 1, 0, terminal)); !errors.Is(err, ErrObservationOrder) {
				t.Fatalf("queued %s error = %v", terminal, err)
			}
			rejected := worker.Snapshot()
			if rejected.NextSequence != 1 || rejected.Lifecycle != LifecycleQueued || rejected.SideEffectOutcome != SideEffectNotApplicable || len(rejected.Rejections) != 1 {
				t.Fatalf("queued terminal state = %#v", rejected)
			}
			acceptAll(t, worker, []Observation{
				observation(testFence(), 1, 0, ObservationDispatchReceived),
				observation(testFence(), 2, 1, ObservationStartAcknowledged),
				observation(testFence(), 3, 2, terminal),
			})
			accepted := worker.Snapshot()
			if terminal == ObservationTerminalSuccess && accepted.Lifecycle != LifecycleSucceeded ||
				terminal == ObservationTerminalFailure && accepted.Lifecycle != LifecycleFailed || accepted.SideEffectOutcome != SideEffectConfirmed {
				t.Fatalf("legal terminal state = %#v", accepted)
			}
		}
	})
}

func runRecoveryScenario(t *testing.T, scenario Scenario, writer *recordingWriter) []Observation {
	t.Helper()
	adapter, err := NewAdapter(allCapabilities(), []Scenario{scenario}, writer)
	if err != nil {
		t.Fatal(err)
	}
	session, emitted, err := adapter.Dispatch(t.Context(), DispatchRequest{Fence: testFence(), ScenarioID: scenario.ID()})
	if err != nil {
		t.Fatal(err)
	}
	worker, err := NewWorker(testFence())
	if err != nil {
		t.Fatal(err)
	}
	acceptAll(t, worker, emitted)
	for tick := uint64(1); tick <= 4; tick++ {
		next, err := session.Poll(t.Context(), TickRequest{Fence: testFence(), Tick: tick})
		if err != nil {
			t.Fatal(err)
		}
		acceptAll(t, worker, next)
	}
	lookedUp, err := session.Lookup(t.Context(), TickRequest{Fence: testFence(), Tick: 5})
	if err != nil {
		t.Fatal(err)
	}
	acceptAll(t, worker, lookedUp)
	snapshot := worker.Snapshot()
	if snapshot.Lifecycle != LifecycleNeedsReconcile || snapshot.SideEffectOutcome != SideEffectUnknown || snapshot.Redispatches != 0 {
		t.Fatalf("final snapshot = %#v", snapshot)
	}
	return session.Transcript()
}

func acceptAll(t *testing.T, worker *Worker, observations []Observation) {
	t.Helper()
	for _, current := range observations {
		if err := worker.Accept(current); err != nil {
			t.Fatal(err)
		}
	}
}

func mustScenario(t *testing.T, id string, capabilities []Capability, steps []Step) Scenario {
	t.Helper()
	scenario, err := NewScenario(id, capabilities, steps)
	if err != nil {
		t.Fatal(err)
	}
	return scenario
}

func allCapabilities() []Capability {
	return []Capability{CapabilityStartAck, CapabilityHeartbeat, CapabilityLookup, CapabilityCancelAck, CapabilityDurableCheckpoint}
}

func testFence() Fence {
	return Fence{RunID: "run-1", InputDigest: domain.HashString("input"), LeaseHolder: "worker-1", LeaseEpoch: 4, RestoreGeneration: 2}
}

func withFence(value Fence, change func(*Fence)) Fence {
	change(&value)
	return value
}

func observation(fence Fence, sequence, tick uint64, kind ObservationKind) Observation {
	return Observation{Fence: fence, Sequence: sequence, Tick: tick, Kind: kind}
}

type stageCall struct {
	runID     domain.RunID
	name      string
	mediaType string
	bytes     []byte
}

type recordingWriter struct {
	calls []stageCall
}

func (writer *recordingWriter) Stage(_ context.Context, runID domain.RunID, name, mediaType string, bytes []byte) (domain.Digest, error) {
	writer.calls = append(writer.calls, stageCall{runID: runID, name: name, mediaType: mediaType, bytes: slices.Clone(bytes)})
	return domain.HashBytes(bytes), nil
}

var _ port.Executor = (*Adapter)(nil)
