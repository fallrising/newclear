package storage

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

func TestM1ST01AppendBatchesAndReadOffsets(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	dataDir, partition := openM1Partition(t, root, topology)

	batches := [][]DataRecord{
		{{Key: []byte("a"), Value: []byte("one")}, {Key: nil, Value: []byte("two")}},
		{{Key: []byte{}, Value: []byte{}}, {Key: []byte("binary"), Value: []byte{0, 1, 0xff}}},
		{{Key: []byte("last"), Value: []byte("record")}},
	}
	wantOffset := uint64(0)
	for index, batch := range batches {
		result, err := partition.AppendBatch(1, uint64(1700000000000+index), batch)
		if err != nil {
			t.Fatal(err)
		}
		if result.BaseOffset != wantOffset || result.LastOffset != wantOffset+uint64(len(batch))-1 {
			t.Fatalf("append result = %#v, want base %d", result, wantOffset)
		}
		wantOffset += uint64(len(batch))
	}
	records, next, err := partition.ReadLocalRecords(0, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if next != wantOffset || len(records) != int(wantOffset) {
		t.Fatalf("read %d records through offset %d, want %d", len(records), next, wantOffset)
	}
	if records[1].Key != nil {
		t.Fatal("null key did not round-trip as nil")
	}
	if records[2].Key == nil || len(records[2].Key) != 0 {
		t.Fatal("empty key did not remain distinct from null")
	}
	if !bytes.Equal(records[3].Value, []byte{0, 1, 0xff}) {
		t.Fatalf("binary value = %v", records[3].Value)
	}
	closeM1(t, dataDir, partition)
}

func TestM1ST02RecordBoundaries(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	dataDir, partition := openM1Partition(t, root, topology)

	large := bytes.Repeat([]byte{0xab}, maxRawRecordBytes)
	if _, err := partition.AppendBatch(1, 1, []DataRecord{{Key: nil, Value: large}}); err != nil {
		t.Fatalf("append boundary-sized record: %v", err)
	}
	before := partition.LEO()
	tooLarge := append(append([]byte(nil), large...), 0)
	if _, err := partition.AppendBatch(1, 2, []DataRecord{{Key: nil, Value: tooLarge}}); err == nil {
		t.Fatal("oversized record was accepted")
	}
	if partition.LEO() != before {
		t.Fatal("invalid append changed LEO")
	}
	if _, _, err := partition.ReadLocalRecords(0, maxRawRecordBytes-1); err == nil {
		t.Fatal("too-small read budget was accepted")
	} else {
		var budgetError *ReadBudgetTooSmallError
		if !errors.As(err, &budgetError) || budgetError.RequiredBytes != maxRawRecordBytes {
			t.Fatalf("read error = %v", err)
		}
	}
	closeM1(t, dataDir, partition)
}

func TestM1ST03DurableAfterSIGKILL(t *testing.T) {
	if os.Getenv("MKFK_ST03_CHILD") == "1" {
		runST03Child(t)
		return
	}
	root, topology := formatM1DataDir(t)
	command := exec.Command(os.Args[0], "-test.run=^TestM1ST03DurableAfterSIGKILL$")
	command.Env = append(os.Environ(), "MKFK_ST03_CHILD=1", "MKFK_ST03_ROOT="+root)
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	signal := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if scanner.Text() == "SYNCED" {
				signal <- "SYNCED"
				return
			}
		}
		signal <- ""
	}()
	select {
	case got := <-signal:
		if got != "SYNCED" {
			_ = command.Process.Kill()
			_ = command.Wait()
			t.Fatalf("child exited before sync marker: %s", stderr.String())
		}
	case <-time.After(10 * time.Second):
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatal("child did not report its durability barrier")
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err == nil {
		t.Fatal("SIGKILL child unexpectedly exited successfully")
	}

	dataDir, partition := openM1Partition(t, root, topology)
	records, next, err := partition.ReadLocalRecords(0, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if next != 2 || len(records) != 2 || string(records[0].Value) != "durable-a" || string(records[1].Value) != "durable-b" {
		t.Fatalf("records after SIGKILL = %#v, next %d", records, next)
	}
	closeM1(t, dataDir, partition)
}

func TestM1ST04TornActiveTailRecovery(t *testing.T) {
	t.Parallel()
	payload, err := encodeDataPayload(newStandaloneDataPayload(1, 2, []DataRecord{{Key: []byte("torn"), Value: []byte("tail")}}))
	if err != nil {
		t.Fatal(err)
	}
	tornFrame, err := EncodeFrame(Frame{Kind: KindData, LogIndex: 2, Term: 1, Payload: payload})
	if err != nil {
		t.Fatal(err)
	}
	cuts := uniqueCuts([]int{1, 3, 4, 16, len(tornFrame) / 2, len(tornFrame) - 1})
	for _, cut := range cuts {
		cut := cut
		t.Run(fmt.Sprintf("cut-%d", cut), func(t *testing.T) {
			t.Parallel()
			root, topology := formatM1DataDir(t)
			dataDir, partition := openM1Partition(t, root, topology)
			if _, err := partition.AppendBatch(1, 1, []DataRecord{{Key: []byte("kept"), Value: []byte("prefix")}}); err != nil {
				t.Fatal(err)
			}
			if err := partition.PersistHardState(HardState{CurrentTerm: 1, CommitIndex: 1}); err != nil {
				t.Fatal(err)
			}
			closeM1(t, dataDir, partition)

			walPath := m1WALPath(root)
			wal, err := os.OpenFile(walPath, os.O_WRONLY, 0)
			if err != nil {
				t.Fatal(err)
			}
			info, err := wal.Stat()
			if err != nil {
				t.Fatal(err)
			}
			validBytes := info.Size()
			if _, err := wal.WriteAt(tornFrame[:cut], validBytes); err != nil {
				t.Fatal(err)
			}
			if err := wal.Sync(); err != nil {
				t.Fatal(err)
			}
			if err := wal.Close(); err != nil {
				t.Fatal(err)
			}

			dataDir, partition = openM1Partition(t, root, topology)
			event := partition.RecoveryEvent()
			if event == nil || event.TruncatedBytes != int64(cut) || event.ValidBytes != validBytes || event.LastLogIndex != 1 {
				t.Fatalf("recovery event = %#v", event)
			}
			if partition.LEO() != 1 || partition.LastLogIndex() != 1 {
				t.Fatalf("recovered LEO/index = %d/%d", partition.LEO(), partition.LastLogIndex())
			}
			closeM1(t, dataDir, partition)
			info, err = os.Stat(walPath)
			if err != nil {
				t.Fatal(err)
			}
			if info.Size() != validBytes {
				t.Fatalf("repaired WAL size = %d, want %d", info.Size(), validBytes)
			}
		})
	}
}

func TestM1ST05CorruptionAndCommitFloorFailClosed(t *testing.T) {
	t.Parallel()
	t.Run("complete CRC corruption", func(t *testing.T) {
		t.Parallel()
		root, topology := formatM1DataDir(t)
		dataDir, partition := openM1Partition(t, root, topology)
		for i := range 2 {
			if _, err := partition.AppendBatch(1, uint64(i+1), []DataRecord{{Key: []byte("k"), Value: []byte{byte(i)}}}); err != nil {
				t.Fatal(err)
			}
		}
		if err := partition.PersistHardState(HardState{CurrentTerm: 1, CommitIndex: 1}); err != nil {
			t.Fatal(err)
		}
		closeM1(t, dataDir, partition)

		wal, err := os.OpenFile(m1WALPath(root), os.O_RDWR, 0)
		if err != nil {
			t.Fatal(err)
		}
		info, err := wal.Stat()
		if err != nil {
			t.Fatal(err)
		}
		last := []byte{0}
		if _, err := wal.ReadAt(last, info.Size()-1); err != nil {
			t.Fatal(err)
		}
		last[0] ^= 1
		if _, err := wal.WriteAt(last, info.Size()-1); err != nil {
			t.Fatal(err)
		}
		if err := wal.Sync(); err != nil {
			t.Fatal(err)
		}
		if err := wal.Close(); err != nil {
			t.Fatal(err)
		}
		dataDir, err = OpenDataDir(root, 1, topology)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := dataDir.OpenPartition("events", 0); err == nil || !strings.Contains(err.Error(), "CRC32C") {
			t.Fatalf("corrupt complete frame error = %v", err)
		}
		if err := dataDir.Close(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("commit floor beyond WAL", func(t *testing.T) {
		t.Parallel()
		root, topology := formatM1DataDir(t)
		dataDir, partition := openM1Partition(t, root, topology)
		if _, err := partition.AppendBatch(1, 1, []DataRecord{{Key: nil, Value: []byte("committed")}}); err != nil {
			t.Fatal(err)
		}
		if err := partition.PersistHardState(HardState{CurrentTerm: 1, CommitIndex: 1}); err != nil {
			t.Fatal(err)
		}
		closeM1(t, dataDir, partition)
		wal, err := os.OpenFile(m1WALPath(root), os.O_WRONLY, 0)
		if err != nil {
			t.Fatal(err)
		}
		if err := wal.Truncate(0); err != nil {
			t.Fatal(err)
		}
		if err := wal.Sync(); err != nil {
			t.Fatal(err)
		}
		if err := wal.Close(); err != nil {
			t.Fatal(err)
		}
		dataDir, err = OpenDataDir(root, 1, topology)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := dataDir.OpenPartition("events", 0); err == nil || !strings.Contains(err.Error(), "commit index") {
			t.Fatalf("commit floor error = %v", err)
		}
		if err := dataDir.Close(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestM1OP02FormattingLockAndIdentity(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	if err := FormatDataDir(root, 1, topology); err == nil {
		t.Fatal("formatting a non-empty data directory succeeded")
	}
	dataDir, err := OpenDataDir(root, 1, topology)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := OpenDataDir(root, 1, topology); err == nil {
		t.Fatal("second process lock unexpectedly succeeded")
	}
	if _, err := dataDir.OpenPartition("events", 99); err == nil {
		t.Fatal("unknown partition opened")
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenDataDir(root, 2, topology); err == nil {
		t.Fatal("wrong node ID opened data directory")
	}
	changedTopology := append(append([]byte(nil), topology...), '\n')
	if _, err := OpenDataDir(root, 1, changedTopology); err == nil {
		t.Fatal("different exact topology bytes opened data directory")
	}
}

func TestM1WriteAllAndSyncFailureQuarantine(t *testing.T) {
	t.Parallel()
	root, _ := formatM1DataDir(t)
	directory := filepath.Join(root, "partitions", "events", "0")
	shortFS := &faultFileSystem{delegate: adapters.OSFileSystem{}, maximumWrite: 7}
	partition, err := openPartitionLog(shortFS, directory, "events", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := partition.AppendBatch(1, 1, []DataRecord{{Key: []byte("partial"), Value: []byte("write-all")}}); err != nil {
		t.Fatalf("write-all did not complete partial writes: %v", err)
	}
	if err := partition.Close(); err != nil {
		t.Fatal(err)
	}

	failingFS := &faultFileSystem{delegate: adapters.OSFileSystem{}, failWALSync: true}
	partition, err = openPartitionLog(failingFS, directory, "events", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := partition.AppendBatch(1, 2, []DataRecord{{Key: nil, Value: []byte("unknown")}}); err == nil || !strings.Contains(err.Error(), "sync WAL") {
		t.Fatalf("sync failure result = %v", err)
	}
	if _, err := partition.AppendBatch(1, 3, []DataRecord{{Key: nil, Value: []byte("blocked")}}); !errors.Is(err, ErrRecoveryRequired) {
		t.Fatalf("append after sync failure = %v", err)
	}
	_ = partition.Close()
}

func TestM1HardStatePersistsAndFencesSameTermVote(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	dataDir, partition := openM1Partition(t, root, topology)
	if _, err := partition.AppendBatch(1, 1, []DataRecord{{Key: nil, Value: []byte("entry")}}); err != nil {
		t.Fatal(err)
	}
	vote := uint32(1)
	state := HardState{CurrentTerm: 2, VotedFor: &vote, CommitIndex: 1}
	if err := partition.PersistHardState(state); err != nil {
		t.Fatal(err)
	}
	otherVote := uint32(2)
	if err := partition.PersistHardState(HardState{CurrentTerm: 2, VotedFor: &otherVote, CommitIndex: 1}); err == nil {
		t.Fatal("same-term vote change was accepted")
	}
	if err := partition.PersistHardState(HardState{CurrentTerm: 2, CommitIndex: 1}); err == nil {
		t.Fatal("same-term vote clearing was accepted")
	}
	closeM1(t, dataDir, partition)
	dataDir, partition = openM1Partition(t, root, topology)
	got := partition.HardState()
	if got.CurrentTerm != 2 || got.CommitIndex != 1 || got.VotedFor == nil || *got.VotedFor != 1 {
		t.Fatalf("recovered hardstate = %#v", got)
	}
	closeM1(t, dataDir, partition)
}

func runST03Child(t *testing.T) {
	root := os.Getenv("MKFK_ST03_ROOT")
	topology, err := os.ReadFile(filepath.Join(root, clusterFileName))
	if err != nil {
		t.Fatal(err)
	}
	dataDir, err := OpenDataDir(root, 1, topology)
	if err != nil {
		t.Fatal(err)
	}
	partition, err := dataDir.OpenPartition("events", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := partition.AppendBatch(1, 1700000000000, []DataRecord{
		{Key: []byte("a"), Value: []byte("durable-a")},
		{Key: []byte("b"), Value: []byte("durable-b")},
	}); err != nil {
		t.Fatal(err)
	}
	fmt.Println("SYNCED")
	var block [1]byte
	_, _ = os.Stdin.Read(block[:])
	// The parent must SIGKILL before this point. Reaching here makes the child
	// fail rather than accidentally proving a graceful-close path.
	t.Fatal("parent did not SIGKILL storage child")
}

func formatM1DataDir(t *testing.T) (string, []byte) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "node-1")
	topology := []byte(`{
  "version": 1,
  "cluster_id": "mkfk-m1-test",
  "brokers": [
    {"id": 1, "client_addr": "127.0.0.1:19092", "peer_addr": "127.0.0.1:19093", "admin_addr": "127.0.0.1:19094"}
  ],
  "topics": [
    {"name": "events", "internal": false, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1], "min_isr": 1}]}
  ]
}
`)
	if err := FormatDataDir(root, 1, topology); err != nil {
		t.Fatal(err)
	}
	return root, topology
}

func openM1Partition(t *testing.T, root string, topology []byte) (*DataDir, *PartitionLog) {
	t.Helper()
	dataDir, err := OpenDataDir(root, 1, topology)
	if err != nil {
		t.Fatal(err)
	}
	partition, err := dataDir.OpenPartition("events", 0)
	if err != nil {
		_ = dataDir.Close()
		t.Fatal(err)
	}
	return dataDir, partition
}

func closeM1(t *testing.T, dataDir *DataDir, partition *PartitionLog) {
	t.Helper()
	if err := partition.Close(); err != nil {
		t.Fatal(err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}
}

func m1WALPath(root string) string {
	return filepath.Join(root, "partitions", "events", "0", initialWALName)
}

func uniqueCuts(cuts []int) []int {
	seen := make(map[int]struct{})
	result := make([]int, 0, len(cuts))
	for _, cut := range cuts {
		if cut <= 0 {
			continue
		}
		if _, exists := seen[cut]; exists {
			continue
		}
		seen[cut] = struct{}{}
		result = append(result, cut)
	}
	return result
}

type faultFileSystem struct {
	delegate     adapters.FileSystem
	maximumWrite int
	failWALSync  bool
}

func (filesystem *faultFileSystem) Open(path string, options adapters.OpenOptions) (adapters.DurableFile, error) {
	file, err := filesystem.delegate.Open(path, options)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(path, ".wal") {
		return &faultFile{DurableFile: file, maximumWrite: filesystem.maximumWrite, failSync: filesystem.failWALSync}, nil
	}
	return file, nil
}

func (filesystem *faultFileSystem) CreateTemp(directory, pattern string) (adapters.DurableFile, string, error) {
	return filesystem.delegate.CreateTemp(directory, pattern)
}

func (filesystem *faultFileSystem) MkdirAll(path string, mode fs.FileMode) error {
	return filesystem.delegate.MkdirAll(path, mode)
}

func (filesystem *faultFileSystem) ReadDir(path string) ([]fs.DirEntry, error) {
	return filesystem.delegate.ReadDir(path)
}

func (filesystem *faultFileSystem) Rename(from, to string) error {
	return filesystem.delegate.Rename(from, to)
}

func (filesystem *faultFileSystem) Remove(path string) error {
	return filesystem.delegate.Remove(path)
}

func (filesystem *faultFileSystem) SyncDir(path string) error {
	return filesystem.delegate.SyncDir(path)
}

func (filesystem *faultFileSystem) Lstat(path string) (fs.FileInfo, error) {
	return filesystem.delegate.Lstat(path)
}

type faultFile struct {
	adapters.DurableFile
	maximumWrite int
	failSync     bool
}

func (file *faultFile) WriteAt(data []byte, offset int64) (int, error) {
	if file.maximumWrite > 0 && len(data) > file.maximumWrite {
		data = data[:file.maximumWrite]
	}
	return file.DurableFile.WriteAt(data, offset)
}

func (file *faultFile) Sync() error {
	if file.failSync {
		return errors.New("injected sync failure")
	}
	return file.DurableFile.Sync()
}

var _ adapters.FileSystem = (*faultFileSystem)(nil)
var _ adapters.DurableFile = (*faultFile)(nil)
