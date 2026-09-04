package cluster

import (
	"sync"
	"time"
)

// Lease is a time-bounded ownership grant for a queue.
type Lease struct {
	Queue   string    `json:"queue"`
	Owner   string    `json:"owner"`
	Term    uint64    `json:"term"`
	Epoch   uint64    `json:"epoch"`
	Expires time.Time `json:"expires"`
}

// LeaseStore holds leases observed/granted by this node (for quorum voting).
type LeaseStore struct {
	mu     sync.Mutex
	leases map[string]Lease // queue -> lease
	ttl    time.Duration
}

// NewLeaseStore creates a store. ttl is the default lease lifetime.
func NewLeaseStore(ttl time.Duration) *LeaseStore {
	if ttl <= 0 {
		ttl = 5 * time.Second
	}
	return &LeaseStore{
		leases: make(map[string]Lease),
		ttl:    ttl,
	}
}

// TTL returns configured lease lifetime.
func (s *LeaseStore) TTL() time.Duration {
	if s == nil {
		return 0
	}
	return s.ttl
}

// Get returns a non-expired lease for queue, if any.
func (s *LeaseStore) Get(queue string) (Lease, bool) {
	if s == nil {
		return Lease{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.leases[queue]
	if !ok || time.Now().After(l.Expires) {
		delete(s.leases, queue)
		return Lease{}, false
	}
	return l, true
}

// GrantRequest is a lease acquire/renew proposal.
type GrantRequest struct {
	Queue  string `json:"queue"`
	Owner  string `json:"owner"`
	Term   uint64 `json:"term"`
	Epoch  uint64 `json:"epoch"`
	TTLMs  int64  `json:"ttl_ms"`
	Renew  bool   `json:"renew"`
}

// GrantResponse is returned by a voter.
type GrantResponse struct {
	Granted bool   `json:"granted"`
	Lease   Lease  `json:"lease,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// Vote processes a grant/renew request on this voter.
// Rules:
//   - expired or missing lease → grant to requester with term+1 (or req.Term if higher)
//   - same owner renew → extend expiry, keep/increase term
//   - different owner while lease valid → reject unless req.Term > current.Term (takeover)
func (s *LeaseStore) Vote(req GrantRequest) GrantResponse {
	if s == nil {
		return GrantResponse{Granted: false, Reason: "no store"}
	}
	if req.Queue == "" || req.Owner == "" {
		return GrantResponse{Granted: false, Reason: "invalid request"}
	}
	ttl := s.ttl
	if req.TTLMs > 0 {
		ttl = time.Duration(req.TTLMs) * time.Millisecond
	}
	now := time.Now().UTC()
	exp := now.Add(ttl)

	s.mu.Lock()
	defer s.mu.Unlock()

	cur, ok := s.leases[req.Queue]
	if ok && now.After(cur.Expires) {
		ok = false
		delete(s.leases, req.Queue)
	}

	if !ok {
		term := req.Term
		if term == 0 {
			term = 1
		}
		l := Lease{Queue: req.Queue, Owner: req.Owner, Term: term, Epoch: req.Epoch, Expires: exp}
		s.leases[req.Queue] = l
		return GrantResponse{Granted: true, Lease: l}
	}

	// Same owner: renew
	if cur.Owner == req.Owner {
		if req.Term > cur.Term {
			cur.Term = req.Term
		}
		cur.Epoch = req.Epoch
		cur.Expires = exp
		s.leases[req.Queue] = cur
		return GrantResponse{Granted: true, Lease: cur}
	}

	// Takeover with higher term
	if req.Term > cur.Term {
		l := Lease{Queue: req.Queue, Owner: req.Owner, Term: req.Term, Epoch: req.Epoch, Expires: exp}
		s.leases[req.Queue] = l
		return GrantResponse{Granted: true, Lease: l}
	}

	return GrantResponse{Granted: false, Lease: cur, Reason: "lease held by other owner"}
}

// Snapshot returns non-expired leases.
func (s *LeaseStore) Snapshot() []Lease {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	out := make([]Lease, 0, len(s.leases))
	for q, l := range s.leases {
		if now.After(l.Expires) {
			delete(s.leases, q)
			continue
		}
		out = append(out, l)
	}
	return out
}

// HeldBy reports whether owner holds a valid lease for queue.
func (s *LeaseStore) HeldBy(queue, owner string) bool {
	l, ok := s.Get(queue)
	return ok && l.Owner == owner
}
