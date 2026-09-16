package client

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestM5FileLedgerDurableRoundTripAndSymlinkRejection(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "state", "producer-ledger.json")
	ledger, err := NewFileLedger(path)
	if err != nil {
		t.Fatal(err)
	}
	state := LedgerState{
		Version: LedgerVersion, ClusterID: "cluster-a", ProducerID: clientTestProducerID,
		Topic: "events", Partition: 0, Epoch: 3, NextSequence: 7,
		Pending: &PendingBatch{
			RequestID: "ledger-request", FirstSequence: 7,
			Records: []Record{{Key: nil, Value: []byte{}}, {Key: []byte{}, Value: []byte("binary\x00")}},
		},
	}
	if err := ledger.Save(state); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("ledger mode = %o", info.Mode().Perm())
	}
	loaded, exists, err := ledger.Load()
	if err != nil || !exists || !reflect.DeepEqual(loaded, state) {
		t.Fatalf("ledger round trip = %#v exists=%v err=%v", loaded, exists, err)
	}

	target := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(target, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	symlink := filepath.Join(t.TempDir(), "ledger-link")
	if err := os.Symlink(target, symlink); err != nil {
		t.Fatal(err)
	}
	linkedLedger, err := NewFileLedger(symlink)
	if err != nil {
		t.Fatal(err)
	}
	if err := linkedLedger.Save(state); err == nil {
		t.Fatal("symlink ledger destination was accepted")
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "keep" {
		t.Fatalf("symlink target changed: %q, %v", data, err)
	}
}
