package main

import (
	"context"
	"fmt"
	"math/rand/v2"
	"syscall"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// applyFault injects one fault, holds it, heals it, and waits until every
// broker is ready again. It only signals this test's child processes.
func (c *testCluster) applyFault(t *testing.T, h *history, network *chaosNetwork, random *rand.Rand, kind string) string {
	t.Helper()
	brokers := []uint32{1, 2, 3}
	partition := uint32(random.IntN(3))
	pick := func(except uint32) uint32 {
		for {
			if id := brokers[random.IntN(len(brokers))]; id != except {
				return id
			}
		}
	}
	var description string
	restart := func(id uint32) {
		c.procs[id].kill()
		time.Sleep(1500 * time.Millisecond)
		c.start(id)
	}
	switch kind {
	case "kill-leader":
		id := c.leaderOf(t, partition)
		description = fmt.Sprintf("SIGKILL broker %d, leader of events/%d", id, partition)
		h.event("%s", description)
		restart(id)
	case "kill-follower":
		id := pick(c.leaderOf(t, partition))
		description = fmt.Sprintf("SIGKILL broker %d, follower of events/%d", id, partition)
		h.event("%s", description)
		restart(id)
	case "kill-coordinator":
		id := c.coordinator(t)
		description = fmt.Sprintf("SIGKILL broker %d, the group coordinator", id)
		h.event("%s", description)
		restart(id)
	case "pause":
		id := pick(0)
		description = fmt.Sprintf("SIGSTOP broker %d for 2s", id)
		h.event("%s", description)
		_ = c.procs[id].cmd.Process.Signal(syscall.SIGSTOP)
		time.Sleep(2 * time.Second)
		_ = c.procs[id].cmd.Process.Signal(syscall.SIGCONT)
	case "isolate":
		id := pick(0)
		description = fmt.Sprintf("isolate broker %d's peer links for 2.5s", id)
		h.event("%s", description)
		network.isolate(id, brokers)
		time.Sleep(2500 * time.Millisecond)
	case "one-way-cut":
		from := pick(0)
		to := pick(from)
		description = fmt.Sprintf("cut peer link %d->%d (requests dropped; replies the other way lost) for 2.5s", from, to)
		h.event("%s", description)
		network.cut(from, to)
		time.Sleep(2500 * time.Millisecond)
	case "slow-links":
		id := pick(0)
		description = fmt.Sprintf("delay every peer request to broker %d by 200ms for 3s", id)
		h.event("%s", description)
		network.delay(id, 200*time.Millisecond)
		time.Sleep(3 * time.Second)
	default:
		t.Fatalf("unknown fault %q", kind)
	}
	network.heal()
	for _, id := range brokers {
		c.waitReady(id)
	}
	h.event("healed: %s", description)
	return description
}

// drain waits for the producers' last batches, reads the final committed
// logs, and waits until both groups committed through them and every
// replica holds them. Problems are returned, not fatal, so the report
// still gets written.
func (c *testCluster) drain(t *testing.T, h *history, transport *client.ClusterTransport) (map[uint32][]string, []string) {
	t.Helper()
	final := map[uint32][]string{}
	for partition := uint32(0); partition < 3; partition++ {
		final[partition] = fetchAll(t, transport, partition)
	}
	caughtUp := func() bool {
		for _, groupID := range []string{"g1", "g2"} {
			for partition, values := range final {
				offsets, err := transport.CommittedOffsets(context.Background(), "drain", groupID, []protocol.TopicPartition{{Topic: "events", Partition: partition}})
				if err != nil || offsets.Offsets[0].Offset == nil || uint64(*offsets.Offsets[0].Offset) != uint64(len(values)) {
					return false
				}
			}
		}
		for id := uint32(1); id <= 3; id++ {
			for partition, values := range final {
				if c.metric(id, "log_end_offset", "events", partition) < int64(len(values)) {
					return false
				}
			}
		}
		return true
	}
	deadline := time.Now().Add(90 * time.Second)
	for !caughtUp() {
		if time.Now().After(deadline) {
			return final, []string{"consumers or replicas did not catch up within 90s after healing"}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return final, nil
}
