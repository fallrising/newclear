package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// OP-02: a second process on a locked data dir, a wrong node, changed
// topology bytes, an unformatted dir, or a non-loopback listener without
// the opt-in all fail to start, and none of them rewrites stored state.
func TestM7OP02MisconfiguredOrDuplicateBrokersFailWithoutTouchingData(t *testing.T) {
	t.Parallel()
	cluster := newTestCluster(t, 2, 1, 1)
	manifestPath := filepath.Join(cluster.dataDir(1), "manifest.json")
	before, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	changed := filepath.Join(cluster.dir, "changed.json")
	original, _ := os.ReadFile(cluster.path)
	if err := os.WriteFile(changed, append(original, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	exposed := filepath.Join(cluster.dir, "exposed.json")
	exposedTopology := strings.Replace(string(original), cluster.broker(1).ClientAddr, "10.255.255.1:19092", 1)
	if err := os.WriteFile(exposed, []byte(exposedTopology), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(cluster.dir, "empty"), 0o700); err != nil {
		t.Fatal(err)
	}
	exposedDir := filepath.Join(cluster.dir, "exposed-node")
	if err := run([]string{"format", "--data-dir", exposedDir, "--node-id", "1", "--cluster-json", exposed}, nil); err != nil {
		t.Fatal(err)
	}
	for name, test := range map[string]struct {
		arguments []string
		want      string
	}{
		"wrong node":       {[]string{"--data-dir", cluster.dataDir(1), "--node-id", "2", "--cluster-json", cluster.path}, "node"},
		"changed topology": {[]string{"--data-dir", cluster.dataDir(1), "--node-id", "1", "--cluster-json", changed}, "topology"},
		"unformatted dir":  {[]string{"--data-dir", filepath.Join(cluster.dir, "empty"), "--node-id", "1", "--cluster-json", cluster.path}, "data directory"},
		"insecure bind":    {[]string{"--data-dir", exposedDir, "--node-id", "1", "--cluster-json", exposed}, "--allow-insecure-bind"},
	} {
		proc := spawn(t, test.arguments...)
		err, exited := proc.exited(10 * time.Second)
		if !exited || err == nil || !strings.Contains(proc.stderr.String(), test.want) {
			proc.kill()
			t.Fatalf("%s: exited=%v err=%v stderr=%s", name, exited, err, proc.stderr.String())
		}
		t.Logf("%s: %s", name, strings.TrimSpace(proc.stderr.String()))
	}
	cluster.start(1)
	cluster.waitReady(1)
	second := spawn(t, "--data-dir", cluster.dataDir(1), "--node-id", "1", "--cluster-json", cluster.path)
	if err, exited := second.exited(10 * time.Second); !exited || err == nil {
		second.kill()
		t.Fatalf("second process on a locked data dir: exited=%v err=%v", exited, err)
	}
	t.Logf("locked data dir: %s", strings.TrimSpace(second.stderr.String()))
	if status, _ := cluster.admin(1, "/readyz"); status != 200 {
		t.Fatalf("first broker readyz = %d after the duplicate failed", status)
	}
	after, _ := os.ReadFile(manifestPath)
	if !bytes.Equal(before, after) {
		t.Fatal("a failed start rewrote the storage manifest")
	}
}

// OP-06: SIGTERM drains and exits 0 within its bound, data survives the
// restart, and neither metrics nor logs carry record payloads.
func TestM7OP06GracefulShutdownKeepsDataAndLeaksNoPayload(t *testing.T) {
	t.Parallel()
	cluster := newTestCluster(t, 1, 1, 1)
	first := cluster.start(1)
	cluster.waitReady(1)
	transport, err := client.NewClusterTransport(nil, cluster.endpoints())
	if err != nil {
		t.Fatal(err)
	}
	const secret = "payload-that-must-not-be-logged"
	writer := openWriter(t, transport, 0, "a")
	writer.produce(t, secret)
	started := time.Now()
	if err := first.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err, exited := first.exited(8 * time.Second); !exited || err != nil {
		t.Fatalf("SIGTERM: exited=%v err=%v after %s\n%s", exited, err, time.Since(started), first.stderr.String())
	}
	if !strings.Contains(first.stderr.String(), "broker stopped") {
		t.Fatalf("shutdown was not logged:\n%s", first.stderr.String())
	}
	second := cluster.start(1)
	cluster.waitReady(1)
	records := fetchAll(t, transport, 0)
	if len(records) != 1 || records[0] != secret {
		t.Fatalf("records after restart = %q", records)
	}
	_, metrics := cluster.admin(1, "/metrics")
	if !strings.Contains(metrics, `mkfk_high_watermark{topic="events",partition="0"} 1`) {
		t.Fatalf("metrics lack the committed HW:\n%s", metrics)
	}
	encoded := base64.StdEncoding.EncodeToString([]byte(secret))
	for name, text := range map[string]string{"metrics": metrics, "first log": first.stderr.String(), "second log": second.stderr.String()} {
		if strings.Contains(text, secret) || strings.Contains(text, encoded) {
			t.Fatalf("%s contains a record payload", name)
		}
	}
}

// writer produces with one idempotent producer identity on one partition.
type writer struct {
	transport  *client.ClusterTransport
	partition  uint32
	producerID string
	epoch      uint64
	sequence   uint64
	batches    int
}

func openWriter(t *testing.T, transport *client.ClusterTransport, partition uint32, label string) *writer {
	t.Helper()
	w := &writer{transport: transport, partition: partition, producerID: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5" + label}
	eventually(t, "producer to open", 30*time.Second, func() bool {
		opened, err := transport.OpenProducer(context.Background(), "open-"+label, protocol.OpenProducerRequest{
			Topic: "events", Partition: partition, ProducerID: w.producerID, ExpectedEpoch: -1, RequestID: "open-" + label,
		})
		w.epoch = uint64(opened.Epoch)
		return err == nil
	})
	return w
}

// produce retries the identical batch until it is acknowledged.
func (w *writer) produce(t *testing.T, values ...string) protocol.ProduceResponseData {
	t.Helper()
	records := make([]protocol.WireRecord, len(values))
	for index, value := range values {
		encoded := base64.StdEncoding.EncodeToString([]byte(value))
		records[index] = protocol.WireRecord{KeyBase64: json.RawMessage("null"), ValueBase64: &encoded}
	}
	w.batches++
	requestID := fmt.Sprintf("p%d-%s-%d", w.partition, w.producerID[len(w.producerID)-1:], w.batches)
	var response protocol.ProduceResponseData
	eventually(t, "batch to be acknowledged", 30*time.Second, func() bool {
		var err error
		response, err = w.transport.Produce(context.Background(), requestID, protocol.ProduceRequest{
			Topic: "events", Partition: w.partition, ProducerID: w.producerID, Epoch: protocol.DecimalUint64(w.epoch),
			FirstSequence: protocol.DecimalUint64(w.sequence), Acks: "all", Records: records,
		})
		return err == nil
	})
	w.sequence = uint64(response.NextSequence)
	return response
}

// fetchAll reads every committed record of one partition from the leader.
func fetchAll(t *testing.T, transport *client.ClusterTransport, partition uint32) []string {
	t.Helper()
	var values []string
	eventually(t, "fetch from the leader", 30*time.Second, func() bool {
		values = nil
		offset := uint64(0)
		for {
			fetched, err := transport.Fetch(context.Background(), "fetch", protocol.FetchRequest{
				Topic: "events", Partition: partition, Offset: protocol.DecimalUint64(offset), MaxBytes: 1 << 20,
			})
			if err != nil {
				return false
			}
			for _, record := range fetched.Records {
				value, _ := base64.StdEncoding.DecodeString(record.ValueBase64)
				values = append(values, string(value))
			}
			if len(fetched.Records) == 0 || uint64(fetched.NextOffset) >= uint64(fetched.HighWatermark) {
				return true
			}
			offset = uint64(fetched.NextOffset)
		}
	})
	return values
}
