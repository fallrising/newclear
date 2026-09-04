package api

import (
	"encoding/json"
	"net/http"

	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Server) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	switch req.Kind {
	case token.KindOperator, token.KindCI, token.KindBootstrap:
	default:
		writeError(w, http.StatusBadRequest, "validation_failed", "kind must be operator, ci, or bootstrap", nil)
		return
	}
	iss, err := s.st.CreateToken(req.Kind, req.Name, "")
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	tok, _ := s.st.GetToken(iss.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         iss.ID,
		"kind":       iss.Kind,
		"name":       req.Name,
		"prefix":     iss.Prefix,
		"token":      iss.Plain,
		"created_at": tok.CreatedAt,
	})
}

func (s *Server) handleListTokens(w http.ResponseWriter, _ *http.Request) {
	list, err := s.st.ListTokens()
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, t := range list {
		out = append(out, map[string]any{
			"id": t.ID, "kind": t.Kind, "name": t.Name, "prefix": t.Prefix,
			"node_id": t.NodeID, "created_at": t.CreatedAt, "revoked_at": t.RevokedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": out})
}

func (s *Server) handleRevokeToken(w http.ResponseWriter, r *http.Request) {
	if err := s.st.RevokeToken(r.PathValue("id")); err != nil {
		mapStoreErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
