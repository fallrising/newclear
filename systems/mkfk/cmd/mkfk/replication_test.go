package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/peer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// Three broker processes over the HTTP peer transport: acknowledged records
// survive a SIGKILLed partition leader, the restarted broker catches up,
// and a consumer group survives a SIGKILLed coordinator, resuming from its
// committed offsets. Retries never duplicate a record in the log.
func TestM7ThreeBrokerProcessesFailOverCatchUpAndKeepGroupOffsets(t *testing.T) {
	t.Parallel()
	cluster := newTestCluster(t, 3, 3, 3)
	for id := uint32(1); id <= 3; id++ {
		cluster.start(id)
	}
	for id := uint32(1); id <= 3; id++ {
		cluster.waitReady(id)
	}
	transport, err := client.NewClusterTransport(nil, cluster.endpoints())
	if err != nil {
		t.Fatal(err)
	}
	writers := map[uint32]*writer{}
	for partition := uint32(0); partition < 3; partition++ {
		writers[partition] = openWriter(t, transport, partition, fmt.Sprint(partition))
		writers[partition].produce(t, fmt.Sprintf("p%d-a", partition), fmt.Sprintf("p%d-b", partition))
	}
	seen := &seenValues{counts: map[string]int{}}
	consumer := newConsumer(t, transport, seen)
	first := []string{"p0-a", "p0-b", "p1-a", "p1-b", "p2-a", "p2-b"}
	pollUntil(t, consumer, "first six records to be processed and committed", func() bool {
		return seen.has(first...) && committedEverywhere(transport, 2)
	})

	for partition := uint32(0); partition < 3; partition++ {
		expectOffsetOutOfRange(t, transport, consumer.Generation(), partition)
	}

	leader := cluster.leaderOf(t, 0)
	cluster.expectFollowerRefusesProof(t, leader, 0)
	cluster.procs[leader].kill()
	t.Logf("SIGKILLed broker %d, leader of events/0", leader)
	writers[0].produce(t, "p0-c")
	cluster.start(leader)
	cluster.waitReady(leader)
	newLeader := cluster.leaderOf(t, 0)
	eventually(t, fmt.Sprintf("broker %d to catch up on events/0", leader), 30*time.Second, func() bool {
		return cluster.metric(leader, "log_end_offset", "events", 0) == 3 && cluster.metric(newLeader, "high_watermark", "events", 0) == 3
	})

	coordinator := cluster.coordinator(t)
	cluster.procs[coordinator].kill()
	t.Logf("SIGKILLed broker %d, the group coordinator", coordinator)
	writers[1].produce(t, "p1-c")
	pollUntil(t, consumer, "records after coordinator failover", func() bool { return seen.has("p0-c", "p1-c") })
	for _, value := range first {
		if count := seen.count(value); count != 1 {
			t.Fatalf("%q was processed %d times; its offset was committed before the coordinator died", value, count)
		}
	}
	cluster.start(coordinator)
	cluster.waitReady(coordinator)

	for partition := uint32(0); partition < 3; partition++ {
		values := fetchAll(t, transport, partition)
		unique := map[string]bool{}
		for _, value := range values {
			if unique[value] {
				t.Fatalf("events/%d holds %q twice: %q", partition, value, values)
			}
			unique[value] = true
		}
		want := 2
		if partition < 2 {
			want = 3
		}
		if len(values) != want {
			t.Fatalf("events/%d = %q, want %d records", partition, values, want)
		}
	}
}

type seenValues struct {
	mu     sync.Mutex
	counts map[string]int
}

func (s *seenValues) has(values ...string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, value := range values {
		if s.counts[value] == 0 {
			return false
		}
	}
	return true
}

func (s *seenValues) count(value string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.counts[value]
}

// committedEverywhere reports whether the group committed next offset
// equals want on every partition.
func committedEverywhere(transport *client.ClusterTransport, want uint64) bool {
	partitions := []protocol.TopicPartition{{Topic: "events", Partition: 0}, {Topic: "events", Partition: 1}, {Topic: "events", Partition: 2}}
	offsets, err := transport.CommittedOffsets(context.Background(), "offsets", "readers", partitions)
	if err != nil {
		return false
	}
	for _, offset := range offsets.Offsets {
		if offset.Offset == nil || uint64(*offset.Offset) != want {
			return false
		}
	}
	return true
}

// expectOffsetOutOfRange commits past the data leader's proven HW (2) as
// the partition's owner; the coordinator must refuse it.
func expectOffsetOutOfRange(t *testing.T, transport *client.ClusterTransport, generation uint64, partition uint32) {
	t.Helper()
	requestID := fmt.Sprintf("beyond-hw-%d", partition)
	_, err := transport.CommitOffsets(context.Background(), requestID, "readers", protocol.CommitOffsetsRequest{
		MemberID: "reader-1", Generation: protocol.DecimalUint64(generation), RequestID: requestID,
		Offsets: []protocol.OffsetCommit{{Topic: "events", Partition: partition, Offset: 99}},
	})
	var response *client.ResponseError
	if !errors.As(err, &response) || response.API.Code != "OFFSET_OUT_OF_RANGE" {
		t.Fatalf("commit past HW on events/%d = %v, want OFFSET_OUT_OF_RANGE", partition, err)
	}
}

func newConsumer(t *testing.T, transport *client.ClusterTransport, seen *seenValues) *client.GroupConsumer {
	t.Helper()
	consumer, err := client.NewGroupConsumer(client.ConsumerConfig{
		GroupID: "readers", MemberID: "reader-1", Topics: []string{"events"}, Transport: transport,
		Process: func(_ context.Context, message client.Message) error {
			seen.mu.Lock()
			defer seen.mu.Unlock()
			seen.counts[string(message.Value)]++
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return consumer
}

// pollUntil polls through elections and rebalances; errors are expected
// while a leader or coordinator is missing.
func pollUntil(t *testing.T, consumer *client.GroupConsumer, what string, done func() bool) {
	t.Helper()
	eventually(t, what, 40*time.Second, func() bool {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = consumer.Poll(ctx)
		return done()
	})
}

func (c *testCluster) metadata(t *testing.T) (protocol.MetadataResponseData, bool) {
	t.Helper()
	for id, proc := range c.procs {
		if _, exited := proc.exited(0); exited {
			continue
		}
		request, _ := http.NewRequest(http.MethodGet, "http://"+c.broker(id).ClientAddr+"/v1/metadata", nil)
		request.Header.Set("X-Request-ID", "metadata")
		response, err := probeClient.Do(request)
		if err != nil {
			continue
		}
		var envelope protocol.MetadataResponse
		err = json.NewDecoder(response.Body).Decode(&envelope)
		_ = response.Body.Close()
		if err == nil && response.StatusCode == http.StatusOK {
			return envelope.Data, true
		}
	}
	return protocol.MetadataResponseData{}, false
}

// expectFollowerRefusesProof asks every follower's peer listener for an HW
// proof: only the leader may give one, so each must answer NOT_LEADER.
func (c *testCluster) expectFollowerRefusesProof(t *testing.T, leader, partition uint32) {
	t.Helper()
	for id := uint32(1); id <= 3; id++ {
		if id == leader {
			continue
		}
		peerClient, err := peer.NewClient(http.DefaultClient, c.broker(id).PeerAddr, c.manifest.ClusterID, config.TopologyDigest(c.topology(t)))
		if err != nil {
			t.Fatal(err)
		}
		hw, err := peerClient.HighWatermark(context.Background(), "events", partition)
		var notLeader *peer.NotLeaderError
		if !errors.As(err, &notLeader) || notLeader.LeaderID != leader {
			t.Fatalf("follower %d HW proof = %d, %v; want NOT_LEADER naming %d", id, hw, err, leader)
		}
	}
}

func (c *testCluster) topology(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(c.path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func (c *testCluster) leaderOf(t *testing.T, partition uint32) uint32 {
	t.Helper()
	var leader uint32
	eventually(t, fmt.Sprintf("a leader for events/%d", partition), 30*time.Second, func() bool {
		data, ok := c.metadata(t)
		if !ok || data.Partitions[partition].LeaderID == nil {
			return false
		}
		leader = *data.Partitions[partition].LeaderID
		return c.metric(leader, "leader", "events", partition) == 1
	})
	return leader
}

func (c *testCluster) coordinator(t *testing.T) uint32 {
	t.Helper()
	var coordinator uint32
	eventually(t, "a group coordinator", 30*time.Second, func() bool {
		data, ok := c.metadata(t)
		if !ok || data.Coordinator == nil {
			return false
		}
		coordinator = *data.Coordinator
		return c.metric(coordinator, "leader", "__mkfk_groups", 0) == 1
	})
	return coordinator
}

// metric reads one partition gauge from a broker's /metrics, or -1.
func (c *testCluster) metric(id uint32, name, topic string, partition uint32) int64 {
	status, text := c.admin(id, "/metrics")
	if status != http.StatusOK {
		return -1
	}
	pattern := regexp.MustCompile(fmt.Sprintf(`(?m)^mkfk_%s\{topic="%s",partition="%d"\} (\d+)$`, name, regexp.QuoteMeta(topic), partition))
	match := pattern.FindStringSubmatch(text)
	if match == nil {
		return -1
	}
	value, _ := strconv.ParseInt(match[1], 10, 64)
	return value
}
