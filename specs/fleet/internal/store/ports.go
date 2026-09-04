package store

import (
	"database/sql"
	"fmt"

	"github.com/fallrising/fleet-catalog/internal/model"
)

func (s *Store) AllocatePort(nodeID string) (int, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	p, err := allocatePortTx(tx, nodeID)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return p, nil
}

func allocatePortTx(tx *sql.Tx, nodeID string) (int, error) {
	var minP, maxP int
	err := tx.QueryRow(`SELECT host_port_min, host_port_max FROM nodes WHERE id = ?`, nodeID).Scan(&minP, &maxP)
	if err == sql.ErrNoRows {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	used := map[int]struct{}{}
	rows, err := tx.Query(`
SELECT host_port FROM services WHERE node_id = ?
UNION
SELECT host_port FROM tombstones WHERE node_id = ? AND acked_at IS NULL`, nodeID, nodeID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var p int
		if err := rows.Scan(&p); err != nil {
			return 0, err
		}
		used[p] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for p := minP; p <= maxP; p++ {
		if _, ok := used[p]; !ok {
			return p, nil
		}
	}
	return 0, ErrPortExhausted
}

func (s *Store) PortInUse(nodeID string, port int) (bool, error) {
	var n int
	err := s.DB.QueryRow(`
SELECT COUNT(1) FROM (
  SELECT host_port FROM services WHERE node_id = ? AND host_port = ?
  UNION ALL
  SELECT host_port FROM tombstones WHERE node_id = ? AND host_port = ? AND acked_at IS NULL
)`, nodeID, port, nodeID, port).Scan(&n)
	return n > 0, err
}

func insertTombstoneTx(tx *sql.Tx, t model.Tombstone, now string) error {
	_, err := tx.Exec(`DELETE FROM tombstones WHERE service = ? AND node_id = ? AND acked_at IS NOT NULL`, t.Service, t.NodeID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO tombstones(service, node_id, compose_project, host_port, compose_yaml, env_file, image, health_path, purge_volumes, generation, created_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		t.Service, t.NodeID, t.ComposeProject, t.HostPort, t.ComposeYAML, t.EnvFile, t.Image, t.HealthPath, boolToInt(t.PurgeVolumes), t.Generation, now)
	if err != nil {
		return fmt.Errorf("insert tombstone: %w", err)
	}
	return nil
}
