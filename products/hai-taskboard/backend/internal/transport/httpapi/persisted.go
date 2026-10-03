package httpapi

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"slices"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// PersistedProjections encodes authoritative row reads through an application
// port. It never imports the concrete store or modifies persisted state.
type PersistedProjections struct {
	Store port.PersistedProjectionReader
}

type persistedRun struct {
	ID                  domain.RunID `json:"run_id"`
	DispatchState       string       `json:"dispatch_state"`
	ObservedState       string       `json:"observed_state"`
	ReconciliationState string       `json:"reconciliation_state"`
}

type persistedItem struct {
	ID                 domain.WorkItemID `json:"work_item_id"`
	Title              string            `json:"title"`
	Phase              domain.Phase      `json:"phase"`
	Version            uint64            `json:"version"`
	OwnerID            domain.ActorID    `json:"human_owner_id"`
	EffectiveSatisfied bool              `json:"effective_satisfied"`
	RequiredACCount    int               `json:"required_ac_count"`
	CoveredACCount     int               `json:"covered_ac_count"`
	ActiveBlockerCount int               `json:"active_blocker_count"`
	Conditions         []string          `json:"conditions"`
	CurrentRun         *persistedRun     `json:"current_run,omitempty"`
}

type persistedLane struct {
	Key   string          `json:"key"`
	Items []persistedItem `json:"items"`
}

func (source PersistedProjections) Snapshot(ctx context.Context, projectID domain.ProjectID) (ProjectionSnapshot, error) {
	if source.Store == nil {
		return ProjectionSnapshot{}, ErrProjectionCorrupt
	}
	board, err := source.Store.ReadBoard(ctx, projectID)
	if errors.Is(err, port.ErrNotFound) {
		return ProjectionSnapshot{}, ErrProjectionNotFound
	}
	if err != nil {
		return ProjectionSnapshot{}, err
	}
	if board.ProjectID != projectID || board.Cursor.Epoch == 0 || board.MinimumSequence > board.Cursor.Sequence+1 {
		return ProjectionSnapshot{}, ErrProjectionCorrupt
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
	wire.APIVersion, wire.Projection.Kind, wire.Projection.ProjectID = "v1", "project_board/v1", projectID
	wire.Cursor = projectionCursor{StreamEpoch: board.Cursor.Epoch, EventSequence: board.Cursor.Sequence}
	lanes := map[string]int{}
	for index, key := range []string{"Blocked", "Draft", "Ready", "Developing", "Review", "QA", "Done", "Canceled"} {
		lanes[key] = index
		wire.Projection.Lanes = append(wire.Projection.Lanes, persistedLane{Key: key, Items: []persistedItem{}})
	}
	for _, row := range board.Items {
		if row.ID != row.Item.ID() || row.Item.ProjectID() != projectID || !workPattern.MatchString(string(row.ID)) || !validWireText(row.Title, 1, 240) || !validWireText(string(row.OwnerID), 1, 120) || row.RequiredACCount < 0 {
			return ProjectionSnapshot{}, ErrProjectionCorrupt
		}
		item := persistedItem{ID: row.ID, Title: row.Title, Phase: row.Item.Phase(), Version: row.Item.Version(), OwnerID: row.OwnerID, RequiredACCount: row.RequiredACCount, ActiveBlockerCount: len(row.Item.Blockers()), Conditions: []string{}}
		// Coverage requires policy and verified artifact material, not just SQL
		// history. This bounded runtime does not assert effective completion.
		lane := string(item.Phase)
		if item.ActiveBlockerCount > 0 {
			item.Conditions = append(item.Conditions, "Blocked")
			lane = "Blocked"
		}
		if run := row.CurrentRun; run != nil {
			if !runPattern.MatchString(string(run.ID)) ||
				!slices.Contains([]string{"Pending", "Claimed", "Sent", "Acknowledged", "FailedToDispatch"}, run.DispatchState) ||
				!slices.Contains([]string{"Unknown", "Starting", "Running", "Succeeded", "Failed", "Canceled"}, run.ObservedState) ||
				!slices.Contains([]string{"None", "NeedsReconcile", "Reconciled"}, run.ReconciliationState) ||
				!slices.Contains([]string{"None", "Dispatch", "CancelRequested"}, run.DesiredAction) ||
				!slices.Contains([]string{"NotApplicable", "Confirmed", "OutcomeUnknown"}, run.SideEffectOutcome) {
				return ProjectionSnapshot{}, ErrProjectionCorrupt
			}
			state := run.ReconciliationState
			if state == "Reconciled" {
				state = "Resolved"
			}
			item.CurrentRun = &persistedRun{ID: run.ID, DispatchState: run.DispatchState, ObservedState: run.ObservedState, ReconciliationState: state}
			if run.SideEffectOutcome == "OutcomeUnknown" {
				item.Conditions = append(item.Conditions, "OutcomeUnknown")
			}
			if run.DesiredAction == "CancelRequested" {
				item.Conditions = append(item.Conditions, "CancelRequested")
			}
		}
		if len(item.Conditions) > 0 {
			wire.Projection.AttentionCount++
		}
		index, ok := lanes[lane]
		if !ok || item.Version == 0 {
			return ProjectionSnapshot{}, ErrProjectionCorrupt
		}
		wire.Projection.Lanes[index].Items = append(wire.Projection.Lanes[index].Items, item)
	}
	payload, err := json.Marshal(wire)
	if err != nil {
		return ProjectionSnapshot{}, err
	}
	return ProjectionSnapshot{ProjectID: projectID, Cursor: board.Cursor, MinimumSequence: board.MinimumSequence, Payload: payload}, nil
}

func (source PersistedProjections) Replay(ctx context.Context, projectID domain.ProjectID, after port.Cursor) (ProjectionReplay, error) {
	if source.Store == nil {
		return ProjectionReplay{}, ErrProjectionCorrupt
	}
	window, err := source.Store.ReadProjectionEvents(ctx, projectID, after)
	if errors.Is(err, port.ErrNotFound) {
		return ProjectionReplay{}, ErrProjectionNotFound
	}
	if err != nil {
		return ProjectionReplay{}, err
	}
	result := ProjectionReplay{Epoch: window.Cursor.Epoch, HighWater: window.Cursor.Sequence, MinimumSequence: window.MinimumSequence}
	for _, event := range window.Events {
		value := ProjectionEvent{ProjectID: event.ProjectID, Cursor: event.Cursor, Payload: event.Payload}
		if value.ProjectID != projectID {
			return ProjectionReplay{}, ErrProjectionCorrupt
		}
		if _, err := canonicalProjectionPayload(value); err != nil {
			return ProjectionReplay{}, err
		}
		result.Events = append(result.Events, value)
	}
	return result, nil
}

var _ ProjectionSource = PersistedProjections{}
