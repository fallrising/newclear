package fleetfile

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func testdata(t *testing.T, elem ...string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	parts := append([]string{filepath.Dir(file), "..", "..", "testdata"}, elem...)
	return filepath.Join(parts...)
}

func loadYAML(t *testing.T, name string) *Document {
	t.Helper()
	b, err := os.ReadFile(testdata(t, "fleetfile", name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	doc, err := ParseYAML(b)
	if err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
	return doc
}

func TestValidExamples(t *testing.T) {
	cfg := TestConfig()
	for _, name := range []string{
		"valid-public.yaml",
		"valid-access.yaml",
		"valid-private.yaml",
	} {
		t.Run(name, func(t *testing.T) {
			doc := loadYAML(t, name)
			if err := Validate(doc, cfg); err != nil {
				t.Fatalf("unexpected: %v", err)
			}
			if doc.Spec.Expose.Hostname == "" {
				t.Fatal("hostname not materialized")
			}
			if doc.Spec.Expose.HealthPath != "/healthz" && doc.Spec.Expose.HealthPath == "" {
				t.Fatal("healthPath default")
			}
		})
	}
}

func TestRepoExamples(t *testing.T) {
	cfg := TestConfig()
	roots := []string{
		filepath.Join(testdata(t, ".."), "examples", "hello-healthz", "fleet.yaml"),
		filepath.Join(testdata(t, ".."), "examples", "access-dashboard", "fleet.yaml"),
		filepath.Join(testdata(t, ".."), "examples", "private-files", "fleet.yaml"),
	}
	for _, p := range roots {
		t.Run(filepath.Base(filepath.Dir(p)), func(t *testing.T) {
			doc, err := ParseFile(p)
			if err != nil {
				t.Fatal(err)
			}
			if err := Validate(doc, cfg); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReservedNames(t *testing.T) {
	cfg := TestConfig()
	for _, name := range []string{"invalid-reserved-ui.yaml", "invalid-reserved-fleet-agent.yaml"} {
		t.Run(name, func(t *testing.T) {
			doc := loadYAML(t, name)
			err := Validate(doc, cfg)
			ve, ok := err.(*Error)
			if !ok || !ve.HasCode("name_reserved") {
				t.Fatalf("want name_reserved, got %v", err)
			}
		})
	}
}

func TestHostnameProtected(t *testing.T) {
	cfg := TestConfig()
	doc := loadYAML(t, "invalid-hostname-protected.yaml")
	err := Validate(doc, cfg)
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("hostname_protected") {
		t.Fatalf("want hostname_protected, got %v", err)
	}
}

func TestHostnameProtectedAPI(t *testing.T) {
	cfg := TestConfig()
	doc := loadYAML(t, "invalid-hostname-protected-api.yaml")
	err := Validate(doc, cfg)
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("hostname_protected") {
		t.Fatalf("want hostname_protected, got %v", err)
	}
}

func TestSecretInEnv(t *testing.T) {
	cfg := TestConfig()
	doc := loadYAML(t, "invalid-secret-in-env.yaml")
	err := Validate(doc, cfg)
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("secret_in_env") {
		t.Fatalf("want secret_in_env, got %v", err)
	}
}

func TestPublicLargeOrigin(t *testing.T) {
	cfg := TestConfig()
	doc := loadYAML(t, "invalid-large-origin-public.yaml")
	err := Validate(doc, cfg)
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("public_large_origin") {
		t.Fatalf("want public_large_origin, got %v", err)
	}
}

func TestUnsupportedVersion(t *testing.T) {
	doc := loadYAML(t, "invalid-version.yaml")
	err := Validate(doc, TestConfig())
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("unsupported_version") {
		t.Fatalf("want unsupported_version, got %v", err)
	}
}

func TestPrivateHostnameInvalid(t *testing.T) {
	doc := loadYAML(t, "invalid-private-hostname.yaml")
	err := Validate(doc, TestConfig())
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("private_hostname_invalid") {
		t.Fatalf("want private_hostname_invalid, got %v", err)
	}
}

func TestImageRequired(t *testing.T) {
	doc := loadYAML(t, "valid-public.yaml")
	doc.Spec.Image = ""
	cfg := TestConfig()
	cfg.RequireImage = true
	err := Validate(doc, cfg)
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("image_required") {
		t.Fatalf("want image_required, got %v", err)
	}
}

func TestNodeNotFound(t *testing.T) {
	doc := loadYAML(t, "valid-public.yaml")
	cfg := TestConfig()
	cfg.NodeExists = func(string) bool { return false }
	err := Validate(doc, cfg)
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("node_not_found") {
		t.Fatalf("want node_not_found, got %v", err)
	}
}

func TestAdditionalProperty(t *testing.T) {
	b := []byte(`
apiVersion: fleet.catalog/v1
kind: Service
metadata:
  name: hello
spec:
  node: vps-hel-1
  privileged: true
  expose:
    mode: public
    hostname: hello.example.com
    port: 8080
`)
	_, err := ParseYAML(b)
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("additional_property") {
		t.Fatalf("want additional_property, got %v", err)
	}
}

func TestEnvSecretOverlap(t *testing.T) {
	doc := loadYAML(t, "invalid-env-secret-overlap.yaml")
	err := Validate(doc, TestConfig())
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("env_secret_overlap") {
		t.Fatalf("want env_secret_overlap, got %v", err)
	}
}

func TestVolumeNameDup(t *testing.T) {
	doc := loadYAML(t, "invalid-volume-dup.yaml")
	err := Validate(doc, TestConfig())
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("volume_name_dup") {
		t.Fatalf("want volume_name_dup, got %v", err)
	}
}

func TestHostnameNotAllowed(t *testing.T) {
	doc := loadYAML(t, "invalid-hostname-suffix.yaml")
	err := Validate(doc, TestConfig())
	ve, ok := err.(*Error)
	if !ok || !ve.HasCode("hostname_not_allowed") {
		t.Fatalf("want hostname_not_allowed, got %v", err)
	}
}

func TestDefaultPrivateHostname(t *testing.T) {
	doc := &Document{
		APIVersion: APIVersionV1,
		Kind:       KindService,
		Metadata:   Metadata{Name: "files"},
		Spec: Spec{
			Node: "vps-hel-1",
			Expose: Expose{
				Mode: ModePrivate,
				Port: 8080,
			},
		},
	}
	if err := Validate(doc, TestConfig()); err != nil {
		t.Fatal(err)
	}
	if doc.Spec.Expose.Hostname != "files.fleet.internal" {
		t.Fatalf("got %q", doc.Spec.Expose.Hostname)
	}
}
