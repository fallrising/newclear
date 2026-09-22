package httpapi

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const (
	maxSubscriberEvents       = 128
	maxSubscriberPayloadBytes = 1_048_576
)

type Hub struct {
	mu          sync.Mutex
	nextID      uint64
	subscribers map[uint64]*subscriber
}

type subscriber struct {
	projectID   domain.ProjectID
	events      chan ProjectionEvent
	terminal    chan resetNotice
	queuedBytes int
	closed      bool
}

type resetNotice struct {
	reason          string
	currentEpoch    uint64
	minimumSequence uint64
}

func NewHub() *Hub {
	return &Hub{subscribers: make(map[uint64]*subscriber)}
}

// PublishCommitted implements port.ProjectionSink. It only copies into bounded
// in-memory queues; it never waits for a handler or writes to a client socket.
func (hub *Hub) PublishCommitted(_ context.Context, projection port.CommittedProjection) error {
	if hub == nil || projection.ProjectID == "" || projection.Cursor.Epoch == 0 || projection.Cursor.Sequence == 0 || len(projection.Payload) == 0 {
		return ErrProjectionCorrupt
	}
	event := ProjectionEvent{ProjectID: projection.ProjectID, Cursor: projection.Cursor, Payload: bytes.Clone(projection.Payload)}
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for _, subscription := range hub.subscribers {
		if subscription.projectID == projection.ProjectID {
			subscription.enqueue(event)
		}
	}
	return nil
}

func (hub *Hub) subscribe(projectID domain.ProjectID) (uint64, *subscriber) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	hub.nextID++
	subscription := &subscriber{
		projectID: projectID,
		events:    make(chan ProjectionEvent, maxSubscriberEvents),
		terminal:  make(chan resetNotice, 1),
	}
	hub.subscribers[hub.nextID] = subscription
	return hub.nextID, subscription
}

func (hub *Hub) unsubscribe(id uint64) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if subscription := hub.subscribers[id]; subscription != nil {
		subscription.closed = true
		delete(hub.subscribers, id)
	}
}

func (subscription *subscriber) enqueue(event ProjectionEvent) {
	if subscription.closed {
		return
	}
	if len(subscription.events) >= maxSubscriberEvents || subscription.queuedBytes+len(event.Payload) > maxSubscriberPayloadBytes {
		subscription.closeWith(resetNotice{reason: "slow_consumer", currentEpoch: event.Cursor.Epoch})
		return
	}
	copy := event.Clone()
	select {
	case subscription.events <- copy:
		subscription.queuedBytes += len(copy.Payload)
	default:
		subscription.closeWith(resetNotice{reason: "slow_consumer", currentEpoch: event.Cursor.Epoch})
	}
}

func (subscription *subscriber) closeWith(notice resetNotice) {
	if subscription.closed {
		return
	}
	subscription.closed = true
	select {
	case subscription.terminal <- notice:
	default:
	}
}

func (hub *Hub) received(subscription *subscriber, event ProjectionEvent) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if subscription.queuedBytes >= len(event.Payload) {
		subscription.queuedBytes -= len(event.Payload)
	} else {
		subscription.queuedBytes = 0
	}
}

func (server *Server) streamEvents(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok {
		return
	}
	projectID, ok := pathProject(response, request)
	if !ok || !server.authorizeProject(response, request, session, projectID) {
		return
	}
	revoked := server.authority.Revoked(session)
	cursor, supplied, ok := requestCursor(response, request)
	if !ok {
		return
	}
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeAPIError(response, http.StatusInternalServerError, command.CodeProjectionUnavailable, "streaming is unavailable")
		return
	}

	// Attach before reading the durable high-water. Events committed during the
	// read enter this queue and are de-duplicated against durable replay below.
	subscriptionID, subscription := server.hub.subscribe(projectID)
	defer server.hub.unsubscribe(subscriptionID)

	var (
		currentEpoch    uint64
		minimumSequence uint64
		replayEvents    []ProjectionEvent
		initialReset    string
	)
	if supplied {
		replay, err := server.projections.Replay(request.Context(), projectID, cursor)
		if err != nil || replay.Epoch == 0 || replay.MinimumSequence > replay.HighWater+1 {
			writeAPIError(response, http.StatusServiceUnavailable, command.CodeProjectionUnavailable, "projection replay is unavailable")
			return
		}
		currentEpoch, minimumSequence = replay.Epoch, replay.MinimumSequence
		if cursor.Epoch != replay.Epoch {
			initialReset = "epoch_mismatch"
		} else if minimumSequence > 0 && cursor.Sequence < minimumSequence-1 {
			initialReset = "retention_expired"
		} else if !validReplay(projectID, cursor, replay) {
			writeAPIError(response, http.StatusServiceUnavailable, command.CodeProjectionUnavailable, "projection replay is corrupt")
			return
		} else {
			replayEvents = replay.Events
		}
	} else {
		snapshot, err := server.projections.Snapshot(request.Context(), projectID)
		if err != nil || snapshot.ProjectID != projectID || snapshot.Cursor.Epoch == 0 || snapshot.MinimumSequence > snapshot.Cursor.Sequence+1 {
			writeAPIError(response, http.StatusServiceUnavailable, command.CodeProjectionUnavailable, "projection snapshot is unavailable")
			return
		}
		currentEpoch, minimumSequence = snapshot.Cursor.Epoch, snapshot.MinimumSequence
		cursor = snapshot.Cursor
	}

	if revokedNow(revoked) {
		beginSSE(response)
		_ = writeReset(response, projectID, "authorization_revoked", currentEpoch, minimumSequence)
		flusher.Flush()
		return
	}
	if initialReset != "" {
		beginSSE(response)
		_ = writeReset(response, projectID, initialReset, currentEpoch, minimumSequence)
		flusher.Flush()
		return
	}

	beginSSE(response)
	lastSequence := cursor.Sequence
	for _, event := range replayEvents {
		if revokedNow(revoked) {
			_ = writeReset(response, projectID, "authorization_revoked", currentEpoch, minimumSequence)
			flusher.Flush()
			return
		}
		if event.Cursor.Sequence <= lastSequence {
			continue
		}
		if err := writeProjectionEvent(response, event); err != nil {
			return
		}
		lastSequence = event.Cursor.Sequence
	}
	flusher.Flush()

	for {
		if revokedNow(revoked) {
			_ = writeReset(response, projectID, "authorization_revoked", currentEpoch, minimumSequence)
			flusher.Flush()
			return
		}
		select {
		case notice := <-subscription.terminal:
			_ = writeReset(response, projectID, notice.reason, currentEpoch, minimumSequence)
			flusher.Flush()
			return
		default:
		}
		select {
		case <-request.Context().Done():
			return
		case <-revoked:
			_ = writeReset(response, projectID, "authorization_revoked", currentEpoch, minimumSequence)
			flusher.Flush()
			return
		case notice := <-subscription.terminal:
			_ = writeReset(response, projectID, notice.reason, currentEpoch, minimumSequence)
			flusher.Flush()
			return
		case event := <-subscription.events:
			server.hub.received(subscription, event)
			if revokedNow(revoked) {
				_ = writeReset(response, projectID, "authorization_revoked", currentEpoch, minimumSequence)
				flusher.Flush()
				return
			}
			if event.ProjectID != projectID || event.Cursor.Epoch != currentEpoch {
				_ = writeReset(response, projectID, "epoch_mismatch", currentEpoch, minimumSequence)
				flusher.Flush()
				return
			}
			if event.Cursor.Sequence <= lastSequence {
				continue
			}
			if event.Cursor.Sequence != lastSequence+1 {
				return
			}
			if err := writeProjectionEvent(response, event); err != nil {
				return
			}
			lastSequence = event.Cursor.Sequence
			flusher.Flush()
		}
	}
}

func revokedNow(revoked <-chan struct{}) bool {
	select {
	case <-revoked:
		return true
	default:
		return false
	}
}

func requestCursor(response http.ResponseWriter, request *http.Request) (port.Cursor, bool, bool) {
	queryValues, present := request.URL.Query()["cursor"]
	if present && len(queryValues) != 1 {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "cursor is invalid")
		return port.Cursor{}, false, false
	}
	headerValues := request.Header.Values("Last-Event-ID")
	if len(headerValues) > 1 {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "cursor is invalid")
		return port.Cursor{}, false, false
	}
	query := ""
	if len(queryValues) == 1 {
		query = queryValues[0]
	}
	header := ""
	if len(headerValues) == 1 {
		header = headerValues[0]
	}
	if query == "" && header == "" {
		return port.Cursor{}, false, true
	}
	if query != "" && header != "" && query != header {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "cursor values disagree")
		return port.Cursor{}, false, false
	}
	value := query
	if value == "" {
		value = header
	}
	cursor, err := parseCursor(value)
	if err != nil {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "cursor is invalid")
		return port.Cursor{}, false, false
	}
	return cursor, true, true
}

func parseCursor(value string) (port.Cursor, error) {
	epochText, sequenceText, found := strings.Cut(value, ":")
	if !found || epochText == "" || sequenceText == "" || strings.Contains(sequenceText, ":") || epochText[0] == '0' || len(sequenceText) > 1 && sequenceText[0] == '0' {
		return port.Cursor{}, errors.New("invalid cursor")
	}
	epoch, err := strconv.ParseUint(epochText, 10, 64)
	if err != nil || epoch == 0 {
		return port.Cursor{}, errors.New("invalid cursor epoch")
	}
	sequence, err := strconv.ParseUint(sequenceText, 10, 64)
	if err != nil {
		return port.Cursor{}, errors.New("invalid cursor sequence")
	}
	return port.Cursor{Epoch: epoch, Sequence: sequence}, nil
}

func validReplay(projectID domain.ProjectID, cursor port.Cursor, replay ProjectionReplay) bool {
	if cursor.Epoch != replay.Epoch || replay.HighWater < cursor.Sequence {
		return false
	}
	previous := cursor.Sequence
	for _, event := range replay.Events {
		if event.ProjectID != projectID || event.Cursor.Epoch != replay.Epoch || event.Cursor.Sequence != previous+1 ||
			event.Cursor.Sequence > replay.HighWater {
			return false
		}
		if _, err := canonicalProjectionPayload(event); err != nil {
			return false
		}
		previous = event.Cursor.Sequence
	}
	return previous == replay.HighWater
}

func beginSSE(response http.ResponseWriter) {
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Accel-Buffering", "no")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(http.StatusOK)
}

func writeProjectionEvent(response http.ResponseWriter, event ProjectionEvent) error {
	payload, err := canonicalProjectionPayload(event)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(response, "id: %d:%d\nevent: projection\ndata: %s\n\n", event.Cursor.Epoch, event.Cursor.Sequence, payload)
	return err
}

type applicationChangeEvent struct {
	APIVersion      string           `json:"api_version"`
	EventType       string           `json:"event_type"`
	ProjectID       domain.ProjectID `json:"project_id"`
	ResourceKind    string           `json:"resource_kind"`
	ResourceID      string           `json:"resource_id"`
	ResourceVersion uint64           `json:"resource_version"`
}

type projectionCursor struct {
	StreamEpoch   uint64 `json:"stream_epoch"`
	EventSequence uint64 `json:"event_sequence"`
}

type projectionEventEnvelope struct {
	APIVersion      string           `json:"api_version"`
	Cursor          projectionCursor `json:"cursor"`
	EventType       string           `json:"event_type"`
	ProjectID       domain.ProjectID `json:"project_id"`
	ResourceKind    string           `json:"resource_kind"`
	ResourceID      string           `json:"resource_id"`
	ResourceVersion uint64           `json:"resource_version"`
	Projection      struct{}         `json:"projection"`
}

func canonicalProjectionPayload(event ProjectionEvent) ([]byte, error) {
	if event.ProjectID == "" || event.Cursor.Epoch == 0 || event.Cursor.Sequence == 0 || len(event.Payload) == 0 {
		return nil, ErrProjectionCorrupt
	}
	var change applicationChangeEvent
	if err := json.Unmarshal(event.Payload, &change, json.RejectUnknownMembers(true)); err != nil ||
		change.APIVersion != "v1" || change.ProjectID != event.ProjectID ||
		!projectPattern.MatchString(string(change.ProjectID)) || !validProjectionKind(change.EventType, change.ResourceKind) ||
		!validWireText(change.ResourceID, 1, 120) || change.ResourceVersion == 0 {
		return nil, ErrProjectionCorrupt
	}
	return json.Marshal(projectionEventEnvelope{
		APIVersion: "v1",
		Cursor: projectionCursor{
			StreamEpoch:   event.Cursor.Epoch,
			EventSequence: event.Cursor.Sequence,
		},
		EventType:       change.EventType,
		ProjectID:       change.ProjectID,
		ResourceKind:    change.ResourceKind,
		ResourceID:      change.ResourceID,
		ResourceVersion: change.ResourceVersion,
	})
}

func validProjectionKind(eventType, resourceKind string) bool {
	switch eventType {
	case "project.changed":
		return resourceKind == "project"
	case "work_item.changed":
		return resourceKind == "work_item"
	case "attention.changed":
		return resourceKind == "attention"
	case "impact_plan.created":
		return resourceKind == "impact_plan"
	case "run.changed":
		return resourceKind == "run"
	default:
		return false
	}
}

type projectionReset struct {
	APIVersion      string `json:"api_version"`
	Reason          string `json:"reason"`
	CurrentEpoch    uint64 `json:"current_epoch"`
	MinimumSequence uint64 `json:"minimum_sequence"`
	SnapshotURL     string `json:"snapshot_url"`
}

func writeReset(response http.ResponseWriter, projectID domain.ProjectID, reason string, currentEpoch, minimumSequence uint64) error {
	payload, err := json.Marshal(projectionReset{
		APIVersion:      "v1",
		Reason:          reason,
		CurrentEpoch:    currentEpoch,
		MinimumSequence: minimumSequence,
		SnapshotURL:     "/api/v1/projects/" + string(projectID) + "/board",
	})
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(response, "event: projection_reset_required\ndata: %s\n\n", payload)
	return err
}

var _ port.ProjectionSink = (*Hub)(nil)
