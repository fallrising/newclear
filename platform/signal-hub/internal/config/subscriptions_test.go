package config

import (
	"encoding/json"
	"os"
	"testing"
)

func TestM4SubscriptionActivationConfig(t *testing.T) {
	raw := []byte(`{"sources":[],"rules":[],"subscriptions":[{"id":"test-hook","filter":{"types":["release.deploy.*"]},"channel":{"kind":"webhook","url":"https://receiver.example.invalid/hook","secret_ref":"file:/run/secrets/synthetic"},"mode":"immediate"}],"webhook_allowlist":["https://receiver.example.invalid/hook"]}`)
	cfg, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Subscriptions) != 1 {
		t.Fatal("subscription was dropped")
	}
}

func TestM4ConfigurationFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Schema string
		Valid        bool
		Instance     json.RawMessage
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		if tc.Schema != "config" {
			continue
		}
		t.Run(tc.Name, func(t *testing.T) {
			_, err := Parse(tc.Instance)
			if (err == nil) != tc.Valid {
				t.Fatalf("valid=%v error=%v", tc.Valid, err)
			}
		})
	}
}
