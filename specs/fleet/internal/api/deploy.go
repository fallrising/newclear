package api

import (
	"encoding/json"
	"io"
	"net/http"
	"reflect"

	"github.com/fallrising/fleet-catalog/internal/compose"
	"github.com/fallrising/fleet-catalog/internal/fleetfile"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/store"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Server) handleDeploy(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	var req struct {
		Fleet   json.RawMessage `json:"fleet"`
		Image   string          `json:"image"`
		GitSHA  string          `json:"git_sha"`
		GitRepo string          `json:"git_repo"`
	}
	if err := json.Unmarshal(b, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if len(req.Fleet) == 0 {
		writeError(w, http.StatusBadRequest, "validation_failed", "fleet document required", nil)
		return
	}
	doc, err := fleetfile.ParseJSON(req.Fleet)
	if err != nil {
		writeFleetErr(w, err)
		return
	}
	if req.Image != "" {
		doc.Spec.Image = req.Image
	}
	src := "operator"
	if t := tokenFrom(r.Context()); t != nil && t.Kind == token.KindCI {
		src = "github-actions"
	}
	existing, err := s.st.GetService(doc.Metadata.Name)
	if err == store.ErrNotFound {
		view, err := s.createFromDoc(doc, req.Image, req.GitSHA, req.GitRepo, src)
		if err != nil {
			s.writeCreateErr(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"service": view.Name, "release_id": view.ReleaseID, "generation": view.Generation,
			"desired_state": view.DesiredState, "ingress_status": view.IngressStatus,
		})
		return
	}
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	pending, err := s.st.TombstonePending(doc.Metadata.Name)
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	if pending {
		writeError(w, http.StatusConflict, "tombstone_pending", "service is tombstoning", nil)
		return
	}
	cfg := s.fleetCfg()
	cfg.RequireImage = true
	if err := fleetfile.Validate(doc, cfg); err != nil {
		writeFleetErr(w, err)
		return
	}
	unchanged := existing.Image == doc.Spec.Image && existing.DesiredState == "running" && specEqual(existing, doc)
	if unchanged {
		writeJSON(w, http.StatusOK, map[string]any{
			"unchanged": true, "generation": existing.Generation, "service": existing.Name,
			"release_id": existing.CurrentReleaseID, "desired_state": existing.DesiredState,
			"ingress_status": existing.IngressStatus,
		})
		return
	}
	if doc.Spec.Node != existing.NodeID {
		if err := s.st.MoveService(existing.Name, doc.Spec.Node); err != nil {
			mapStoreErr(w, err)
			return
		}
		existing, _ = s.st.GetService(existing.Name)
	}
	rel := &model.Release{Service: existing.Name, Image: doc.Spec.Image, GitSHA: req.GitSHA, GitRepo: req.GitRepo, Source: src}
	if err := s.st.InsertRelease(rel); err != nil {
		mapStoreErr(w, err)
		return
	}
	if err := s.st.SetCurrentRelease(existing.Name, rel.ID, doc.Spec.Image, true); err != nil {
		mapStoreErr(w, err)
		return
	}
	existing, _ = s.st.GetService(existing.Name)
	fleetBytes, _ := json.Marshal(doc)
	labels, _ := json.Marshal(doc.Metadata.Labels)
	if doc.Metadata.Labels == nil {
		labels = []byte("{}")
	}
	existing.Description = doc.Metadata.Description
	existing.LabelsJSON = string(labels)
	existing.FleetJSON = string(fleetBytes)
	existing.ExposeMode = doc.Spec.Expose.Mode
	existing.Hostname = doc.Spec.Expose.Hostname
	existing.ContainerPort = doc.Spec.Expose.Port
	existing.HealthPath = doc.Spec.Expose.HealthPath
	existing.URL = model.ServiceURL(existing.ExposeMode, existing.Hostname)
	existing.ForceRecreate = true
	yamlOut, envFile, err := compose.Render(compose.Input{Doc: doc, Image: doc.Spec.Image, HostPort: existing.HostPort, ReleaseID: rel.ID, Generation: existing.Generation})
	if err != nil {
		writeError(w, http.StatusBadGateway, "compose_compile_failed", err.Error(), nil)
		return
	}
	existing.ComposeYAML = yamlOut
	existing.EnvFile = envFile
	existing.Image = doc.Spec.Image
	if err := s.st.UpdateServiceSpec(existing); err != nil {
		mapStoreErr(w, err)
		return
	}
	s.enqueueService(existing.Name)
	got, _ := s.st.GetService(existing.Name)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"service": got.Name, "release_id": rel.ID, "generation": got.Generation,
		"desired_state": got.DesiredState, "ingress_status": got.IngressStatus,
	})
}

func specEqual(existing *model.Service, doc *fleetfile.Document) bool {
	var old fleetfile.Document
	if err := json.Unmarshal([]byte(existing.FleetJSON), &old); err != nil {
		return false
	}
	old.Spec.Image = doc.Spec.Image
	return reflect.DeepEqual(old.Spec, doc.Spec) && old.Metadata.Name == doc.Metadata.Name
}
