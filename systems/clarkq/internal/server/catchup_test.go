package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fallrising/newclear/systems/clarkq/internal/config"
)

const catchUpTestToken = "tok"

type testNode struct {
	url    string
	server *Server
	http   *httptest.Server
}

// newClusterPair reserves two listeners so each node knows both advertise URLs.
func newClusterPair(t *testing.T) (*httptest.Server, *httptest.Server) {
	t.Helper()
	a := httptest.NewUnstartedServer(http.NotFoundHandler())
	b := httptest.NewUnstartedServer(http.NotFoundHandler())
	t.Cleanup(a.Close)
	t.Cleanup(b.Close)
	return a, b
}

func startNode(t *testing.T, listener *httptest.Server, peers []string, walPath string) testNode {
	t.Helper()
	url := "http://" + listener.Listener.Addr().String()
	s, err := New(config.Config{
		MaxQueues:           10,
		MaxDepth:            100,
		MaxMessageBytes:     1024,
		ClusterAdvertiseURL: url,
		ClusterNodes:        peers,
		ClusterSecret:       catchUpTestToken,
		ReplicationFactor:   2,
		WALPath:             walPath,
	})
	if err != nil {
		t.Fatal(err)
	}
	listener.Config.Handler = s.Handler()
	return testNode{url: url, server: s, http: listener}
}

func internalPost(t *testing.T, s *Server, path, body string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", catchUpTestToken)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code >= 300 {
		t.Fatalf("%s status=%d body=%s", path, rec.Code, rec.Body.String())
	}
}

const consumedMessage = `{"id":"m-1","queue":"jobs","body":"one","created_at":"2026-01-01T00:00:00Z"}`

func replicateMessage(t *testing.T, s *Server) {
	internalPost(t, s, "/api/v1/internal/replicate/enqueue", consumedMessage)
}

func consumeReplica(t *testing.T, s *Server) {
	internalPost(t, s, "/api/v1/internal/replicate/dequeue", `{"queue":"jobs","id":"m-1"}`)
}

func TestCatchUpDoesNotPullBackConsumedMessage(t *testing.T) {
	la, lb := newClusterPair(t)
	peers := []string{"http://" + la.Listener.Addr().String(), "http://" + lb.Listener.Addr().String()}
	stale := startNode(t, la, peers, "")
	survivor := startNode(t, lb, peers, "")
	stale.http.Start()
	survivor.http.Start()

	replicateMessage(t, stale.server)
	replicateMessage(t, survivor.server)
	consumeReplica(t, survivor.server)

	survivor.server.catchUpOnce()

	if survivor.server.manager.HasMessage("jobs", "m-1") {
		t.Fatal("survivor pulled a consumed message back from a stale peer")
	}
}

func TestRejoinedNodeDropsMessagesConsumedWhileDown(t *testing.T) {
	la, lb := newClusterPair(t)
	peers := []string{"http://" + la.Listener.Addr().String(), "http://" + lb.Listener.Addr().String()}
	walPath := t.TempDir() + "/clarkq.wal"

	beforeDown := startNode(t, la, peers, walPath)
	replicateMessage(t, beforeDown.server)
	if err := beforeDown.server.Shutdown(); err != nil {
		t.Fatal(err)
	}

	survivor := startNode(t, lb, peers, "")
	survivor.http.Start()
	replicateMessage(t, survivor.server)
	consumeReplica(t, survivor.server)

	rejoined := startNode(t, la, peers, walPath)
	rejoined.http.Start()
	rejoined.server.catchUpOnce()

	if rejoined.server.manager.HasMessage("jobs", "m-1") {
		t.Fatal("rejoined node kept a message consumed while it was down")
	}
}

func TestCatchUpKeepsMessagesReceivedWhileRunning(t *testing.T) {
	la, lb := newClusterPair(t)
	peers := []string{"http://" + la.Listener.Addr().String(), "http://" + lb.Listener.Addr().String()}
	holder := startNode(t, la, peers, "")
	peer := startNode(t, lb, peers, "")
	holder.http.Start()
	peer.http.Start()

	replicateMessage(t, peer.server)
	consumeReplica(t, peer.server)
	replicateMessage(t, holder.server)

	holder.server.catchUpOnce()

	if !holder.server.manager.HasMessage("jobs", "m-1") {
		t.Fatal("catch-up dropped a message this node received while running")
	}
}
