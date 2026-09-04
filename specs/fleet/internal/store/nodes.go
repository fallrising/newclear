package store

import (
	"database/sql"
	"time"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Store) CreateNode(n *model.Node) error {
	if ReservedNode(n.ID) {
		return ErrReserved
	}
	now := s.now()
	if n.HostPortMin == 0 {
		n.HostPortMin = config.DefaultHostPortMin
	}
	if n.HostPortMax == 0 {
		n.HostPortMax = config.DefaultHostPortMax
	}
	if n.FactsJSON == "" {
		n.FactsJSON = "{}"
	}
	n.CreatedAt = now
	n.UpdatedAt = now
	_, err := s.DB.Exec(`INSERT INTO nodes(id, display_name, tunnel_id, host_port_min, host_port_max, agent_token_id, agent_instance_id, facts_json, last_seen_at, last_error, desired_generation, created_at, updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		n.ID, n.DisplayName, n.TunnelID, n.HostPortMin, n.HostPortMax, nullStr(n.AgentTokenID), nullStr(n.AgentInstanceID),
		n.FactsJSON, nullStr(n.LastSeenAt), n.LastError, n.DesiredGeneration, n.CreatedAt, n.UpdatedAt)
	return err
}

func (s *Store) GetNode(id string) (*model.Node, error) {
	n := &model.Node{}
	var tokenID, instID, lastSeen sql.NullString
	err := s.DB.QueryRow(`SELECT id, display_name, tunnel_id, host_port_min, host_port_max, agent_token_id, agent_instance_id, facts_json, last_seen_at, last_error, desired_generation, created_at, updated_at FROM nodes WHERE id = ?`, id).
		Scan(&n.ID, &n.DisplayName, &n.TunnelID, &n.HostPortMin, &n.HostPortMax, &tokenID, &instID, &n.FactsJSON, &lastSeen, &n.LastError, &n.DesiredGeneration, &n.CreatedAt, &n.UpdatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	n.AgentTokenID = scanNull(tokenID)
	n.AgentInstanceID = scanNull(instID)
	n.LastSeenAt = scanNull(lastSeen)
	return n, nil
}

func (s *Store) ListNodes() ([]model.Node, error) {
	rows, err := s.DB.Query(`SELECT id, display_name, tunnel_id, host_port_min, host_port_max, IFNULL(agent_token_id,''), IFNULL(agent_instance_id,''), facts_json, IFNULL(last_seen_at,''), last_error, desired_generation, created_at, updated_at FROM nodes ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Node
	for rows.Next() {
		var n model.Node
		if err := rows.Scan(&n.ID, &n.DisplayName, &n.TunnelID, &n.HostPortMin, &n.HostPortMax, &n.AgentTokenID, &n.AgentInstanceID, &n.FactsJSON, &n.LastSeenAt, &n.LastError, &n.DesiredGeneration, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) SetNodeTunnel(id, tunnelID string) error {
	_, err := s.DB.Exec(`UPDATE nodes SET tunnel_id = ?, updated_at = ? WHERE id = ?`, tunnelID, s.now(), id)
	return err
}

func (s *Store) SetNodeAgentToken(id, tokenID string) error {
	_, err := s.DB.Exec(`UPDATE nodes SET agent_token_id = ?, updated_at = ? WHERE id = ?`, tokenID, s.now(), id)
	return err
}

func (s *Store) BumpNodeGeneration(id string) error {
	_, err := s.DB.Exec(`UPDATE nodes SET desired_generation = desired_generation + 1, updated_at = ? WHERE id = ?`, s.now(), id)
	return err
}

func (s *Store) ForceLease(id string) error {
	res, err := s.DB.Exec(`UPDATE nodes SET agent_instance_id = NULL, updated_at = ? WHERE id = ?`, s.now(), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteNode(id string) error {
	var svc, tombs int
	if err := s.DB.QueryRow(`SELECT COUNT(1) FROM services WHERE node_id = ?`, id).Scan(&svc); err != nil {
		return err
	}
	if err := s.DB.QueryRow(`SELECT COUNT(1) FROM tombstones WHERE node_id = ? AND acked_at IS NULL`, id).Scan(&tombs); err != nil {
		return err
	}
	if svc > 0 || tombs > 0 {
		return ErrNodeHasWorkloads
	}
	res, err := s.DB.Exec(`DELETE FROM nodes WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

type HeartbeatResult struct {
	OK       bool
	HeldBy   string
	Until    time.Time
	ServerTS string
}

func (s *Store) Heartbeat(nodeID, instanceID, _ string, factsJSON string) (*HeartbeatResult, error) {
	n, err := s.GetNode(nodeID)
	if err != nil {
		return nil, err
	}
	now := s.nowTime()
	if n.AgentInstanceID != "" && n.AgentInstanceID != instanceID && n.LastSeenAt != "" {
		last, perr := parseTime(n.LastSeenAt)
		if perr == nil && now.Sub(last) < config.StaleAfter {
			return &HeartbeatResult{OK: false, HeldBy: n.AgentInstanceID, Until: last.Add(config.StaleAfter), ServerTS: s.now()}, ErrAgentLeaseHeld
		}
	}
	if factsJSON == "" {
		factsJSON = "{}"
	}
	_, err = s.DB.Exec(`UPDATE nodes SET agent_instance_id = ?, facts_json = ?, last_seen_at = ?, last_error = '', updated_at = ? WHERE id = ?`,
		instanceID, factsJSON, s.now(), s.now(), nodeID)
	if err != nil {
		return nil, err
	}
	return &HeartbeatResult{OK: true, ServerTS: s.now()}, nil
}

func (s *Store) ServiceCount(nodeID string) (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(1) FROM services WHERE node_id = ?`, nodeID).Scan(&n)
	return n, err
}

func (s *Store) IssueAgentToken(nodeID, name string) (token.Issued, error) {
	iss, err := s.CreateToken(token.KindAgent, name, nodeID)
	if err != nil {
		return token.Issued{}, err
	}
	if err := s.SetNodeAgentToken(nodeID, iss.ID); err != nil {
		return token.Issued{}, err
	}
	return iss, nil
}

func (s *Store) RotateAgentToken(nodeID string) (token.Issued, error) {
	n, err := s.GetNode(nodeID)
	if err != nil {
		return token.Issued{}, err
	}
	if n.AgentTokenID != "" {
		_ = s.RevokeToken(n.AgentTokenID)
	}
	iss, err := s.IssueAgentToken(nodeID, "agent:"+nodeID)
	if err != nil {
		return token.Issued{}, err
	}
	return iss, nil
}

func (s *Store) NodeExists(id string) bool {
	var n int
	_ = s.DB.QueryRow(`SELECT COUNT(1) FROM nodes WHERE id = ?`, id).Scan(&n)
	return n > 0
}
