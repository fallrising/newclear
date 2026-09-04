package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/fallrising/fleet-catalog/internal/compose"
	"github.com/fallrising/fleet-catalog/internal/fleetfile"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/store"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Server) handleCreateService(w http.ResponseWriter, r *http.Request) {
	doc, err := decodeFleet(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	view, err := s.createFromDoc(doc, "", "", "", "operator")
	if err != nil {
		s.writeCreateErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, view)
}

func (s *Server) createFromDoc(doc *fleetfile.Document, image, gitSHA, gitRepo, source string) (catalogView, error) {
	if image != "" {
		doc.Spec.Image = image
	}
	cfg := s.fleetCfg()
	cfg.RequireImage = doc.Spec.DesiredState == "" || doc.Spec.DesiredState == fleetfile.StateRunning
	if err := fleetfile.Validate(doc, cfg); err != nil {
		return catalogView{}, err
	}
	pending, err := s.st.TombstonePending(doc.Metadata.Name)
	if err != nil {
		return catalogView{}, err
	}
	if pending {
		return catalogView{}, store.ErrTombstonePending
	}
	if _, err := s.st.GetService(doc.Metadata.Name); err == nil {
		return catalogView{}, store.ErrNameConflict
	}
	fleetBytes, _ := json.Marshal(doc)
	labels, _ := json.Marshal(doc.Metadata.Labels)
	if doc.Metadata.Labels == nil {
		labels = []byte("{}")
	}
	ing := "pending"
	if s.ingressNA {
		ing = "na"
	}
	svc := &model.Service{
		Name:          doc.Metadata.Name,
		Description:   doc.Metadata.Description,
		LabelsJSON:    string(labels),
		NodeID:        doc.Spec.Node,
		FleetJSON:     string(fleetBytes),
		Image:         doc.Spec.Image,
		DesiredState:  doc.Spec.DesiredState,
		ExposeMode:    doc.Spec.Expose.Mode,
		Hostname:      doc.Spec.Expose.Hostname,
		ContainerPort: doc.Spec.Expose.Port,
		HealthPath:    doc.Spec.Expose.HealthPath,
		ForceRecreate: true,
		IngressStatus: ing,
	}
	if err := s.st.InsertService(svc); err != nil {
		return catalogView{}, err
	}
	got, err := s.st.GetService(svc.Name)
	if err != nil {
		return catalogView{}, err
	}
	relID := ""
	if got.Image != "" {
		rel := &model.Release{Service: got.Name, Image: got.Image, GitSHA: gitSHA, GitRepo: gitRepo, Source: source}
		if err := s.st.InsertRelease(rel); err != nil {
			return catalogView{}, err
		}
		relID = rel.ID
		if err := s.st.SetCurrentRelease(got.Name, rel.ID, got.Image, true); err != nil {
			return catalogView{}, err
		}
		got, _ = s.st.GetService(got.Name)
	}
	yamlOut, envFile, err := compose.Render(compose.Input{Doc: doc, Image: got.Image, HostPort: got.HostPort, ReleaseID: relID, Generation: got.Generation})
	if err != nil {
		return catalogView{}, err
	}
	if err := s.st.UpdateCompiled(got.Name, yamlOut, envFile, true, false); err != nil {
		return catalogView{}, err
	}
	s.enqueueService(got.Name)
	got, _ = s.st.GetService(got.Name)
	return s.viewOf(got), nil
}

func (s *Server) writeCreateErr(w http.ResponseWriter, err error) {
	if _, ok := err.(*fleetfile.Error); ok {
		writeFleetErr(w, err)
		return
	}
	if strings.Contains(err.Error(), "compose_compile_failed") {
		writeError(w, http.StatusBadGateway, "compose_compile_failed", err.Error(), nil)
		return
	}
	mapStoreErr(w, err)
}

func decodeFleet(r *http.Request) (*fleetfile.Document, error) {
	b, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	return fleetfile.ParseJSON(b)
}

func (s *Server) handleListServices(w http.ResponseWriter, _ *http.Request) {
	list, err := s.st.ListServices()
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	out := make([]catalogView, 0, len(list))
	for i := range list {
		out = append(out, s.viewOf(&list[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": out})
}

func (s *Server) handleGetService(w http.ResponseWriter, r *http.Request) {
	svc, err := s.st.GetService(r.PathValue("name"))
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.viewOf(svc))
}

func (s *Server) handlePutService(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	existing, err := s.st.GetService(name)
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	doc, err := decodeFleet(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if doc.Metadata.Name != name {
		writeError(w, http.StatusBadRequest, "validation_failed", "name mismatch", nil)
		return
	}
	cfg := s.fleetCfg()
	if err := fleetfile.Validate(doc, cfg); err != nil {
		writeFleetErr(w, err)
		return
	}
	if doc.Spec.Node != existing.NodeID {
		if err := s.st.MoveService(name, doc.Spec.Node); err != nil {
			mapStoreErr(w, err)
			return
		}
	}
	existing, _ = s.st.GetService(name)
	fleetBytes, _ := json.Marshal(doc)
	labels, _ := json.Marshal(doc.Metadata.Labels)
	if doc.Metadata.Labels == nil {
		labels = []byte("{}")
	}
	existing.Description = doc.Metadata.Description
	existing.LabelsJSON = string(labels)
	existing.FleetJSON = string(fleetBytes)
	existing.Image = doc.Spec.Image
	existing.DesiredState = doc.Spec.DesiredState
	existing.ExposeMode = doc.Spec.Expose.Mode
	existing.Hostname = doc.Spec.Expose.Hostname
	existing.ContainerPort = doc.Spec.Expose.Port
	existing.HealthPath = doc.Spec.Expose.HealthPath
	existing.URL = model.ServiceURL(existing.ExposeMode, existing.Hostname)
	existing.ForceRecreate = true
	yamlOut, envFile, err := compose.Render(compose.Input{Doc: doc, Image: existing.Image, HostPort: existing.HostPort, ReleaseID: existing.CurrentReleaseID, Generation: existing.Generation + 1})
	if err != nil {
		writeError(w, http.StatusBadGateway, "compose_compile_failed", err.Error(), nil)
		return
	}
	existing.ComposeYAML = yamlOut
	existing.EnvFile = envFile
	if err := s.st.UpdateServiceSpec(existing); err != nil {
		mapStoreErr(w, err)
		return
	}
	s.enqueueService(name)
	got, _ := s.st.GetService(name)
	writeJSON(w, http.StatusOK, s.viewOf(got))
}

func (s *Server) handleDeleteService(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	purge := r.URL.Query().Get("purge_volumes") == "true"
	svc, err := s.st.GetService(name)
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	if svc.DesiredState != "absent" {
		if err := s.st.UninstallService(name, purge); err != nil {
			mapStoreErr(w, err)
			return
		}
	}
	got, _ := s.st.GetService(name)
	s.enqueueService(name)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"name": name, "desired_state": "absent", "purge_volumes": purge, "generation": got.Generation,
	})
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	s.mutateDesired(w, r, s.st.StartService)
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	s.mutateDesired(w, r, s.st.StopService)
}

func (s *Server) handleRedeploy(w http.ResponseWriter, r *http.Request) {
	s.mutateDesired(w, r, s.st.RedeployService)
}

func (s *Server) mutateDesired(w http.ResponseWriter, r *http.Request, fn func(string) error) {
	name := r.PathValue("name")
	if err := fn(name); err != nil {
		mapStoreErr(w, err)
		return
	}
	s.enqueueService(name)
	if s.html != nil && (strings.Contains(r.Header.Get("Accept"), "text/html") || r.Header.Get("HX-Request") == "true") {
		s.html.ServiceRow(w, r, name)
		return
	}
	got, err := s.st.GetService(name)
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.viewOf(got))
}

func (s *Server) handleInstance(w http.ResponseWriter, r *http.Request) {
	out, err := s.instanceJSON(r.PathValue("name"))
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateRelease(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Service string `json:"service"`
		Image   string `json:"image"`
		GitSHA  string `json:"git_sha"`
		GitRepo string `json:"git_repo"`
		Source  string `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if _, err := s.st.GetService(req.Service); err != nil {
		mapStoreErr(w, err)
		return
	}
	if req.Source == "" {
		if t := tokenFrom(r.Context()); t != nil && t.Kind == token.KindCI {
			req.Source = "github-actions"
		} else {
			req.Source = "operator"
		}
	}
	rel := &model.Release{Service: req.Service, Image: req.Image, GitSHA: req.GitSHA, GitRepo: req.GitRepo, Source: req.Source}
	if err := s.st.InsertRelease(rel); err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": rel.ID, "service": rel.Service, "image": rel.Image,
		"git_sha": rel.GitSHA, "git_repo": rel.GitRepo, "created_at": rel.CreatedAt,
	})
}

func (s *Server) handleListReleases(w http.ResponseWriter, r *http.Request) {
	list, err := s.st.ListReleases(r.URL.Query().Get("service"))
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"releases": list})
}

func (s *Server) handleServiceDeploy(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req struct {
		ReleaseID    string `json:"release_id"`
		Image        string `json:"image"`
		GitSHA       string `json:"git_sha"`
		GitRepo      string `json:"git_repo"`
		DesiredState string `json:"desired_state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	svc, err := s.st.GetService(name)
	if err != nil {
		mapStoreErr(w, err)
		return
	}
	var rel *model.Release
	if req.ReleaseID != "" {
		rel, err = s.st.GetRelease(req.ReleaseID)
		if err != nil {
			mapStoreErr(w, err)
			return
		}
	} else {
		if req.Image == "" {
			writeError(w, http.StatusBadRequest, "image_required", "image required", nil)
			return
		}
		rel = &model.Release{Service: name, Image: req.Image, GitSHA: req.GitSHA, GitRepo: req.GitRepo, Source: "github-actions"}
		if err := s.st.InsertRelease(rel); err != nil {
			mapStoreErr(w, err)
			return
		}
	}
	if err := s.st.SetCurrentRelease(name, rel.ID, rel.Image, true); err != nil {
		mapStoreErr(w, err)
		return
	}
	svc, _ = s.st.GetService(name)
	var doc fleetfile.Document
	_ = json.Unmarshal([]byte(svc.FleetJSON), &doc)
	yamlOut, envFile, err := compose.Render(compose.Input{Doc: &doc, Image: rel.Image, HostPort: svc.HostPort, ReleaseID: rel.ID, Generation: svc.Generation})
	if err == nil {
		_ = s.st.UpdateCompiled(name, yamlOut, envFile, true, false)
	}
	s.enqueueService(name)
	got, _ := s.st.GetService(name)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"service": name, "release_id": rel.ID, "generation": got.Generation,
		"desired_state": got.DesiredState, "ingress_status": got.IngressStatus,
	})
}
