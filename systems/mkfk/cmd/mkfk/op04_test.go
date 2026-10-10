package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// countingDoer counts HTTP requests the SDK sends.
type countingDoer struct {
	requests atomic.Int64
	client   *http.Client
}

func (d *countingDoer) Do(request *http.Request) (*http.Response, error) {
	d.requests.Add(1)
	return d.client.Do(request)
}

// OP-04 reply loss: the broker commits the batch but the client never sees
// the reply. The SDK producer resends the identical batch, gets the original
// offsets back, and the log holds one copy.
func TestM7OP04LostProduceReplyIsRetriedWithTheSameIdentity(t *testing.T) {
	t.Parallel()
	cluster := newTestCluster(t, 1, 1, 1)
	cluster.start(1)
	cluster.waitReady(1)
	upstream, _ := url.Parse("http://" + cluster.broker(1).ClientAddr)
	var dropped atomic.Int64
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.ModifyResponse = func(response *http.Response) error {
		if response.Request.URL.Path == "/v1/produce" && dropped.Add(1) == 1 {
			return errReplyLost
		}
		return nil
	}
	proxy.ErrorHandler = func(response http.ResponseWriter, _ *http.Request, _ error) {
		panic(http.ErrAbortHandler) // the connection dies; the client sees no reply
	}
	front := httptest.NewServer(proxy)
	defer front.Close()
	transport, err := client.NewClusterTransport(nil, map[uint32]string{1: front.URL})
	if err != nil {
		t.Fatal(err)
	}
	w := openWriter(t, transport, 0, "e")
	producer, err := client.NewProducer(client.ProducerConfig{
		ClusterID: cluster.manifest.ClusterID, ProducerID: w.producerID, Topic: "events", Epoch: w.epoch,
		Transport: transport, Ledger: mustLedger(t, filepath.Join(cluster.dir, "ledger.json")),
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := producer.Send(context.Background(), []client.Record{{Value: []byte("sent-once")}})
	if err != nil {
		t.Fatalf("send after a lost reply: %v", err)
	}
	if dropped.Load() < 2 {
		t.Fatalf("the first reply was not dropped (%d produce replies seen)", dropped.Load())
	}
	values := fetchAll(t, transport, 0)
	if len(values) != 1 || values[0] != "sent-once" || response.BaseOffset != 0 || response.NextSequence != 1 {
		t.Fatalf("log=%q response=%+v; want one copy at offset 0 and next sequence 1", values, response)
	}
}

var errReplyLost = &replyLost{}

type replyLost struct{}

func (*replyLost) Error() string { return "reply lost" }

func mustLedger(t *testing.T, path string) *client.FileLedger {
	t.Helper()
	ledger, err := client.NewFileLedger(path)
	if err != nil {
		t.Fatal(err)
	}
	return ledger
}

// OP-04 stale routes: a client whose route points at followers or at a
// dead broker reaches the leader within one bounded pass, keeps its
// identity, and leaves no goroutines behind after many failed calls.
func TestM7OP04StaleRoutesAreBoundedAndLeakNoGoroutines(t *testing.T) {
	t.Parallel()
	cluster := newTestCluster(t, 3, 1, 3)
	for id := uint32(1); id <= 3; id++ {
		cluster.start(id)
	}
	for id := uint32(1); id <= 3; id++ {
		cluster.waitReady(id)
	}
	leader := cluster.leaderOf(t, 0)
	doer := &countingDoer{client: &http.Client{Timeout: 5 * time.Second}}
	transport, err := client.NewClusterTransport(doer, cluster.endpoints())
	if err != nil {
		t.Fatal(err)
	}
	w := openWriter(t, transport, 0, "f")
	w.produce(t, "learned-route")
	cluster.procs[leader].kill()
	newLeader := cluster.leaderOf(t, 0)
	value := "after-failover"
	request := protocol.ProduceRequest{
		Topic: "events", ProducerID: w.producerID, Epoch: protocol.DecimalUint64(w.epoch),
		FirstSequence: protocol.DecimalUint64(w.sequence), Acks: "all",
		Records: []protocol.WireRecord{{KeyBase64: json.RawMessage("null"), ValueBase64: &value}},
	}
	value = base64.StdEncoding.EncodeToString([]byte("after-failover"))
	var calls []int64
	for attempt := 0; ; attempt++ {
		before := doer.requests.Load()
		_, err := transport.Produce(context.Background(), "after-failover", request)
		calls = append(calls, doer.requests.Load()-before)
		if calls[len(calls)-1] > 3 {
			t.Fatalf("one produce call sent %d HTTP requests; a routing pass covers 3 brokers", calls[len(calls)-1])
		}
		if err == nil {
			break
		}
		if attempt == 10 {
			t.Fatalf("new leader %d not reached after %v requests per call: %v", newLeader, calls, err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Logf("old leader %d killed; reached new leader %d; requests per call %v", leader, newLeader, calls)
	if values := fetchAll(t, transport, 0); len(values) != 2 {
		t.Fatalf("log after failover = %q", values)
	}

	dead := map[uint32]string{1: "http://" + freePorts(t, 1)[0], 2: "http://" + freePorts(t, 1)[0]}
	unreachable, err := client.NewClusterTransport(nil, dead)
	if err != nil {
		t.Fatal(err)
	}
	baseline := runtime.NumGoroutine()
	for range 200 {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		_, err := unreachable.Produce(ctx, "dead", protocol.ProduceRequest{
			Topic: "events", ProducerID: w.producerID, Epoch: protocol.DecimalUint64(w.epoch), FirstSequence: 1, Acks: "all",
		})
		cancel()
		if err == nil {
			t.Fatal("a produce to dead brokers succeeded")
		}
	}
	eventually(t, "client goroutines to return to baseline", 10*time.Second, func() bool {
		return runtime.NumGoroutine() <= baseline+5
	})
	if leaderGoroutines := cluster.goroutines(newLeader); leaderGoroutines < 0 || leaderGoroutines > 400 {
		t.Fatalf("leader reports %d goroutines", leaderGoroutines)
	}
}

// goroutines reads a broker's mkfk_goroutines gauge, or -1.
func (c *testCluster) goroutines(id uint32) int64 {
	_, text := c.admin(id, "/metrics")
	match := regexp.MustCompile(`(?m)^mkfk_goroutines (\d+)$`).FindStringSubmatch(text)
	if match == nil {
		return -1
	}
	value, _ := strconv.ParseInt(match[1], 10, 64)
	return value
}
