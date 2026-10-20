package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAC89ConfigCheckRejectsSecondDocument(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{name: "two documents", body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n---\ngroups:\n  - name: h\n    rules:\n      - alert: B\n        expr: up\n"},
		{name: "trailing document", body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n---\n"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := loadRulesBody(t, test.body)
			if err == nil || !strings.Contains(err.Error(), "more than one YAML document") {
				t.Fatalf("LoadWithEnvironment() error = %v", err)
			}
		})
	}
}

func TestAC89ConfigCheckAcceptsSingleDocument(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{name: "leading document", body: "---\ngroups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n"},
		{name: "trailing dots", body: "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n...\n"},
		{name: "only document start", body: "---\n"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if err := loadRulesBody(t, test.body); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAC90ConfigCheckAcceptsEmptyRules(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{name: "empty", body: ""},
		{name: "comment", body: "# only a comment\n"},
		{name: "groups empty", body: "groups: []\n"},
		{name: "groups null", body: "groups:\n"},
		{name: "rules empty", body: "groups:\n  - name: g\n    rules: []\n"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if err := loadRulesBody(t, test.body); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func loadRulesBody(t *testing.T, body string) error {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "rule.yaml"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	fixture := loadFixture(t)
	path := writeFixtureFile(t, "rules-config.yaml", strings.Replace(fixture, fixturePath(t, "rules"), dir, 1))
	_, err := LoadWithEnvironment(t.Context(), path, nil)
	return err
}
