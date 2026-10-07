package main

import (
	"context"
	"fmt"
	"math/rand/v2"
	"os"
	"slices"
	"strconv"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

var faultKinds = []string{"kill-leader", "kill-follower", "kill-coordinator", "pause", "isolate", "one-way-cut", "slow-links"}

// OP-05: three brokers, three idempotent producers, and two consumer groups
// run while a seeded schedule crashes leaders, followers, and the group
// coordinator, pauses brokers, and cuts or slows peer links. After healing,
// the history must show no lost or duplicated acknowledged batch, identical
// committed replicas, at-least-once delivery to both groups, disjoint
// assignments per generation, and committed offsets that never go back.
//
// MKFK_CHAOS_PROFILE=short applies each fault kind once; full applies 28
// seeded faults. MKFK_CHAOS_SEED replays a schedule.
func TestM7ChaosOP05RotatingCrashesPartitionsAndPauses(t *testing.T) {
	profile := os.Getenv("MKFK_CHAOS_PROFILE")
	if profile != "short" && profile != "full" {
		t.Skip("set MKFK_CHAOS_PROFILE=short|full (make test-chaos)")
	}
	seed := uint64(time.Now().UnixNano())
	if value := os.Getenv("MKFK_CHAOS_SEED"); value != "" {
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		seed = parsed
	}
	t.Logf("profile=%s seed=%d", profile, seed)
	var h *history
	defer func() {
		if t.Failed() && h != nil {
			h.mu.Lock()
			defer h.mu.Unlock()
			for _, line := range h.timeline {
				t.Log(line)
			}
		}
	}()
	random := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	network := newChaosNetwork()
	cluster := newTestCluster(t, 3, 3, 3)
	cluster.withPeerProxies(network)
	brokers := []uint32{1, 2, 3}
	for _, id := range brokers {
		cluster.start(id)
	}
	for _, id := range brokers {
		cluster.waitReady(id)
	}
	h = newHistory()
	transport := func() *client.ClusterTransport {
		transport, err := client.NewClusterTransport(nil, cluster.endpoints())
		if err != nil {
			t.Fatal(err)
		}
		return transport
	}
	stopNew, stopProducing := context.WithCancel(context.Background())
	hardStop, abandon := context.WithTimeout(context.Background(), 10*time.Minute)
	defer abandon()
	consumeCtx, stopConsuming := context.WithCancel(context.Background())
	var producers, consumers sync.WaitGroup
	for partition := uint32(0); partition < 3; partition++ {
		w := openWriter(t, transport(), partition, strconv.Itoa(int(partition)))
		producers.Add(1)
		go func() { defer producers.Done(); produceLoop(stopNew, hardStop, h, w) }()
	}
	for _, member := range [][2]string{{"g1", "m1"}, {"g1", "m2"}, {"g2", "m3"}} {
		consumers.Add(1)
		go func() { defer consumers.Done(); _ = consumeLoop(consumeCtx, h, transport(), member[0], member[1]) }()
	}
	consumers.Add(1)
	go func() { defer consumers.Done(); sampleCommitted(consumeCtx, h, transport(), []string{"g1", "g2"}, 3) }()

	count := len(faultKinds)
	if profile == "full" {
		count = 28
	}
	var applied []string
	for index := 0; index < count; index++ {
		kind := faultKinds[index%len(faultKinds)]
		if profile == "full" {
			kind = faultKinds[random.IntN(len(faultKinds))]
		}
		time.Sleep(time.Second)
		applied = append(applied, cluster.applyFault(t, h, network, random, kind))
	}
	network.heal()
	for _, id := range brokers {
		cluster.waitReady(id)
	}
	h.event("faults healed; draining")
	stopProducing()
	producersDone := make(chan struct{})
	go func() { producers.Wait(); close(producersDone) }()
	var stuck []string
	select {
	case <-producersDone:
	case <-time.After(90 * time.Second):
		stuck = append(stuck, "a producer could not resolve its last batch within 90s after healing")
		abandon()
		<-producersDone
	}
	final, lagging := cluster.drain(t, h, transport())
	stuck = append(stuck, lagging...)
	stopConsuming()
	consumers.Wait()

	violations := append(h.violations(final), stuck...)
	for _, id := range brokers {
		if err := cluster.procs[id].cmd.Process.Signal(syscall.SIGTERM); err != nil {
			t.Fatal(err)
		}
		if err, exited := cluster.procs[id].exited(15 * time.Second); !exited || err != nil {
			violations = append(violations, fmt.Sprintf("broker %d did not stop cleanly: exited=%v err=%v", id, exited, err))
		}
	}
	for partition, values := range final {
		for _, id := range brokers {
			local := replicaValues(t, cluster, id, partition)
			if len(local) < len(values) || !slices.Equal(local[:len(values)], values) {
				violations = append(violations, fmt.Sprintf("broker %d's committed copy of events/%d differs from the leader's", id, partition))
			}
		}
	}
	h.mu.Lock()
	summary := map[string]any{
		"profile": profile, "seed": strconv.FormatUint(seed, 10), "faults": applied,
		"records_per_partition": recordCounts(final), "acknowledged_records": ackedCount(h),
		"processed_by_group": processedCounts(h), "consumer_poll_errors": h.pollErrors,
		"violations": violations, "timeline": h.timeline,
	}
	h.mu.Unlock()
	writeReport(t, summary)
	if !t.Failed() && len(violations) == 0 {
		for _, line := range h.timeline {
			t.Log(line)
		}
	}
	if len(violations) > 0 {
		t.Fatalf("seed %d: %d violations:\n%v", seed, len(violations), violations)
	}
}

func recordCounts(final map[uint32][]string) map[string]int {
	counts := map[string]int{}
	for partition, values := range final {
		counts[fmt.Sprintf("events/%d", partition)] = len(values)
	}
	return counts
}

func ackedCount(h *history) int {
	total := 0
	for _, values := range h.acked {
		total += len(values)
	}
	return total
}

func processedCounts(h *history) map[string]int {
	counts := map[string]int{}
	for group, values := range h.processed {
		for _, times := range values {
			counts[group] += times
		}
	}
	return counts
}
