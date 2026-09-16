package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDevelopmentManifest(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile(filepath.Join("..", "..", "configs", "dev-cluster.json"))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := ParseClusterManifest(data)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.ClusterID != "mkfk-dev" || len(manifest.Brokers) != 3 {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
	storage := StorageManifest{
		StorageFormatVersion: StorageFormatVersion,
		ClusterID:            manifest.ClusterID,
		NodeID:               1,
		TopologySHA256:       TopologyDigest(data),
	}
	if err := storage.ValidateAgainst(1, data); err != nil {
		t.Fatal(err)
	}
	changed := append([]byte(nil), data...)
	changed = append(changed, '\n')
	if err := storage.ValidateAgainst(1, changed); err == nil {
		t.Fatal("exact-byte topology digest mismatch was accepted")
	}
}

func TestManifestRejectsDuplicateUnknownAndUnsafeInput(t *testing.T) {
	t.Parallel()
	base, err := os.ReadFile(filepath.Join("..", "..", "configs", "dev-cluster.json"))
	if err != nil {
		t.Fatal(err)
	}
	for name, mutation := range map[string]func(string) string{
		"duplicate": func(s string) string { return strings.Replace(s, `"version": 1`, `"version": 1, "version": 1`, 1) },
		"unknown":   func(s string) string { return strings.Replace(s, `"version": 1`, `"version": 1, "surprise": true`, 1) },
		"traversal": func(s string) string { return strings.Replace(s, `"name": "events"`, `"name": "../events"`, 1) },
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := ParseClusterManifest([]byte(mutation(string(base)))); err == nil {
				t.Fatalf("%s manifest was accepted", name)
			}
		})
	}
}

func TestResourceLimits(t *testing.T) {
	t.Parallel()
	limits := DefaultResourceLimits()
	if err := limits.Validate(); err != nil {
		t.Fatal(err)
	}
	limits.PendingBrokerBytes = 1
	if err := limits.Validate(); err == nil {
		t.Fatal("inconsistent pending byte caps were accepted")
	}
}
