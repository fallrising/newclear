package fleetfile

import (
	"encoding/json"
	"strings"
	"testing"
)

func validRaw() map[string]any {
	return map[string]any{"apiVersion": APIVersionV1, "kind": KindService,
		"metadata": map[string]any{"name": "hello"},
		"spec":     map[string]any{"node": "node-1", "image": "busybox:latest", "expose": map[string]any{"mode": ModePublic, "port": 8080}}}
}

func TestRawSchemaRejectsNullAndInvalidPresentValues(t *testing.T) {
	mutations := map[string]func(map[string]any){
		"null args":      func(s map[string]any) { s["args"] = nil },
		"null argv":      func(s map[string]any) { s["args"] = []any{nil} },
		"null replica":   func(s map[string]any) { s["replicas"] = nil },
		"null state":     func(s map[string]any) { s["desiredState"] = nil },
		"empty state":    func(s map[string]any) { s["desiredState"] = "" },
		"empty image":    func(s map[string]any) { s["image"] = "" },
		"null image":     func(s map[string]any) { s["image"] = nil },
		"null env":       func(s map[string]any) { s["env"] = map[string]any{"SAFE": nil} },
		"null resources": func(s map[string]any) { s["resources"] = nil },
		"empty memory":   func(s map[string]any) { s["resources"] = map[string]any{"memory": ""} },
		"empty cpus":     func(s map[string]any) { s["resources"] = map[string]any{"cpus": ""} },
		"empty health":   func(s map[string]any) { s["expose"].(map[string]any)["healthPath"] = "" },
		"null health":    func(s map[string]any) { s["expose"].(map[string]any)["healthPath"] = nil },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			raw := validRaw()
			mutate(raw["spec"].(map[string]any))
			b, _ := json.Marshal(raw)
			doc, err := ParseJSON(b)
			if err == nil {
				err = Validate(doc, TestConfig())
			}
			if err == nil {
				t.Fatalf("schema-invalid JSON accepted: %s", b)
			}
		})
	}
}

func TestYAMLDoesNotCoerceTypesOrIgnoreDocuments(t *testing.T) {
	base := "apiVersion: fleet.catalog/v1\nkind: Service\nmetadata:\n  name: hello\nspec:\n  node: node-1\n  image: busybox:latest\n  expose:\n    mode: public\n    port: 8080\n"
	for _, input := range []string{base + "  args: [true]\n", base + "  env: {SAFE: 123}\n", base + "---\nprivileged: true\n"} {
		doc, err := ParseYAML([]byte(input))
		if err == nil {
			err = Validate(doc, TestConfig())
		}
		if err == nil {
			t.Fatalf("invalid YAML accepted: %s", input)
		}
	}
}

func TestHostnameNormalizationAndSyntax(t *testing.T) {
	for _, host := range []string{"fleet.example.com.", "FLEET-API.EXAMPLE.COM.", "bad name.example.com", "-bad.example.com", "a..example.com"} {
		raw := validRaw()
		raw["spec"].(map[string]any)["expose"].(map[string]any)["hostname"] = host
		b, _ := json.Marshal(raw)
		doc, err := ParseJSON(b)
		if err == nil {
			err = Validate(doc, TestConfig())
		}
		if err == nil {
			t.Fatalf("unsafe hostname accepted: %q", host)
		}
	}
	raw := validRaw()
	raw["spec"].(map[string]any)["expose"].(map[string]any)["hostname"] = "HELLO.EXAMPLE.COM."
	b, _ := json.Marshal(raw)
	doc, err := ParseJSON(b)
	if err != nil {
		t.Fatal(err)
	}
	if err := Validate(doc, TestConfig()); err != nil {
		t.Fatal(err)
	}
	if doc.Spec.Expose.Hostname != "hello.example.com" {
		t.Fatalf("hostname not canonical: %q", doc.Spec.Expose.Hostname)
	}
}

func TestUnicodeSchemaLengthUsesCharacters(t *testing.T) {
	raw := validRaw()
	raw["metadata"].(map[string]any)["description"] = strings.Repeat("界", 512)
	raw["spec"].(map[string]any)["env"] = map[string]any{"SAFE": strings.Repeat("界", 4096)}
	b, _ := json.Marshal(raw)
	doc, err := ParseJSON(b)
	if err != nil {
		t.Fatal(err)
	}
	if err := Validate(doc, TestConfig()); err != nil {
		t.Fatal(err)
	}
	doc.Metadata.Description += "界"
	if err := Validate(doc, TestConfig()); err == nil {
		t.Fatal("overlong Unicode description accepted")
	}
}
