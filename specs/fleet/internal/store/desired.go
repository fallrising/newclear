package store

import (
	"database/sql"
	"encoding/json"

	"github.com/fallrising/fleet-catalog/internal/model"
)

// DesiredService is one UNION row from GET /desired.
type DesiredService struct {
	Name           string
	DesiredState   string
	Generation     int64
	ForceRecreate  bool
	PurgeVolumes   bool
	ComposeProject string
	HostPort       int
	ComposeYAML    string
	EnvFile        string
	Image          string
	HealthPath     string
	FleetJSON      sql.NullString
}

func (d DesiredService) SecretKeys() []string {
	if !d.FleetJSON.Valid || d.FleetJSON.String == "" {
		return []string{}
	}
	var doc struct {
		Spec struct {
			Secrets []string `json:"secrets"`
		} `json:"spec"`
	}
	if err := json.Unmarshal([]byte(d.FleetJSON.String), &doc); err != nil {
		return []string{}
	}
	if doc.Spec.Secrets == nil {
		return []string{}
	}
	return doc.Spec.Secrets
}

func (d DesiredService) HealthURL() string {
	path := d.HealthPath
	if path == "" {
		path = "/healthz"
	}
	return "http://127.0.0.1:" + itoa(d.HostPort) + path
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

type Desired struct {
	NodeID     string
	Generation int64
	Services   []DesiredService
}

const desiredSQL = `
SELECT name,
       desired_state,
       generation,
       force_recreate,
       purge_volumes,
       'fleet-' || name AS compose_project,
       host_port,
       compose_yaml,
       env_file,
       image,
       health_path,
       fleet_json
  FROM services
 WHERE node_id = ?
UNION ALL
SELECT t.service,
       'absent',
       t.generation,
       0,
       t.purge_volumes,
       t.compose_project,
       t.host_port,
       t.compose_yaml,
       t.env_file,
       t.image,
       t.health_path,
       NULL
  FROM tombstones t
 WHERE t.node_id = ?
   AND t.acked_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM services s
          WHERE s.name = t.service AND s.node_id = t.node_id
       )`

func (s *Store) DesiredForNode(nodeID string) (*Desired, error) {
	n, err := s.GetNode(nodeID)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(desiredSQL, nodeID, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Desired{NodeID: nodeID, Generation: n.DesiredGeneration, Services: []DesiredService{}}
	for rows.Next() {
		var d DesiredService
		var fr, pv int
		if err := rows.Scan(&d.Name, &d.DesiredState, &d.Generation, &fr, &pv, &d.ComposeProject, &d.HostPort, &d.ComposeYAML, &d.EnvFile, &d.Image, &d.HealthPath, &d.FleetJSON); err != nil {
			return nil, err
		}
		d.ForceRecreate = fr != 0
		d.PurgeVolumes = pv != 0
		out.Services = append(out.Services, d)
	}
	return out, rows.Err()
}

func (s *Store) GetInstance(name string) (*model.Instance, error) {
	var inst model.Instance
	var rel, reported sql.NullString
	err := s.DB.QueryRow(`SELECT service, node_id, release_id, compose_project, container_id, image, actual_state, health, health_detail, applied_generation, error, reported_at FROM instances WHERE service = ?`, name).
		Scan(&inst.Service, &inst.NodeID, &rel, &inst.ComposeProject, &inst.ContainerID, &inst.Image, &inst.ActualState, &inst.Health, &inst.HealthDetail, &inst.AppliedGeneration, &inst.Error, &reported)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	inst.ReleaseID = scanNull(rel)
	inst.ReportedAt = scanNull(reported)
	return &inst, nil
}

func (s *Store) ListAudit(limit int) ([]model.AuditEvent, error) {
	if limit <= 0 {
		limit = 50
	}
	return s.listAudit(`SELECT id, at, actor, action, IFNULL(service,''), IFNULL(node_id,''), detail_json FROM audit_events ORDER BY id DESC LIMIT ?`, limit)
}

func (s *Store) ListAuditForService(service string, limit int) ([]model.AuditEvent, error) {
	if limit <= 0 {
		limit = 50
	}
	return s.listAudit(`SELECT id, at, actor, action, IFNULL(service,''), IFNULL(node_id,''), detail_json FROM audit_events WHERE service = ? ORDER BY id DESC LIMIT ?`, service, limit)
}

func (s *Store) listAudit(q string, args ...any) ([]model.AuditEvent, error) {
	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.AuditEvent
	for rows.Next() {
		var a model.AuditEvent
		if err := rows.Scan(&a.ID, &a.At, &a.Actor, &a.Action, &a.Service, &a.NodeID, &a.DetailJSON); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
