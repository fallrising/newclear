package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/fallrising/clarkQ/internal/queue"
)

const (
	internalQueueMessages = "/api/v1/internal/queue/" // + {name}/messages
	internalQueueIDs      = "/api/v1/internal/queue/" // + {name}/ids
)

func (s *Server) startCatchUpWorker() {
	if s.cluster == nil || !s.cluster.Enabled() || s.replicationFactor() < 2 {
		return
	}
	interval := s.cfg.CatchUpInterval
	if interval < 0 {
		return
	}
	if interval == 0 {
		interval = 5 * time.Second
	}
	go func() {
		// Short delay so membership has a first probe.
		select {
		case <-s.bgStop:
			return
		case <-time.After(time.Second):
		}
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-s.bgStop:
				return
			case <-t.C:
				s.catchUpOnce()
			}
		}
	}()
}

func (s *Server) catchUpOnce() {
	if s.cluster == nil || !s.cluster.Enabled() {
		return
	}
	rf := s.replicationFactor()
	if rf < 2 {
		return
	}

	// Queues we participate in locally.
	seen := map[string]struct{}{}
	for _, qi := range s.manager.List() {
		seen[qi.Name] = struct{}{}
		s.catchUpQueue(qi.Name, rf)
	}

	// Discover queues on peers that we should hold (owner or replica).
	for _, peer := range s.cluster.AlivePeers() {
		list, err := s.fetchPeerQueues(context.Background(), peer)
		if err != nil {
			continue
		}
		for _, qi := range list {
			if _, ok := seen[qi.Name]; ok {
				continue
			}
			if s.cluster.IsLocal(qi.Name) || s.cluster.IsReplica(qi.Name, rf) {
				seen[qi.Name] = struct{}{}
				s.catchUpQueue(qi.Name, rf)
			}
		}
	}
}

func (s *Server) catchUpQueue(queueName string, rf int) {
	if !s.cluster.IsLocal(queueName) && !s.cluster.IsReplica(queueName, rf) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Pull missing messages from every other live member of the replica set.
	for _, node := range s.cluster.Replicas(queueName, rf) {
		if node == s.cluster.Self {
			continue
		}
		if s.cluster.Membership != nil && !s.cluster.Membership.IsAlive(node) {
			continue
		}
		added, err := s.pullAndMerge(ctx, node, queueName)
		if err != nil {
			slog.Debug("catch-up pull failed", "queue", queueName, "peer", node, "error", err)
			continue
		}
		if added > 0 {
			slog.Info("catch-up merged messages", "queue", queueName, "from", node, "added", added)
		}
	}

	// If we are primary, push missing to replicas (heals recovering nodes).
	if s.cluster.IsLocal(queueName) {
		s.pushMissingToReplicas(ctx, queueName, rf)
	}
}

func (s *Server) pullAndMerge(ctx context.Context, peer, queueName string) (int, error) {
	msgs, err := s.fetchPeerMessages(ctx, peer, queueName)
	if err != nil {
		return 0, err
	}
	if len(msgs) == 0 {
		return 0, nil
	}
	added, err := s.manager.MergeMessages(queueName, msgs)
	if err != nil {
		return len(added), err
	}
	if s.engine != nil {
		for _, msg := range added {
			_ = s.engine.RecordEnqueue(msg)
		}
	}
	return len(added), nil
}

func (s *Server) pushMissingToReplicas(ctx context.Context, queueName string, rf int) {
	local, err := s.manager.ExportQueue(queueName)
	if err != nil || len(local) == 0 {
		return
	}
	byID := make(map[string]queue.Message, len(local))
	for _, m := range local {
		byID[m.ID] = m
	}
	for _, node := range s.cluster.Replicas(queueName, rf) {
		if node == s.cluster.Self {
			continue
		}
		if s.cluster.Membership != nil && !s.cluster.Membership.IsAlive(node) {
			continue
		}
		ids, err := s.fetchPeerIDs(ctx, node, queueName)
		if err != nil {
			// Peer may not have the queue yet — push all via outbox/replicate.
			for _, msg := range local {
				_ = s.postJSONCatchUp(ctx, node+internalEnqueue, msg)
			}
			continue
		}
		have := map[string]struct{}{}
		for _, id := range ids {
			have[id] = struct{}{}
		}
		for id, msg := range byID {
			if _, ok := have[id]; ok {
				continue
			}
			if err := s.postJSONCatchUp(ctx, node+internalEnqueue, msg); err != nil {
				s.queueOutboxEnqueue(msg, []string{node})
			}
		}
	}
}

func (s *Server) fetchPeerMessages(ctx context.Context, peer, queueName string) ([]queue.Message, error) {
	url := peer + internalQueueMessages + queueName + "/messages"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	s.withClusterAuth(req)
	req.Header.Set("X-ClarkQ-CatchUp", "1")
	resp, err := s.clusterHTTP().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(b))
	}
	var out struct {
		Messages []queue.Message `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Messages, nil
}

func (s *Server) fetchPeerIDs(ctx context.Context, peer, queueName string) ([]string, error) {
	url := peer + internalQueueIDs + queueName + "/ids"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	s.withClusterAuth(req)
	req.Header.Set("X-ClarkQ-CatchUp", "1")
	resp, err := s.clusterHTTP().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var out struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.IDs, nil
}

func (s *Server) handleInternalQueueMessages(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	spanAttrs(r.Context(), attrOp("internal_messages"), attrQueue(name))
	msgs, err := s.manager.ExportQueue(name)
	if err != nil {
		if errors.Is(err, queue.ErrQueueNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"messages": []queue.Message{}})
			return
		}
		s.writeError(w, err)
		return
	}
	if msgs == nil {
		msgs = []queue.Message{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

func (s *Server) handleInternalQueueIDs(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	spanAttrs(r.Context(), attrOp("internal_ids"), attrQueue(name))
	ids, err := s.manager.MessageIDs(name)
	if err != nil {
		s.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ids": ids})
}
