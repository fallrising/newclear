package api

import (
	"encoding/json"
	"net/http"

	"github.com/fallrising/fleet-catalog/internal/agentclient"
	"github.com/fallrising/fleet-catalog/internal/store"
)

func (s *Server) handleDesired(w http.ResponseWriter, r *http.Request) {
	tok := tokenFrom(r.Context())
	nodeID := tok.NodeID
	d, err := s.st.DesiredForNode(nodeID)
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	out := agentclient.Desired{
		NodeID:                nodeID,
		Generation:            d.Generation,
		ReconcileAfterSeconds: 15,
		Services:              make([]agentclient.DesiredService, 0, len(d.Services)),
	}
	if s.cfg.GHCRPullToken != "" {
		out.Registry = &agentclient.Registry{
			URL:      "ghcr.io",
			Username: "x-access-token",
			Password: s.cfg.GHCRPullToken,
		}
	}
	for _, svc := range d.Services {
		keys := svc.SecretKeys()
		if keys == nil {
			keys = []string{}
		}
		out.Services = append(out.Services, agentclient.DesiredService{
			Name:           svc.Name,
			DesiredState:   svc.DesiredState,
			Generation:     svc.Generation,
			ForceRecreate:  svc.ForceRecreate,
			PurgeVolumes:   svc.PurgeVolumes,
			ComposeProject: svc.ComposeProject,
			HostPort:       svc.HostPort,
			ComposeYAML:    svc.ComposeYAML,
			EnvFile:        svc.EnvFile,
			SecretKeys:     keys,
			Image:          svc.Image,
			Health: agentclient.Health{
				URL:       svc.HealthURL(),
				TimeoutMS: 2000,
			},
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleActual(w http.ResponseWriter, r *http.Request) {
	tok := tokenFrom(r.Context())
	var req agentclient.Actual
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if req.NodeID != "" && req.NodeID != tok.NodeID {
		writeError(w, http.StatusForbidden, "node_scope_mismatch", "node_id mismatch", nil)
		return
	}
	reports := make([]store.ActualReport, 0, len(req.Services))
	for _, svc := range req.Services {
		reports = append(reports, store.ActualReport{
			Name:              svc.Name,
			AppliedGeneration: svc.AppliedGeneration,
			ActualState:       svc.ActualState,
			Health:            svc.Health,
			HealthDetail:      svc.HealthDetail,
			ContainerID:       svc.ContainerID,
			Image:             svc.Image,
			Error:             svc.Error,
		})
	}
	if err := s.st.ApplyActual(tok.NodeID, reports); err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
