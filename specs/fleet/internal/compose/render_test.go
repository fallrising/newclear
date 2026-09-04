package compose

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/fallrising/fleet-catalog/internal/fleetfile"
	"gopkg.in/yaml.v3"
)

func TestRenderFilesGolden(t *testing.T) {
	_, this, _, _ := runtime.Caller(0)
	p := filepath.Join(filepath.Dir(this), "..", "..", "examples", "private-files", "fleet.yaml")
	doc, err := fleetfile.ParseFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := fleetfile.Validate(doc, fleetfile.TestConfig()); err != nil {
		t.Fatal(err)
	}
	out, env, err := Render(Input{
		Doc:        doc,
		Image:      "ghcr.io/fallrising/file-relay:cafebabe",
		HostPort:   20014,
		ReleaseID:  "rel_01HZX...",
		Generation: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	goldenPath := filepath.Join(filepath.Dir(this), "..", "..", "testdata", "compose", "files.golden.yaml")
	g, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	assertYAMLEq(t, string(g), out)
	if env != "" {
		t.Fatalf("unexpected env %q", env)
	}
}

func TestRenderHelloGolden(t *testing.T) {
	_, this, _, _ := runtime.Caller(0)
	p := filepath.Join(filepath.Dir(this), "..", "..", "examples", "hello-healthz", "fleet.yaml")
	doc, err := fleetfile.ParseFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := fleetfile.Validate(doc, fleetfile.TestConfig()); err != nil {
		t.Fatal(err)
	}
	out, env, err := Render(Input{
		Doc:        doc,
		Image:      "ghcr.io/fallrising/hello-healthz:a1b2c3d",
		HostPort:   20001,
		ReleaseID:  "rel_01HZXHELLO000000000000000",
		Generation: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	goldenPath := filepath.Join(filepath.Dir(this), "..", "..", "testdata", "compose", "hello.golden.yaml")
	g, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	assertYAMLEq(t, string(g), out)
	if env != "LOG_LEVEL=info\n" {
		t.Fatalf("env %q", env)
	}
}

func TestValidateRejectsPublicBind(t *testing.T) {
	err := ValidateOutput("name: fleet-hello\nservices:\n  app:\n    ports: [\"0.0.0.0:80:80\"]\n", "hello")
	if err == nil {
		t.Fatal("expected error")
	}
}

func assertYAMLEq(t *testing.T, want, got string) {
	t.Helper()
	if strings.TrimSpace(want) != strings.TrimSpace(got) {
		t.Fatalf("yaml mismatch\nwant:\n%s\ngot:\n%s", want, got)
	}
	var w, g any
	if err := yaml.Unmarshal([]byte(want), &w); err != nil {
		t.Fatal(err)
	}
	if err := yaml.Unmarshal([]byte(got), &g); err != nil {
		t.Fatal(err)
	}
}
