package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Store) TombstonePending(name string) (bool, error) {
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(1) FROM services WHERE name = ? AND desired_state = 'absent'`, name).Scan(&n); err != nil {
		return false, err
	}
	if n > 0 {
		return true, nil
	}
	if err := s.DB.QueryRow(`SELECT COUNT(1) FROM tombstones WHERE service = ? AND acked_at IS NULL`, name).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *Store) InsertService(svc *model.Service) error {
	pending, err := s.TombstonePending(svc.Name)
	if err != nil {
		return err
	}
	if pending {
		return ErrTombstonePending
	}
	if svc.Hostname == "" {
		return fmt.Errorf("hostname must be materialized")
	}
	now := s.now()
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if svc.HostPort == 0 {
		p, err := allocatePortTx(tx, svc.NodeID)
		if err != nil {
			return err
		}
		svc.HostPort = p
	}
	if svc.Generation == 0 {
		svc.Generation = 1
	}
	if svc.DesiredState == "" {
		svc.DesiredState = "running"
	}
	if svc.HealthPath == "" {
		svc.HealthPath = "/healthz"
	}
	if svc.LabelsJSON == "" {
		svc.LabelsJSON = "{}"
	}
	if svc.URL == "" {
		svc.URL = model.ServiceURL(svc.ExposeMode, svc.Hostname)
	}
	if svc.IngressStatus == "" {
		svc.IngressStatus = "pending"
	}
	svc.CreatedAt = now
	svc.UpdatedAt = now
	_, err = tx.Exec(`INSERT INTO services(
		name, description, labels_json, node_id, fleet_json, image, desired_state, expose_mode, hostname,
		container_port, host_port, health_path, current_release_id, generation, force_recreate, compose_yaml, env_file, url,
		cf_dns_record_id, cf_access_app_id, cf_access_policy_id, cf_hostname_route_id, ingress_status, ingress_error, purge_volumes,
		created_at, updated_at)
	VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		svc.Name, svc.Description, svc.LabelsJSON, svc.NodeID, svc.FleetJSON, svc.Image, svc.DesiredState, svc.ExposeMode, svc.Hostname,
		svc.ContainerPort, svc.HostPort, svc.HealthPath, nullStr(svc.CurrentReleaseID), svc.Generation, boolToInt(svc.ForceRecreate),
		svc.ComposeYAML, svc.EnvFile, svc.URL, svc.CFDNSRecordID, svc.CFAccessAppID, svc.CFAccessPolicyID, svc.CFHostnameRouteID,
		svc.IngressStatus, svc.IngressError, boolToInt(svc.PurgeVolumes), svc.CreatedAt, svc.UpdatedAt)
	if err != nil {
		if isUnique(err) {
			return ErrNameConflict
		}
		return err
	}
	if _, err := tx.Exec(`UPDATE nodes SET desired_generation = desired_generation + 1, updated_at = ? WHERE id = ?`, now, svc.NodeID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetService(name string) (*model.Service, error) {
	row := s.DB.QueryRow(`SELECT name, description, labels_json, node_id, fleet_json, image, desired_state, expose_mode, hostname,
		container_port, host_port, health_path, IFNULL(current_release_id,''), generation, force_recreate, compose_yaml, env_file, url,
		cf_dns_record_id, cf_access_app_id, cf_access_policy_id, cf_hostname_route_id, ingress_status, ingress_error, purge_volumes,
		created_at, updated_at FROM services WHERE name = ?`, name)
	return scanService(row)
}

func (s *Store) ListServices() ([]model.Service, error) {
	rows, err := s.DB.Query(`SELECT name, description, labels_json, node_id, fleet_json, image, desired_state, expose_mode, hostname,
		container_port, host_port, health_path, IFNULL(current_release_id,''), generation, force_recreate, compose_yaml, env_file, url,
		cf_dns_record_id, cf_access_app_id, cf_access_policy_id, cf_hostname_route_id, ingress_status, ingress_error, purge_volumes,
		created_at, updated_at FROM services ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Service
	for rows.Next() {
		svc, err := scanServiceRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *svc)
	}
	return out, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanService(row scanner) (*model.Service, error) {
	var svc model.Service
	var fr, pv int
	err := row.Scan(&svc.Name, &svc.Description, &svc.LabelsJSON, &svc.NodeID, &svc.FleetJSON, &svc.Image, &svc.DesiredState, &svc.ExposeMode, &svc.Hostname,
		&svc.ContainerPort, &svc.HostPort, &svc.HealthPath, &svc.CurrentReleaseID, &svc.Generation, &fr, &svc.ComposeYAML, &svc.EnvFile, &svc.URL,
		&svc.CFDNSRecordID, &svc.CFAccessAppID, &svc.CFAccessPolicyID, &svc.CFHostnameRouteID, &svc.IngressStatus, &svc.IngressError, &pv,
		&svc.CreatedAt, &svc.UpdatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	svc.ForceRecreate = intToBool(fr)
	svc.PurgeVolumes = intToBool(pv)
	return &svc, nil
}

func scanServiceRows(rows *sql.Rows) (*model.Service, error) {
	return scanService(rows)
}

func (s *Store) UpdateCompiled(name, composeYAML, envFile string, forceRecreate bool, bump bool) error {
	now := s.now()
	q := `UPDATE services SET compose_yaml = ?, env_file = ?, force_recreate = ?, updated_at = ?`
	args := []any{composeYAML, envFile, boolToInt(forceRecreate), now}
	if bump {
		q += `, generation = generation + 1`
	}
	q += ` WHERE name = ?`
	args = append(args, name)
	_, err := s.DB.Exec(q, args...)
	return err
}

func (s *Store) SetDesiredState(name, state string, forceRecreate bool, purge *bool) error {
	svc, err := s.GetService(name)
	if err != nil {
		return err
	}
	now := s.now()
	pv := boolToInt(svc.PurgeVolumes)
	if purge != nil {
		pv = boolToInt(*purge)
	}
	_, err = s.DB.Exec(`UPDATE services SET desired_state = ?, force_recreate = ?, purge_volumes = ?, generation = generation + 1, updated_at = ? WHERE name = ?`,
		state, boolToInt(forceRecreate), pv, now, name)
	if err != nil {
		return err
	}
	return s.BumpNodeGeneration(svc.NodeID)
}

func (s *Store) StartService(name string) error {
	return s.SetDesiredState(name, "running", false, nil)
}

func (s *Store) StopService(name string) error {
	return s.SetDesiredState(name, "stopped", false, nil)
}

func (s *Store) RedeployService(name string) error {
	return s.SetDesiredState(name, "running", true, nil)
}

func (s *Store) UninstallService(name string, purgeVolumes bool) error {
	return s.SetDesiredState(name, "absent", false, &purgeVolumes)
}

func (s *Store) MoveService(name, destNode string) error {
	if !s.NodeExists(destNode) {
		return ErrNotFound
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	svc, err := scanService(tx.QueryRow(`SELECT name, description, labels_json, node_id, fleet_json, image, desired_state, expose_mode, hostname,
		container_port, host_port, health_path, IFNULL(current_release_id,''), generation, force_recreate, compose_yaml, env_file, url,
		cf_dns_record_id, cf_access_app_id, cf_access_policy_id, cf_hostname_route_id, ingress_status, ingress_error, purge_volumes,
		created_at, updated_at FROM services WHERE name = ?`, name))
	if err != nil {
		return err
	}
	if svc.NodeID == destNode {
		return tx.Commit()
	}
	oldNode := svc.NodeID
	oldPort := svc.HostPort
	now := s.now()
	ts := model.Tombstone{
		Service:        svc.Name,
		NodeID:         oldNode,
		ComposeProject: model.ComposeProject(svc.Name),
		HostPort:       oldPort,
		ComposeYAML:    svc.ComposeYAML,
		EnvFile:        svc.EnvFile,
		Image:          svc.Image,
		HealthPath:     svc.HealthPath,
		PurgeVolumes:   false,
		Generation:     svc.Generation + 1,
	}
	if err := insertTombstoneTx(tx, ts, now); err != nil {
		return err
	}
	newPort, err := allocatePortTx(tx, destNode)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE services SET node_id = ?, host_port = ?, generation = generation + 1, force_recreate = 1, desired_state = 'running', updated_at = ? WHERE name = ?`,
		destNode, newPort, now, name); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE nodes SET desired_generation = desired_generation + 1, updated_at = ? WHERE id IN (?, ?)`, now, oldNode, destNode); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) InsertRelease(r *model.Release) error {
	if r.ID == "" {
		id, err := token.NewReleaseID()
		if err != nil {
			return err
		}
		r.ID = id
	}
	if r.CreatedAt == "" {
		r.CreatedAt = s.now()
	}
	if r.Source == "" {
		r.Source = "operator"
	}
	if _, err := s.DB.Exec(`INSERT INTO releases(id, service, image, git_sha, git_repo, source, created_at) VALUES (?,?,?,?,?,?,?)`,
		r.ID, r.Service, r.Image, r.GitSHA, r.GitRepo, r.Source, r.CreatedAt); err != nil {
		return err
	}
	return s.pruneReleases(r.Service)
}

func (s *Store) pruneReleases(service string) error {
	_, err := s.DB.Exec(`
DELETE FROM releases
 WHERE service = ?
   AND id NOT IN (
     SELECT id FROM (
       SELECT id FROM releases WHERE service = ? ORDER BY created_at DESC LIMIT 20
     )
   )
   AND id NOT IN (SELECT current_release_id FROM services WHERE name = ? AND current_release_id IS NOT NULL)`,
		service, service, service)
	return err
}

func (s *Store) ListReleases(service string) ([]model.Release, error) {
	q := `SELECT id, service, image, git_sha, git_repo, source, created_at FROM releases`
	var args []any
	if service != "" {
		q += ` WHERE service = ?`
		args = append(args, service)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Release
	for rows.Next() {
		var r model.Release
		if err := rows.Scan(&r.ID, &r.Service, &r.Image, &r.GitSHA, &r.GitRepo, &r.Source, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetRelease(id string) (*model.Release, error) {
	var r model.Release
	err := s.DB.QueryRow(`SELECT id, service, image, git_sha, git_repo, source, created_at FROM releases WHERE id = ?`, id).
		Scan(&r.ID, &r.Service, &r.Image, &r.GitSHA, &r.GitRepo, &r.Source, &r.CreatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return &r, err
}

func (s *Store) SetCurrentRelease(name, releaseID, image string, forceRecreate bool) error {
	svc, err := s.GetService(name)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`UPDATE services SET current_release_id = ?, image = ?, desired_state = 'running', force_recreate = ?, generation = generation + 1, updated_at = ? WHERE name = ?`,
		releaseID, image, boolToInt(forceRecreate), s.now(), name)
	if err != nil {
		return err
	}
	return s.BumpNodeGeneration(svc.NodeID)
}

func (s *Store) UpdateServiceSpec(svc *model.Service) error {
	_, err := s.DB.Exec(`UPDATE services SET description = ?, labels_json = ?, fleet_json = ?, image = ?, desired_state = ?, expose_mode = ?, hostname = ?,
		container_port = ?, health_path = ?, compose_yaml = ?, env_file = ?, url = ?, force_recreate = ?, generation = generation + 1, ingress_status = ?, updated_at = ?
		WHERE name = ?`,
		svc.Description, svc.LabelsJSON, svc.FleetJSON, svc.Image, svc.DesiredState, svc.ExposeMode, svc.Hostname,
		svc.ContainerPort, svc.HealthPath, svc.ComposeYAML, svc.EnvFile, svc.URL, boolToInt(svc.ForceRecreate),
		svc.IngressStatus, s.now(), svc.Name)
	if err != nil {
		return err
	}
	return s.BumpNodeGeneration(svc.NodeID)
}

func (s *Store) SetIngress(name, status, errMsg, dnsID, appID, polID, routeID string) error {
	_, e := s.DB.Exec(`UPDATE services SET ingress_status = ?, ingress_error = ?, cf_dns_record_id = ?, cf_access_app_id = ?, cf_access_policy_id = ?, cf_hostname_route_id = ?, updated_at = ? WHERE name = ?`,
		status, errMsg, dnsID, appID, polID, routeID, s.now(), name)
	return e
}

func (s *Store) SetCFState(key, etag, js string) error {
	_, err := s.DB.Exec(`INSERT INTO cf_state(key, etag, json, updated_at) VALUES (?,?,?,?)
		ON CONFLICT(key) DO UPDATE SET etag = excluded.etag, json = excluded.json, updated_at = excluded.updated_at`,
		key, etag, js, s.now())
	return err
}

func (s *Store) GetCFState(key string) (*model.CFState, error) {
	var c model.CFState
	err := s.DB.QueryRow(`SELECT key, etag, json, updated_at FROM cf_state WHERE key = ?`, key).Scan(&c.Key, &c.ETag, &c.JSON, &c.UpdatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return &c, err
}

func (s *Store) SweepTimeouts() (int, error) {
	cutoff := s.nowTime().Add(-config.TombstoneTimeout).Format(time.RFC3339)
	res1, err := s.DB.Exec(`DELETE FROM services WHERE desired_state = 'absent' AND updated_at <= ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n1, _ := res1.RowsAffected()
	res2, err := s.DB.Exec(`DELETE FROM tombstones WHERE acked_at IS NULL AND created_at <= ?`, cutoff)
	if err != nil {
		return 0, err
	}
	n2, _ := res2.RowsAffected()
	return int(n1 + n2), nil
}

func isUnique(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "constraint")
}

func MustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
