// Package broker assembles one mkfk broker process: its data directory,
// one actor per local partition replica, the peer transport, and the
// client, peer, and admin listeners (SDD §12.1).
package broker

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/group"
	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/peer"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const groupsTopic = "__mkfk_groups"

type Config struct {
	Topology          []byte // exact cluster.json bytes
	NodeID            uint32
	DataDir           string
	AllowInsecureBind bool
	// PeerBind, when set, is where the peer listener binds instead of the
	// topology's peer_addr, e.g. behind a fault-injecting proxy that owns it.
	PeerBind string
	Clock    adapters.Clock
	Random   adapters.RandomSource
	Logger   *slog.Logger
}

// replica is one local partition replica.
type replica struct {
	topic     string
	partition uint32
	replicas  []uint32
	log       *storage.PartitionLog
	actor     *partition.Actor
	data      *partition.Data // nil for the groups partition
	outbox    *partition.Outbox
}

type Broker struct {
	config     Config
	manifest   config.ClusterManifest
	self       config.Broker
	configHash string
	logger     *slog.Logger
	dataDir    *storage.DataDir
	registry   *partition.Registry
	peers      map[uint32]*peer.Client
	replicas   map[string]*replica
	groups     *group.Service
	servers    []*http.Server
	ready      atomic.Bool
}

// Open runs boot steps 2–7: validate the topology, take the data-dir lock,
// verify the storage manifest, and recover every local replica. Nothing
// listens yet; Start opens the listeners.
func Open(cfg Config) (*Broker, error) {
	if cfg.Clock == nil {
		cfg.Clock = adapters.SystemClock{}
	}
	if cfg.Random == nil {
		cfg.Random = adapters.CryptoRandom{}
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	manifest, err := config.ParseClusterManifest(cfg.Topology)
	if err != nil {
		return nil, fmt.Errorf("cluster topology: %w", err)
	}
	self, ok := manifest.Broker(cfg.NodeID)
	if !ok {
		return nil, fmt.Errorf("node %d is not in the cluster topology", cfg.NodeID)
	}
	exposed := self.NonLoopbackListeners()
	if cfg.PeerBind != "" {
		bind := config.Broker{ClientAddr: self.ClientAddr, PeerAddr: cfg.PeerBind, AdminAddr: self.AdminAddr}
		exposed = bind.NonLoopbackListeners()
	}
	if len(exposed) > 0 {
		if !cfg.AllowInsecureBind {
			return nil, fmt.Errorf("listeners %v are not loopback; pass --allow-insecure-bind only on an isolated network", exposed)
		}
		cfg.Logger.Warn("binding non-loopback listeners without TLS or authentication", "listeners", exposed)
	}
	b := &Broker{
		config: cfg, manifest: manifest, self: self, configHash: config.TopologyDigest(cfg.Topology),
		logger:   cfg.Logger.With("cluster", manifest.ClusterID, "node", cfg.NodeID),
		registry: partition.NewRegistry(), peers: make(map[uint32]*peer.Client), replicas: make(map[string]*replica),
	}
	if b.dataDir, err = storage.OpenDataDir(cfg.DataDir, cfg.NodeID, cfg.Topology); err != nil {
		return nil, fmt.Errorf("data directory: %w", err)
	}
	if err := b.openPeers(); err != nil {
		b.closePartitions()
		return nil, err
	}
	for _, topic := range manifest.Topics {
		for _, spec := range topic.Partitions {
			if !contains(spec.Replicas, cfg.NodeID) {
				continue
			}
			if err := b.openReplica(topic.Name, spec); err != nil {
				b.closePartitions()
				return nil, fmt.Errorf("%s/%d: %w", topic.Name, spec.ID, err)
			}
		}
	}
	return b, nil
}

func (b *Broker) openPeers() error {
	httpClient := &http.Client{Transport: &http.Transport{
		DialContext:         (&net.Dialer{Timeout: time.Second}).DialContext,
		MaxIdleConnsPerHost: 64, IdleConnTimeout: 30 * time.Second, DisableCompression: true,
	}}
	for _, other := range b.manifest.Brokers {
		if other.ID == b.self.ID {
			continue
		}
		client, err := peer.NewClient(httpClient, other.PeerAddr, b.manifest.ClusterID, b.configHash)
		if err != nil {
			return err
		}
		b.peers[other.ID] = client
	}
	return nil
}

func (b *Broker) openReplica(topic string, spec config.Partition) error {
	log, err := b.dataDir.OpenPartition(topic, spec.ID)
	if err != nil {
		return err
	}
	r := &replica{topic: topic, partition: spec.ID, replicas: spec.Replicas, log: log}
	b.replicas[peer.GroupID(topic, spec.ID)] = r
	electionTicks, err := raft.RandomElectionTimeout(b.config.Random)
	if err != nil {
		return err
	}
	node, err := raft.NewNode(raft.Config{
		Identity: raft.Identity{ClusterID: b.manifest.ClusterID, ConfigHash: b.configHash, GroupID: peer.GroupID(topic, spec.ID)},
		NodeID:   b.self.ID, Voters: spec.Replicas, ElectionTimeoutTicks: electionTicks, HeartbeatTicks: raft.DefaultHeartbeatTicks,
	}, log)
	if err != nil {
		return err
	}
	var sender partition.Sender
	if len(spec.Replicas) > 1 {
		remotes := make(map[uint32]partition.Remote)
		for _, id := range spec.Replicas {
			if id != b.self.ID {
				remotes[id] = b.peers[id]
			}
		}
		if r.outbox, err = partition.NewOutbox(b.registry, remotes, 0, 0); err != nil {
			return err
		}
		sender = r.outbox
	}
	onRole := b.roleLogger(topic, spec.ID)
	if topic == groupsTopic {
		b.groups, err = group.NewService(group.ServiceConfig{
			Node: node, Proofs: proofSource{b}, Clock: b.config.Clock, Sender: sender, OnRoleChange: onRole,
			StorageFailed: log.RecoveryRequired,
			Coordinator:   group.CoordinatorConfig{State: group.Config{Partitions: b.userPartitionCount}},
		})
		if err != nil {
			return err
		}
		r.actor = b.groups.Actor()
	} else {
		r.data, err = partition.NewData(partition.DataConfig{
			Topic: topic, Partition: spec.ID, Node: node, Log: log, Clock: b.config.Clock, Sender: sender, OnRoleChange: onRole,
			StorageFailed: log.RecoveryRequired, OnISRShrink: b.isrLogger(topic, spec.ID),
			Replication: replicationConfig(b.self.ID, spec),
		})
		if err != nil {
			return err
		}
		r.actor = r.data.Actor()
	}
	b.registry.Add(peer.GroupID(topic, spec.ID), r.actor)
	return nil
}

func (b *Broker) roleLogger(topic string, id uint32) func(raft.RoleChange) {
	return func(change raft.RoleChange) {
		b.logger.Info("role change", "topic", topic, "partition", id, "term", change.Term,
			"from", string(change.From), "to", string(change.To), "leader", change.LeaderID)
	}
}

func (b *Broker) isrLogger(topic string, id uint32) func([]uint32, []replication.PeerObservation) {
	return func(evicted []uint32, observations []replication.PeerObservation) {
		for _, peer := range observations {
			if contains(evicted, peer.PeerID) {
				b.logger.Warn("isr shrink", "topic", topic, "partition", id, "peer", peer.PeerID, "term", peer.Term,
					"durable_match", peer.DurableMatchIndex, "catchup_target", peer.CatchupTarget,
					"last_success", peer.LastSuccessAt.Format(time.RFC3339Nano), "last_caught_up", peer.LastCaughtUpAt.Format(time.RFC3339Nano))
			}
		}
	}
}

func (b *Broker) userPartitionCount(topic string) (uint32, bool) {
	for _, candidate := range b.manifest.Topics {
		if candidate.Name == topic && !candidate.Internal {
			return uint32(len(candidate.Partitions)), true
		}
	}
	return 0, false
}

// closePartitions stops every actor and link, then closes the logs and
// releases the data-dir lock.
func (b *Broker) closePartitions() {
	var closeErr error
	for _, r := range b.replicas {
		if r.actor != nil {
			r.actor.Close()
		}
		if r.outbox != nil {
			r.outbox.Close()
		}
	}
	for _, r := range b.replicas {
		closeErr = errors.Join(closeErr, r.log.Close())
	}
	if b.dataDir != nil {
		closeErr = errors.Join(closeErr, b.dataDir.Close())
	}
	if closeErr != nil {
		b.logger.Error("closing storage", "error", closeErr.Error())
	}
}

func contains(values []uint32, value uint32) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
