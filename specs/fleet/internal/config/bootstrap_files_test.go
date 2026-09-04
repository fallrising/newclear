package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestControlPlaneCompose(t *testing.T) {
	_, this, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(this), "..", "..")
	b, err := os.ReadFile(filepath.Join(root, "deploy", "fleet-control", "docker-compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, want := range []string{
		"127.0.0.1:18765:18765",
		"TUNNEL_TOKEN: ${FLEET_BOOTSTRAP_TUNNEL_TOKEN}",
		"network_mode: host",
		"name: fleet-control",
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %q", want)
		}
	}
}

func TestGHAPinnedYQ(t *testing.T) {
	_, this, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(this), "..", "..")
	for _, rel := range []string{
		filepath.Join("contrib", "github-actions", "deploy.yml"),
		filepath.Join("examples", "hello-healthz", ".github", "workflows", "deploy.yml"),
	} {
		b, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			t.Fatal(err)
		}
		s := string(b)
		if !strings.Contains(s, "mikefarah/yq@bbdd97482f2d439126582a59689eb1c855944955") {
			t.Fatalf("%s yq not pinned to v4.44.3 SHA", rel)
		}
		if strings.Contains(s, "yq@master") {
			t.Fatalf("%s uses @master", rel)
		}
		if !strings.Contains(s, "/api/v1/deploy") {
			t.Fatalf("%s missing deploy API", rel)
		}
	}
}

func TestWARPBootstrapDoc(t *testing.T) {
	_, this, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(this), "..", "..")
	b, err := os.ReadFile(filepath.Join(root, "docs", "bootstrap.md"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, want := range []string{
		"100.64.0.0/10",
		"100.80.0.0/16",
		"Local Domain Fallback",
		"fleet.internal",
		"connect-private-hostname",
		"FLEET_BOOTSTRAP_TUNNEL_ID",
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("bootstrap.md missing %q", want)
		}
	}
}
