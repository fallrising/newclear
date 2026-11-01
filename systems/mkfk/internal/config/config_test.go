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

// A manifest may name non-loopback listeners (isolated Compose network,
// private benchmark network); binding them is the broker's opt-in decision.
func TestManifestReportsNonLoopbackListenersForBindPolicy(t *testing.T) {
	t.Parallel()
	base, err := os.ReadFile(filepath.Join("..", "..", "configs", "dev-cluster.json"))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := ParseClusterManifest(base)
	if err != nil {
		t.Fatal(err)
	}
	broker, ok := manifest.Broker(1)
	if !ok || len(broker.NonLoopbackListeners()) != 0 {
		t.Fatalf("dev broker 1 = %+v exposed=%v", broker, broker.NonLoopbackListeners())
	}
	exposed := strings.Replace(string(base), `"peer_addr": "127.0.0.1:19093"`, `"peer_addr": "172.30.0.11:19093"`, 1)
	manifest, err = ParseClusterManifest([]byte(exposed))
	if err != nil {
		t.Fatal(err)
	}
	broker, _ = manifest.Broker(1)
	if got := broker.NonLoopbackListeners(); len(got) != 1 || got[0] != "172.30.0.11:19093" {
		t.Fatalf("non-loopback listeners = %v", got)
	}
	if _, ok := manifest.Broker(9); ok {
		t.Fatal("unknown broker was found")
	}
	if _, err := ParseClusterManifest([]byte(strings.Replace(string(base), `"127.0.0.1:19093"`, `"broker1:19093"`, 1))); err == nil {
		t.Fatal("a host name listener was accepted; listeners must be IP:port")
	}
}

// The Compose topology names container addresses on a private network; it
// must parse, and every listener is non-loopback so serve requires the
// explicit --allow-insecure-bind used in deploy/compose.yaml.
func TestComposeManifestNeedsInsecureBindOptIn(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile(filepath.Join("..", "..", "configs", "compose-cluster.json"))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := ParseClusterManifest(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, broker := range manifest.Brokers {
		if len(broker.NonLoopbackListeners()) != 3 {
			t.Fatalf("broker %d exposes %v", broker.ID, broker.NonLoopbackListeners())
		}
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
