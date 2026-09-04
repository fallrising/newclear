package cluster

import "testing"

func TestOwnerStable(t *testing.T) {
	r := New("http://n1:8080", []string{"http://n1:8080", "http://n2:8080", "http://n3:8080"})
	if !r.Enabled() {
		t.Fatal("expected enabled")
	}
	o1 := r.Owner("orders")
	o2 := r.Owner("orders")
	if o1 != o2 {
		t.Fatalf("unstable owner %s vs %s", o1, o2)
	}
	// All three nodes should own something across many queues.
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		seen[r.Owner(string(rune('a'+i%26))+string(rune('0'+i%10)))] = true
	}
	if len(seen) < 2 {
		t.Fatalf("expected multiple owners, got %v", seen)
	}
}

func TestIsLocalSingleNode(t *testing.T) {
	r := New("http://n1:8080", []string{"http://n1:8080"})
	if r.Enabled() {
		t.Fatal("single node should not enable sharding")
	}
	if !r.IsLocal("q") {
		t.Fatal("local")
	}
}

func TestProxyNilWhenLocal(t *testing.T) {
	r := New("http://n1:8080", []string{"http://n1:8080", "http://n2:8080"})
	// Find a queue owned by n1
	var localQ string
	for _, name := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"} {
		if r.IsLocal(name) {
			localQ = name
			break
		}
	}
	if localQ == "" {
		t.Skip("no local queue in sample")
	}
	if p := r.Proxy(localQ); p != nil {
		t.Fatal("expected nil proxy for local")
	}
}

func TestReplicasPrimaryFirst(t *testing.T) {
	r := New("http://n1:8080", []string{"http://n1:8080", "http://n2:8080", "http://n3:8080"})
	reps := r.Replicas("orders", 2)
	if len(reps) != 2 {
		t.Fatalf("len=%d", len(reps))
	}
	if reps[0] != r.Owner("orders") {
		t.Fatalf("primary first: %v owner=%s", reps, r.Owner("orders"))
	}
	if reps[0] == reps[1] {
		t.Fatal("duplicate replica")
	}
	for _, n := range reps {
		if n == r.Self && !r.IsReplica("orders", 2) {
			t.Fatal("IsReplica false for self in set")
		}
	}
}

func TestEpochStableForSameAliveSet(t *testing.T) {
	r := New("http://n1:8080", []string{"http://n1:8080", "http://n2:8080", "http://n3:8080"})
	m := NewMembership(r.Self, r.Nodes, MembershipConfig{FailThreshold: 1})
	r.Membership = m
	e1 := r.Epoch()
	e2 := r.Epoch()
	if e1 == 0 || e1 != e2 {
		t.Fatalf("epoch unstable %d %d", e1, e2)
	}
	m.SetAlive("http://n2:8080", false)
	e3 := r.Epoch()
	if e3 == e1 {
		t.Fatal("epoch should change when alive set changes")
	}
}

func TestOwnerSkipsDeadWithMembership(t *testing.T) {
	r := New("http://n1:8080", []string{"http://n1:8080", "http://n2:8080", "http://n3:8080"})
	m := NewMembership(r.Self, r.Nodes, MembershipConfig{FailThreshold: 1})
	r.Membership = m
	// Force only n1 and n3 alive.
	m.SetAlive("http://n2:8080", false)
	for i := 0; i < 20; i++ {
		name := string(rune('a' + i))
		o := r.Owner(name)
		if o == "http://n2:8080" {
			t.Fatalf("queue %s owned by dead n2", name)
		}
	}
}
