package rules

import (
	"encoding/json"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"strings"
	"testing"
)

func TestParseRejectsReservedRuleLoop(t *testing.T) {
	raw := json.RawMessage(`{"id":"count","version":1,"title":"Count","filter":{"types":["signalhub.rule.*"]},"aggregation":{"fn":"count"},"bucket":"1h"}`)
	if _, err := Parse([]json.RawMessage{raw}); err == nil {
		t.Fatal("reserved rules prefix accepted")
	}
}

func TestParseValidation(t *testing.T) {
	valid := `{"id":"count","version":1,"title":"Count","filter":{"types":["test.event"]},"aggregation":{"fn":"count"},"bucket":"1h"}`
	for _, tc := range []struct{ name, old, replacement string }{
		{"duplicate", `"version":1`, `"version":1,"version":2`},
		{"unknown", `"version":1`, `"version":1,"script":"x"`},
		{"no types", `"types":["test.event"]`, `"sources":["urn:test"]`},
		{"empty types", `["test.event"]`, `[]`},
		{"ancestor loop", `test.event`, `signalhub.*`},
		{"exact loop", `test.event`, `signalhub.rule.failed`},
		{"null filter", `{"types":["test.event"]}`, `null`},
		{"sources null", `"types":["test.event"]`, `"types":["test.event"],"sources":null`},
		{"sources empty", `"types":["test.event"]`, `"types":["test.event"],"sources":[]`},
		{"sources middle wildcard", `"types":["test.event"]`, `"types":["test.event"],"sources":["urn:*:test"]`},
		{"invalid field", `"fn":"count"`, `"fn":"sum","field":"data.a.b.c.d"`},
		{"missing field", `"fn":"count"`, `"fn":"sum"`},
		{"count field", `"fn":"count"`, `"fn":"count","field":"subject"`},
		{"invalid bucket", `"1h"`, `"2h"`},
		{"zero version", `"version":1`, `"version":0`},
		{"null group", `"bucket":"1h"`, `"bucket":"1h","group_by":null`},
		{"duplicate group", `"bucket":"1h"`, `"bucket":"1h","group_by":["source","source"]`},
		{"three groups", `"bucket":"1h"`, `"bucket":"1h","group_by":["source","subject","type"]`},
		{"nested data", `"types":["test.event"]`, `"types":["test.event"],"data":{"a":{}}`},
		{"threshold missing value", `"bucket":"1h"`, `"bucket":"1h","threshold":{"op":">","for_buckets":1,"severity":"info"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := strings.Replace(valid, tc.old, tc.replacement, 1)
			if _, err := Parse([]json.RawMessage{json.RawMessage(raw)}); err == nil {
				t.Fatalf("accepted %s", raw)
			}
		})
	}
	if _, err := Parse([]json.RawMessage{json.RawMessage(valid), json.RawMessage(valid)}); err == nil {
		t.Fatal("duplicate id accepted")
	}
	parsed, err := Parse([]json.RawMessage{json.RawMessage(valid)})
	if err != nil || len(parsed) != 1 {
		t.Fatalf("valid: %v", err)
	}
}

func TestTypedFiltersAndCanonicalGroups(t *testing.T) {
	raw := json.RawMessage(`{"id":"typed","version":1,"title":"Typed","filter":{"types":["test.event.*"],"sources":["urn:fixture*"],"severity_min":"info","subject_prefix":"job","data":{"nested.enabled":false,"nil":null,"n":1}},"aggregation":{"fn":"count"},"bucket":"1d","group_by":["data.missing","data.group"]}`)
	rr, err := Parse([]json.RawMessage{raw})
	if err != nil {
		t.Fatal(err)
	}
	r := rr[0]
	decode := func(raw string) map[string]any {
		t.Helper()
		v, err := event.Decode([]byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	fixture := `{"type":"test.event.ok","source":"urn:fixture:one","subject":"job-1","data":{"nested":{"enabled":false},"nil":null,"n":1.0,"group":"__other__"}}`
	fields := decode(fixture)
	if !r.Matches(fields) {
		t.Fatal("typed filter rejected")
	}
	key, err := r.GroupKey(fields)
	if err != nil || key != `[null,"__other__"]` {
		t.Fatalf("key %s %v", key, err)
	}
	for _, raw := range []string{strings.Replace(fixture, `false`, `0`, 1), strings.Replace(fixture, `"nil":null,`, ``, 1), strings.Replace(fixture, `"job-1"`, `"other"`, 1), strings.Replace(fixture, `"test.event.ok"`, `"test"`, 1)} {
		if r.Matches(decode(raw)) {
			t.Fatalf("matched %s", raw)
		}
	}
}

func TestSchemaIntegerForms(t *testing.T) {
	raw := json.RawMessage(`{"id":"integer","version":1.0,"title":"Integer","filter":{"types":["test.event"]},"aggregation":{"fn":"count"},"bucket":"1h","threshold":{"op":">","value":0,"for_buckets":1e0,"severity":"info"}}`)
	rr, err := Parse([]json.RawMessage{raw})
	if err != nil || rr[0].Version != 1 || rr[0].Threshold.ForBuckets != 1 {
		t.Fatalf("schema integer forms %v %v", rr, err)
	}
}
