package store

import (
	"encoding/json"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"testing"
	"time"
)

func TestDeliveryAncientDigestWindowPublicTime(t *testing.T) {
	s, _ := newStore(t)
	now := time.Date(1, 1, 3, 0, 0, 0, 0, time.UTC)
	put(t, s, parsed(t, "ancient-offset", "0001-01-01T00:00:00+23:00", nil))
	configureDelivery(t, s, now, digestSubscription("ancient", "earliest_hot", true))
	queueDelivery(t, s, now)
	p := deliveryPage(t, s, DeliveryQuery{})
	if len(p.Items) != 1 {
		t.Fatalf("page %+v", p)
	}
	raw, _ := json.Marshal(p)
	t.Logf("public delivery response: %s", raw)
	if _, err := event.ParseTime(*p.Items[0].WindowStart); err != nil {
		t.Fatalf("window_start violates public RFC3339 date-time contract: %v", err)
	}
}

func TestDeliveryFutureDigestDoesNotBlockImmediate(t *testing.T) {
	s, _ := newStore(t)
	now := ruleTime(12)
	configureDelivery(t, s, now, digestSubscription("future", "earliest_hot", true), subscription("immediate", "earliest_hot"))
	put(t, s, parsed(t, "far-future", "9999-12-31T23:59:59-23:00", nil))
	if err := s.QueueDeliveries(t.Context(), now, "https://board.example.invalid"); err != nil {
		t.Fatalf("a valid future event in a digest blocks all projection and sending: %v", err)
	}
	p := deliveryPage(t, s, DeliveryQuery{Subscription: "immediate"})
	if len(p.Items) != 1 {
		t.Fatalf("immediate event not queued: %+v", p)
	}
}
