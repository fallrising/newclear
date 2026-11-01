package broker

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

func freeAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().String()
}

// readyz is false before the listeners are up and after shutdown starts;
// it is never "leads every partition".
func TestM7ReadyOnlyWhileListenersServe(t *testing.T) {
	t.Parallel()
	manifest := config.ClusterManifest{
		Version: 1, ClusterID: "mkfk-ready",
		Brokers: []config.Broker{{ID: 1, ClientAddr: freeAddress(t), PeerAddr: freeAddress(t), AdminAddr: freeAddress(t)}},
		Topics: []config.Topic{
			{Name: "events", Partitions: []config.Partition{{ID: 0, Replicas: []uint32{1}, MinISR: 1}}},
			{Name: "__mkfk_groups", Internal: true, Partitions: []config.Partition{{ID: 0, Replicas: []uint32{1}, MinISR: 1}}},
		},
	}
	topology, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "node-1")
	if err := storage.FormatDataDir(root, 1, topology); err != nil {
		t.Fatal(err)
	}
	b, err := Open(Config{Topology: topology, NodeID: 1, DataDir: root})
	if err != nil {
		t.Fatal(err)
	}
	if b.Ready() {
		t.Fatal("ready before any listener started")
	}
	if err := b.Start(); err != nil {
		t.Fatal(err)
	}
	response, err := http.Get("http://" + manifest.Brokers[0].AdminAddr + "/readyz")
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("readyz after start = %v, %v", response, err)
	}
	_ = response.Body.Close()
	b.Shutdown(context.Background())
	if b.Ready() {
		t.Fatal("ready after shutdown")
	}
}
