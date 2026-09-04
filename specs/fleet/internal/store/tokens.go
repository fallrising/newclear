package store

import (
	"database/sql"
	"strings"
	"time"

	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Store) CreateToken(kind, name, nodeID string) (token.Issued, error) {
	iss, err := token.Generate(kind)
	if err != nil {
		return token.Issued{}, err
	}
	if err := s.insertToken(iss, nodeID, name); err != nil {
		return token.Issued{}, err
	}
	return iss, nil
}

func (s *Store) ListTokens() ([]model.Token, error) {
	rows, err := s.DB.Query(`SELECT id, kind, IFNULL(node_id,''), name, prefix, hash, IFNULL(last_used_at,''), created_at, IFNULL(revoked_at,'') FROM tokens ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Token
	for rows.Next() {
		var t model.Token
		if err := rows.Scan(&t.ID, &t.Kind, &t.NodeID, &t.Name, &t.Prefix, &t.Hash, &t.LastUsedAt, &t.CreatedAt, &t.RevokedAt); err != nil {
			return nil, err
		}
		t.Hash = "" // never list hashes
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) GetToken(id string) (*model.Token, error) {
	t, err := s.scanToken(`SELECT id, kind, IFNULL(node_id,''), name, prefix, hash, IFNULL(last_used_at,''), created_at, IFNULL(revoked_at,'') FROM tokens WHERE id = ?`, id)
	return t, err
}

func (s *Store) RevokeToken(id string) error {
	res, err := s.DB.Exec(`UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, s.now(), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) LookupByHash(hash string) (*model.Token, error) {
	return s.scanToken(`SELECT id, kind, IFNULL(node_id,''), name, prefix, hash, IFNULL(last_used_at,''), created_at, IFNULL(revoked_at,'') FROM tokens WHERE hash = ?`, hash)
}

func (s *Store) Authenticate(plain string) (*model.Token, error) {
	if plain == "" {
		return nil, ErrUnauthorized
	}
	t, err := s.LookupByHash(token.Hash(plain))
	if err != nil {
		if err == ErrNotFound {
			return nil, ErrUnauthorized
		}
		return nil, err
	}
	if t.RevokedAt != "" {
		return nil, ErrUnauthorized
	}
	if t.Kind == token.KindBootstrap {
		created, perr := parseTime(t.CreatedAt)
		if perr != nil || s.nowTime().Sub(created) > token.BootstrapTTL {
			return nil, ErrTokenExpired
		}
	}
	_, _ = s.DB.Exec(`UPDATE tokens SET last_used_at = ? WHERE id = ?`, s.now(), t.ID)
	return t, nil
}

func (s *Store) scanToken(q string, args ...any) (*model.Token, error) {
	var t model.Token
	err := s.DB.QueryRow(q, args...).Scan(&t.ID, &t.Kind, &t.NodeID, &t.Name, &t.Prefix, &t.Hash, &t.LastUsedAt, &t.CreatedAt, &t.RevokedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func parseTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339Nano, s)
}

func (s *Store) HasOperator() (bool, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(1) FROM tokens WHERE kind = 'operator' AND revoked_at IS NULL`).Scan(&n)
	return n > 0, err
}

func nullIfEmpty(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
