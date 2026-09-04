package cluster

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fallrising/clarkQ/internal/queue"
)

func TestMembershipFailoverOwner(t *testing.T) {
	// Three logical nodes; membership forces n2 dead → hashing only on alive.
	r := New("http://n1:8080", []string{"http://n1:8080", "http://n2:8080", "http://n3:8080"})
	m := NewMembership(r.Self, r.Nodes, MembershipConfig{FailThreshold: 1})
	r.Membership = m

	// Initially all optimistic alive.
	ownerAll := r.Owner("orders")
	if ownerAll == "" {
		t.Fatal("empty owner")
	}

	// Kill n2
	m.SetAlive("http://n2:8080", false)
	alive := m.AliveNodes()
	for _, u := range alive {
		if u == "http://n2:8080" {
			t.Fatal("n2 should not be alive")
		}
	}
	owner := r.Owner("orders")
	if owner == "http://n2:8080" {
		t.Fatal("dead node must not own queues")
	}
	// Owner must be in alive set
	ok := false
	for _, u := range alive {
		if u == owner {
			ok = true
		}
	}
	if !ok {
		t.Fatalf("owner %s not in alive %v", owner, alive)
	}

	// Revive n2
	m.SetAlive("http://n2:8080", true)
	if !m.IsAlive("http://n2:8080") {
		t.Fatal("n2 should be alive")
	}
	if m.Generation() < 2 {
		t.Fatalf("generation should bump, got %d", m.Generation())
	}
}

func TestMembershipProbe(t *testing.T) {
	alive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer alive.Close()
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	deadURL := dead.URL
	dead.Close() // immediately closed → connection errors

	self := "http://self:1"
	m := NewMembership(self, []string{self, alive.URL, deadURL}, MembershipConfig{
		Interval:      time.Hour,
		Timeout:       200 * time.Millisecond,
		FailThreshold: 1,
	})
	m.probeAll()
	if !m.IsAlive(alive.URL) {
		t.Fatal("alive server should be up")
	}
	if m.IsAlive(deadURL) {
		t.Fatal("dead server should be down")
	}
}

func TestOutboxRetryAndDrop(t *testing.T) {
	o := NewOutbox(3, time.Millisecond, "")
	o.Add(OutboxItem{Op: OutboxEnqueue, Target: "http://n2", Queue: "q"})
	if o.Len() != 1 {
		t.Fatal(o.Len())
	}
	ready := o.Ready(time.Now().Add(time.Second), 10)
	if len(ready) != 1 {
		t.Fatalf("ready=%d", len(ready))
	}
	id := ready[0].ID
	if o.Fail(id, "err1") {
		t.Fatal("should not drop yet")
	}
	if o.Fail(id, "err2") {
		t.Fatal("should not drop yet")
	}
	if !o.Fail(id, "err3") {
		t.Fatal("should drop after max")
	}
	if o.Len() != 0 {
		t.Fatal("empty")
	}
}

func TestOutboxDurableRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/outbox.json"
	o1 := NewOutbox(5, time.Millisecond, path)
	o1.Add(OutboxItem{
		Op:     OutboxEnqueue,
		Target: "http://n2:8080",
		Queue:  "orders",
		Message: &queue.Message{
			ID:    "m1",
			Queue: "orders",
			Body:  "hello",
		},
	})
	if err := o1.Save(); err != nil {
		t.Fatal(err)
	}

	o2 := NewOutbox(5, time.Millisecond, path)
	if err := o2.Load(); err != nil {
		t.Fatal(err)
	}
	if o2.Len() != 1 {
		t.Fatalf("len=%d", o2.Len())
	}
	items := o2.Snapshot()
	if items[0].Queue != "orders" || items[0].Message == nil || items[0].Message.Body != "hello" {
		t.Fatalf("%+v", items[0])
	}
}
