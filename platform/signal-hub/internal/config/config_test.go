package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const source = `{"name":"release","source_prefix":"urn:example:release:","allowed_types":["release.deploy.*"],"token_ref":"file:/run/secrets/synthetic.token"}`

func bundle(s string) []byte {
	return []byte(`{"sources":[` + s + `],"rules":[],"subscriptions":[],"webhook_allowlist":[]}`)
}

func TestLoadM1Config(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, bundle(source), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Sources) != 1 || c.Sources[0].SourcePrefix != "urn:example:release:" {
		t.Fatalf("unexpected config: %#v", c)
	}
}

func TestSourcesM0Fixtures(t *testing.T) {
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
	for _, c := range cases {
		if c.Schema != "sources" {
			continue
		}
		t.Run(c.Name, func(t *testing.T) {
			var m map[string]json.RawMessage
			if err := json.Unmarshal(c.Instance, &m); err != nil {
				t.Fatal(err)
			}
			data := []byte(`{"sources":` + string(m["sources"]) + `,"rules":[],"subscriptions":[],"webhook_allowlist":[]}`)
			_, err := Parse(data)
			if (err == nil) != c.Valid {
				t.Fatalf("valid=%v error=%v", c.Valid, err)
			}
		})
	}
}

func TestRejectUnsupportedOrInvalidConfig(t *testing.T) {
	bad := []string{
		`sources: []`, `{"sources":[],"rules":[],"subscriptions":[],"webhook_allowlist":[],"extra":true}`,
		`{"sources":[],"rules":[],"rules":[],"subscriptions":[],"webhook_allowlist":[]}`,
		`{"sources":[],"rules":[{}],"subscriptions":[],"webhook_allowlist":[]}`,
		`{"sources":[],"rules":[],"subscriptions":[{}],"webhook_allowlist":[]}`,
		`{"sources":[],"rules":[],"subscriptions":[],"webhook_allowlist":["http://example.invalid/a"]}`,
		`{"sources":[],"rules":[],"subscriptions":[],"webhook_allowlist":["https://example.invalid/a","https://example.invalid/a"]}`,
		string(bundle(source + "," + source)),
		string(bundle(strings.Replace(source, `release.deploy.*`, `signalhub.rule.*`, 1))),
		string(bundle(strings.Replace(source, `file:/run/secrets/synthetic.token`, `inline:secret`, 1))),
		string(bundle(strings.Replace(source, `"release"`, `"Bad-Name"`, 1))),
		string(bundle(strings.TrimSuffix(source, "}") + `,"unexpected":true}`)),
		string(bundle(strings.TrimSuffix(source, "}") + `,"retention_days":1.1}`)),
	}
	for _, raw := range bad {
		if _, err := Parse([]byte(raw)); err == nil {
			t.Errorf("accepted invalid config: %s", raw)
		}
	}
}
