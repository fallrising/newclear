package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadFromFileAndEnvOverride(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "clarkq.yaml")
	content := `
addr: ":9090"
max_queues: 50
api_key: file-key
encryption:
  mode: client
  queues:
    secure: server_rsa
snapshot:
  path: ./data/snap.json
  interval: 5s
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != ":9090" || cfg.MaxQueues != 50 {
		t.Fatalf("file values not applied: %+v", cfg)
	}
	if len(cfg.APIKeys) != 1 || cfg.APIKeys[0] != "file-key" {
		t.Fatalf("api keys = %#v", cfg.APIKeys)
	}
	if cfg.EncryptionMode != "client" || cfg.EncryptionQueues["secure"] != "server_rsa" {
		t.Fatalf("encryption = mode=%s queues=%v", cfg.EncryptionMode, cfg.EncryptionQueues)
	}
	if cfg.SnapshotPath != "./data/snap.json" || cfg.SnapshotInterval != 5*time.Second {
		t.Fatalf("snapshot = path=%s interval=%s", cfg.SnapshotPath, cfg.SnapshotInterval)
	}

	t.Setenv("CLARKQ_ADDR", ":7070")
	t.Setenv("CLARKQ_ENCRYPTION_MODE", "none")
	t.Setenv("CLARKQ_API_KEY", "env-key")
	cfg, err = LoadFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != ":7070" {
		t.Fatalf("env addr override failed: %s", cfg.Addr)
	}
	if cfg.EncryptionMode != "none" {
		t.Fatalf("env encryption override failed: %s", cfg.EncryptionMode)
	}
	if len(cfg.APIKeys) != 1 || cfg.APIKeys[0] != "env-key" {
		t.Fatalf("env api key override failed: %#v", cfg.APIKeys)
	}
}

func TestLoadFromFileInvalidInterval(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.yaml")
	if err := os.WriteFile(path, []byte("snapshot:\n  interval: not-a-duration\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFromFile(path); err == nil {
		t.Fatal("expected interval parse error")
	}
}
