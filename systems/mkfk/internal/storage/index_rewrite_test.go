package storage

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

func TestAppendRewritesIndexOnlyWhenAnchorsChange(t *testing.T) {
	t.Parallel()
	root, _ := formatM1DataDir(t)
	filesystem := &indexWriteCountingFileSystem{FileSystem: adapters.OSFileSystem{}}
	partition := openIndexTestPartition(t, root, filesystem)
	appendValue(t, partition, 1, 100)
	afterFirstAnchor := filesystem.writes.Load()

	for sequence := uint64(2); sequence <= 10; sequence++ {
		appendValue(t, partition, sequence, 100)
	}
	if got := filesystem.writes.Load(); got != afterFirstAnchor {
		t.Fatalf("appends inside one anchor stride wrote the index %d times", got-afterFirstAnchor)
	}

	appendValue(t, partition, 11, SparseIndexStride)
	appendValue(t, partition, 12, 100)
	if got := filesystem.writes.Load(); got != afterFirstAnchor+1 {
		t.Fatalf("crossing one anchor stride wrote the index %d times, want 1", got-afterFirstAnchor)
	}
}

func TestSkippedIndexRewritesLeaveAValidIndexAfterRestart(t *testing.T) {
	t.Parallel()
	root, _ := formatM1DataDir(t)
	partition := openIndexTestPartition(t, root, adapters.OSFileSystem{})
	for sequence := uint64(1); sequence <= 20; sequence++ {
		appendValue(t, partition, sequence, 700)
	}
	closePartition(t, partition)

	partition = openIndexTestPartition(t, root, adapters.OSFileSystem{})
	defer closePartition(t, partition)
	if got := partition.IndexRebuildCount(); got != 0 {
		t.Fatalf("restart rebuilt %d indexes, want 0", got)
	}
}

func TestStaleIndexIsRebuiltOnRestart(t *testing.T) {
	t.Parallel()
	root, _ := formatM1DataDir(t)
	partition := openIndexTestPartition(t, root, adapters.OSFileSystem{})
	appendValue(t, partition, 1, 100)
	indexPath := onlyIndexPath(t, root)
	stale, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	for sequence := uint64(2); sequence <= 20; sequence++ {
		appendValue(t, partition, sequence, 700)
	}
	closePartition(t, partition)
	if err := os.WriteFile(indexPath, stale, 0o600); err != nil {
		t.Fatal(err)
	}

	partition = openIndexTestPartition(t, root, adapters.OSFileSystem{})
	defer closePartition(t, partition)
	if got := partition.IndexRebuildCount(); got != 1 {
		t.Fatalf("restart rebuilt %d indexes, want 1", got)
	}
	rebuilt, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := DecodeIndex(rebuilt)
	if err != nil {
		t.Fatal(err)
	}
	if !indexEntriesEqual(entries, partition.segments[0].anchors) {
		t.Fatalf("rebuilt index %v does not match WAL anchors %v", entries, partition.segments[0].anchors)
	}
}

func TestAppendRetriesIndexWriteAfterFailure(t *testing.T) {
	t.Parallel()
	root, _ := formatM1DataDir(t)
	filesystem := &indexWriteCountingFileSystem{FileSystem: adapters.OSFileSystem{}}
	filesystem.fail.Store(true)
	partition := openIndexTestPartition(t, root, filesystem)
	defer closePartition(t, partition)
	appendValue(t, partition, 1, 100)
	if partition.Segments()[0].IndexValid {
		t.Fatal("injected index write failure was not marked invalid")
	}

	filesystem.fail.Store(false)
	appendValue(t, partition, 2, 100)
	if !partition.Segments()[0].IndexValid {
		t.Fatal("append without new anchors did not retry the failed index write")
	}
}

func openIndexTestPartition(t *testing.T, root string, filesystem adapters.FileSystem) *PartitionLog {
	t.Helper()
	directory := filepath.Join(root, "partitions", "events", "0")
	partition, err := openPartitionLog(filesystem, directory, "events", 0)
	if err != nil {
		t.Fatal(err)
	}
	return partition
}

func appendValue(t *testing.T, partition *PartitionLog, sequence uint64, valueBytes int) {
	t.Helper()
	if _, err := partition.AppendBatch(1, sequence, []DataRecord{{Value: bytes.Repeat([]byte{'v'}, valueBytes)}}); err != nil {
		t.Fatal(err)
	}
}

func closePartition(t *testing.T, partition *PartitionLog) {
	t.Helper()
	if err := partition.Close(); err != nil {
		t.Fatal(err)
	}
}

func onlyIndexPath(t *testing.T, root string) string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(root, "partitions", "events", "0", "*.idx"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 {
		t.Fatalf("index files = %v, want exactly one", paths)
	}
	return paths[0]
}

type indexWriteCountingFileSystem struct {
	adapters.FileSystem
	writes atomic.Int64
	fail   atomic.Bool
}

func (filesystem *indexWriteCountingFileSystem) CreateTemp(directory, pattern string) (adapters.DurableFile, string, error) {
	if pattern != ".mkfk-index-*" {
		return filesystem.FileSystem.CreateTemp(directory, pattern)
	}
	if filesystem.fail.Load() {
		return nil, "", errors.New("injected index cache write failure")
	}
	filesystem.writes.Add(1)
	return filesystem.FileSystem.CreateTemp(directory, pattern)
}
