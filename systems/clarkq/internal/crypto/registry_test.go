package crypto

import (
	"testing"
)

func TestRegistryModeFor(t *testing.T) {
	reg, err := NewRegistry("none", map[string]string{
		"secure": "server_rsa",
		"e2e":    "client",
	}, "", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	if got := reg.ModeFor("orders"); got != "none" {
		t.Fatalf("default queue mode = %q", got)
	}
	if got := reg.ModeFor("secure"); got != "server_rsa" {
		t.Fatalf("secure mode = %q", got)
	}
	if got := reg.ModeFor("e2e"); got != "client" {
		t.Fatalf("e2e mode = %q", got)
	}

	if reg.ProviderFor("orders").Mode() != "none" {
		t.Fatal("expected noop provider for default queue")
	}
	if reg.ProviderFor("e2e").Mode() != "client" {
		t.Fatal("expected client provider")
	}
	if reg.ProviderFor("secure").Mode() != "server_rsa" {
		t.Fatal("expected rsa provider")
	}

	if _, ok := reg.PublicKeyPEM(); !ok {
		t.Fatal("expected public key when server_rsa is configured")
	}
}

func TestRegistryNoRSAWhenUnused(t *testing.T) {
	reg, err := NewRegistry("none", map[string]string{"a": "client"}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := reg.PublicKeyPEM(); ok {
		t.Fatal("public key should be unavailable without server_rsa")
	}
}

func TestRegistryInvalidMode(t *testing.T) {
	if _, err := NewRegistry("xyz", nil, "", ""); err == nil {
		t.Fatal("expected error for invalid default mode")
	}
	if _, err := NewRegistry("none", map[string]string{"q": "xyz"}, "", ""); err == nil {
		t.Fatal("expected error for invalid queue mode")
	}
}
