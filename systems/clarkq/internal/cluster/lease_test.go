package cluster

import (
	"testing"
	"time"
)

func TestLeaseGrantRenewTakeover(t *testing.T) {
	s := NewLeaseStore(time.Second)
	r1 := s.Vote(GrantRequest{Queue: "q", Owner: "n1", Term: 1})
	if !r1.Granted {
		t.Fatal(r1)
	}
	// Other owner lower term rejected
	r2 := s.Vote(GrantRequest{Queue: "q", Owner: "n2", Term: 1})
	if r2.Granted {
		t.Fatal("should reject")
	}
	// Same owner renew
	r3 := s.Vote(GrantRequest{Queue: "q", Owner: "n1", Term: 1, Renew: true})
	if !r3.Granted {
		t.Fatal(r3)
	}
	// Takeover higher term
	r4 := s.Vote(GrantRequest{Queue: "q", Owner: "n2", Term: 2})
	if !r4.Granted || r4.Lease.Owner != "n2" {
		t.Fatalf("%+v", r4)
	}
	if !s.HeldBy("q", "n2") {
		t.Fatal("held")
	}
}

func TestLeaseExpiry(t *testing.T) {
	s := NewLeaseStore(20 * time.Millisecond)
	s.Vote(GrantRequest{Queue: "q", Owner: "n1", Term: 1, TTLMs: 20})
	time.Sleep(40 * time.Millisecond)
	if _, ok := s.Get("q"); ok {
		t.Fatal("should expire")
	}
	r := s.Vote(GrantRequest{Queue: "q", Owner: "n2", Term: 1})
	if !r.Granted || r.Lease.Owner != "n2" {
		t.Fatal(r)
	}
}
