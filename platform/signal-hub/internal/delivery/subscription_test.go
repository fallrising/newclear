package delivery

import (
	"encoding/json"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"os"
	"strings"
	"testing"
)

const validSubscription = `{"id":"test-hook","filter":{"types":["release.deploy.*"]},"channel":{"kind":"webhook","url":"https://receiver.example.invalid/hook","secret_ref":"file:/run/secrets/synthetic"},"mode":"immediate"}`

var allowlist = []string{"https://receiver.example.invalid/hook", "https://ntfy.example.invalid/topic"}

func TestSubscriptionFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Schema string
		Valid        bool
		Instance     struct {
			Subscriptions []json.RawMessage `json:"subscriptions"`
		}
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, tc := range fixtures {
		if tc.Schema != "subscriptions" {
			continue
		}
		t.Run(tc.Name, func(t *testing.T) {
			allowed := []string{}
			for _, raw := range tc.Instance.Subscriptions {
				var value Subscription
				_ = json.Unmarshal(raw, &value)
				if ValidURL(value.Channel.URL) {
					found := false
					for _, v := range allowed {
						if v == value.Channel.URL {
							found = true
						}
					}
					if !found {
						allowed = append(allowed, value.Channel.URL)
					}
				}
			}
			_, err := Parse(tc.Instance.Subscriptions, allowed)
			if (err == nil) != tc.Valid {
				t.Fatalf("valid=%v error=%v", tc.Valid, err)
			}
		})
	}
}
func TestStrictSubscriptions(t *testing.T) {
	good, err := Parse([]json.RawMessage{json.RawMessage(validSubscription)}, allowlist)
	if err != nil || good[0].Start != "now" {
		t.Fatalf("default start: %v", err)
	}
	invalid := []string{
		strings.Replace(validSubscription, `"mode":"immediate"`, `"mode":"immediate","start":""`, 1),
		strings.Replace(validSubscription, `"mode":"immediate"`, `"mode":"immediate","unexpected":true`, 1),
		strings.Replace(validSubscription, `"mode":"immediate"`, `"mode":"immediate","digest":null`, 1),
		strings.Replace(validSubscription, `"id":"test-hook"`, `"id":"test-hook","id":"second"`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"types":[]`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"sources":null`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"types":["release.deploy.*"],"data":{"x":[]}`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"types":["release.deploy.*"],"data":{"x.y.z.q":1}`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"types":["release.deploy.*"],"severity_min":""`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"types":["release.deploy.*"],"unknown":true`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"types":["signalhub.*"]`, 1),
		strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"types":["signalhub.delivery.dlq"],"subject_prefix":"test"`, 1),
		strings.Replace(validSubscription, `"secret_ref":"file:/run/secrets/synthetic"`, `"secret_ref":"file:/run/secrets/synthetic","token_ref":""`, 1),
		strings.Replace(validSubscription, `https://receiver.example.invalid/hook`, `https://receiver.example.invalid/hook/`, 1),
		strings.Replace(validSubscription, `"filter":{"types":["release.deploy.*"]}`, `"filter":null`, 1),
	}
	for i, raw := range invalid {
		if _, err := Parse([]json.RawMessage{json.RawMessage(raw)}, allowlist); err == nil {
			t.Errorf("accepted invalid case %d", i)
		}
	}
	for _, kind := range []string{"webhook", "ntfy"} {
		raw := validSubscription
		if kind == "ntfy" {
			raw = strings.ReplaceAll(strings.ReplaceAll(raw, "webhook", "ntfy"), "secret_ref", "token_ref")
		}
		if _, err := Parse([]json.RawMessage{json.RawMessage(raw)}, nil); err == nil {
			t.Errorf("%s bypassed empty allowlist", kind)
		}
	}
	safe := Safe(good[0])
	serialized, _ := json.Marshal(safe)
	if strings.Contains(string(serialized), "example.invalid") || strings.Contains(string(serialized), "file:") || safe.Channel.Kind != "webhook" {
		t.Fatal("unsafe persistent definition")
	}
}
func TestURLSyntax(t *testing.T) {
	for _, raw := range []string{"http://receiver.example.invalid/", "https://user@receiver.example.invalid/", "https://receiver.example.invalid/#fragment", "https://receiver.example.invalid/\n", "https://[fe80::1%25eth0]/", "https:///path", "https://[::ffff:100.64.0.1]/", "https://receiver.example.invalid?bare=query"} {
		if ValidURL(raw) {
			t.Errorf("accepted forbidden URL %q", raw)
		}
	}
	for _, raw := range []string{"https://receiver.example.invalid/", "https://receiver.example.invalid:443/path?q=ok", "https://[fd7a:115c:a1e0::1]/"} {
		if !ValidURL(raw) {
			t.Errorf("rejected URL %q", raw)
		}
	}
}
func TestTypedFilterAndOwnFailure(t *testing.T) {
	raw := strings.Replace(validSubscription, `"types":["release.deploy.*"]`, `"sources":["urn:example:*"],"subject_prefix":"safe-","data":{"a":null,"b":false}`, 1)
	subs, err := Parse([]json.RawMessage{json.RawMessage(raw)}, allowlist)
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]any{"type": "release.deploy.done", "source": "urn:example:release", "subject": "safe-service", "data": map[string]any{"a": nil, "b": false}}
	if !Match(subs[0], &event.Event{Fields: fields}) {
		t.Fatal("null/bool match failed")
	}
	fields["data"] = map[string]any{"a": nil, "b": json.Number("0")}
	if Match(subs[0], &event.Event{Fields: fields}) {
		t.Fatal("false equals zero")
	}
	fields["data"] = map[string]any{"b": false}
	if Match(subs[0], &event.Event{Fields: fields}) {
		t.Fatal("missing equals null")
	}
}
