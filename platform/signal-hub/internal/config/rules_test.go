package config

import (
	"strings"
	"testing"
)

func TestM3AcceptsValidatedRules(t *testing.T) {
	rule := `{"id":"deploy-count","version":1,"title":"Deploys","filter":{"types":["release.deploy.*"]},"aggregation":{"fn":"count"},"bucket":"1h"}`
	raw := strings.Replace(string(bundle(source)), `"rules":[]`, `"rules":[`+rule+`]`, 1)
	cfg, err := Parse([]byte(raw))
	if err != nil {
		t.Fatalf("valid M3 rule rejected: %v", err)
	}
	if len(cfg.Rules) != 1 {
		t.Fatal("rule was lost")
	}
	for _, bad := range []string{
		strings.Replace(raw, "release.deploy.*", "signalhub.rule.*", 1),
		strings.Replace(raw, `"rules":[`+rule+`]`, `"rules":[`+rule+`,`+rule+`]`, 1),
		strings.Replace(raw, `"aggregation":{"fn":"count"}`, `"aggregation":{"fn":"sum"}`, 1),
		strings.Replace(raw, `"subscriptions":[]`, `"subscriptions":[{}]`, 1),
	} {
		if _, err := Parse([]byte(bad)); err == nil {
			t.Fatal("invalid rule/subscription accepted")
		}
	}
}
