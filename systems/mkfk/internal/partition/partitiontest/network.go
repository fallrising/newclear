// Package partitiontest connects in-process partition actors through a
// network whose links can be cut in either direction.
package partitiontest

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

var ErrPartitioned = errors.New("link is partitioned")

// Network holds one Registry and Outbox per broker. Each link carries a
// request to the target broker's registry and its replies back, unless the
// request direction or the reply direction is blocked.
type Network struct {
	mu         sync.Mutex
	blocked    map[[2]uint32]bool
	registries map[uint32]*partition.Registry
	outboxes   map[uint32]*partition.Outbox
}

func NewNetwork(t *testing.T, brokers ...uint32) *Network {
	t.Helper()
	network := &Network{
		blocked:    make(map[[2]uint32]bool),
		registries: make(map[uint32]*partition.Registry),
		outboxes:   make(map[uint32]*partition.Outbox),
	}
	for _, id := range brokers {
		network.registries[id] = partition.NewRegistry()
	}
	for _, from := range brokers {
		remotes := make(map[uint32]partition.Remote)
		for _, to := range brokers {
			if to != from {
				remotes[to] = link{network: network, from: from, to: to}
			}
		}
		outbox, err := partition.NewOutbox(network.registries[from], remotes, 0, 500*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		network.outboxes[from] = outbox
	}
	t.Cleanup(network.Close)
	return network
}

func (n *Network) Registry(id uint32) *partition.Registry { return n.registries[id] }

func (n *Network) Sender(id uint32) partition.Sender { return n.outboxes[id] }

// Close stops every link; call it before closing the actors' logs.
func (n *Network) Close() {
	for _, outbox := range n.outboxes {
		outbox.Close()
	}
}

// Isolate cuts every link to and from id.
func (n *Network) Isolate(id uint32) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for other := range n.registries {
		if other != id {
			n.blocked[[2]uint32{id, other}] = true
			n.blocked[[2]uint32{other, id}] = true
		}
	}
}

// Block cuts the one-way link from -> to.
func (n *Network) Block(from, to uint32) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.blocked[[2]uint32{from, to}] = true
}

func (n *Network) Heal() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.blocked = make(map[[2]uint32]bool)
}

func (n *Network) isBlocked(from, to uint32) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.blocked[[2]uint32{from, to}]
}

type link struct {
	network  *Network
	from, to uint32
}

func (l link) Step(ctx context.Context, request raft.Message) ([]raft.Message, error) {
	if l.network.isBlocked(l.from, l.to) {
		return nil, ErrPartitioned
	}
	replies, err := l.network.registries[l.to].Step(ctx, request)
	if err != nil {
		return nil, err
	}
	if l.network.isBlocked(l.to, l.from) {
		return nil, ErrPartitioned
	}
	return replies, nil
}

// Eventually polls condition until it holds or the deadline passes. It
// waits for asynchronous delivery; it does not decide safety.
func Eventually(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
