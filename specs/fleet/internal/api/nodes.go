package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/store"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	tok, err := s.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", nil)
		return
	}
	var req struct {
		ID              string `json:"id"`
		DisplayName     string `json:"display_name"`
		AgentInstanceID string `json:"agent_instance_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if store.ReservedNode(req.ID) {
		writeError(w, http.StatusBadRequest, "name_reserved", "reserved node id", nil)
		return
	}
	existing, err := s.st.GetNode(req.ID)
	if err == nil {
		s.reregister(w, r, tok, existing, req.AgentInstanceID)
		return
	}
	if err != store.ErrNotFound {
		mapStoreErr(w, err)
		return
	}
	if tok.Kind != token.KindBootstrap {
		writeError(w, http.StatusForbidden, "forbidden", "bootstrap token required to register", nil)
		return
	}
	tunID, tunTok, err := s.ing.EnsureNodeTunnel(r.Context(), req.ID)
	if err != nil {
		s.log.Error("cf_error", "msg", err.Error(), "node_id", req.ID)
	}
	if tunID != "" && tunID == s.cfg.BootstrapTunnelID {
		writeError(w, http.StatusBadRequest, "validation_failed", "bootstrap tunnel cannot be a node tunnel", nil)
		return
	}
	n := &model.Node{
		ID:              req.ID,
		DisplayName:     req.DisplayName,
		TunnelID:        tunID,
		AgentInstanceID: req.AgentInstanceID,
		HostPortMin:     config.DefaultHostPortMin,
		HostPortMax:     config.DefaultHostPortMax,
	}
	if err := s.st.CreateNode(n); err != nil {
		mapStoreErr(w, err)
		return
	}
	iss, err := s.st.IssueAgentToken(req.ID, "agent:"+req.ID)
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	s.st.Audit(tok.Prefix, "register", "", req.ID, "{}")
	got, _ := s.st.GetNode(req.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"node":         nodeJSON(got, 0, s.now()),
		"agent_token":  iss.Plain,
		"tunnel_token": tunTok,
	})
}

func (s *Server) reregister(w http.ResponseWriter, r *http.Request, tok *model.Token, n *model.Node, inst string) {
	_ = r
	switch tok.Kind {
	case token.KindAgent:
		if tok.NodeID != n.ID {
			writeError(w, http.StatusForbidden, "node_scope_mismatch", "token is not scoped to this node", nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"node": nodeJSON(n, 0, s.now())})
	case token.KindBootstrap:
		iss, err := s.st.RotateAgentToken(n.ID)
		if err != nil {
			mapStoreErr(w, err)
			return
		}
		if inst != "" {
			_, _ = s.st.Heartbeat(n.ID, inst, "", n.FactsJSON)
		}
		got, _ := s.st.GetNode(n.ID)
		writeJSON(w, http.StatusOK, map[string]any{
			"node":        nodeJSON(got, 0, s.now()),
			"agent_token": iss.Plain,
		})
	default:
		writeError(w, http.StatusForbidden, "forbidden", "token kind not allowed", nil)
	}
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	tok := tokenFrom(r.Context())
	id := r.PathValue("id")
	if tok.NodeID != id {
		writeError(w, http.StatusForbidden, "node_scope_mismatch", "token is not scoped to this node", nil)
		return
	}
	var req struct {
		AgentInstanceID string         `json:"agent_instance_id"`
		AgentVersion    string         `json:"agent_version"`
		Facts           map[string]any `json:"facts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	facts, _ := json.Marshal(req.Facts)
	res, err := s.st.Heartbeat(id, req.AgentInstanceID, req.AgentVersion, string(facts))
	if err == store.ErrAgentLeaseHeld {
		writeError(w, http.StatusConflict, "agent_lease_held", "instance "+res.HeldBy+" holds the lease until "+res.Until.UTC().Format(time.RFC3339), nil)
		return
	}
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "server_time": res.ServerTS, "stale_after_seconds": 60})
}

func (s *Server) handleListNodes(w http.ResponseWriter, _ *http.Request) {
	nodes, err := s.st.ListNodes()
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	out := make([]any, 0, len(nodes))
	for i := range nodes {
		c, _ := s.st.ServiceCount(nodes[i].ID)
		out = append(out, nodeJSON(&nodes[i], c, s.now()))
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": out})
}

func (s *Server) handleGetNode(w http.ResponseWriter, r *http.Request) {
	n, err := s.st.GetNode(r.PathValue("id"))
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	c, _ := s.st.ServiceCount(n.ID)
	writeJSON(w, http.StatusOK, nodeJSON(n, c, s.now()))
}

func (s *Server) handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	if err := s.st.DeleteNode(r.PathValue("id")); err != nil {
		mapStoreErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleForceLease(w http.ResponseWriter, r *http.Request) {
	if err := s.st.ForceLease(r.PathValue("id")); err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleReissueTunnel(w http.ResponseWriter, r *http.Request) {
	n, err := s.st.GetNode(r.PathValue("id"))
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	tok, err := s.ing.ReissueTunnelToken(r.Context(), n.TunnelID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "cf_error", err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"tunnel_token": tok})
}

func nodeJSON(n *model.Node, services int, now time.Time) map[string]any {
	var facts any = map[string]any{}
	_ = json.Unmarshal([]byte(n.FactsJSON), &facts)
	return map[string]any{
		"id":            n.ID,
		"display_name":  n.DisplayName,
		"status":        n.Status(now),
		"last_seen_at":  n.LastSeenAt,
		"facts":         facts,
		"service_count": services,
		"tunnel_id":     n.TunnelID,
		"host_port_min": n.HostPortMin,
		"host_port_max": n.HostPortMax,
		"created_at":    n.CreatedAt,
	}
}
