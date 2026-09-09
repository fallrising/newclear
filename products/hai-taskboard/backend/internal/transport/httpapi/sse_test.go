package httpapi

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type cancelRecorder struct {
	*httptest.ResponseRecorder
	cancel context.CancelFunc
	needle []byte
}

func testProjectionPayload(t *testing.T, eventType, resourceKind, resourceID string, version uint64) []byte {
	t.Helper()
	payload, err := json.Marshal(applicationChangeEvent{
		APIVersion: "v1", EventType: eventType, ProjectID: testProjectID,
		ResourceKind: resourceKind, ResourceID: resourceID, ResourceVersion: version,
	})
	if err != nil {
		t.Fatalf("marshal projection payload: %v", err)
	}
	return payload
}

func (recorder *cancelRecorder) Write(payload []byte) (int, error) {
	written, err := recorder.ResponseRecorder.Write(payload)
	if bytes.Contains(recorder.Body.Bytes(), recorder.needle) {
		recorder.cancel()
	}
	return written, err
}

func TestSSE_SnapshotGapReplayAndRetentionReset(t *testing.T) {
	t.Run("snapshot attachment closes the high-water gap", func(t *testing.T) {
		hub := NewHub()
		projections := &projectionStub{}
		projections.snapshotFn = func() ProjectionSnapshot {
			payload := testProjectionPayload(t, "project.changed", "project", string(testProjectID), 5)
			if err := hub.PublishCommitted(t.Context(), port.CommittedProjection{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 5}, Payload: payload}); err != nil {
				t.Fatalf("PublishCommitted: %v", err)
			}
			return ProjectionSnapshot{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 4}, MinimumSequence: 1, Payload: []byte(`{"api_version":"v1"}`)}
		}
		ctx, cancel := context.WithCancel(t.Context())
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events", nil).WithContext(ctx)
		addSession(request)
		response := &cancelRecorder{ResponseRecorder: httptest.NewRecorder(), cancel: cancel, needle: []byte("id: 1:5")}
		testServer(t, nil, nil, projections, nil, hub).ServeHTTP(response, request)
		body := response.Body.String()
		if response.Code != http.StatusOK || strings.Count(body, "id: 1:5") != 1 {
			t.Fatalf("status=%d body=%q", response.Code, body)
		}
	})

	t.Run("durable replay wins and duplicate live notification is discarded", func(t *testing.T) {
		hub := NewHub()
		payload2 := testProjectionPayload(t, "work_item.changed", "work_item", "wi_01ARZ3NDEK", 2)
		payload3 := testProjectionPayload(t, "run.changed", "run", "run_01ARZ3NDEK", 3)
		projections := &projectionStub{}
		projections.replayFn = func() ProjectionReplay {
			publications := []port.CommittedProjection{
				{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 2}, Payload: payload2},
				{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 3}, Payload: payload3},
			}
			for _, publication := range publications {
				if err := hub.PublishCommitted(t.Context(), publication); err != nil {
					t.Fatalf("PublishCommitted: %v", err)
				}
			}
			return ProjectionReplay{Epoch: 1, HighWater: 2, MinimumSequence: 1, Events: []ProjectionEvent{{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 2}, Payload: payload2}}}
		}
		ctx, cancel := context.WithCancel(t.Context())
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events?cursor=1:1", nil).WithContext(ctx)
		addSession(request)
		response := &cancelRecorder{ResponseRecorder: httptest.NewRecorder(), cancel: cancel, needle: []byte("id: 1:3")}
		testServer(t, nil, nil, projections, nil, hub).ServeHTTP(response, request)
		body := response.Body.String()
		if strings.Count(body, "id: 1:2") != 1 || strings.Count(body, "id: 1:3") != 1 || strings.Index(body, "id: 1:2") > strings.Index(body, "id: 1:3") {
			t.Fatalf("replay/live output=%q", body)
		}
	})

	t.Run("retention expiry emits exactly one reset and closes", func(t *testing.T) {
		projections := &projectionStub{replay: ProjectionReplay{Epoch: 1, HighWater: 9, MinimumSequence: 5}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events?cursor=1:3", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, nil, nil).ServeHTTP(response, request)
		body := response.Body.String()
		if response.Code != http.StatusOK || strings.Count(body, "event: projection_reset_required") != 1 || !strings.Contains(body, `"reason":"retention_expired"`) || !strings.Contains(body, `"minimum_sequence":5`) || !strings.Contains(body, `"snapshot_url":"/api/v1/projects/prj_01ARZ3NDEK/board"`) {
			t.Fatalf("status=%d body=%q", response.Code, body)
		}
	})
}

func TestT077ReplayGapFailsClosed(t *testing.T) {
	payload2 := testProjectionPayload(t, "work_item.changed", "work_item", "wi_01ARZ3NDEK", 2)
	payload3 := testProjectionPayload(t, "run.changed", "run", "run_01ARZ3NDEK", 3)
	tests := map[string]ProjectionReplay{
		"gap": {
			Epoch: 1, HighWater: 3, MinimumSequence: 1,
			Events: []ProjectionEvent{{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 3}, Payload: payload3}},
		},
		"missing tail": {
			Epoch: 1, HighWater: 3, MinimumSequence: 1,
			Events: []ProjectionEvent{{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 2}, Payload: payload2}},
		},
	}
	for name, replay := range tests {
		t.Run(name, func(t *testing.T) {
			if validReplay(testProjectID, port.Cursor{Epoch: 1, Sequence: 1}, replay) {
				t.Fatal("corrupt replay was accepted")
			}
			projections := &projectionStub{replay: replay}
			request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events?cursor=1:1", nil)
			addSession(request)
			response := httptest.NewRecorder()
			testServer(t, nil, nil, projections, nil, nil).ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "id: 1:") {
				t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
			}
		})
	}
}

func TestT077ProjectionDataMustHaveOpenAPIShape(t *testing.T) {
	t.Run("valid event binds cursor to SSE id", func(t *testing.T) {
		event := ProjectionEvent{
			ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 7, Sequence: 11},
			Payload: testProjectionPayload(t, "work_item.changed", "work_item", "wi_01ARZ3NDEK", 4),
		}
		response := httptest.NewRecorder()
		if err := writeProjectionEvent(response, event); err != nil {
			t.Fatalf("writeProjectionEvent: %v", err)
		}
		const want = "id: 7:11\nevent: projection\ndata: {\"api_version\":\"v1\",\"cursor\":{\"stream_epoch\":7,\"event_sequence\":11},\"event_type\":\"work_item.changed\",\"project_id\":\"prj_01ARZ3NDEK\",\"resource_kind\":\"work_item\",\"resource_id\":\"wi_01ARZ3NDEK\",\"resource_version\":4,\"projection\":{}}\n\n"
		if response.Body.String() != want {
			t.Fatalf("SSE event=%q", response.Body.String())
		}
	})

	malformed := map[string][]byte{
		"missing shape":     []byte(`{"api_version":"v1"}`),
		"duplicate member":  []byte(`{"api_version":"v1","api_version":"v1","event_type":"project.changed","project_id":"prj_01ARZ3NDEK","resource_kind":"project","resource_id":"prj_01ARZ3NDEK","resource_version":1}`),
		"unknown member":    []byte(`{"api_version":"v1","event_type":"project.changed","project_id":"prj_01ARZ3NDEK","resource_kind":"project","resource_id":"prj_01ARZ3NDEK","resource_version":1,"extra":true}`),
		"wrong project":     []byte(`{"api_version":"v1","event_type":"project.changed","project_id":"prj_01ARZ3NDEM","resource_kind":"project","resource_id":"prj_01ARZ3NDEM","resource_version":1}`),
		"mismatched kind":   []byte(`{"api_version":"v1","event_type":"run.changed","project_id":"prj_01ARZ3NDEK","resource_kind":"work_item","resource_id":"wi_01ARZ3NDEK","resource_version":1}`),
		"empty resource ID": []byte(`{"api_version":"v1","event_type":"project.changed","project_id":"prj_01ARZ3NDEK","resource_kind":"project","resource_id":"","resource_version":1}`),
		"zero version":      []byte(`{"api_version":"v1","event_type":"project.changed","project_id":"prj_01ARZ3NDEK","resource_kind":"project","resource_id":"prj_01ARZ3NDEK","resource_version":0}`),
	}
	for name, payload := range malformed {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			err := writeProjectionEvent(response, ProjectionEvent{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 2}, Payload: payload})
			if !errors.Is(err, ErrProjectionCorrupt) || response.Body.Len() != 0 {
				t.Fatalf("err=%v body=%q", err, response.Body.String())
			}
		})
	}

	t.Run("live gap and malformed data are not emitted", func(t *testing.T) {
		for name, event := range map[string]port.CommittedProjection{
			"gap": {
				ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 3},
				Payload: testProjectionPayload(t, "project.changed", "project", string(testProjectID), 3),
			},
			"malformed": {ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 2}, Payload: []byte(`{"api_version":"v1"}`)},
		} {
			t.Run(name, func(t *testing.T) {
				hub := NewHub()
				projections := &projectionStub{snapshotFn: func() ProjectionSnapshot {
					if err := hub.PublishCommitted(t.Context(), event); err != nil {
						t.Fatalf("PublishCommitted: %v", err)
					}
					return ProjectionSnapshot{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 1}, MinimumSequence: 1, Payload: []byte(`{"api_version":"v1"}`)}
				}}
				request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events", nil)
				addSession(request)
				response := httptest.NewRecorder()
				testServer(t, nil, nil, projections, nil, hub).ServeHTTP(response, request)
				if strings.Contains(response.Body.String(), "event: projection\n") || strings.Contains(response.Body.String(), "id: 1:") {
					t.Fatalf("corrupt live event emitted: %q", response.Body.String())
				}
			})
		}
	})

	t.Run("out-of-order live publication fails closed at the first gap", func(t *testing.T) {
		hub := NewHub()
		projections := &projectionStub{snapshotFn: func() ProjectionSnapshot {
			for _, event := range []port.CommittedProjection{
				{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 3}, Payload: testProjectionPayload(t, "run.changed", "run", "run_01ARZ3NDEK", 3)},
				{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 2}, Payload: testProjectionPayload(t, "work_item.changed", "work_item", "wi_01ARZ3NDEK", 2)},
			} {
				if err := hub.PublishCommitted(t.Context(), event); err != nil {
					t.Fatalf("PublishCommitted: %v", err)
				}
			}
			return ProjectionSnapshot{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 1}, MinimumSequence: 1, Payload: []byte(`{"api_version":"v1"}`)}
		}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, nil, hub).ServeHTTP(response, request)
		if strings.Contains(response.Body.String(), "event: projection\n") || strings.Contains(response.Body.String(), "id: 1:") {
			t.Fatalf("out-of-order live data emitted: %q", response.Body.String())
		}
	})
}

func TestT079RevocationPrecedesQueuedDataAndIsSingleRead(t *testing.T) {
	t.Run("preclosed revocation precedes queued live data", func(t *testing.T) {
		revoked := make(chan struct{})
		close(revoked)
		authority := &authorityStub{revoked: revoked}
		hub := NewHub()
		projections := &projectionStub{snapshotFn: func() ProjectionSnapshot {
			event := port.CommittedProjection{
				ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 7, Sequence: 3},
				Payload: testProjectionPayload(t, "run.changed", "run", "run_01ARZ3NDEK", 3),
			}
			if err := hub.PublishCommitted(t.Context(), event); err != nil {
				t.Fatalf("PublishCommitted: %v", err)
			}
			return ProjectionSnapshot{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 7, Sequence: 2}, MinimumSequence: 1, Payload: []byte(`{"api_version":"v1"}`)}
		}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, authority, hub).ServeHTTP(response, request)
		body := response.Body.String()
		if authority.revokedCalls != 1 || strings.Count(body, "event: projection_reset_required") != 1 ||
			!strings.Contains(body, `"reason":"authorization_revoked"`) || !strings.Contains(body, `"current_epoch":7`) ||
			strings.Contains(body, "event: projection\n") || strings.Contains(body, "id: 7:3") {
			t.Fatalf("revoked_calls=%d body=%q", authority.revokedCalls, body)
		}
	})

	t.Run("preclosed revocation precedes durable replay", func(t *testing.T) {
		revoked := make(chan struct{})
		close(revoked)
		authority := &authorityStub{revoked: revoked}
		payload := testProjectionPayload(t, "work_item.changed", "work_item", "wi_01ARZ3NDEK", 2)
		projections := &projectionStub{replay: ProjectionReplay{
			Epoch: 7, HighWater: 2, MinimumSequence: 1,
			Events: []ProjectionEvent{{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 7, Sequence: 2}, Payload: payload}},
		}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events?cursor=7:1", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, authority, nil).ServeHTTP(response, request)
		body := response.Body.String()
		if authority.revokedCalls != 1 || strings.Count(body, "event: projection_reset_required") != 1 ||
			!strings.Contains(body, `"reason":"authorization_revoked"`) || strings.Contains(body, "event: projection\n") ||
			strings.Contains(body, "id: 7:2") {
			t.Fatalf("revoked_calls=%d body=%q", authority.revokedCalls, body)
		}
	})
}

func TestT079WrongLiveEpochUsesAuthoritativeEpoch(t *testing.T) {
	authority := &authorityStub{}
	hub := NewHub()
	projections := &projectionStub{snapshotFn: func() ProjectionSnapshot {
		event := port.CommittedProjection{
			ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 99, Sequence: 2},
			Payload: testProjectionPayload(t, "work_item.changed", "work_item", "wi_01ARZ3NDEK", 2),
		}
		if err := hub.PublishCommitted(t.Context(), event); err != nil {
			t.Fatalf("PublishCommitted: %v", err)
		}
		return ProjectionSnapshot{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 7, Sequence: 1}, MinimumSequence: 1, Payload: []byte(`{"api_version":"v1"}`)}
	}}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events", nil)
	addSession(request)
	response := httptest.NewRecorder()
	testServer(t, nil, nil, projections, authority, hub).ServeHTTP(response, request)
	body := response.Body.String()
	if authority.revokedCalls != 1 || strings.Count(body, "event: projection_reset_required") != 1 ||
		!strings.Contains(body, `"reason":"epoch_mismatch"`) || !strings.Contains(body, `"current_epoch":7`) ||
		strings.Contains(body, `"current_epoch":99`) || strings.Contains(body, "event: projection\n") {
		t.Fatalf("revoked_calls=%d body=%q", authority.revokedCalls, body)
	}
}

func TestSSE_SlowConsumerCannotBlockCommand(t *testing.T) {
	hub := NewHub()
	id, subscription := hub.subscribe(testProjectID)
	defer hub.unsubscribe(id)
	for sequence := uint64(1); sequence <= maxSubscriberEvents+1; sequence++ {
		if err := hub.PublishCommitted(t.Context(), port.CommittedProjection{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: sequence}, Payload: []byte(`{}`)}); err != nil {
			t.Fatalf("PublishCommitted sequence %d: %v", sequence, err)
		}
	}
	if got := len(subscription.events); got != maxSubscriberEvents {
		t.Fatalf("queued events=%d, want=%d", got, maxSubscriberEvents)
	}
	select {
	case notice := <-subscription.terminal:
		if notice.reason != "slow_consumer" || notice.currentEpoch != 1 {
			t.Fatalf("notice=%+v", notice)
		}
	default:
		t.Fatal("overflow did not enqueue terminal slow-consumer reset")
	}
}

func TestSSE_RevocationIsolationEpochAndCursorAgreement(t *testing.T) {
	t.Run("revoked session receives one reset", func(t *testing.T) {
		revoked := make(chan struct{})
		close(revoked)
		authority := &authorityStub{revoked: revoked}
		projections := &projectionStub{snapshot: ProjectionSnapshot{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 7, Sequence: 2}, MinimumSequence: 2, Payload: []byte(`{"api_version":"v1"}`)}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, authority, nil).ServeHTTP(response, request)
		body := response.Body.String()
		if strings.Count(body, "event: projection_reset_required") != 1 || !strings.Contains(body, `"reason":"authorization_revoked"`) {
			t.Fatalf("body=%q", body)
		}
	})

	t.Run("wrong epoch resets without replay payload", func(t *testing.T) {
		projections := &projectionStub{replay: ProjectionReplay{Epoch: 8, HighWater: 4, MinimumSequence: 1}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events?cursor=7:4", nil)
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, nil, nil).ServeHTTP(response, request)
		body := response.Body.String()
		if strings.Count(body, "event: projection_reset_required") != 1 || !strings.Contains(body, `"reason":"epoch_mismatch"`) || !strings.Contains(body, `"current_epoch":8`) {
			t.Fatalf("body=%q", body)
		}
	})

	t.Run("query and header cursors must agree", func(t *testing.T) {
		projections := &projectionStub{}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/events?cursor=1:2", nil)
		request.Header.Set("Last-Event-ID", "1:3")
		addSession(request)
		response := httptest.NewRecorder()
		testServer(t, nil, nil, projections, nil, nil).ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || projections.replayCalls != 0 {
			t.Fatalf("status=%d replay_calls=%d", response.Code, projections.replayCalls)
		}
	})

	t.Run("publication is project isolated", func(t *testing.T) {
		hub := NewHub()
		firstID, first := hub.subscribe(testProjectID)
		defer hub.unsubscribe(firstID)
		otherProject := domain.ProjectID("prj_01ARZ3NDEM")
		secondID, second := hub.subscribe(otherProject)
		defer hub.unsubscribe(secondID)
		if err := hub.PublishCommitted(t.Context(), port.CommittedProjection{ProjectID: testProjectID, Cursor: port.Cursor{Epoch: 1, Sequence: 1}, Payload: []byte(`{}`)}); err != nil {
			t.Fatal(err)
		}
		select {
		case <-first.events:
		default:
			t.Fatal("matching project did not receive publication")
		}
		select {
		case event := <-second.events:
			t.Fatalf("cross-project event leaked: %+v", event)
		default:
		}
	})
}
