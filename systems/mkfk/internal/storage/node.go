package storage

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/config"
)

const (
	clusterFileName  = "cluster.json"
	manifestFileName = "manifest.json"
	lockFileName     = "node.lock"
	initialWALName   = "00000000000000000001.wal"
)

type DataDir struct {
	mu         sync.Mutex
	root       string
	nodeID     uint32
	topology   config.ClusterManifest
	filesystem adapters.FileSystem
	lock       *os.File
	partitions map[string]*PartitionLog
	closed     bool
}

func FormatDataDir(root string, nodeID uint32, topologyBytes []byte) error {
	topology, err := config.ParseClusterManifest(topologyBytes)
	if err != nil {
		return fmt.Errorf("parse cluster topology: %w", err)
	}
	if !hasBroker(topology, nodeID) {
		return fmt.Errorf("node %d is not in the cluster topology", nodeID)
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	filesystem := adapters.OSFileSystem{}
	if err := prepareEmptyDirectory(filesystem, absoluteRoot); err != nil {
		return err
	}
	manifest := config.StorageManifest{
		StorageFormatVersion: config.StorageFormatVersion,
		ClusterID:            topology.ClusterID,
		NodeID:               nodeID,
		TopologySHA256:       config.TopologyDigest(topologyBytes),
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	manifestBytes = append(manifestBytes, '\n')
	if err := createSyncedFile(filesystem, filepath.Join(absoluteRoot, clusterFileName), topologyBytes); err != nil {
		return err
	}
	if err := createSyncedFile(filesystem, filepath.Join(absoluteRoot, manifestFileName), manifestBytes); err != nil {
		return err
	}
	if err := createSyncedFile(filesystem, filepath.Join(absoluteRoot, lockFileName), nil); err != nil {
		return err
	}
	partitionsRoot := filepath.Join(absoluteRoot, "partitions")
	if err := filesystem.MkdirAll(partitionsRoot, 0o750); err != nil {
		return err
	}
	for _, topic := range topology.Topics {
		for _, partition := range topic.Partitions {
			if !containsReplica(partition.Replicas, nodeID) {
				continue
			}
			directory := filepath.Join(partitionsRoot, topic.Name, strconv.FormatUint(uint64(partition.ID), 10))
			if err := filesystem.MkdirAll(directory, 0o750); err != nil {
				return err
			}
			if err := persistHardState(filesystem, directory, HardState{}); err != nil {
				return err
			}
			if err := createSyncedFile(filesystem, filepath.Join(directory, initialWALName), nil); err != nil {
				return err
			}
			if err := filesystem.SyncDir(directory); err != nil {
				return err
			}
		}
	}
	if err := syncTreeDirectories(filesystem, partitionsRoot, topology, nodeID); err != nil {
		return err
	}
	return filesystem.SyncDir(absoluteRoot)
}

func OpenDataDir(root string, nodeID uint32, topologyBytes []byte) (*DataDir, error) {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := requireRealDirectory(absoluteRoot); err != nil {
		return nil, err
	}
	lock, err := openAndLock(filepath.Join(absoluteRoot, lockFileName))
	if err != nil {
		return nil, err
	}
	fail := func(openErr error) (*DataDir, error) {
		_ = unlockAndClose(lock)
		return nil, openErr
	}
	filesystem := adapters.OSFileSystem{}
	manifestBytes, err := readBoundedFile(filesystem, filepath.Join(absoluteRoot, manifestFileName), 16<<10)
	if err != nil {
		return fail(fmt.Errorf("read storage manifest: %w", err))
	}
	manifest, err := config.ParseStorageManifest(manifestBytes)
	if err != nil {
		return fail(fmt.Errorf("parse storage manifest: %w", err))
	}
	storedTopology, err := readBoundedFile(filesystem, filepath.Join(absoluteRoot, clusterFileName), config.MaxManifestBytes)
	if err != nil {
		return fail(fmt.Errorf("read stored topology: %w", err))
	}
	if !bytes.Equal(storedTopology, topologyBytes) {
		return fail(errors.New("provided topology bytes do not match stored cluster.json"))
	}
	if err := manifest.ValidateAgainst(nodeID, topologyBytes); err != nil {
		return fail(err)
	}
	topology, err := config.ParseClusterManifest(topologyBytes)
	if err != nil {
		return fail(err)
	}
	if !hasBroker(topology, nodeID) {
		return fail(fmt.Errorf("node %d is not in the cluster topology", nodeID))
	}
	return &DataDir{
		root:       absoluteRoot,
		nodeID:     nodeID,
		topology:   topology,
		filesystem: filesystem,
		lock:       lock,
		partitions: make(map[string]*PartitionLog),
	}, nil
}

func (dataDir *DataDir) OpenPartition(topic string, partitionID uint32) (*PartitionLog, error) {
	dataDir.mu.Lock()
	defer dataDir.mu.Unlock()
	if dataDir.closed {
		return nil, errors.New("data directory is closed")
	}
	if !nodeOwnsPartition(dataDir.topology, dataDir.nodeID, topic, partitionID) {
		return nil, fmt.Errorf("node %d is not a replica for %s/%d", dataDir.nodeID, topic, partitionID)
	}
	key := partitionKey(topic, partitionID)
	if _, exists := dataDir.partitions[key]; exists {
		return nil, fmt.Errorf("partition %s is already open", key)
	}
	directory := filepath.Join(dataDir.root, "partitions", topic, strconv.FormatUint(uint64(partitionID), 10))
	if err := requireRealDirectory(directory); err != nil {
		return nil, err
	}
	partition, err := openPartitionLog(dataDir.filesystem, directory, topic, partitionID)
	if err != nil {
		return nil, err
	}
	partition.onClose = func() {
		dataDir.mu.Lock()
		defer dataDir.mu.Unlock()
		delete(dataDir.partitions, key)
	}
	dataDir.partitions[key] = partition
	return partition, nil
}

func (dataDir *DataDir) Close() error {
	dataDir.mu.Lock()
	defer dataDir.mu.Unlock()
	if dataDir.closed {
		return nil
	}
	if len(dataDir.partitions) != 0 {
		return fmt.Errorf("%d partitions are still open", len(dataDir.partitions))
	}
	dataDir.closed = true
	return unlockAndClose(dataDir.lock)
}

func prepareEmptyDirectory(filesystem adapters.FileSystem, root string) error {
	info, err := filesystem.Lstat(root)
	if errors.Is(err, fs.ErrNotExist) {
		if err := filesystem.MkdirAll(root, 0o750); err != nil {
			return err
		}
		return filesystem.SyncDir(filepath.Dir(root))
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("data directory must be a real directory, not a symlink")
	}
	entries, err := filesystem.ReadDir(root)
	if err != nil {
		return err
	}
	if len(entries) != 0 {
		return errors.New("data directory must be empty before formatting")
	}
	return nil
}

func requireRealDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s is not a real directory", path)
	}
	return nil
}

func createSyncedFile(filesystem adapters.FileSystem, path string, data []byte) error {
	file, err := filesystem.Open(path, adapters.OpenOptions{Write: true, CreateNew: true})
	if err != nil {
		return err
	}
	if err := writeAllAt(file, 0, data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func syncTreeDirectories(filesystem adapters.FileSystem, partitionsRoot string, topology config.ClusterManifest, nodeID uint32) error {
	seenTopics := make(map[string]struct{})
	for _, topic := range topology.Topics {
		for _, partition := range topic.Partitions {
			if containsReplica(partition.Replicas, nodeID) {
				seenTopics[topic.Name] = struct{}{}
			}
		}
	}
	for topic := range seenTopics {
		if err := filesystem.SyncDir(filepath.Join(partitionsRoot, topic)); err != nil {
			return err
		}
	}
	return filesystem.SyncDir(partitionsRoot)
}

func hasBroker(topology config.ClusterManifest, nodeID uint32) bool {
	for _, broker := range topology.Brokers {
		if broker.ID == nodeID {
			return true
		}
	}
	return false
}

func nodeOwnsPartition(topology config.ClusterManifest, nodeID uint32, topicName string, partitionID uint32) bool {
	for _, topic := range topology.Topics {
		if topic.Name != topicName {
			continue
		}
		for _, partition := range topic.Partitions {
			if partition.ID == partitionID {
				return containsReplica(partition.Replicas, nodeID)
			}
		}
	}
	return false
}

func containsReplica(replicas []uint32, nodeID uint32) bool {
	for _, replica := range replicas {
		if replica == nodeID {
			return true
		}
	}
	return false
}

func partitionKey(topic string, partitionID uint32) string {
	return topic + "/" + strconv.FormatUint(uint64(partitionID), 10)
}
