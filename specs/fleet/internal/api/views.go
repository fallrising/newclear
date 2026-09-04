package api

import (
	"time"

	"github.com/fallrising/fleet-catalog/internal/model"
)

type catalogView struct {
	Name              string `json:"name"`
	Description       string `json:"description"`
	Node              string `json:"node"`
	Image             string `json:"image"`
	ReleaseID         string `json:"release_id"`
	GitSHA            string `json:"git_sha"`
	DesiredState      string `json:"desired_state"`
	ActualState       string `json:"actual_state"`
	Health            string `json:"health"`
	ExposeMode        string `json:"expose_mode"`
	Hostname          string `json:"hostname"`
	URL               string `json:"url"`
	HostPort          int    `json:"host_port"`
	ContainerPort     int    `json:"container_port"`
	Generation        int64  `json:"generation"`
	AppliedGeneration int64  `json:"applied_generation"`
	IngressStatus     string `json:"ingress_status"`
	IngressError      string `json:"ingress_error"`
	NodeStatus        string `json:"node_status"`
	UpdatedAt         string `json:"updated_at"`
}

func (s *Server) viewOf(svc *model.Service) catalogView {
	v := catalogView{
		Name:          svc.Name,
		Description:   svc.Description,
		Node:          svc.NodeID,
		Image:         svc.Image,
		ReleaseID:     svc.CurrentReleaseID,
		DesiredState:  svc.DesiredState,
		ActualState:   "unknown",
		Health:        "unknown",
		ExposeMode:    svc.ExposeMode,
		Hostname:      svc.Hostname,
		URL:           svc.URL,
		HostPort:      svc.HostPort,
		ContainerPort: svc.ContainerPort,
		Generation:    svc.Generation,
		IngressStatus: svc.IngressStatus,
		IngressError:  svc.IngressError,
		NodeStatus:    "offline",
		UpdatedAt:     svc.UpdatedAt,
	}
	if n, err := s.st.GetNode(svc.NodeID); err == nil {
		v.NodeStatus = n.Status(s.now())
	}
	if inst, err := s.st.GetInstance(svc.Name); err == nil {
		v.ActualState = inst.ActualState
		v.Health = inst.Health
		v.AppliedGeneration = inst.AppliedGeneration
		if inst.ReportedAt != "" {
			if t, e := time.Parse(time.RFC3339, inst.ReportedAt); e == nil && s.now().Sub(t) > 90*time.Second {
				v.Health = "unknown"
			}
		}
		if v.Generation != inst.AppliedGeneration {
			if v.Health == "unknown" || v.Health == "" {
				v.Health = "progressing"
			}
		}
	}
	if v.NodeStatus != "online" && v.Health != "unknown" {
		// keep reported health; UI may show offline-node
	}
	if svc.CurrentReleaseID != "" {
		if rel, err := s.st.GetRelease(svc.CurrentReleaseID); err == nil {
			v.GitSHA = rel.GitSHA
		}
	}
	return v
}

func (s *Server) instanceJSON(name string) (map[string]any, error) {
	svc, err := s.st.GetService(name)
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"service": name, "node": svc.NodeID, "compose_project": model.ComposeProject(name),
		"container_id": "", "image": svc.Image, "desired_state": svc.DesiredState,
		"actual_state": "unknown", "health": "unknown", "health_detail": "",
		"applied_generation": 0, "reported_at": "",
	}
	if inst, err := s.st.GetInstance(name); err == nil {
		out["container_id"] = inst.ContainerID
		out["image"] = inst.Image
		out["actual_state"] = inst.ActualState
		out["health"] = inst.Health
		out["health_detail"] = inst.HealthDetail
		out["applied_generation"] = inst.AppliedGeneration
		out["reported_at"] = inst.ReportedAt
		out["node"] = inst.NodeID
	}
	return out, nil
}


