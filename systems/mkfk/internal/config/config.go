// Package config owns static topology and resource-bound validation.
package config

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"sort"
	"strings"

	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
)

const (
	StorageFormatVersion       = 1
	MaxManifestBytes           = 6 << 20
	MaxUserPartitionsPerBroker = 32
)

var (
	userTopicPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	tokenPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)
)

type Broker struct {
	ID         uint32 `json:"id"`
	ClientAddr string `json:"client_addr"`
	PeerAddr   string `json:"peer_addr"`
	AdminAddr  string `json:"admin_addr"`
}

type Partition struct {
	ID       uint32   `json:"id"`
	Replicas []uint32 `json:"replicas"`
	MinISR   uint32   `json:"min_isr"`
}

type Topic struct {
	Name       string      `json:"name"`
	Internal   bool        `json:"internal"`
	Partitions []Partition `json:"partitions"`
}

type ClusterManifest struct {
	Version   uint16   `json:"version"`
	ClusterID string   `json:"cluster_id"`
	Brokers   []Broker `json:"brokers"`
	Topics    []Topic  `json:"topics"`
}

func ParseClusterManifest(exactBytes []byte) (ClusterManifest, error) {
	if len(exactBytes) > MaxManifestBytes {
		return ClusterManifest{}, fmt.Errorf("cluster manifest exceeds %d bytes", MaxManifestBytes)
	}
	var manifest ClusterManifest
	if err := jsonstrict.Decode(exactBytes, &manifest); err != nil {
		return ClusterManifest{}, err
	}
	if err := manifest.Validate(); err != nil {
		return ClusterManifest{}, err
	}
	return manifest, nil
}

func (m ClusterManifest) Validate() error {
	if m.Version != 1 {
		return fmt.Errorf("unsupported cluster manifest version %d", m.Version)
	}
	if err := ValidateToken("cluster_id", m.ClusterID); err != nil {
		return err
	}
	if len(m.Brokers) == 0 {
		return errors.New("at least one broker is required")
	}
	brokerIDs := make(map[uint32]struct{}, len(m.Brokers))
	addresses := make(map[netip.AddrPort]struct{}, len(m.Brokers)*3)
	for _, broker := range m.Brokers {
		if broker.ID == 0 {
			return errors.New("broker IDs must be positive")
		}
		if _, exists := brokerIDs[broker.ID]; exists {
			return fmt.Errorf("duplicate broker ID %d", broker.ID)
		}
		brokerIDs[broker.ID] = struct{}{}
		for listener, raw := range map[string]string{
			"client": broker.ClientAddr,
			"peer":   broker.PeerAddr,
			"admin":  broker.AdminAddr,
		} {
			address, err := netip.ParseAddrPort(raw)
			if err != nil {
				return fmt.Errorf("broker %d %s address: %w", broker.ID, listener, err)
			}
			if !address.Addr().IsLoopback() {
				return fmt.Errorf("broker %d %s listener is not loopback", broker.ID, listener)
			}
			if _, exists := addresses[address]; exists {
				return fmt.Errorf("listener address %s is reused", address)
			}
			addresses[address] = struct{}{}
		}
	}
	if len(m.Topics) == 0 {
		return errors.New("at least one topic is required")
	}
	topicNames := make(map[string]struct{}, len(m.Topics))
	userPartitions := make(map[uint32]int)
	hasGroups := false
	for _, topic := range m.Topics {
		if err := ValidateTopicName(topic.Name, topic.Internal); err != nil {
			return err
		}
		if _, exists := topicNames[topic.Name]; exists {
			return fmt.Errorf("duplicate topic %q", topic.Name)
		}
		topicNames[topic.Name] = struct{}{}
		if topic.Name == "__mkfk_groups" {
			hasGroups = true
			if !topic.Internal || len(topic.Partitions) != 1 || topic.Partitions[0].ID != 0 {
				return errors.New("__mkfk_groups must be one internal partition with ID 0")
			}
		} else if topic.Internal {
			return errors.New("v0.1 only defines __mkfk_groups as an internal topic")
		}
		if len(topic.Partitions) == 0 {
			return fmt.Errorf("topic %q has no partitions", topic.Name)
		}
		partitionIDs := make([]int, 0, len(topic.Partitions))
		for _, partition := range topic.Partitions {
			partitionIDs = append(partitionIDs, int(partition.ID))
			if len(partition.Replicas) != 1 && len(partition.Replicas) != 3 {
				return fmt.Errorf("%s/%d replication factor must be 1 or 3", topic.Name, partition.ID)
			}
			replicas := make(map[uint32]struct{}, len(partition.Replicas))
			for _, replica := range partition.Replicas {
				if _, exists := brokerIDs[replica]; !exists {
					return fmt.Errorf("%s/%d references unknown broker %d", topic.Name, partition.ID, replica)
				}
				if _, exists := replicas[replica]; exists {
					return fmt.Errorf("%s/%d repeats replica %d", topic.Name, partition.ID, replica)
				}
				replicas[replica] = struct{}{}
				if !topic.Internal {
					userPartitions[replica]++
				}
			}
			if partition.MinISR == 0 || int(partition.MinISR) > len(partition.Replicas) {
				return fmt.Errorf("%s/%d min_isr is outside its replica set", topic.Name, partition.ID)
			}
		}
		sort.Ints(partitionIDs)
		for expected, actual := range partitionIDs {
			if expected != actual {
				return fmt.Errorf("topic %q partition IDs must be contiguous from zero", topic.Name)
			}
		}
	}
	if !hasGroups {
		return errors.New("the internal __mkfk_groups partition is required")
	}
	for broker, count := range userPartitions {
		if count > MaxUserPartitionsPerBroker {
			return fmt.Errorf("broker %d has %d user partitions; maximum is %d", broker, count, MaxUserPartitionsPerBroker)
		}
	}
	return nil
}

func TopologyDigest(exactBytes []byte) string {
	digest := sha256.Sum256(exactBytes)
	return hex.EncodeToString(digest[:])
}

type StorageManifest struct {
	StorageFormatVersion uint16 `json:"storage_format_version"`
	ClusterID            string `json:"cluster_id"`
	NodeID               uint32 `json:"node_id"`
	TopologySHA256       string `json:"topology_sha256"`
}

func (m StorageManifest) ValidateAgainst(nodeID uint32, topologyBytes []byte) error {
	if m.StorageFormatVersion != StorageFormatVersion {
		return errors.New("storage format version mismatch")
	}
	if m.NodeID != nodeID {
		return errors.New("storage node ID mismatch")
	}
	topology, err := ParseClusterManifest(topologyBytes)
	if err != nil {
		return fmt.Errorf("parse topology: %w", err)
	}
	if m.ClusterID != topology.ClusterID {
		return errors.New("storage cluster ID mismatch")
	}
	if !strings.EqualFold(m.TopologySHA256, TopologyDigest(topologyBytes)) {
		return errors.New("topology digest mismatch")
	}
	return nil
}

func ValidateTopicName(name string, internal bool) error {
	if internal {
		if name != "__mkfk_groups" {
			return errors.New("unknown internal topic")
		}
		return nil
	}
	if !userTopicPattern.MatchString(name) {
		return fmt.Errorf("invalid topic name %q", name)
	}
	if strings.HasPrefix(name, "__mkfk_") {
		return errors.New("the __mkfk_ prefix is reserved")
	}
	return nil
}

func ValidateToken(field, value string) error {
	if !tokenPattern.MatchString(value) {
		return fmt.Errorf("%s must be a 1..64 byte safe ASCII token", field)
	}
	return nil
}

type ResourceLimits struct {
	HTTPBodyBytes           int
	WALFrameBytes           int
	RawRecordBytes          int
	RecordsPerBatch         int
	FetchBytes              int
	PendingPerPartition     int
	PendingPartitionBytes   int
	PendingBrokerBytes      int
	LongPollsPerBroker      int
	ProducerIDsPerPartition int
}

func DefaultResourceLimits() ResourceLimits {
	return ResourceLimits{
		HTTPBodyBytes:           6 << 20,
		WALFrameBytes:           4 << 20,
		RawRecordBytes:          1 << 20,
		RecordsPerBatch:         1000,
		FetchBytes:              4 << 20,
		PendingPerPartition:     256,
		PendingPartitionBytes:   16 << 20,
		PendingBrokerBytes:      64 << 20,
		LongPollsPerBroker:      256,
		ProducerIDsPerPartition: 1024,
	}
}

func (l ResourceLimits) Validate() error {
	if l.HTTPBodyBytes < l.WALFrameBytes || l.WALFrameBytes < l.RawRecordBytes {
		return errors.New("HTTP, WAL, and record byte caps must be non-increasing")
	}
	if l.PendingPartitionBytes > l.PendingBrokerBytes {
		return errors.New("partition pending byte cap exceeds broker cap")
	}
	if l.RecordsPerBatch <= 0 || l.FetchBytes <= 0 || l.PendingPerPartition <= 0 || l.LongPollsPerBroker <= 0 || l.ProducerIDsPerPartition <= 0 {
		return errors.New("resource count and byte caps must be positive")
	}
	return nil
}
