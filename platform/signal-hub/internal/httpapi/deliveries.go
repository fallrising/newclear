package httpapi

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

// Dispatch projects a bounded batch and sends without holding the runtime lock
// or a database transaction across network IO. An already claimed attempt uses
// its immutable sender snapshot; a reload affects subsequent claims.
func (s *Server) Dispatch(ctx context.Context, now time.Time, boardURL string) error {
	s.mu.RLock()
	err := s.db.QueueDeliveries(ctx, now, boardURL)
	s.mu.RUnlock()
	if err != nil {
		return err
	}
	for range 20 {
		s.mu.RLock()
		sender := s.sender
		if sender == nil {
			s.mu.RUnlock()
			return nil
		}
		now = s.now().UTC()
		work, err := s.db.ClaimDelivery(ctx, now)
		s.mu.RUnlock()
		if err != nil {
			return err
		}
		if work == nil {
			return nil
		}
		result := sender.Send(ctx, work.SubscriptionID, work.DeliveryID, work.Message, now)
		// Cancellation deliberately leaves the durable claim for lease recovery.
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.db.FinishDelivery(ctx, *work, result, s.now().UTC()); err != nil {
			return err
		}
	}
	return nil
}

func deliveryParams(raw string, subscriptions bool) (url.Values, int, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return nil, 0, err
	}
	for k, v := range values {
		if len(v) != 1 || v[0] == "" || (k != "cursor" && k != "limit" && (subscriptions || (k != "state" && k != "subscription"))) {
			return nil, 0, store.ErrInvalidQuery
		}
	}
	limit := 100
	if value := values.Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 200 {
			return nil, 0, store.ErrInvalidQuery
		}
	}
	return values, limit, nil
}
func (s *Server) deliveryList(w http.ResponseWriter, r *http.Request) {
	subscriptions := r.URL.Path == "/v1/subscriptions"
	values, limit, err := deliveryParams(r.URL.RawQuery, subscriptions)
	if err != nil {
		fail(w, 400, "invalid_query", "invalid delivery query")
		return
	}
	var page any
	if subscriptions {
		page, err = s.db.ListSubscriptions(r.Context(), values.Get("cursor"), limit)
	} else {
		page, err = s.db.ListDeliveries(r.Context(), store.DeliveryQuery{Subscription: values.Get("subscription"), State: values.Get("state"), Cursor: values.Get("cursor"), Limit: limit})
	}
	if errors.Is(err, store.ErrInvalidQuery) {
		fail(w, 400, "invalid_query", "invalid filters or cursor")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable", "delivery store unavailable")
		return
	}
	writeJSON(w, 200, page)
}
func (s *Server) replay(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		fail(w, 400, "invalid_query", "replay takes no query parameters")
		return
	}
	ct, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || ct != "application/json" || (params["charset"] != "" && !strings.EqualFold(params["charset"], "utf-8")) || (r.Header.Get("Content-Encoding") != "" && r.Header.Get("Content-Encoding") != "identity") {
		fail(w, 415, "unsupported_media_type", "replay requires JSON")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
	if err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			fail(w, 413, "payload_too_large", "request body exceeds 4 MiB")
		} else {
			fail(w, 400, "invalid_json", "invalid replay JSON")
		}
		return
	}
	value, err := event.Decode(body)
	if err != nil {
		fail(w, 400, "invalid_json", "invalid replay JSON")
		return
	}
	obj, ok := value.(map[string]any)
	if !ok || len(obj) != 1 {
		fail(w, 400, "invalid_reason", "one nonblank reason is required")
		return
	}
	reason, ok := obj["reason"].(string)
	if !ok || strings.TrimSpace(reason) == "" {
		fail(w, 400, "invalid_reason", "nonblank reason is required")
		return
	}
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/deliveries/"), ":replay")
	err = s.db.ReplayDelivery(r.Context(), id, reason, s.now().UTC())
	switch {
	case errors.Is(err, store.ErrNotFound):
		fail(w, 404, "not_found", "delivery not found")
	case errors.Is(err, store.ErrNotReplayable):
		fail(w, 409, "not_replayable", "delivery is not an active DLQ item")
	case errors.Is(err, store.ErrInvalidReason):
		fail(w, 400, "invalid_reason", "nonblank reason is required")
	case err != nil:
		fail(w, 503, "unavailable", "delivery store unavailable")
	default:
		writeJSON(w, 202, map[string]string{"delivery_id": id, "state": "pending"})
	}
}
