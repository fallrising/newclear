package adapter

import (
	"encoding/json"
	"testing"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

func TestParseAlertmanagerFiringRepeatIsDeterministic(t *testing.T) {
	body := []byte(`{"version":"4","groupKey":"g","receiver":"ops","status":"firing","alerts":[{"status":"firing","labels":{"alertname":"DiskFull","severity":"critical"},"annotations":{"summary":"Disk is full"},"startsAt":"2026-10-03T10:00:00Z","endsAt":"2026-10-03T11:00:00Z","generatorURL":"https://prometheus.example.invalid/graph","fingerprint":"abc123"}]}`)
	first, err := Parse(body)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Parse(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || len(second) != 1 || string(first[0]) != string(second[0]) {
		t.Fatalf("repeated firing conversion differs: %q vs %q", first, second)
	}
	fields := decodeEvent(t, first[0])
	if fields["id"] != "abc123:2026-10-03T10:00:00Z:firing" || fields["time"] != "2026-10-03T10:00:00Z" || fields["type"] != "alertmanager.alert.firing" {
		t.Fatalf("unexpected firing event: %#v", fields)
	}
	if fields["source"] != "urn:signalhub:alertmanager:ops" || fields["severity"] != "critical" || fields["summary"] != "Disk is full" {
		t.Fatalf("unexpected mapped attributes: %#v", fields)
	}
}

func TestParseAlertmanagerResolvedChangesIDAndTime(t *testing.T) {
	firing, err := Parse([]byte(webhookForStatus("firing")))
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := Parse([]byte(webhookForStatus("resolved")))
	if err != nil {
		t.Fatal(err)
	}
	firingEvent := decodeEvent(t, firing[0])
	resolvedEvent := decodeEvent(t, resolved[0])
	if firingEvent["id"] == resolvedEvent["id"] {
		t.Fatal("resolved event reused firing id")
	}
	if resolvedEvent["time"] != "2026-10-03T11:00:00Z" || resolvedEvent["type"] != "alertmanager.alert.resolved" {
		t.Fatalf("unexpected resolved event: %#v", resolvedEvent)
	}
}

func TestParseAlertmanagerKeepsValidAlertsWhenMemberInvalid(t *testing.T) {
	body := `{"version":"4","groupKey":"g","receiver":"ops","status":"firing","alerts":[{"status":"firing","labels":{"alertname":"A"},"annotations":{},"startsAt":"2026-10-03T10:00:00Z","endsAt":"2026-10-03T11:00:00Z","generatorURL":"https://prometheus.example.invalid/graph","fingerprint":"ok"},{"status":"unknown","labels":{},"annotations":{},"startsAt":"2026-10-03T10:00:00Z","endsAt":"2026-10-03T11:00:00Z","generatorURL":"https://prometheus.example.invalid/graph","fingerprint":"bad"}]}`
	items, err := Parse([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("got %d output items", len(items))
	}
	if _, err := event.Parse(items[0]); err != nil {
		t.Fatalf("first event should be valid: %v", err)
	}
	if _, err := event.Parse(items[1]); err == nil {
		t.Fatal("invalid alert should remain an invalid event result")
	}
}

func TestParseAlertmanagerAllowsEmptyAlertsAndRejectsOversize(t *testing.T) {
	items, err := Parse([]byte(`{"version":"4","groupKey":"g","receiver":"ops","status":"firing","alerts":[]}`))
	if err != nil || len(items) != 0 {
		t.Fatalf("empty alerts: items=%v err=%v", items, err)
	}
	alerts := make([]json.RawMessage, 101)
	for i := range alerts {
		alerts[i] = json.RawMessage(`null`)
	}
	body, _ := json.Marshal(map[string]any{"version": "4", "groupKey": "g", "receiver": "ops", "status": "firing", "alerts": alerts})
	if _, err := Parse(body); err == nil {
		t.Fatal("expected more than 100 alerts to fail")
	}
}

func TestParseAlertmanagerInvalidEnvelopeErrorIsGeneric(t *testing.T) {
	_, err := Parse([]byte(`{"version":"3","groupKey":"private-value","receiver":"ops","status":"firing","alerts":[]}`))
	if err == nil || err.Error() != "invalid Alertmanager webhook" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func decodeEvent(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	value, err := event.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	fields, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("event output is not object: %T", value)
	}
	return fields
}

func webhookForStatus(status string) string {
	return `{"version":"4","groupKey":"g","receiver":"ops","status":"` + status + `","alerts":[{"status":"` + status + `","labels":{"alertname":"DiskFull","severity":"critical"},"annotations":{"summary":"Disk is full"},"startsAt":"2026-10-03T10:00:00Z","endsAt":"2026-10-03T11:00:00Z","generatorURL":"https://prometheus.example.invalid/graph?g0.expr=disk","fingerprint":"abc123"}]}`
}

func TestParseAlertmanagerTruncatedAlertsIntegerSemantics(t *testing.T) {
	for _, tc := range []struct {
		value string
		valid bool
	}{
		{value: `1.0`, valid: true},
		{value: `1e0`, valid: true},
		{value: `0`, valid: true},
		{value: `-1`, valid: false},
		{value: `1.5`, valid: false},
	} {
		body := `{"version":"4","groupKey":"g","receiver":"ops","status":"firing","alerts":[],"truncatedAlerts":` + tc.value + `}`
		_, err := Parse([]byte(body))
		if (err == nil) != tc.valid {
			t.Errorf("truncatedAlerts=%s: err=%v, want valid=%v", tc.value, err, tc.valid)
		}
	}
}
