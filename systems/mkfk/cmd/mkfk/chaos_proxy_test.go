package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"
)

// chaosNetwork controls every peer link through per-broker proxies that
// own the topology's peer addresses. A cut from→to drops requests on that
// direction; a cut to→from lets the request apply but loses its reply.
type chaosNetwork struct {
	mu     sync.Mutex
	cuts   map[[2]uint32]bool
	delays map[uint32]time.Duration
}

func newChaosNetwork() *chaosNetwork {
	return &chaosNetwork{cuts: map[[2]uint32]bool{}, delays: map[uint32]time.Duration{}}
}

func (n *chaosNetwork) cut(from, to uint32) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.cuts[[2]uint32{from, to}] = true
}

func (n *chaosNetwork) isolate(id uint32, brokers []uint32) {
	for _, other := range brokers {
		if other != id {
			n.cut(id, other)
			n.cut(other, id)
		}
	}
}

func (n *chaosNetwork) delay(to uint32, delay time.Duration) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.delays[to] = delay
}

func (n *chaosNetwork) heal() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.cuts = map[[2]uint32]bool{}
	n.delays = map[uint32]time.Duration{}
}

func (n *chaosNetwork) state(from, to uint32) (requestCut, replyCut bool, delay time.Duration) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.cuts[[2]uint32{from, to}], n.cuts[[2]uint32{to, from}], n.delays[to]
}

// peerProxy forwards one broker's peer traffic and applies the network's
// faults. It reads only the routing fields of each request.
type peerProxy struct {
	network *chaosNetwork
	to      uint32
	target  string
	client  *http.Client
	server  *http.Server
}

func startPeerProxy(t *testing.T, network *chaosNetwork, to uint32, listen, target string) {
	t.Helper()
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		t.Fatal(err)
	}
	proxy := &peerProxy{network: network, to: to, target: target, client: &http.Client{Timeout: 5 * time.Second}}
	proxy.server = &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = proxy.server.Serve(listener) }()
	t.Cleanup(func() { _ = proxy.server.Close() })
}

func (p *peerProxy) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	body, err := io.ReadAll(io.LimitReader(request.Body, 9<<20))
	if err != nil {
		http.Error(response, "read", http.StatusBadGateway)
		return
	}
	var routing struct {
		From uint32 `json:"from"`
	}
	_ = json.Unmarshal(body, &routing)
	requestCut, replyCut, delay := p.network.state(routing.From, p.to)
	if routing.From != 0 && requestCut {
		http.Error(response, "partitioned", http.StatusServiceUnavailable)
		return
	}
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-request.Context().Done():
			return
		}
	}
	forward, _ := http.NewRequestWithContext(request.Context(), http.MethodPost, "http://"+p.target+request.URL.Path, bytes.NewReader(body))
	forward.Header.Set("Content-Type", "application/json")
	upstream, err := p.client.Do(forward)
	if err != nil {
		http.Error(response, "upstream", http.StatusBadGateway)
		return
	}
	defer upstream.Body.Close()
	reply, _ := io.ReadAll(upstream.Body)
	if routing.From != 0 && replyCut {
		http.Error(response, "reply lost", http.StatusServiceUnavailable)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(upstream.StatusCode)
	_, _ = response.Write(reply)
}

// withPeerProxies makes every broker bind its peer listener on a private
// port and puts a fault proxy on the topology's peer address.
func (c *testCluster) withPeerProxies(network *chaosNetwork) {
	c.t.Helper()
	c.peerBinds = map[uint32]string{}
	binds := freePorts(c.t, len(c.manifest.Brokers))
	for index, broker := range c.manifest.Brokers {
		c.peerBinds[broker.ID] = binds[index]
		startPeerProxy(c.t, network, broker.ID, broker.PeerAddr, binds[index])
	}
}
