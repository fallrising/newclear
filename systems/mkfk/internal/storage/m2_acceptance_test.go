package storage

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

func TestM2ST06SegmentRotationAndCrossBoundaryRead(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	options := PartitionOptions{SegmentBytes: 900}
	dataDir, partition := openM2Partition(t, root, topology, options)

	want := make([]LocalRecord, 0, 18)
	for batch := range 9 {
		records := []DataRecord{
			{Key: []byte(fmt.Sprintf("key-%02d-a", batch)), Value: bytes.Repeat([]byte{byte(batch)}, 120)},
			{Key: []byte(fmt.Sprintf("key-%02d-b", batch)), Value: []byte(fmt.Sprintf("value-%02d", batch))},
		}
		result, err := partition.AppendBatch(1, uint64(1000+batch), records)
		if err != nil {
			t.Fatal(err)
		}
		for index, record := range records {
			want = append(want, LocalRecord{
				Offset: result.BaseOffset + uint64(index),
				Key:    cloneNullableBytes(record.Key),
				Value:  append([]byte{}, record.Value...),
			})
		}
	}
	segments := partition.Segments()
	if len(segments) < 3 {
		t.Fatalf("segment count = %d, want at least 3", len(segments))
	}
	for _, segment := range segments {
		if segment.SizeBytes > options.SegmentBytes {
			t.Fatalf("frame crossed segment boundary: segment %#v exceeds %d", segment, options.SegmentBytes)
		}
	}
	got, next, stats, err := partition.ReadLocalRecordsWithStats(0, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if next != uint64(len(want)) || !reflect.DeepEqual(got, want) {
		t.Fatalf("cross-segment read returned %d records through %d", len(got), next)
	}
	if stats.ScannedFrames < 9 {
		t.Fatalf("cross-segment scan saw %d frames, want at least 9", stats.ScannedFrames)
	}
	closeM1(t, dataDir, partition)

	dataDir, partition = openM2Partition(t, root, topology, options)
	got, next, err = partition.ReadLocalRecords(0, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if next != uint64(len(want)) || !reflect.DeepEqual(got, want) {
		t.Fatal("restart changed cross-segment records")
	}
	closeM1(t, dataDir, partition)
}

func TestM2ST07SparseSeekMatchesReferenceAndReportsWork(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	options := PartitionOptions{SegmentBytes: 12 << 10}
	dataDir, partition := openM2Partition(t, root, topology, options)
	reference := make([]LocalRecord, 0, 40)

	appendBatch := func(batch int, count int) {
		t.Helper()
		records := make([]DataRecord, 0, count)
		for record := range count {
			value := bytes.Repeat([]byte{byte(batch + record + 1)}, 1150+record*17)
			records = append(records, DataRecord{Key: []byte(fmt.Sprintf("%02d/%d", batch, record)), Value: value})
		}
		result, err := partition.AppendBatch(1, uint64(2000+batch), records)
		if err != nil {
			t.Fatal(err)
		}
		for index, record := range records {
			reference = append(reference, LocalRecord{
				Offset: result.BaseOffset + uint64(index),
				Key:    cloneNullableBytes(record.Key),
				Value:  append([]byte{}, record.Value...),
			})
		}
	}

	for batch := range 8 {
		count := 1
		if batch == 3 {
			count = 3 // A multi-record DATA frame exercises seek within a batch.
		}
		appendBatch(batch, count)
	}
	controlPayload, err := json.Marshal(map[string]string{"padding": strings.Repeat("c", 10<<10)})
	if err != nil {
		t.Fatal(err)
	}
	firstControl := partition.LastLogIndex() + 1
	if err := partition.AppendEntries([]Frame{
		{Kind: KindFence, LogIndex: firstControl, Term: 1, Payload: controlPayload},
		{Kind: KindFence, LogIndex: firstControl + 1, Term: 1, Payload: controlPayload},
	}); err != nil {
		t.Fatal(err)
	}
	for batch := 8; batch < 28; batch++ {
		appendBatch(batch, 1)
	}

	segments := partition.Segments()
	controlOnly := false
	anchored := false
	for _, segment := range segments {
		if !segment.HasData && segment.SizeBytes > 0 {
			controlOnly = true
		}
		if segment.AnchorCount > 1 {
			anchored = true
		}
	}
	if !controlOnly {
		t.Fatalf("fixture did not create a control-only segment: %#v", segments)
	}
	if !anchored {
		t.Fatalf("fixture did not cross the %d-byte sparse-index stride", SparseIndexStride)
	}
	totalWALBytes := sumWALBytes(t, root)
	random := rand.New(rand.NewSource(2207))
	var totalStats ReadStats
	for range 80 {
		offset := uint64(random.Intn(len(reference)))
		budget := len(reference[offset].Key) + len(reference[offset].Value)
		records, next, stats, err := partition.ReadLocalRecordsWithStats(offset, budget)
		if err != nil {
			t.Fatalf("seek offset %d: %v", offset, err)
		}
		if len(records) == 0 || !reflect.DeepEqual(records[0], reference[offset]) || next <= offset {
			t.Fatalf("seek offset %d returned %#v through %d", offset, records, next)
		}
		if stats.ScannedBytes >= totalWALBytes {
			t.Fatalf("seek offset %d scanned %d of %d WAL bytes", offset, stats.ScannedBytes, totalWALBytes)
		}
		totalStats.SegmentComparisons += stats.SegmentComparisons
		totalStats.IndexComparisons += stats.IndexComparisons
		totalStats.ScannedFrames += stats.ScannedFrames
		totalStats.ScannedBytes += stats.ScannedBytes
		totalStats.IndexBytes = stats.IndexBytes
	}
	if totalStats.SegmentComparisons == 0 || totalStats.IndexComparisons == 0 || totalStats.IndexBytes == 0 {
		t.Fatalf("seek work was not reported: %#v", totalStats)
	}
	t.Logf("segments=%d wal_bytes=%d index_bytes=%d seeks=80 segment_comparisons=%d index_comparisons=%d scanned_frames=%d scanned_bytes=%d",
		len(segments), totalWALBytes, totalStats.IndexBytes, totalStats.SegmentComparisons,
		totalStats.IndexComparisons, totalStats.ScannedFrames, totalStats.ScannedBytes)

	offset := uint64(len(reference) / 2)
	records, next, _, err := partition.ReadRecords(offset, offset+1, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || next != offset+1 {
		t.Fatalf("HW-bounded read returned %d records through %d", len(records), next)
	}
	closeM1(t, dataDir, partition)
}

func TestM2ST08MissingAndCorruptIndexesRebuildWithoutWALMutation(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	options := PartitionOptions{SegmentBytes: 850}
	dataDir, partition := openM2Partition(t, root, topology, options)
	for batch := range 12 {
		if _, err := partition.AppendBatch(1, uint64(batch+1), []DataRecord{{
			Key: []byte(fmt.Sprintf("k-%02d", batch)), Value: bytes.Repeat([]byte{byte(batch)}, 220),
		}}); err != nil {
			t.Fatal(err)
		}
	}
	closeM1(t, dataDir, partition)
	before := walDigests(t, root)

	indexPaths, err := filepath.Glob(filepath.Join(root, "partitions", "events", "0", "*.idx"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(indexPaths)
	if len(indexPaths) < 2 {
		t.Fatalf("index count = %d, want at least 2", len(indexPaths))
	}
	if err := os.Remove(indexPaths[0]); err != nil {
		t.Fatal(err)
	}
	wrongIndex, err := EncodeIndex([]IndexEntry{{BaseOffset: 999, FilePosition: 1, LogIndex: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(indexPaths[1], wrongIndex, 0o600); err != nil {
		t.Fatal(err)
	}

	dataDir, partition = openM2Partition(t, root, topology, options)
	if partition.IndexRebuildCount() < 2 {
		t.Fatalf("rebuilt %d indexes, want at least 2", partition.IndexRebuildCount())
	}
	records, next, err := partition.ReadLocalRecords(0, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 12 || next != 12 {
		t.Fatalf("rebuilt-index read returned %d records through %d", len(records), next)
	}
	for _, segment := range partition.Segments() {
		if !segment.IndexValid {
			t.Fatalf("index remained invalid after rebuild: %#v", segment)
		}
	}
	closeM1(t, dataDir, partition)
	after := walDigests(t, root)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("index rebuild changed WAL bytes\nbefore: %v\nafter:  %v", before, after)
	}
}

func TestM2ST09SuffixTruncationRepairsCatalogAndProtectsCommit(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	options := PartitionOptions{SegmentBytes: 800}
	dataDir, partition := openM2Partition(t, root, topology, options)
	for batch := range 10 {
		if _, err := partition.AppendBatch(1, uint64(batch+1), []DataRecord{{
			Key: []byte(fmt.Sprintf("k-%d", batch)), Value: bytes.Repeat([]byte{byte(batch)}, 260),
		}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := partition.PersistHardState(HardState{CurrentTerm: 1, CommitIndex: 4}); err != nil {
		t.Fatal(err)
	}
	if err := partition.TruncateSuffix(7); err != nil {
		t.Fatal(err)
	}
	if partition.LastLogIndex() != 6 || partition.LEO() != 6 {
		t.Fatalf("post-truncate index/LEO = %d/%d, want 6/6", partition.LastLogIndex(), partition.LEO())
	}
	records, next, err := partition.ReadLocalRecords(0, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 6 || next != 6 {
		t.Fatalf("post-truncate read returned %d records through %d", len(records), next)
	}
	if term, err := partition.Term(6); err != nil || term != 1 {
		t.Fatalf("Term(6) = %d, %v", term, err)
	}

	afterLegalTruncate := walDigests(t, root)
	if err := partition.TruncateSuffix(4); !errors.Is(err, ErrCommittedTruncate) {
		t.Fatalf("committed-prefix truncate error = %v", err)
	}
	if got := walDigests(t, root); !reflect.DeepEqual(got, afterLegalTruncate) {
		t.Fatal("rejected committed-prefix truncate changed WAL bytes")
	}
	replacement, err := partition.AppendBatch(2, 99, []DataRecord{{Key: nil, Value: []byte("replacement")}})
	if err != nil {
		t.Fatal(err)
	}
	if replacement.LogIndex != 7 || replacement.BaseOffset != 6 {
		t.Fatalf("replacement allocation = %#v", replacement)
	}
	closeM1(t, dataDir, partition)

	dataDir, partition = openM2Partition(t, root, topology, options)
	if partition.LastLogIndex() != 7 || partition.LEO() != 7 {
		t.Fatalf("restart index/LEO = %d/%d, want 7/7", partition.LastLogIndex(), partition.LEO())
	}
	records, _, err = partition.ReadLocalRecords(6, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || string(records[0].Value) != "replacement" {
		t.Fatalf("replacement after restart = %#v", records)
	}
	closeM1(t, dataDir, partition)
}

func TestM2SealedSegmentIncompleteTailFailsClosed(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	options := PartitionOptions{SegmentBytes: 750}
	dataDir, partition := openM2Partition(t, root, topology, options)
	for batch := range 6 {
		if _, err := partition.AppendBatch(1, uint64(batch+1), []DataRecord{{
			Key: []byte("sealed"), Value: bytes.Repeat([]byte{byte(batch)}, 240),
		}}); err != nil {
			t.Fatal(err)
		}
	}
	closeM1(t, dataDir, partition)

	walPaths, err := filepath.Glob(filepath.Join(root, "partitions", "events", "0", "*.wal"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(walPaths)
	if len(walPaths) < 2 {
		t.Fatalf("segment count = %d, want at least 2", len(walPaths))
	}
	sealed, err := os.OpenFile(walPaths[0], os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	info, err := sealed.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if err := sealed.Truncate(info.Size() - 1); err != nil {
		t.Fatal(err)
	}
	if err := sealed.Sync(); err != nil {
		t.Fatal(err)
	}
	if err := sealed.Close(); err != nil {
		t.Fatal(err)
	}

	dataDir, err = OpenDataDir(root, 1, topology)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dataDir.OpenPartitionWithOptions("events", 0, options); err == nil || !strings.Contains(err.Error(), "sealed segment") {
		t.Fatalf("sealed torn-tail open error = %v", err)
	}
	if err := dataDir.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestM2StableReadViewExcludesConcurrentTruncate(t *testing.T) {
	t.Parallel()
	root, _ := formatM1DataDir(t)
	directory := filepath.Join(root, "partitions", "events", "0")
	filesystem := &blockingReadFileSystem{
		FileSystem: adapters.OSFileSystem{},
		entered:    make(chan struct{}),
		release:    make(chan struct{}),
	}
	partition, err := openPartitionLogWithOptions(filesystem, directory, "events", 0, PartitionOptions{SegmentBytes: 900})
	if err != nil {
		t.Fatal(err)
	}
	for batch := range 3 {
		if _, err := partition.AppendBatch(1, uint64(batch+1), []DataRecord{{
			Key: []byte("view"), Value: bytes.Repeat([]byte{byte(batch)}, 180),
		}}); err != nil {
			t.Fatal(err)
		}
	}
	filesystem.enabled.Store(true)
	readResult := make(chan error, 1)
	go func() {
		records, next, err := partition.ReadLocalRecords(0, MaxLocalReadBytes)
		if err == nil && (len(records) != 3 || next != 3) {
			err = fmt.Errorf("read returned %d records through %d", len(records), next)
		}
		readResult <- err
	}()
	select {
	case <-filesystem.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("read did not enter the WAL adapter")
	}
	truncateResult := make(chan error, 1)
	go func() { truncateResult <- partition.TruncateSuffix(3) }()
	select {
	case err := <-truncateResult:
		t.Fatalf("truncate passed an active stable read view: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(filesystem.release)
	if err := <-readResult; err != nil {
		t.Fatal(err)
	}
	if err := <-truncateResult; err != nil {
		t.Fatal(err)
	}
	if partition.LastLogIndex() != 2 {
		t.Fatalf("last index after released view = %d, want 2", partition.LastLogIndex())
	}
	if err := partition.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestM2IndexWriteFailureDoesNotRollbackDurableWAL(t *testing.T) {
	t.Parallel()
	root, topology := formatM1DataDir(t)
	directory := filepath.Join(root, "partitions", "events", "0")
	filesystem := failingIndexFileSystem{FileSystem: adapters.OSFileSystem{}}
	partition, err := openPartitionLogWithOptions(filesystem, directory, "events", 0, PartitionOptions{SegmentBytes: 900})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := partition.AppendBatch(1, 1, []DataRecord{{Key: nil, Value: []byte("WAL-is-truth")}}); err != nil {
		t.Fatalf("index cache failure changed durable append result: %v", err)
	}
	if partition.Segments()[0].IndexValid {
		t.Fatal("injected index write failure was not marked invalid")
	}
	if err := partition.Close(); err != nil {
		t.Fatal(err)
	}

	dataDir, partition := openM2Partition(t, root, topology, PartitionOptions{SegmentBytes: 900})
	if partition.IndexRebuildCount() != 1 {
		t.Fatalf("restart index rebuild count = %d, want 1", partition.IndexRebuildCount())
	}
	records, next, err := partition.ReadLocalRecords(0, MaxLocalReadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || next != 1 || string(records[0].Value) != "WAL-is-truth" {
		t.Fatalf("record after index failure/rebuild = %#v through %d", records, next)
	}
	closeM1(t, dataDir, partition)
}

func openM2Partition(t *testing.T, root string, topology []byte, options PartitionOptions) (*DataDir, *PartitionLog) {
	t.Helper()
	dataDir, err := OpenDataDir(root, 1, topology)
	if err != nil {
		t.Fatal(err)
	}
	partition, err := dataDir.OpenPartitionWithOptions("events", 0, options)
	if err != nil {
		_ = dataDir.Close()
		t.Fatal(err)
	}
	return dataDir, partition
}

func sumWALBytes(t *testing.T, root string) int64 {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(root, "partitions", "events", "0", "*.wal"))
	if err != nil {
		t.Fatal(err)
	}
	var total int64
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		total += info.Size()
	}
	return total
}

func walDigests(t *testing.T, root string) map[string][sha256.Size]byte {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(root, "partitions", "events", "0", "*.wal"))
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string][sha256.Size]byte, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		result[filepath.Base(path)] = sha256.Sum256(data)
	}
	return result
}

type blockingReadFileSystem struct {
	adapters.FileSystem
	enabled atomic.Bool
	entered chan struct{}
	release chan struct{}
}

func (filesystem *blockingReadFileSystem) Open(path string, options adapters.OpenOptions) (adapters.DurableFile, error) {
	file, err := filesystem.FileSystem.Open(path, options)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(path, ".wal") {
		return &blockingReadFile{DurableFile: file, filesystem: filesystem}, nil
	}
	return file, nil
}

type blockingReadFile struct {
	adapters.DurableFile
	filesystem *blockingReadFileSystem
}

func (file *blockingReadFile) ReadAt(destination []byte, offset int64) (int, error) {
	if file.filesystem.enabled.CompareAndSwap(true, false) {
		close(file.filesystem.entered)
		<-file.filesystem.release
	}
	return file.DurableFile.ReadAt(destination, offset)
}

var _ adapters.FileSystem = (*blockingReadFileSystem)(nil)
var _ adapters.DurableFile = (*blockingReadFile)(nil)

type failingIndexFileSystem struct {
	adapters.FileSystem
}

func (filesystem failingIndexFileSystem) CreateTemp(directory, pattern string) (adapters.DurableFile, string, error) {
	if pattern == ".mkfk-index-*" {
		return nil, "", errors.New("injected index cache write failure")
	}
	return filesystem.FileSystem.CreateTemp(directory, pattern)
}

var _ adapters.FileSystem = failingIndexFileSystem{}
