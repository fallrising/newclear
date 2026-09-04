package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/fallrising/clarkQ/internal/cluster"
	"github.com/fallrising/clarkQ/internal/queue"
)

const (
	clusterTokenHeader = "X-ClarkQ-Cluster-Token"
	internalEnqueue    = "/api/v1/internal/replicate/enqueue"
	internalDequeue    = "/api/v1/internal/replicate/dequeue"
	internalClear      = "/api/v1/internal/replicate/clear"
	internalQueues     = "/api/v1/internal/queues"
)

// configuredRF is the configured replication factor capped by cluster size (not liveness).
func (s *Server) configuredRF() int {
	rf := s.cfg.ReplicationFactor
	if rf < 1 {
		return 1
	}
	if s.cluster != nil && rf > len(s.cluster.Nodes) {
		return len(s.cluster.Nodes)
	}
	return rf
}

// replicationFactor returns RF capped by currently alive nodes (for target selection).
func (s *Server) replicationFactor() int {
	rf := s.configuredRF()
	if s.cluster == nil {
		return 1
	}
	n := len(s.cluster.Nodes)
	if s.cluster.Membership != nil {
		if a := len(s.cluster.Membership.AliveNodes()); a > 0 {
			n = a
		}
	}
	if rf > n {
		return n
	}
	return rf
}

// writeQuorum is the number of successful copies required (including primary).
// Default 0 → majority of configured RF: floor(RF/2)+1.
func (s *Server) writeQuorum() int {
	return s.quorumOf(s.cfg.WriteQuorum)
}

// readQuorum is the number of replicas that must observe a message before linearizable ops.
func (s *Server) readQuorum() int {
	return s.quorumOf(s.cfg.ReadQuorum)
}

func (s *Server) quorumOf(configured int) int {
	rf := s.configuredRF()
	w := configured
	if w <= 0 {
		return rf/2 + 1
	}
	if w > rf {
		return rf
	}
	if w < 1 {
		return 1
	}
	return w
}

func (s *Server) replicaTargets(queueName string) []string {
	if s.cluster == nil {
		return nil
	}
	// Target selection uses alive-aware RF; quorum check uses configured majority.
	return s.cluster.Replicas(queueName, s.replicationFactor())
}

func (s *Server) clusterHTTP() *http.Client {
	return &http.Client{Timeout: 5 * time.Second}
}

func (s *Server) withClusterAuth(req *http.Request) {
	if s.cfg.ClusterSecret != "" {
		req.Header.Set(clusterTokenHeader, s.cfg.ClusterSecret)
	}
	req.Header.Set(cluster.ForwardHeader, "1")
	if s.cluster != nil {
		if gen := s.cluster.Generation(); gen > 0 {
			req.Header.Set(cluster.GenerationHeader, fmt.Sprintf("%d", gen))
		}
		if epoch := s.cluster.Epoch(); epoch > 0 {
			req.Header.Set(cluster.EpochHeader, fmt.Sprintf("%d", epoch))
		}
	}
}

// checkEpoch rejects internal ops stamped with a different membership epoch (fencing).
// Catch-up requests may set X-ClarkQ-CatchUp: 1 to bypass.
func (s *Server) checkEpoch(r *http.Request) error {
	if s.cluster == nil || !s.cfg.EpochFencing {
		return nil
	}
	if r.Header.Get(cluster.CatchUpHeader) == "1" {
		return nil
	}
	raw := r.Header.Get(cluster.EpochHeader)
	if raw == "" {
		// Missing epoch allowed only when fencing is soft (default true still requires match if present).
		if s.cfg.EpochFencingStrict {
			return errStaleEpoch
		}
		return nil
	}
	var reqEpoch uint64
	if _, err := fmt.Sscanf(raw, "%d", &reqEpoch); err != nil {
		return errStaleEpoch
	}
	local := s.cluster.Epoch()
	if reqEpoch != local {
		return errStaleEpoch
	}
	return nil
}

// assertOwnerWrite enforces hash ownership, optional lease, and grace period.
func (s *Server) assertOwnerWrite(queueName string) error {
	if s.cluster == nil || !s.cluster.Enabled() {
		return nil
	}
	if !s.cluster.IsLocal(queueName) {
		return errNotOwner
	}
	if s.cfg.OwnerGrace > 0 {
		last := time.Unix(0, s.membershipChangedAt.Load())
		if !last.IsZero() && time.Since(last) < s.cfg.OwnerGrace {
			return errOwnerGrace
		}
	}
	if s.leasesEnabled() {
		if err := s.leaseCoord.ensureLease(context.Background(), queueName); err != nil {
			return errLease
		}
		if !s.hasValidLease(queueName) {
			return errLease
		}
	}
	return nil
}

func (s *Server) validClusterToken(r *http.Request) bool {
	// Empty secret is allowed for local/dev clusters (see docs); set CLARKQ_CLUSTER_SECRET in production.
	if s.cfg.ClusterSecret == "" {
		return true
	}
	return r.Header.Get(clusterTokenHeader) == s.cfg.ClusterSecret
}

// replicateEnqueue pushes msg to non-self replicas.
// sync mode: wait for all; on failure compensate by removing local msg.
// async mode: enqueue to outbox for retry worker (no rollback).
func (s *Server) replicateEnqueue(ctx context.Context, msg queue.Message) error {
	if s.cluster == nil || s.replicationFactor() <= 1 {
		return nil
	}
	targets := s.replicaTargets(msg.Queue)
	if s.cfg.ReplicationAsync() {
		s.queueOutboxEnqueue(msg, targets)
		return nil
	}
	return s.replicateEnqueueSync(ctx, msg, targets, true)
}

func (s *Server) replicateEnqueueSync(ctx context.Context, msg queue.Message, targets []string, rollback bool) error {
	// Local write already succeeded → count as 1 toward quorum.
	successes := 1
	var failed []string
	for _, node := range targets {
		if node == s.cluster.Self {
			continue
		}
		if err := s.postJSON(ctx, node+internalEnqueue, msg); err != nil {
			slog.Error("replicate enqueue failed", "node", node, "queue", msg.Queue, "id", msg.ID, "error", err)
			failed = append(failed, node)
			if !rollback && s.outbox != nil {
				cp := msg
				s.outbox.Add(cluster.OutboxItem{Op: cluster.OutboxEnqueue, Target: node, Queue: msg.Queue, Message: &cp})
			}
			continue
		}
		successes++
	}

	need := s.writeQuorum()
	if successes < need {
		if rollback {
			_, _ = s.manager.RemoveByID(msg.Queue, msg.ID)
			if s.engine != nil {
				_ = s.engine.RecordDequeue(msg.Queue, msg.ID)
			}
			if s.outbox != nil {
				for _, node := range failed {
					cp := msg
					s.outbox.Add(cluster.OutboxItem{Op: cluster.OutboxEnqueue, Target: node, Queue: msg.Queue, Message: &cp})
				}
			}
		}
		return fmt.Errorf("%w: got %d need %d (failed=%v)", errQuorum, successes, need, failed)
	}
	// Quorum met but some replicas failed: heal via outbox.
	if len(failed) > 0 && s.outbox != nil {
		for _, node := range failed {
			cp := msg
			s.outbox.Add(cluster.OutboxItem{Op: cluster.OutboxEnqueue, Target: node, Queue: msg.Queue, Message: &cp})
		}
	}
	return nil
}

func (s *Server) replicateDequeue(ctx context.Context, queueName, messageID string) {
	if s.cluster == nil || s.replicationFactor() <= 1 {
		return
	}
	targets := s.replicaTargets(queueName)
	if s.cfg.ReplicationAsync() && !s.cfg.LinearizableConsume {
		s.queueOutboxDequeue(queueName, messageID, targets)
		return
	}
	// Best-effort path (or used after linearizable already enforced).
	body := map[string]string{"queue": queueName, "id": messageID}
	for _, node := range targets {
		if node == s.cluster.Self {
			continue
		}
		if err := s.postJSON(ctx, node+internalDequeue, body); err != nil {
			slog.Error("replicate dequeue failed", "node", node, "queue", queueName, "id", messageID, "error", err)
			s.queueOutboxDequeue(queueName, messageID, []string{node})
		}
	}
}

// confirmReadQuorum counts how many replica-set members (incl. self) currently hold messageID.
func (s *Server) confirmReadQuorum(ctx context.Context, queueName, messageID string) (int, error) {
	need := s.readQuorum()
	if s.cluster == nil || s.configuredRF() <= 1 {
		return 1, nil
	}
	count := 0
	if s.manager.HasMessage(queueName, messageID) {
		count = 1
	}
	for _, node := range s.replicaTargets(queueName) {
		if node == s.cluster.Self {
			continue
		}
		if s.cluster.Membership != nil && !s.cluster.Membership.IsAlive(node) {
			continue
		}
		ids, err := s.fetchPeerIDs(ctx, node, queueName)
		if err != nil {
			continue
		}
		for _, id := range ids {
			if id == messageID {
				count++
				break
			}
		}
		if count >= need {
			break
		}
	}
	if count < need {
		return count, fmt.Errorf("%w: read got %d need %d for msg %s", errQuorum, count, need, messageID)
	}
	return count, nil
}

// replicateDequeueQuorum removes messageID on peers and requires write/delete quorum acks.
// Local removal is assumed already done (counts as 1).
func (s *Server) replicateDequeueQuorum(ctx context.Context, queueName, messageID string) error {
	if s.cluster == nil || s.configuredRF() <= 1 {
		return nil
	}
	need := s.writeQuorum() // delete quorum mirrors write quorum
	successes := 1
	body := map[string]string{"queue": queueName, "id": messageID}
	var failed []string
	for _, node := range s.replicaTargets(queueName) {
		if node == s.cluster.Self {
			continue
		}
		if err := s.postJSON(ctx, node+internalDequeue, body); err != nil {
			slog.Error("quorum dequeue replicate failed", "node", node, "queue", queueName, "id", messageID, "error", err)
			failed = append(failed, node)
			continue
		}
		successes++
	}
	if successes < need {
		for _, node := range failed {
			s.queueOutboxDequeue(queueName, messageID, []string{node})
		}
		return fmt.Errorf("%w: delete got %d need %d (failed=%v)", errQuorum, successes, need, failed)
	}
	for _, node := range failed {
		s.queueOutboxDequeue(queueName, messageID, []string{node})
	}
	return nil
}

func (s *Server) replicateClear(ctx context.Context, queueName string) {
	if s.cluster == nil || s.replicationFactor() <= 1 {
		return
	}
	targets := s.replicaTargets(queueName)
	if s.cfg.ReplicationAsync() {
		s.queueOutboxClear(queueName, targets)
		return
	}
	body := map[string]string{"queue": queueName}
	for _, node := range targets {
		if node == s.cluster.Self {
			continue
		}
		if err := s.postJSON(ctx, node+internalClear, body); err != nil {
			slog.Error("replicate clear failed", "node", node, "queue", queueName, "error", err)
			s.queueOutboxClear(queueName, []string{node})
		}
	}
}

func (s *Server) postJSON(ctx context.Context, url string, payload any) error {
	return s.postJSONOpt(ctx, url, payload, false)
}

func (s *Server) postJSONCatchUp(ctx context.Context, url string, payload any) error {
	return s.postJSONOpt(ctx, url, payload, true)
}

func (s *Server) postJSONOpt(ctx context.Context, url string, payload any, catchUp bool) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	s.withClusterAuth(req)
	if catchUp {
		req.Header.Set(cluster.CatchUpHeader, "1")
	}
	resp, err := s.clusterHTTP().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func (s *Server) fetchPeerQueues(ctx context.Context, peer string) ([]queue.QueueInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, peer+internalQueues, nil)
	if err != nil {
		return nil, err
	}
	s.withClusterAuth(req)
	resp, err := s.clusterHTTP().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var out struct {
		Queues []queue.QueueInfo `json:"queues"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Queues, nil
}

// aggregateQueues merges queue lists from all peers, counting only primary-owned queues.
func (s *Server) aggregateQueues(ctx context.Context) []queue.QueueInfo {
	type entry struct {
		info queue.QueueInfo
		node string
	}
	byName := map[string]entry{}

	addFrom := func(node string, list []queue.QueueInfo) {
		for _, q := range list {
			if s.cluster != nil && s.cluster.Enabled() && s.cluster.Owner(q.Name) != node {
				// Skip replica copies so depths are not double-counted.
				continue
			}
			byName[q.Name] = entry{info: q, node: node}
		}
	}

	localNode := ""
	if s.cluster != nil {
		localNode = s.cluster.Self
	}
	addFrom(localNode, s.manager.List())

	if s.cluster != nil && s.cluster.Enabled() {
		peers := s.cluster.AlivePeers()
		if len(peers) == 0 {
			peers = s.cluster.Peers()
		}
		for _, peer := range peers {
			list, err := s.fetchPeerQueues(ctx, peer)
			if err != nil {
				slog.Warn("peer queue list failed", "peer", peer, "error", err)
				continue
			}
			addFrom(peer, list)
		}
	}

	out := make([]queue.QueueInfo, 0, len(byName))
	for _, e := range byName {
		out = append(out, e.info)
	}
	return out
}

// --- internal handlers ---

func (s *Server) withClusterAuthHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.cluster == nil || !s.cluster.Enabled() {
			s.writeError(w, errForbidden)
			return
		}
		if !s.validClusterToken(r) {
			s.writeError(w, errUnauthorized)
			return
		}
		if err := s.checkEpoch(r); err != nil {
			s.writeError(w, err)
			return
		}
		next(w, r)
	}
}

func (s *Server) handleInternalEnqueue(w http.ResponseWriter, r *http.Request) {
	var msg queue.Message
	if err := json.NewDecoder(io.LimitReader(r.Body, int64(s.cfg.MaxMessageBytes)+4096)).Decode(&msg); err != nil {
		s.writeError(w, errInvalidJSON)
		return
	}
	if msg.Queue == "" {
		s.writeError(w, queue.ErrInvalidName)
		return
	}
	spanAttrs(r.Context(), attrOp("replicate_enqueue"), attrQueue(msg.Queue), attrMessageID(msg.ID))
	// Idempotent: duplicate ID from retry is success.
	if s.manager.HasMessage(msg.Queue, msg.ID) {
		writeJSON(w, http.StatusCreated, map[string]string{"status": "ok", "id": msg.ID, "deduped": "true"})
		return
	}
	if err := s.manager.RestoreMessage(msg); err != nil {
		s.writeError(w, err)
		return
	}
	if s.engine != nil {
		_ = s.engine.RecordEnqueue(msg)
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "ok", "id": msg.ID})
}

func (s *Server) handleInternalDequeue(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Queue string `json:"queue"`
		ID    string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, errInvalidJSON)
		return
	}
	spanAttrs(r.Context(), attrOp("replicate_dequeue"), attrQueue(body.Queue), attrMessageID(body.ID))
	ok, err := s.manager.RemoveByID(body.Queue, body.ID)
	if err != nil && !errors.Is(err, queue.ErrQueueNotFound) {
		s.writeError(w, err)
		return
	}
	if ok && s.engine != nil {
		_ = s.engine.RecordDequeue(body.Queue, body.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": ok})
}

func (s *Server) handleInternalClear(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Queue string `json:"queue"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.writeError(w, errInvalidJSON)
		return
	}
	spanAttrs(r.Context(), attrOp("replicate_clear"), attrQueue(body.Queue))
	n, err := s.manager.Clear(body.Queue)
	if err != nil && !errors.Is(err, queue.ErrQueueNotFound) {
		s.writeError(w, err)
		return
	}
	if err == nil && s.engine != nil {
		_ = s.engine.RecordClear(body.Queue)
	}
	if errors.Is(err, queue.ErrQueueNotFound) {
		n = 0
	}
	writeJSON(w, http.StatusOK, map[string]int{"cleared": n})
}

func (s *Server) handleInternalQueues(w http.ResponseWriter, r *http.Request) {
	spanAttrs(r.Context(), attrOp("internal_list"))
	writeJSON(w, http.StatusOK, map[string]any{"queues": s.manager.List()})
}
