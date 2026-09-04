package store

import (
	"database/sql"

	"github.com/fallrising/fleet-catalog/internal/model"
)

type ActualReport struct {
	Name              string
	AppliedGeneration int64
	ActualState       string
	Health            string
	HealthDetail      string
	ContainerID       string
	Image             string
	Error             string
}

func (s *Store) ApplyActual(nodeID string, reports []ActualReport) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := s.now()
	for _, r := range reports {
		if r.ActualState == "absent" {
			if err := ackAbsentTx(tx, nodeID, r, now); err != nil {
				return err
			}
			continue
		}
		if err := upsertInstanceTx(tx, nodeID, r, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func upsertInstanceTx(tx *sql.Tx, nodeID string, r ActualReport, now string) error {
	var releaseID sql.NullString
	_ = tx.QueryRow(`SELECT current_release_id FROM services WHERE name = ?`, r.Name).Scan(&releaseID)
	_, err := tx.Exec(`INSERT INTO instances(service, node_id, release_id, compose_project, container_id, image, actual_state, health, health_detail, applied_generation, error, reported_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(service) DO UPDATE SET
  node_id = excluded.node_id,
  release_id = excluded.release_id,
  compose_project = excluded.compose_project,
  container_id = excluded.container_id,
  image = excluded.image,
  actual_state = excluded.actual_state,
  health = excluded.health,
  health_detail = excluded.health_detail,
  applied_generation = excluded.applied_generation,
  error = excluded.error,
  reported_at = excluded.reported_at`,
		r.Name, nodeID, releaseID, model.ComposeProject(r.Name), r.ContainerID, r.Image, r.ActualState, emptyHealth(r.Health), r.HealthDetail, r.AppliedGeneration, r.Error, now)
	return err
}

func emptyHealth(h string) string {
	if h == "" {
		return "unknown"
	}
	return h
}

func ackAbsentTx(tx *sql.Tx, nodeID string, r ActualReport, now string) error {
	var desired, svcNode string
	var gen int64
	err := tx.QueryRow(`SELECT desired_state, node_id, generation FROM services WHERE name = ?`, r.Name).Scan(&desired, &svcNode, &gen)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil && desired == "absent" && svcNode == nodeID && r.AppliedGeneration >= gen {
		if _, err := tx.Exec(`DELETE FROM services WHERE name = ?`, r.Name); err != nil {
			return err
		}
		return nil
	}
	var tgen int64
	err = tx.QueryRow(`SELECT generation FROM tombstones WHERE service = ? AND node_id = ? AND acked_at IS NULL`, r.Name, nodeID).Scan(&tgen)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if r.AppliedGeneration >= tgen {
		if _, err := tx.Exec(`DELETE FROM tombstones WHERE service = ? AND node_id = ?`, r.Name, nodeID); err != nil {
			return err
		}
	} else {
		_, _ = tx.Exec(`UPDATE tombstones SET acked_at = ? WHERE service = ? AND node_id = ?`, now, r.Name, nodeID)
	}
	return nil
}
