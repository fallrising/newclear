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

	"github.com/fallrising/newclear/systems/clarkq/internal/queue"
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

	// Snapshot every other live member of the replica set.
	peers := map[string]peerQueueState{}
	attempted := 0
	for _, node := range s.cluster.Replicas(queueName, rf) {
		if node == s.cluster.Self {
			continue
		}
		if s.cluster.Membership != nil && !s.cluster.Membership.IsAlive(node) {
			continue
		}
		attempted++
		state, err := s.fetchPeerMessages(ctx, node, queueName)
		if err != nil {
			slog.Debug("catch-up pull failed", "queue", queueName, "peer", node, "error", err)
			continue
		}
		peers[node] = state
	}

	if dropped := s.dropStaleLocal(queueName, peers); dropped > 0 {
		slog.Info("catch-up dropped stale messages consumed elsewhere", "queue", queueName, "dropped", dropped)
	}
	// Once every live replica has answered, what remains locally is vouched for.
	if attempted > 0 && len(peers) == attempted {
		s.manager.ConfirmAll(queueName)
	}
	for node, state := range peers {
		added, err := s.mergeFromPeer(queueName, state.Messages)
		if err != nil {
			slog.Debug("catch-up merge failed", "queue", queueName, "peer", node, "error", err)
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

// peerQueueState is a peer's view of one queue: what it holds and what it removed recently.
type peerQueueState struct {
	Messages []queue.Message `json:"messages"`
	Removed  []string        `json:"removed"`
}

// dropStaleLocal deletes messages restored from disk at startup that a peer has since
// removed and no peer still holds: they were consumed while this node was down.
// Messages received while running are never dropped here, so a head put back after a
// failed quorum delete is kept.
func (s *Server) dropStaleLocal(queueName string, peers map[string]peerQueueState) int {
	unconfirmed := s.manager.UnconfirmedIDs(queueName)
	if len(unconfirmed) == 0 {
		return 0
	}
	held := map[string]struct{}{}
	for _, state := range peers {
		for _, msg := range state.Messages {
			held[msg.ID] = struct{}{}
		}
	}
	dropped := 0
	for _, state := range peers {
		for _, id := range state.Removed {
			if _, ok := unconfirmed[id]; !ok {
				continue
			}
			if _, ok := held[id]; ok {
				continue
			}
			removed, err := s.manager.RemoveByID(queueName, id)
			if err != nil || !removed {
				continue
			}
			dropped++
			if s.engine != nil {
				_ = s.engine.RecordDequeue(queueName, id)
			}
		}
	}
	return dropped
}

func (s *Server) mergeFromPeer(queueName string, msgs []queue.Message) (int, error) {
	if len(msgs) == 0 {
		return 0, nil
	}
	added, err := s.manager.MergeMessages(queueName, msgs)
	if s.engine != nil {
		for _, msg := range added {
			_ = s.engine.RecordEnqueue(msg)
		}
	}
	return len(added), err
}

func (s *Server) pushMissingToReplicas(ctx context.Context, queueName string, rf int) {
	local, err := s.manager.ExportQueue(queueName)
	if err != nil || len(local) == 0 {
		return
	}
	// Never spread copies peers have not confirmed; they may already be consumed.
	unconfirmed := s.manager.UnconfirmedIDs(queueName)
	byID := make(map[string]queue.Message, len(local))
	for _, m := range local {
		if _, ok := unconfirmed[m.ID]; ok {
			continue
		}
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
			for _, msg := range byID {
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

func (s *Server) fetchPeerMessages(ctx context.Context, peer, queueName string) (peerQueueState, error) {
	var out peerQueueState
	url := peer + internalQueueMessages + queueName + "/messages"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return out, err
	}
	s.withClusterAuth(req)
	req.Header.Set("X-ClarkQ-CatchUp", "1")
	resp, err := s.clusterHTTP().Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return out, nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return out, fmt.Errorf("status %d: %s", resp.StatusCode, string(b))
	}
	err = json.NewDecoder(resp.Body).Decode(&out)
	return out, err
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
	if err != nil && !errors.Is(err, queue.ErrQueueNotFound) {
		s.writeError(w, err)
		return
	}
	state := peerQueueState{Messages: msgs, Removed: s.manager.RemovedIDs(name)}
	if state.Messages == nil {
		state.Messages = []queue.Message{}
	}
	if state.Removed == nil {
		state.Removed = []string{}
	}
	writeJSON(w, http.StatusOK, state)
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
