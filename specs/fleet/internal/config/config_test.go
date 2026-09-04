package config

import (
	"os"
	"testing"
)

func TestLoadFleetdRequired(t *testing.T) {
	t.Setenv("FLEET_UI_HOSTNAME", "")
	t.Setenv("FLEET_API_HOSTNAME", "")
	if _, err := LoadFleetd(); err == nil {
		t.Fatal("expected error")
	}
}

func TestLoadFleetdDefaults(t *testing.T) {
	t.Setenv("FLEET_UI_HOSTNAME", "fleet.example.com")
	t.Setenv("FLEET_API_HOSTNAME", "fleet-api.example.com")
	t.Setenv("FLEET_BASE_DOMAIN", "example.com")
	t.Setenv("CF_BASE_DOMAIN", "ignored.example")
	c, err := LoadFleetd()
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen != DefaultListen {
		t.Fatalf("listen %q", c.Listen)
	}
	if c.BaseDomain != "example.com" {
		t.Fatal(c.BaseDomain)
	}
	if len(c.AllowedSuffixes) != 1 || c.AllowedSuffixes[0] != "example.com" {
		t.Fatalf("%v", c.AllowedSuffixes)
	}
	if c.ProtectedHostnames[0] != "fleet.example.com" {
		t.Fatal(c.ProtectedHostnames)
	}
	// CF_BASE_DOMAIN is not an alias.
	if c.BaseDomain == os.Getenv("CF_BASE_DOMAIN") {
		t.Fatal("must not read CF_BASE_DOMAIN")
	}
}

func TestLoadAgent(t *testing.T) {
	t.Setenv("FLEET_URL", "https://fleet-api.example.com")
	t.Setenv("FLEET_NODE_ID", "vps-hel-1")
	c, err := LoadAgent()
	if err != nil {
		t.Fatal(err)
	}
	if c.TokenFile != DefaultTokenFile || c.AgentComposeFile != DefaultAgentStack {
		t.Fatalf("%+v", c)
	}
}
