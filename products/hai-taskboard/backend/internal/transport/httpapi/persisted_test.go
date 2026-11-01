package httpapi

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type persistedReadStub struct {
	board  port.PersistedBoard
	replay port.PersistedReplay
	err    error
}

func (stub persistedReadStub) ReadBoard(context.Context, domain.ProjectID) (port.PersistedBoard, error) {
	return stub.board, stub.err
}
func (stub persistedReadStub) ReadProjectionEvents(context.Context, domain.ProjectID, port.Cursor) (port.PersistedReplay, error) {
	return stub.replay, stub.err
}

func TestPersistedProjection_BoardWireAndReplayValidation(t *testing.T) {
	item, err := domain.NewWorkItem("wi_0000000001", testProjectID, domain.PhaseDraft, 1)
	if err != nil {
		t.Fatal(err)
	}
	item, err = item.AddBlocker(1, domain.Blocker{ID: "blocking", Reason: "waiting"})
	if err != nil {
		t.Fatal(err)
	}
	stub := persistedReadStub{board: port.PersistedBoard{
		ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 4}, MinimumSequence: 1,
		Items: []port.BoardWorkItem{{ID: item.ID(), Item: item, Title: "Blocked item", OwnerID: "operator", RequiredACCount: 2, CurrentRun: &port.BoardRun{ID: "run_0000000001", DesiredAction: "CancelRequested", DispatchState: "Acknowledged", ObservedState: "Unknown", ReconciliationState: "NeedsReconcile", SideEffectOutcome: "OutcomeUnknown"}}},
	}}
	source := PersistedProjections{Store: stub}
	snapshot, err := source.Snapshot(t.Context(), testProjectID)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		APIVersion string `json:"api_version"`
		Projection struct {
			Kind           string           `json:"kind"`
			ProjectID      domain.ProjectID `json:"project_id"`
			Lanes          []persistedLane  `json:"lanes"`
			AttentionCount int              `json:"attention_count"`
		} `json:"projection"`
		Cursor projectionCursor `json:"cursor"`
	}
	if err := json.Unmarshal(snapshot.Payload, &wire, json.RejectUnknownMembers(true)); err != nil {
		t.Fatal(err)
	}
	if wire.APIVersion != "v1" || wire.Projection.Kind != "project_board/v1" || wire.Projection.ProjectID != testProjectID || len(wire.Projection.Lanes) != 8 || wire.Projection.AttentionCount != 1 || wire.Cursor.EventSequence != snapshot.Cursor.Sequence {
		t.Fatalf("wire=%s", snapshot.Payload)
	}
	card := wire.Projection.Lanes[0].Items[0]
	if card.Phase != domain.PhaseDraft || card.ActiveBlockerCount != 1 || card.RequiredACCount != 2 || card.EffectiveSatisfied || card.CoveredACCount != 0 || len(card.Conditions) != 3 || card.CurrentRun.ReconciliationState != "NeedsReconcile" {
		t.Fatalf("card=%+v", card)
	}
	for _, lane := range wire.Projection.Lanes[1:] {
		if lane.Items == nil || len(lane.Items) != 0 {
			t.Fatalf("empty lane=%+v", lane)
		}
	}
	if strings.Contains(string(snapshot.Payload), `"items":null`) {
		t.Fatalf("null array: %s", snapshot.Payload)
	}

	for _, payload := range []string{
		`{"api_version":"v1","event_type":"project.changed","project_id":"prj_01ARZ3NDEK","resource_kind":"project","resource_id":"prj_01ARZ3NDEK","resource_version":1}`,
		`{"api_version":"v1","project_id":"prj_01ARZ3NDEK"}`,
		`{"api_version":"v1","event_type":"project.changed","project_id":"prj_0000000002","resource_kind":"project","resource_id":"prj_0000000002","resource_version":1}`,
	} {
		stub.replay = port.PersistedReplay{Cursor: port.Cursor{Epoch: 1, Sequence: 1}, MinimumSequence: 1, Events: []port.CommittedProjection{{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 1}, Payload: []byte(payload)}}}
		source.Store = stub
		replay, err := source.Replay(t.Context(), testProjectID, port.Cursor{Epoch: 1})
		valid := strings.Contains(payload, `"resource_version":1`) && !strings.Contains(payload, "prj_0000000002")
		if valid && (err != nil || !validReplay(testProjectID, port.Cursor{Epoch: 1}, replay)) {
			t.Fatalf("valid replay=%+v %v", replay, err)
		}
		if !valid && err == nil {
			t.Fatalf("corrupt payload accepted: %s", payload)
		}
	}
	stub.err = port.ErrNotFound
	source.Store = stub
	if _, err := source.Snapshot(t.Context(), testProjectID); !errors.Is(err, ErrProjectionNotFound) {
		t.Fatalf("snapshot missing=%v", err)
	}
	if _, err := source.Replay(t.Context(), testProjectID, port.Cursor{Epoch: 1}); !errors.Is(err, ErrProjectionNotFound) {
		t.Fatalf("replay missing=%v", err)
	}
}
