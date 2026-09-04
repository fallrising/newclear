package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/systems/clarkq/internal/auth"
	"github.com/fallrising/newclear/systems/clarkq/internal/cluster"
	"github.com/fallrising/newclear/systems/clarkq/internal/config"
	"github.com/fallrising/newclear/systems/clarkq/internal/crypto"
	"github.com/fallrising/newclear/systems/clarkq/internal/persist"
	"github.com/fallrising/newclear/systems/clarkq/internal/queue"
	"github.com/fallrising/newclear/systems/clarkq/internal/ui"
	"github.com/fallrising/newclear/systems/clarkq/internal/version"
)

type Server struct {
	cfg      config.Config
	manager  *queue.Manager
	registry *crypto.Registry
	engine   *persist.Engine
	jwt      *auth.Validator
	cluster  *cluster.Ring
	outbox   *cluster.Outbox
	leaseCoord *leaseCoordinator
	leaseStore *cluster.LeaseStore
	tenants    *tenantTracker
	mux      *http.ServeMux
	started  time.Time
	bgStop   chan struct{}

	// membershipChangedAt is unix nanos of last peer alive/dead transition (owner grace).
	membershipChangedAt atomic.Int64

	enqueued atomic.Int64
	dequeued atomic.Int64
	peeked   atomic.Int64
	cleared  atomic.Int64
	errors   atomic.Int64

	// Cluster-oriented counters (also rolled into errors_total via writeError).
	replicationErrors atomic.Int64
	quorumErrors      atomic.Int64
	leaseErrors       atomic.Int64
	staleEpochErrors  atomic.Int64
	notOwnerErrors    atomic.Int64
	ownerGraceErrors  atomic.Int64
}

const maxLongPollSeconds = 30

func New(cfg config.Config) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	registry, err := crypto.NewRegistry(cfg.EncryptionMode, cfg.EncryptionQueues, cfg.RSAPublicKey, cfg.RSAKeyDir)
	if err != nil {
		return nil, err
	}

	manager := queue.NewManager(cfg.MaxQueues, cfg.MaxDepth, cfg.MaxMessageBytes)

	var engine *persist.Engine
	engCfg := persist.EngineConfig{
		SnapshotPath:     cfg.SnapshotPath,
		SnapshotInterval: cfg.SnapshotInterval,
		WALPath:          cfg.WALPath,
	}
	if persist.EngineEnabled(engCfg) {
		engine = persist.NewEngine(manager, engCfg)
		if err := engine.Load(); err != nil {
			return nil, err
		}
	}

	jwtValidator, err := auth.NewValidator(auth.JWTConfig{
		Issuer:          cfg.OIDCIssuer,
		Audience:        cfg.OIDCAudience,
		JWKSURL:         cfg.OIDCJWKSURL,
		HSSecret:        cfg.JWTHSSecret,
		RSAPublicKeyPEM: cfg.JWTRSAPublicKey,
	})
	if err != nil {
		return nil, err
	}

	var ring *cluster.Ring
	var outbox *cluster.Outbox
	if cfg.ClusterAdvertiseURL != "" || len(cfg.ClusterNodes) > 0 {
		ring = cluster.New(cfg.ClusterAdvertiseURL, cfg.ClusterNodes)
		if ring != nil && ring.Enabled() {
			interval := cfg.ClusterProbeInterval
			if interval <= 0 {
				interval = 2 * time.Second
			}
			ring.Membership = cluster.NewMembership(ring.Self, ring.Nodes, cluster.MembershipConfig{
				Interval:      interval,
				Timeout:       interval / 2,
				FailThreshold: cfg.ClusterFailThreshold,
			})
			outboxPath := cfg.OutboxPath
			if outboxPath == "" && cfg.SnapshotPath != "" {
				// Default beside snapshot when durability is already configured.
				outboxPath = cfg.SnapshotPath + ".outbox.json"
			}
			outbox = cluster.NewOutbox(cfg.OutboxMaxAttempts, cfg.OutboxBackoff, outboxPath)
			if err := outbox.Load(); err != nil {
				return nil, err
			}
		}
	}

	var leaseStore *cluster.LeaseStore
	if cfg.LeaseEnabled {
		leaseStore = cluster.NewLeaseStore(cfg.LeaseTTL)
	}
	var tenants *tenantTracker
	if cfg.TenantQuotas {
		tenants = newTenantTracker(cfg.TenantMaxQueues, cfg.TenantMaxMessages, cfg.TenantMaxEnqueuePerSec, cfg.TenantHeader, cfg.TenantClaim)
	}

	s := &Server{
		cfg:        cfg,
		manager:    manager,
		registry:   registry,
		engine:     engine,
		jwt:        jwtValidator,
		cluster:    ring,
		outbox:     outbox,
		leaseStore: leaseStore,
		tenants:    tenants,
		mux:        http.NewServeMux(),
		started:    time.Now().UTC(),
		bgStop:     make(chan struct{}),
	}
	if cfg.LeaseEnabled && ring != nil && ring.Enabled() {
		s.leaseCoord = newLeaseCoordinator(s)
	}
	if ring != nil && ring.Membership != nil {
		ring.Membership.SetOnChange(func(gen uint64) {
			s.membershipChangedAt.Store(time.Now().UnixNano())
			slog.Info("membership change noted for owner grace", "generation", gen)
		})
		// Start grace clock from process start when cluster enabled.
		s.membershipChangedAt.Store(time.Now().UnixNano())
	}
	s.routes()
	return s, nil
}

// Manager exposes the queue manager (tests / advanced wiring).
func (s *Server) Manager() *queue.Manager {
	return s.manager
}

// StartBackground starts optional background workers (compaction, membership, outbox).
func (s *Server) StartBackground() {
	if s.engine != nil {
		s.engine.Start()
	}
	if s.cluster != nil && s.cluster.Membership != nil {
		s.cluster.Membership.Start()
	}
	s.startOutboxWorker()
	s.startCatchUpWorker()
	s.startLeaseWorker()
}

// Shutdown flushes durable state and stops background workers.
func (s *Server) Shutdown() error {
	select {
	case <-s.bgStop:
	default:
		close(s.bgStop)
	}
	if s.cluster != nil && s.cluster.Membership != nil {
		s.cluster.Membership.Stop()
	}
	if s.outbox != nil {
		if err := s.outbox.Save(); err != nil {
			slog.Error("outbox save failed", "error", err)
		}
	}
	if s.engine == nil {
		return nil
	}
	return s.engine.Stop()
}

func (s *Server) routes() {
	// Admin UI (public page; browser uses API key for /api calls).
	s.mux.Handle("GET /ui", ui.Handler())
	s.mux.Handle("GET /ui/{$}", ui.Handler())
	s.mux.Handle("GET /ui/", ui.Handler())

	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /version", s.handleVersion)
	s.mux.HandleFunc("GET /metrics", s.handlePrometheusMetrics)
	s.mux.HandleFunc("GET /api/v1/metrics", s.withAuth(s.handleJSONMetrics))
	s.mux.HandleFunc("GET /api/v1/queues", s.withAuth(s.handleListQueues))
	s.mux.HandleFunc("GET /api/v1/cluster", s.withAuth(s.handleClusterStatus))
	s.mux.HandleFunc("GET /api/v1/crypto/config", s.withAuth(s.handleCryptoConfig))
	s.mux.HandleFunc("GET /api/v1/crypto/public-key", s.withAuth(s.handleCryptoPublicKey))
	s.mux.HandleFunc("POST /api/v1/queue/{name}", s.withAuth(s.handleEnqueue))
	s.mux.HandleFunc("GET /api/v1/queue/{name}", s.withAuth(s.handleDequeue))
	s.mux.HandleFunc("DELETE /api/v1/queue/{name}", s.withAuth(s.handleClearQueue))

	// Internal cluster APIs (token-gated).
	s.mux.HandleFunc("POST /api/v1/internal/replicate/enqueue", s.withClusterAuthHandler(s.handleInternalEnqueue))
	s.mux.HandleFunc("POST /api/v1/internal/replicate/dequeue", s.withClusterAuthHandler(s.handleInternalDequeue))
	s.mux.HandleFunc("POST /api/v1/internal/replicate/clear", s.withClusterAuthHandler(s.handleInternalClear))
	s.mux.HandleFunc("GET /api/v1/internal/queues", s.withClusterAuthHandler(s.handleInternalQueues))
	s.mux.HandleFunc("GET /api/v1/internal/queue/{name}/messages", s.withClusterAuthHandler(s.handleInternalQueueMessages))
	s.mux.HandleFunc("GET /api/v1/internal/queue/{name}/ids", s.withClusterAuthHandler(s.handleInternalQueueIDs))
	s.mux.HandleFunc("POST /api/v1/internal/lease/vote", s.withClusterAuthHandler(s.handleLeaseVote))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	v := version.Get()
	resp := map[string]any{
		"status":  "ok",
		"version": v.Version,
		"commit":  v.Commit,
	}
	if s.cluster != nil && s.cluster.Enabled() {
		alive := s.cluster.Nodes
		if s.cluster.Membership != nil {
			alive = s.cluster.Membership.AliveNodes()
		}
		resp["cluster"] = map[string]any{
			"self":               s.cluster.Self,
			"nodes":              s.cluster.Nodes,
			"alive":              alive,
			"generation":         s.cluster.Generation(),
			"epoch":              s.cluster.Epoch(),
			"replication_factor": s.replicationFactor(),
			"replication_mode":   s.cfg.ReplicationMode,
			"write_quorum":       s.writeQuorum(),
			"epoch_fencing":      s.cfg.EpochFencing,
			"outbox_depth":       s.outboxDepth(),
			"outbox_path":        s.outboxPath(),
			"catchup_enabled":    s.replicationFactor() >= 2,
		}
		spanAttrs(r.Context(), attrClusterNode(s.cluster.Self), attrOp("health"))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) outboxPath() string {
	if s.outbox == nil {
		return ""
	}
	return s.outbox.Path()
}

func (s *Server) handleClusterStatus(w http.ResponseWriter, r *http.Request) {
	if err := s.requireACL(r, "", auth.ActionList); err != nil {
		s.writeError(w, err)
		return
	}
	spanAttrs(r.Context(), attrOp("cluster_status"))
	if s.cluster == nil || !s.cluster.Enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	var peers []cluster.PeerInfo
	alive := s.cluster.Nodes
	if s.cluster.Membership != nil {
		peers = s.cluster.Membership.Snapshot()
		alive = s.cluster.Membership.AliveNodes()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":            true,
		"self":               s.cluster.Self,
		"configured_nodes":   s.cluster.Nodes,
		"alive_nodes":        alive,
		"generation":         s.cluster.Generation(),
		"epoch":              s.cluster.Epoch(),
		"replication_factor": s.replicationFactor(),
		"configured_rf":      s.configuredRF(),
		"write_quorum":       s.writeQuorum(),
		"replication_mode":   s.cfg.ReplicationMode,
		"epoch_fencing":      s.cfg.EpochFencing,
		"owner_grace":        s.cfg.OwnerGrace.String(),
		"peers":              peers,
		"outbox_depth":       s.outboxDepth(),
		"outbox_path":        s.outboxPath(),
		"outbox":             s.outboxSnapshot(),
		"catchup_enabled":    s.replicationFactor() >= 2,
		"catchup_interval":   s.cfg.CatchUpInterval.String(),
		"leases_enabled":        s.leasesEnabled(),
		"leases_held":           s.leaseSnapshot(),
		"linearizable_consume":  s.cfg.LinearizableConsume,
		"tenant_quotas":         s.cfg.TenantQuotas,
	})
}

func (s *Server) outboxDepth() int {
	if s.outbox == nil {
		return 0
	}
	return s.outbox.Len()
}

func (s *Server) outboxSnapshot() []cluster.OutboxItem {
	if s.outbox == nil {
		return nil
	}
	return s.outbox.Snapshot()
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, version.Get())
}

func (s *Server) handleListQueues(w http.ResponseWriter, r *http.Request) {
	if err := s.requireACL(r, "", auth.ActionList); err != nil {
		s.writeError(w, err)
		return
	}
	spanAttrs(r.Context(), attrOp("list_queues"))
	localOnly := r.URL.Query().Get("local") == "true" || r.URL.Query().Get("local") == "1"
	var queues []queue.QueueInfo
	if localOnly || s.cluster == nil || !s.cluster.Enabled() {
		queues = s.manager.List()
	} else {
		queues = s.aggregateQueues(r.Context())
	}
	writeJSON(w, http.StatusOK, map[string]any{"queues": queues})
}

func (s *Server) handleJSONMetrics(w http.ResponseWriter, r *http.Request) {
	if err := s.requireACL(r, "", auth.ActionList); err != nil {
		s.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.collectMetrics())
}

func (s *Server) handlePrometheusMetrics(w http.ResponseWriter, _ *http.Request) {
	m := s.collectMetrics()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	var b strings.Builder
	writeProm(&b, "clarkq_up", "gauge", "1")
	writeProm(&b, "clarkq_uptime_seconds", "gauge", strconv.FormatFloat(m.UptimeSeconds, 'f', 3, 64))
	writeProm(&b, "clarkq_queues", "gauge", strconv.Itoa(m.Queues))
	writeProm(&b, "clarkq_messages", "gauge", strconv.Itoa(m.Messages))
	writeProm(&b, "clarkq_enqueued_total", "counter", strconv.FormatInt(m.EnqueuedTotal, 10))
	writeProm(&b, "clarkq_dequeued_total", "counter", strconv.FormatInt(m.DequeuedTotal, 10))
	writeProm(&b, "clarkq_peeked_total", "counter", strconv.FormatInt(m.PeekedTotal, 10))
	writeProm(&b, "clarkq_cleared_total", "counter", strconv.FormatInt(m.ClearedTotal, 10))
	writeProm(&b, "clarkq_errors_total", "counter", strconv.FormatInt(m.ErrorsTotal, 10))
	writeProm(&b, "clarkq_replication_errors_total", "counter", strconv.FormatInt(m.ReplicationErrorsTotal, 10))
	writeProm(&b, "clarkq_quorum_errors_total", "counter", strconv.FormatInt(m.QuorumErrorsTotal, 10))
	writeProm(&b, "clarkq_lease_errors_total", "counter", strconv.FormatInt(m.LeaseErrorsTotal, 10))
	writeProm(&b, "clarkq_stale_epoch_errors_total", "counter", strconv.FormatInt(m.StaleEpochErrorsTotal, 10))
	writeProm(&b, "clarkq_not_owner_errors_total", "counter", strconv.FormatInt(m.NotOwnerErrorsTotal, 10))
	writeProm(&b, "clarkq_owner_grace_errors_total", "counter", strconv.FormatInt(m.OwnerGraceErrorsTotal, 10))
	writeProm(&b, "clarkq_outbox_depth", "gauge", strconv.Itoa(m.OutboxDepth))
	writeProm(&b, "clarkq_cluster_enabled", "gauge", boolGauge(m.ClusterEnabled))
	writeProm(&b, "clarkq_cluster_alive_nodes", "gauge", strconv.Itoa(m.ClusterAliveNodes))
	writeProm(&b, "clarkq_cluster_configured_nodes", "gauge", strconv.Itoa(m.ClusterConfiguredNodes))
	writeProm(&b, "clarkq_cluster_generation", "gauge", strconv.FormatUint(m.ClusterGeneration, 10))
	writeProm(&b, "clarkq_leases_held", "gauge", strconv.Itoa(m.LeasesHeld))
	if m.SnapshotEnabled {
		writeProm(&b, "clarkq_snapshot_enabled", "gauge", "1")
	} else {
		writeProm(&b, "clarkq_snapshot_enabled", "gauge", "0")
	}
	if m.WALEnabled {
		writeProm(&b, "clarkq_wal_enabled", "gauge", "1")
	} else {
		writeProm(&b, "clarkq_wal_enabled", "gauge", "0")
	}
	for name, depth := range m.QueueDepths {
		// Queue names are restricted to [a-zA-Z0-9_-]; Quote is still applied for safety.
		fmt.Fprintf(&b, "clarkq_queue_depth{queue=%q} %d\n", name, depth)
	}
	_, _ = io.WriteString(w, b.String())
}

func boolGauge(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

func writeProm(b *strings.Builder, name, typ, value string) {
	b.WriteString("# TYPE ")
	b.WriteString(name)
	b.WriteByte(' ')
	b.WriteString(typ)
	b.WriteByte('\n')
	b.WriteString(name)
	b.WriteByte(' ')
	b.WriteString(value)
	b.WriteByte('\n')
}

type Metrics struct {
	UptimeSeconds   float64        `json:"uptime_seconds"`
	Queues          int            `json:"queues"`
	Messages        int            `json:"messages"`
	EnqueuedTotal   int64          `json:"enqueued_total"`
	DequeuedTotal   int64          `json:"dequeued_total"`
	PeekedTotal     int64          `json:"peeked_total"`
	ClearedTotal    int64          `json:"cleared_total"`
	ErrorsTotal     int64          `json:"errors_total"`
	QueueDepths     map[string]int `json:"queue_depths"`
	SnapshotEnabled bool           `json:"snapshot_enabled"`
	WALEnabled      bool           `json:"wal_enabled"`

	// Cluster / ops
	ReplicationErrorsTotal int64  `json:"replication_errors_total"`
	QuorumErrorsTotal      int64  `json:"quorum_errors_total"`
	LeaseErrorsTotal       int64  `json:"lease_errors_total"`
	StaleEpochErrorsTotal  int64  `json:"stale_epoch_errors_total"`
	NotOwnerErrorsTotal    int64  `json:"not_owner_errors_total"`
	OwnerGraceErrorsTotal  int64  `json:"owner_grace_errors_total"`
	OutboxDepth            int    `json:"outbox_depth"`
	ClusterEnabled         bool   `json:"cluster_enabled"`
	ClusterAliveNodes      int    `json:"cluster_alive_nodes"`
	ClusterConfiguredNodes int    `json:"cluster_configured_nodes"`
	ClusterGeneration      uint64 `json:"cluster_generation"`
	LeasesHeld             int    `json:"leases_held"`
}

func (s *Server) collectMetrics() Metrics {
	stats := s.manager.Stats()
	depths := stats.QueueDepths
	if depths == nil {
		depths = map[string]int{}
	}
	m := Metrics{
		UptimeSeconds:          time.Since(s.started).Seconds(),
		Queues:                 stats.Queues,
		Messages:               stats.Messages,
		EnqueuedTotal:          s.enqueued.Load(),
		DequeuedTotal:          s.dequeued.Load(),
		PeekedTotal:            s.peeked.Load(),
		ClearedTotal:           s.cleared.Load(),
		ErrorsTotal:            s.errors.Load(),
		QueueDepths:            depths,
		SnapshotEnabled:        s.engine != nil && s.engine.SnapshotEnabled(),
		WALEnabled:             s.engine != nil && s.engine.WALEnabled(),
		ReplicationErrorsTotal: s.replicationErrors.Load(),
		QuorumErrorsTotal:      s.quorumErrors.Load(),
		LeaseErrorsTotal:       s.leaseErrors.Load(),
		StaleEpochErrorsTotal:  s.staleEpochErrors.Load(),
		NotOwnerErrorsTotal:    s.notOwnerErrors.Load(),
		OwnerGraceErrorsTotal:  s.ownerGraceErrors.Load(),
		OutboxDepth:            s.outboxDepth(),
	}
	if s.cluster != nil && s.cluster.Enabled() {
		m.ClusterEnabled = true
		m.ClusterConfiguredNodes = len(s.cluster.Nodes)
		m.ClusterGeneration = s.cluster.Generation()
		alive := s.cluster.Nodes
		if s.cluster.Membership != nil {
			alive = s.cluster.Membership.AliveNodes()
		}
		m.ClusterAliveNodes = len(alive)
	}
	if held := s.leaseSnapshot(); held != nil {
		m.LeasesHeld = len(held)
	}
	return m
}

func (s *Server) handleCryptoConfig(w http.ResponseWriter, r *http.Request) {
	if err := s.requireACL(r, "", auth.ActionList); err != nil {
		s.writeError(w, err)
		return
	}
	resp := map[string]any{
		"mode":       s.registry.DefaultMode(),
		"algorithms": s.supportedAlgorithms(s.registry.DefaultMode()),
	}
	if queues := s.registry.QueueModes(); len(queues) > 0 {
		resp["queues"] = queues
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleCryptoPublicKey(w http.ResponseWriter, r *http.Request) {
	if err := s.requireACL(r, "", auth.ActionList); err != nil {
		s.writeError(w, err)
		return
	}
	pemData, ok := s.registry.PublicKeyPEM()
	if !ok {
		s.writeError(w, errPublicKeyUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"mode":       "server_rsa",
		"key_id":     "server-pubkey-v1",
		"public_key": pemData,
	})
}

func (s *Server) handleEnqueue(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if s.maybeForward(w, r, name) {
		return
	}
	if err := s.requireACL(r, name, auth.ActionWrite); err != nil {
		s.writeError(w, err)
		return
	}
	if err := s.assertOwnerWrite(name); err != nil {
		s.writeError(w, err)
		return
	}
	if _, err := s.checkTenantEnqueue(r, name); err != nil {
		s.writeError(w, err)
		return
	}
	spanAttrs(r.Context(), attrOp("enqueue"), attrQueue(name))
	if p := principalFrom(r.Context()); p != nil {
		spanAttrs(r.Context(), attrAuth(p.Method))
	}
	input, err := parseEnqueueRequest(r, s.cfg.MaxMessageBytes)
	if err != nil {
		s.writeError(w, err)
		return
	}

	provider := s.registry.ProviderFor(name)
	body, encMeta, err := provider.PrepareForStorage([]byte(input.Body), input.Encryption)
	if err != nil {
		s.writeError(w, err)
		return
	}
	input.Body = body
	input.Encryption = encMeta

	msg, err := s.manager.Enqueue(name, input)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if s.engine != nil {
		if err := s.engine.RecordEnqueue(msg); err != nil {
			slog.Error("wal enqueue failed", "error", err)
			s.writeError(w, err)
			return
		}
	}
	if err := s.replicateEnqueue(r.Context(), msg); err != nil {
		if errors.Is(err, errQuorum) {
			s.writeError(w, errQuorum)
		} else {
			s.writeError(w, errReplication)
		}
		return
	}
	s.enqueued.Add(1)
	spanAttrs(r.Context(), attrMessageID(msg.ID))

	writeJSON(w, http.StatusCreated, queue.EnqueueResult{
		ID:        msg.ID,
		Queue:     msg.Queue,
		CreatedAt: msg.CreatedAt,
	})
}

func (s *Server) handleDequeue(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if s.maybeForward(w, r, name) {
		return
	}
	if err := s.requireACL(r, name, auth.ActionRead); err != nil {
		s.writeError(w, err)
		return
	}
	// Destructive consume must be owner-only under cluster mode.
	peek, timeout, err := parseReadOptions(r)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if !peek {
		if err := s.assertOwnerWrite(name); err != nil {
			s.writeError(w, err)
			return
		}
	}
	if peek {
		spanAttrs(r.Context(), attrOp("peek"), attrQueue(name))
	} else {
		spanAttrs(r.Context(), attrOp("dequeue"), attrQueue(name))
	}

	// Linearizable consume: peek → read-quorum → CAS pop → delete-quorum.
	if !peek && s.cfg.LinearizableConsume && s.cluster != nil && s.cluster.Enabled() && s.configuredRF() > 1 {
		msg, err := s.linearizableConsume(r.Context(), name, timeout)
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
		if errors.Is(err, queue.ErrQueueEmpty) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err != nil {
			if errors.Is(err, errQuorum) {
				s.writeError(w, errQuorum)
			} else {
				s.writeError(w, err)
			}
			return
		}
		spanAttrs(r.Context(), attrMessageID(msg.ID), attrOp("dequeue_linearizable"))
		s.dequeued.Add(1)
		writeJSON(w, http.StatusOK, msg)
		return
	}

	msg, err := s.manager.Read(r.Context(), name, peek, timeout)
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return
	}
	if errors.Is(err, queue.ErrQueueEmpty) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		s.writeError(w, err)
		return
	}
	spanAttrs(r.Context(), attrMessageID(msg.ID))
	if peek {
		// Optional strong peek: require read quorum observation.
		if s.cfg.LinearizableConsume && s.cluster != nil && s.configuredRF() > 1 {
			if _, err := s.confirmReadQuorum(r.Context(), name, msg.ID); err != nil {
				s.writeError(w, errQuorum)
				return
			}
		}
		s.peeked.Add(1)
	} else {
		if s.engine != nil {
			if err := s.engine.RecordDequeue(name, msg.ID); err != nil {
				slog.Error("wal dequeue failed", "error", err)
				s.writeError(w, err)
				return
			}
		}
		s.replicateDequeue(r.Context(), name, msg.ID)
		s.dequeued.Add(1)
	}

	writeJSON(w, http.StatusOK, msg)
}

// linearizableConsume performs a quorum-safe FIFO pop on the owner.
func (s *Server) linearizableConsume(ctx context.Context, name string, timeout time.Duration) (queue.Message, error) {
	// Wait for a head message (supports long-poll via repeated peek).
	deadline := time.Time{}
	if timeout > 0 {
		deadline = time.Now().Add(timeout)
	}
	for {
		head, err := s.manager.PeekFront(name)
		if errors.Is(err, queue.ErrQueueEmpty) || errors.Is(err, queue.ErrQueueNotFound) {
			if timeout <= 0 || (!deadline.IsZero() && time.Now().After(deadline)) {
				return queue.Message{}, queue.ErrQueueEmpty
			}
			// Brief wait for new messages.
			select {
			case <-ctx.Done():
				return queue.Message{}, ctx.Err()
			case <-time.After(50 * time.Millisecond):
				continue
			}
		}
		if err != nil {
			return queue.Message{}, err
		}

		// 1) Read quorum: majority still stores this ID.
		if _, err := s.confirmReadQuorum(ctx, name, head.ID); err != nil {
			// Head may be unreplicated; wait a bit for catch-up/outbox then retry.
			if timeout <= 0 || (!deadline.IsZero() && time.Now().After(deadline)) {
				return queue.Message{}, err
			}
			select {
			case <-ctx.Done():
				return queue.Message{}, ctx.Err()
			case <-time.After(100 * time.Millisecond):
				continue
			}
		}

		// 2) CAS pop so concurrent consumers cannot steal a different head.
		msg, err := s.manager.CompareAndPop(name, head.ID)
		if err != nil {
			// Lost race; retry.
			continue
		}

		// 3) Persist local dequeue then require delete quorum on peers.
		if s.engine != nil {
			if err := s.engine.RecordDequeue(name, msg.ID); err != nil {
				_ = s.manager.PushFront(name, msg)
				return queue.Message{}, err
			}
		}
		if err := s.replicateDequeueQuorum(ctx, name, msg.ID); err != nil {
			// Compensation: put message back at head.
			if pushErr := s.manager.PushFront(name, msg); pushErr != nil {
				slog.Error("failed to restore message after delete quorum failure",
					"queue", name, "id", msg.ID, "error", pushErr)
			}
			return queue.Message{}, err
		}
		return msg, nil
	}
}

func (s *Server) handleClearQueue(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if s.maybeForward(w, r, name) {
		return
	}
	if err := s.requireACL(r, name, auth.ActionAdmin); err != nil {
		s.writeError(w, err)
		return
	}
	if err := s.assertOwnerWrite(name); err != nil {
		s.writeError(w, err)
		return
	}
	spanAttrs(r.Context(), attrOp("clear"), attrQueue(name))
	count, err := s.manager.Clear(name)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if s.engine != nil {
		if err := s.engine.RecordClear(name); err != nil {
			slog.Error("wal clear failed", "error", err)
			s.writeError(w, err)
			return
		}
	}
	s.replicateClear(r.Context(), name)
	s.cleared.Add(int64(count))

	writeJSON(w, http.StatusOK, map[string]int{"cleared": count})
}

func parseReadOptions(r *http.Request) (bool, time.Duration, error) {
	query := r.URL.Query()

	peek := false
	if raw := query.Get("peek"); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return false, 0, errInvalidPeek
		}
		peek = value
	}

	seconds := 0
	if raw := query.Get("timeout"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 || value > maxLongPollSeconds {
			return false, 0, errInvalidTimeout
		}
		seconds = value
	}

	return peek, time.Duration(seconds) * time.Second, nil
}

func (s *Server) supportedAlgorithms(mode string) []string {
	switch mode {
	case "client":
		return []string{"aes-256-gcm"}
	case "server_rsa":
		return []string{crypto.RSAAlgorithm}
	default:
		return []string{}
	}
}

type apiError struct {
	Error struct {
		Code         string `json:"code"`
		Message      string `json:"message"`
		Retryable    bool   `json:"retryable,omitempty"`
		RetryAfterMs int    `json:"retry_after_ms,omitempty"`
	} `json:"error"`
}

func (s *Server) writeError(w http.ResponseWriter, err error) {
	status, code, message := mapError(err)
	if status >= http.StatusBadRequest {
		s.errors.Add(1)
		s.noteClusterError(err)
	}
	if status >= http.StatusInternalServerError {
		slog.Error("request failed", "error", err)
	}

	retryMs := s.retryAfterMs(err)
	if retryMs > 0 {
		// RFC 9110 Retry-After is seconds; round up so clients wait at least one full second when short.
		sec := (retryMs + 999) / 1000
		if sec < 1 {
			sec = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(sec))
	}

	body := apiError{}
	body.Error.Code = code
	body.Error.Message = message
	if retryMs > 0 {
		body.Error.Retryable = true
		body.Error.RetryAfterMs = retryMs
	}
	writeJSON(w, status, body)
}

// noteClusterError increments typed counters for cluster/ops dashboards.
func (s *Server) noteClusterError(err error) {
	switch {
	case errors.Is(err, errReplication):
		s.replicationErrors.Add(1)
	case errors.Is(err, errQuorum):
		s.quorumErrors.Add(1)
	case errors.Is(err, errLease):
		s.leaseErrors.Add(1)
	case errors.Is(err, errStaleEpoch):
		s.staleEpochErrors.Add(1)
	case errors.Is(err, errNotOwner):
		s.notOwnerErrors.Add(1)
	case errors.Is(err, errOwnerGrace):
		s.ownerGraceErrors.Add(1)
	}
}

// retryAfterMs returns a client backoff hint for transient cluster/auth-of-ownership errors.
// Zero means the error is not treated as automatically retryable.
func (s *Server) retryAfterMs(err error) int {
	switch {
	case errors.Is(err, errStaleEpoch):
		// Membership epoch mismatch during churn — short backoff, then retry any healthy node.
		return 250
	case errors.Is(err, errOwnerGrace):
		if s.cfg.OwnerGrace > 0 {
			ms := int(s.cfg.OwnerGrace.Milliseconds())
			if ms < 100 {
				return 100
			}
			return ms
		}
		return 500
	case errors.Is(err, errNotOwner):
		// Can surface after a one-hop forward when membership flips mid-request.
		return 200
	case errors.Is(err, errLease):
		return 300
	case errors.Is(err, errQuorum), errors.Is(err, errReplication):
		return 500
	case errors.Is(err, errTenantRate):
		return 1000
	default:
		return 0
	}
}

func mapError(err error) (status int, code, message string) {
	switch {
	case errors.Is(err, queue.ErrInvalidName):
		return http.StatusBadRequest, "INVALID_QUEUE_NAME", err.Error()
	case errors.Is(err, queue.ErrEmptyBody):
		return http.StatusBadRequest, "EMPTY_BODY", err.Error()
	case errors.Is(err, queue.ErrMessageTooLarge):
		return http.StatusRequestEntityTooLarge, "MESSAGE_TOO_LARGE", err.Error()
	case errors.Is(err, queue.ErrQueueFull):
		return http.StatusInsufficientStorage, "QUEUE_FULL", err.Error()
	case errors.Is(err, queue.ErrQueueLimit):
		return http.StatusInsufficientStorage, "QUEUE_LIMIT_REACHED", err.Error()
	case errors.Is(err, queue.ErrQueueNotFound):
		return http.StatusNotFound, "QUEUE_NOT_FOUND", err.Error()
	case errors.Is(err, queue.ErrQueueEmpty):
		return http.StatusNoContent, "QUEUE_EMPTY", err.Error()
	case errors.Is(err, errInvalidContentType):
		return http.StatusBadRequest, "INVALID_CONTENT_TYPE", err.Error()
	case errors.Is(err, errInvalidJSON):
		return http.StatusBadRequest, "INVALID_JSON", err.Error()
	case errors.Is(err, errInvalidTimeout):
		return http.StatusBadRequest, "INVALID_TIMEOUT", err.Error()
	case errors.Is(err, errInvalidPeek):
		return http.StatusBadRequest, "INVALID_PEEK", err.Error()
	case errors.Is(err, errUnauthorized):
		return http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid credentials"
	case errors.Is(err, errForbidden):
		return http.StatusForbidden, "FORBIDDEN", "insufficient permissions for this queue action"
	case errors.Is(err, errReplication):
		return http.StatusServiceUnavailable, "REPLICATION_FAILED", "failed to replicate message to peer nodes; retry"
	case errors.Is(err, errQuorum):
		return http.StatusServiceUnavailable, "QUORUM_FAILED", "write quorum not satisfied; retry"
	case errors.Is(err, errStaleEpoch):
		return http.StatusConflict, "STALE_EPOCH", "cluster membership view is stale; retry against any healthy node"
	case errors.Is(err, errOwnerGrace):
		return http.StatusServiceUnavailable, "OWNER_GRACE", "membership just changed; wait briefly then retry"
	case errors.Is(err, errNotOwner):
		return http.StatusConflict, "NOT_OWNER", "this node is not the queue owner under current membership; retry (proxy will re-route after membership converges)"
	case errors.Is(err, errLease):
		return http.StatusServiceUnavailable, "LEASE_FAILED", "could not acquire queue ownership lease; retry shortly"
	case errors.Is(err, errTenantQuota):
		return http.StatusTooManyRequests, "TENANT_QUOTA", "tenant queue or message quota exceeded"
	case errors.Is(err, errTenantRate):
		return http.StatusTooManyRequests, "TENANT_RATE", "tenant enqueue rate exceeded; retry after backoff"
	case errors.Is(err, errTenantForbidden):
		return http.StatusForbidden, "TENANT_FORBIDDEN", "queue is owned by another tenant"
	case errors.Is(err, crypto.ErrInvalidEncryption):
		return http.StatusBadRequest, "INVALID_ENCRYPTION", err.Error()
	case errors.Is(err, errPublicKeyUnavailable):
		return http.StatusNotFound, "PUBLIC_KEY_UNAVAILABLE", err.Error()
	default:
		return http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error"
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type enqueueJSON struct {
	Body       string                 `json:"body"`
	Metadata   map[string]string      `json:"metadata"`
	Encryption *crypto.EncryptionMeta `json:"encryption"`
}

var (
	errInvalidContentType   = errors.New("unsupported content type")
	errInvalidJSON          = errors.New("invalid json body")
	errPublicKeyUnavailable = errors.New("public key unavailable for current encryption mode")
	errInvalidTimeout       = errors.New("timeout must be an integer from 0 to 30 seconds")
	errInvalidPeek          = errors.New("peek must be true or false")
)

func parseEnqueueRequest(r *http.Request, maxBytes int) (queue.EnqueueInput, error) {
	defer r.Body.Close()

	limited := io.LimitReader(r.Body, int64(maxBytes)+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return queue.EnqueueInput{}, err
	}
	if len(body) > maxBytes {
		return queue.EnqueueInput{}, queue.ErrMessageTooLarge
	}

	contentType := r.Header.Get("Content-Type")
	if contentType == "" || strings.HasPrefix(contentType, "text/plain") {
		if len(body) == 0 {
			return queue.EnqueueInput{}, queue.ErrEmptyBody
		}
		return queue.EnqueueInput{Body: string(body)}, nil
	}
	if !strings.HasPrefix(contentType, "application/json") {
		return queue.EnqueueInput{}, errInvalidContentType
	}

	var payload enqueueJSON
	if err := json.Unmarshal(body, &payload); err != nil {
		return queue.EnqueueInput{}, errInvalidJSON
	}
	if payload.Body == "" {
		return queue.EnqueueInput{}, queue.ErrEmptyBody
	}
	return queue.EnqueueInput{
		Body:       payload.Body,
		Metadata:   payload.Metadata,
		Encryption: payload.Encryption,
	}, nil
}
