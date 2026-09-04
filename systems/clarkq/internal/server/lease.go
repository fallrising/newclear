package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/fallrising/newclear/systems/clarkq/internal/cluster"
)

const internalLeaseVote = "/api/v1/internal/lease/vote"

// leaseCoordinator acquires/renews leases for queues this node should own.
type leaseCoordinator struct {
	s *Server

	mu    sync.Mutex
	local map[string]cluster.Lease // queues we believe we hold
	terms map[string]uint64        // last term we used per queue
}

func newLeaseCoordinator(s *Server) *leaseCoordinator {
	return &leaseCoordinator{
		s:     s,
		local: make(map[string]cluster.Lease),
		terms: make(map[string]uint64),
	}
}

func (s *Server) leasesEnabled() bool {
	return s.cfg.LeaseEnabled && s.cluster != nil && s.cluster.Enabled() && s.leaseStore != nil && s.leaseCoord != nil
}

func (s *Server) startLeaseWorker() {
	if !s.leasesEnabled() {
		return
	}
	interval := s.cfg.LeaseTTL / 3
	if interval < 200*time.Millisecond {
		interval = 200 * time.Millisecond
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-s.bgStop:
				return
			case <-t.C:
				s.leaseCoord.renewAll()
			}
		}
	}()
}

func (c *leaseCoordinator) renewAll() {
	s := c.s
	if s.cluster == nil {
		return
	}
	// Queues we hash-own under current membership + any we already hold.
	queues := map[string]struct{}{}
	for _, qi := range s.manager.List() {
		if s.cluster.IsLocal(qi.Name) {
			queues[qi.Name] = struct{}{}
		}
	}
	c.mu.Lock()
	for q := range c.local {
		queues[q] = struct{}{}
	}
	c.mu.Unlock()

	for q := range queues {
		if !s.cluster.IsLocal(q) {
			// Lost hash ownership — drop local lease claim.
			c.mu.Lock()
			delete(c.local, q)
			c.mu.Unlock()
			continue
		}
		if err := c.acquire(context.Background(), q, true); err != nil {
			slog.Debug("lease renew failed", "queue", q, "error", err)
		}
	}
}

// ensureLease acquires a lease if needed (call before owner write).
func (c *leaseCoordinator) ensureLease(ctx context.Context, queueName string) error {
	if c == nil || !c.s.leasesEnabled() {
		return nil
	}
	c.mu.Lock()
	l, ok := c.local[queueName]
	c.mu.Unlock()
	if ok && time.Now().Before(l.Expires.Add(-c.s.cfg.LeaseTTL/4)) {
		return nil
	}
	return c.acquire(ctx, queueName, ok)
}

func (c *leaseCoordinator) acquire(ctx context.Context, queueName string, renew bool) error {
	s := c.s
	c.mu.Lock()
	term := c.terms[queueName]
	if !renew || term == 0 {
		term++
	}
	c.terms[queueName] = term
	c.mu.Unlock()

	req := cluster.GrantRequest{
		Queue: queueName,
		Owner: s.cluster.Self,
		Term:  term,
		Epoch: s.cluster.Epoch(),
		TTLMs: s.cfg.LeaseTTL.Milliseconds(),
		Renew: renew,
	}

	// Local vote first.
	votes := 0
	var last cluster.Lease
	if s.leaseStore != nil {
		resp := s.leaseStore.Vote(req)
		if resp.Granted {
			votes++
			last = resp.Lease
		}
	}

	need := s.leaseQuorum()
	for _, peer := range s.cluster.AlivePeers() {
		resp, err := s.voteLease(ctx, peer, req)
		if err != nil {
			continue
		}
		if resp.Granted {
			votes++
			last = resp.Lease
		}
	}

	if votes < need {
		return fmt.Errorf("%w: lease votes %d need %d", errLease, votes, need)
	}

	// Bump term if peers advanced it.
	if last.Term > term {
		term = last.Term
	}
	lease := cluster.Lease{
		Queue:   queueName,
		Owner:   s.cluster.Self,
		Term:    term,
		Epoch:   s.cluster.Epoch(),
		Expires: time.Now().UTC().Add(s.cfg.LeaseTTL),
	}
	c.mu.Lock()
	c.local[queueName] = lease
	c.terms[queueName] = term
	c.mu.Unlock()
	return nil
}

func (s *Server) leaseQuorum() int {
	// Majority of configured cluster nodes.
	n := 1
	if s.cluster != nil {
		n = len(s.cluster.Nodes)
	}
	return n/2 + 1
}

func (s *Server) voteLease(ctx context.Context, peer string, req cluster.GrantRequest) (cluster.GrantResponse, error) {
	data, err := json.Marshal(req)
	if err != nil {
		return cluster.GrantResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, peer+internalLeaseVote, bytes.NewReader(data))
	if err != nil {
		return cluster.GrantResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	s.withClusterAuth(httpReq)
	// Lease votes use catch-up bypass for epoch during membership churn.
	httpReq.Header.Set(cluster.CatchUpHeader, "1")
	resp, err := s.clusterHTTP().Do(httpReq)
	if err != nil {
		return cluster.GrantResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return cluster.GrantResponse{}, fmt.Errorf("status %d: %s", resp.StatusCode, string(b))
	}
	var out cluster.GrantResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return cluster.GrantResponse{}, err
	}
	return out, nil
}

func (s *Server) handleLeaseVote(w http.ResponseWriter, r *http.Request) {
	var req cluster.GrantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, errInvalidJSON)
		return
	}
	if s.leaseStore == nil {
		s.writeError(w, errForbidden)
		return
	}
	spanAttrs(r.Context(), attrOp("lease_vote"), attrQueue(req.Queue))
	resp := s.leaseStore.Vote(req)
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) hasValidLease(queueName string) bool {
	if !s.leasesEnabled() {
		return true
	}
	if s.leaseCoord == nil {
		return false
	}
	s.leaseCoord.mu.Lock()
	l, ok := s.leaseCoord.local[queueName]
	s.leaseCoord.mu.Unlock()
	return ok && time.Now().Before(l.Expires)
}

func (s *Server) leaseSnapshot() []cluster.Lease {
	if s.leaseCoord == nil {
		return nil
	}
	s.leaseCoord.mu.Lock()
	defer s.leaseCoord.mu.Unlock()
	out := make([]cluster.Lease, 0, len(s.leaseCoord.local))
	now := time.Now()
	for _, l := range s.leaseCoord.local {
		if now.Before(l.Expires) {
			out = append(out, l)
		}
	}
	return out
}
