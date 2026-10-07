package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// floodCodes are the answers a saturated broker may give: success, typed
// backpressure, or an explicitly unknown outcome. Anything else fails.
var floodCodes = map[string]bool{"": true, "RESOURCE_EXHAUSTED": true, "PRODUCER_LIMIT": true, "NOT_ENOUGH_REPLICAS": true, "REQUEST_TIMEOUT": true}

// OP-03: a produce flood, slow-header clients, and a fetch storm against
// the leader get typed answers or bounded closes, never exceed the pending
// cap, never acknowledge what the log lacks, and leave the broker serving.
func TestM7OP03FloodSlowClientsAndFetchStormStayBounded(t *testing.T) {
	t.Parallel()
	cluster := newTestCluster(t, 3, 1, 3)
	for id := uint32(1); id <= 3; id++ {
		cluster.start(id)
	}
	for id := uint32(1); id <= 3; id++ {
		cluster.waitReady(id)
	}
	leader := cluster.leaderOf(t, 0)
	transport, err := client.NewClusterTransport(&http.Client{Timeout: 15 * time.Second}, cluster.endpoints())
	if err != nil {
		t.Fatal(err)
	}
	openWriter(t, transport, 0, "0")
	eventually(t, "both followers to join the ISR", 10*time.Second, func() bool {
		return cluster.metric(leader, "isr_size", "events", 0) == 3
	})
	baseline := cluster.goroutines(leader)

	var maxPending atomic.Int64
	sampling, stopSampling := context.WithCancel(context.Background())
	go func() {
		for sampling.Err() == nil {
			if pending := cluster.metric(leader, "pending_ack_waiters", "events", 0); pending > maxPending.Load() {
				maxPending.Store(pending)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	acked := floodProduce(t, transport, 400)
	stopSampling()
	values := fetchAll(t, transport, 0)
	present := map[string]int{}
	for _, value := range values {
		present[value]++
	}
	for _, value := range acked {
		if present[value] != 1 {
			t.Fatalf("acknowledged %q appears %d times", value, present[value])
		}
	}
	if pending := maxPending.Load(); pending > 256 {
		t.Fatalf("pending acknowledgement waiters peaked at %d, above the 256 cap", pending)
	}
	t.Logf("flood: %d of 400 acknowledged, peak pending waiters %d", len(acked), maxPending.Load())

	slowHeadersAreCut(t, cluster.broker(leader).ClientAddr, cluster, leader)
	fetchStormIsAnswered(t, cluster.broker(leader).ClientAddr)
	eventually(t, "leader goroutines to settle", 15*time.Second, func() bool {
		now := cluster.goroutines(leader)
		return now >= 0 && now <= baseline+50
	})
	if status, _ := cluster.admin(leader, "/readyz"); status != http.StatusOK {
		t.Fatalf("leader readyz = %d after the storms", status)
	}
}

// floodProduce opens 400 producers and sends one batch from each at once.
func floodProduce(t *testing.T, transport *client.ClusterTransport, producers int) []string {
	t.Helper()
	var mu sync.Mutex
	var acked, unexpected []string
	codes := map[string]int{}
	var wg sync.WaitGroup
	for index := range producers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			producerID := fmt.Sprintf("%08x-0000-4000-8000-%012x", index+1, index+1)
			opened, err := transport.OpenProducer(context.Background(), fmt.Sprintf("flood-open-%d", index), protocol.OpenProducerRequest{
				Topic: "events", ProducerID: producerID, ExpectedEpoch: -1, RequestID: fmt.Sprintf("flood-open-%d", index),
			})
			value := fmt.Sprintf("flood-%d", index)
			if err == nil {
				encoded := base64.StdEncoding.EncodeToString([]byte(value))
				_, err = transport.Produce(context.Background(), fmt.Sprintf("flood-%d", index), protocol.ProduceRequest{
					Topic: "events", ProducerID: producerID, Epoch: opened.Epoch, Acks: "all",
					Records: []protocol.WireRecord{{KeyBase64: json.RawMessage("null"), ValueBase64: &encoded}},
				})
			}
			var response *client.ResponseError
			mu.Lock()
			defer mu.Unlock()
			if errors.As(err, &response) {
				codes[response.API.Code]++
			}
			switch {
			case err == nil:
				acked = append(acked, value)
			case !errors.As(err, &response) || !floodCodes[response.API.Code]:
				unexpected = append(unexpected, err.Error())
			}
		}()
	}
	wg.Wait()
	t.Logf("flood answers: %d acknowledged, errors by code %v", len(acked), codes)
	if len(unexpected) > 0 {
		t.Fatalf("%d flood answers were not success or typed backpressure, e.g. %s", len(unexpected), unexpected[0])
	}
	return acked
}

// slowHeadersAreCut holds 200 connections that never finish their request
// headers. Other clients keep being served, and the broker closes the slow
// ones once the header timeout passes.
func slowHeadersAreCut(t *testing.T, address string, cluster *testCluster, leader uint32) {
	t.Helper()
	var connections []net.Conn
	for range 200 {
		connection, err := net.Dial("tcp", address)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = connection.Write([]byte("POST /v1/produce HTTP/1.1\r\nHost: mkfk\r\nContent-Type: appl"))
		connections = append(connections, connection)
	}
	started := time.Now()
	if status, _ := cluster.admin(leader, "/readyz"); status != http.StatusOK {
		t.Fatalf("readyz with 200 slow clients = %d", status)
	}
	if _, ok := cluster.metadata(t); !ok || time.Since(started) > 2*time.Second {
		t.Fatalf("metadata was not served promptly beside slow clients (%s)", time.Since(started))
	}
	for index, connection := range connections {
		_ = connection.SetReadDeadline(time.Now().Add(15 * time.Second))
		if _, err := io.ReadAll(connection); err != nil {
			t.Fatalf("slow connection %d was not closed by the broker: %v", index, err)
		}
		_ = connection.Close()
	}
	t.Logf("200 slow-header connections closed by the broker after %s", time.Since(started).Round(time.Second))
}

// fetchStormIsAnswered sends 600 concurrent fetches asking to wait 5 s. Each
// gets an answer (records, or typed backpressure) well before that.
func fetchStormIsAnswered(t *testing.T, address string) {
	t.Helper()
	httpClient := &http.Client{Timeout: 10 * time.Second}
	statuses := map[int]int{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	started := time.Now()
	for index := range 600 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			request, _ := http.NewRequest(http.MethodGet, "http://"+address+"/v1/fetch?topic=events&partition=0&offset=0&max_bytes=1024&max_wait_ms=5000", nil)
			request.Header.Set("X-Request-ID", fmt.Sprintf("storm-%d", index))
			status := 0
			if response, err := httpClient.Do(request); err == nil {
				status = response.StatusCode
				_, _ = io.Copy(io.Discard, response.Body)
				_ = response.Body.Close()
			}
			mu.Lock()
			statuses[status]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	for status, count := range statuses {
		if status != http.StatusOK && status != http.StatusTooManyRequests && status != http.StatusServiceUnavailable {
			t.Fatalf("fetch storm got %d answers with status %d: %v", count, status, statuses)
		}
	}
	t.Logf("fetch storm answered in %s: %v", time.Since(started).Round(time.Millisecond), statuses)
}
