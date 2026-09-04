package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"time"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/fleetfile"
	"github.com/fallrising/fleet-catalog/internal/ingress"
	"github.com/fallrising/fleet-catalog/internal/store"
	"github.com/fallrising/fleet-catalog/internal/token"
	"github.com/fallrising/fleet-catalog/internal/version"
)

type Server struct {
	cfg      config.Fleetd
	st       *Store
	ing      ingress.Reconciler
	log      *slog.Logger
	mux      *http.ServeMux
	html     HTMLPages
	now      func() time.Time
	ingressNA bool
}

type Store = store.Store

type HTMLPages interface {
	Catalog(w http.ResponseWriter, r *http.Request)
	Node(w http.ResponseWriter, r *http.Request, id string)
	Service(w http.ResponseWriter, r *http.Request, name string)
	Login(w http.ResponseWriter, r *http.Request)
	ServiceRow(w http.ResponseWriter, r *http.Request, name string)
}

func New(cfg config.Fleetd, st *store.Store, ing ingress.Reconciler, html HTMLPages) *Server {
	if ing == nil {
		ing = ingress.Noop{}
	}
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{ReplaceAttr: redactAttr})
	s := &Server{
		cfg:       cfg,
		st:        st,
		ing:       ing,
		log:       slog.New(h),
		mux:       http.NewServeMux(),
		html:      html,
		now:       func() time.Time { return time.Now().UTC() },
		ingressNA: isNoop(ing),
	}
	s.routes()
	return s
}

func isNoop(ing ingress.Reconciler) bool {
	_, ok := ing.(ingress.Noop)
	return ok
}

func (s *Server) routes() {
	op := s.require(token.KindOperator)
	opCI := s.require(token.KindOperator, token.KindCI)
	ag := s.require(token.KindAgent)
	bs := s.require(token.KindBootstrap)

	s.mux.HandleFunc("GET /healthz", s.handleHealthz)
	s.mux.HandleFunc("GET /version", s.handleVersion)

	s.mux.HandleFunc("GET /login", s.handleLoginGet)
	s.mux.HandleFunc("POST /login", s.handleLoginPost)

	s.mux.HandleFunc("GET /{$}", s.htmlAuth(s.handleCatalog))
	s.mux.HandleFunc("GET /nodes/{id}", s.htmlAuth(s.handleNodePage))
	s.mux.HandleFunc("GET /services/{name}", s.htmlAuth(s.handleServicePage))
	if ss, ok := s.html.(interface{ Static() http.Handler }); ok && s.html != nil {
		s.mux.Handle("GET /static/", ss.Static())
	}

	s.mux.HandleFunc("POST /api/v1/tokens", op(s.handleCreateToken))
	s.mux.HandleFunc("GET /api/v1/tokens", op(s.handleListTokens))
	s.mux.HandleFunc("DELETE /api/v1/tokens/{id}", op(s.handleRevokeToken))

	s.mux.HandleFunc("POST /api/v1/nodes/register", s.handleRegister)
	s.mux.HandleFunc("POST /api/v1/nodes/{id}/heartbeat", ag(s.handleHeartbeat))
	s.mux.HandleFunc("GET /api/v1/nodes", op(s.handleListNodes))
	s.mux.HandleFunc("GET /api/v1/nodes/{id}", op(s.handleGetNode))
	s.mux.HandleFunc("DELETE /api/v1/nodes/{id}", op(s.handleDeleteNode))
	s.mux.HandleFunc("POST /api/v1/nodes/{id}/force-lease", op(s.handleForceLease))
	s.mux.HandleFunc("POST /api/v1/nodes/{id}/reissue-tunnel-token", op(s.handleReissueTunnel))

	s.mux.HandleFunc("POST /api/v1/services", op(s.handleCreateService))
	s.mux.HandleFunc("GET /api/v1/services", opCI(s.handleListServices))
	s.mux.HandleFunc("GET /api/v1/services/{name}", opCI(s.handleGetService))
	s.mux.HandleFunc("PUT /api/v1/services/{name}", op(s.handlePutService))
	s.mux.HandleFunc("DELETE /api/v1/services/{name}", op(s.handleDeleteService))
	s.mux.HandleFunc("POST /api/v1/services/{name}/start", op(s.handleStart))
	s.mux.HandleFunc("POST /api/v1/services/{name}/stop", op(s.handleStop))
	s.mux.HandleFunc("POST /api/v1/services/{name}/redeploy", op(s.handleRedeploy))
	s.mux.HandleFunc("GET /api/v1/services/{name}/instance", opCI(s.handleInstance))
	s.mux.HandleFunc("POST /api/v1/services/{name}/deploy", opCI(s.handleServiceDeploy))

	s.mux.HandleFunc("POST /api/v1/releases", opCI(s.handleCreateRelease))
	s.mux.HandleFunc("GET /api/v1/releases", opCI(s.handleListReleases))
	s.mux.HandleFunc("POST /api/v1/deploy", opCI(s.handleDeploy))

	s.mux.HandleFunc("GET /api/v1/agent/desired", ag(s.handleDesired))
	s.mux.HandleFunc("POST /api/v1/agent/actual", ag(s.handleActual))

	_ = bs
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id := r.Header.Get("X-Request-Id")
	if id == "" {
		id = newRequestID()
	}
	w.Header().Set("X-Request-Id", id)
	ww := &statusWriter{ResponseWriter: w, status: 200}
	start := time.Now()
	s.mux.ServeHTTP(ww, r)
	s.log.Info("http", "request_id", id, "http_status", ww.status, "method", r.Method, "path", r.URL.Path, "ms", time.Since(start).Milliseconds())
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func newRequestID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

var redactKeys = regexp.MustCompile(`(?i)token|password|secret|authorization|cookie`)

func redactAttr(_ []string, a slog.Attr) slog.Attr {
	if redactKeys.MatchString(a.Key) {
		a.Value = slog.StringValue("[redacted]")
	}
	return a
}

func (s *Server) fleetCfg() fleetfile.Config {
	return fleetfile.Config{
		BaseDomain:         s.cfg.BaseDomain,
		AllowedSuffixes:    s.cfg.AllowedSuffixes,
		UIHostname:         s.cfg.UIHostname,
		APIHostname:        s.cfg.APIHostname,
		ProtectedHostnames: s.cfg.ProtectedHostnames,
		NodeExists:         s.st.NodeExists,
	}
}

func (s *Server) enqueueService(name string) {
	go func() {
		defer func() { _ = recover() }()
		svc, err := s.st.GetService(name)
		if err != nil {
			return
		}
		n, err := s.st.GetNode(svc.NodeID)
		if err != nil {
			return
		}
		view := ingress.ServiceView{
			Name:            svc.Name,
			NodeID:          svc.NodeID,
			TunnelID:        n.TunnelID,
			DesiredState:    svc.DesiredState,
			ExposeMode:      svc.ExposeMode,
			Hostname:        svc.Hostname,
			HostPort:        svc.HostPort,
			ContainerPort:   svc.ContainerPort,
			DNSRecordID:     svc.CFDNSRecordID,
			AccessAppID:     svc.CFAccessAppID,
			AccessPolicyID:  svc.CFAccessPolicyID,
			HostnameRouteID: svc.CFHostnameRouteID,
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := s.ing.ReconcileService(ctx, view); err != nil {
			s.log.Error("cf_error", "service", name, "err", err.Error())
			_ = s.st.SetIngress(name, "error", err.Error(), svc.CFDNSRecordID, svc.CFAccessAppID, svc.CFAccessPolicyID, svc.CFHostnameRouteID)
			return
		}
		st := "ok"
		if s.ingressNA {
			st = "na"
		}
		_ = s.st.SetIngress(name, st, "", svc.CFDNSRecordID, svc.CFAccessAppID, svc.CFAccessPolicyID, svc.CFHostnameRouteID)
	}()
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	body := map[string]any{"status": "ok", "role": "fleetd", "version": version.Version, "time": s.now().Format(time.RFC3339)}
	if err := s.st.DB.Ping(); err != nil {
		body["status"] = "degraded"
		body["error"] = "sqlite"
		writeJSON(w, http.StatusInternalServerError, body)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": version.Version, "commit": version.Commit, "date": version.Date})
}
