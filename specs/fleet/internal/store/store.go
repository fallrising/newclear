package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/fallrising/fleet-catalog/internal/token"
)

var (
	ErrNotFound          = errors.New("not_found")
	ErrNameConflict      = errors.New("name_conflict")
	ErrTombstonePending  = errors.New("tombstone_pending")
	ErrPortExhausted     = errors.New("port_exhausted")
	ErrAgentLeaseHeld    = errors.New("agent_lease_held")
	ErrNodeHasWorkloads  = errors.New("node_has_workloads")
	ErrReserved          = errors.New("name_reserved")
	ErrUnauthorized      = errors.New("unauthorized")
	ErrForbidden         = errors.New("forbidden")
	ErrTokenExpired      = errors.New("token_expired")
	ErrNodeScope         = errors.New("node_scope_mismatch")
)

type Store struct {
	DB  *sql.DB
	Now func() time.Time
}

func New(db *sql.DB) *Store {
	return &Store{
		DB:  db,
		Now: func() time.Time { return time.Now().UTC() },
	}
}

func (s *Store) now() string {
	return s.Now().UTC().Format(time.RFC3339)
}

func (s *Store) nowTime() time.Time {
	return s.Now().UTC()
}

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func intToBool(v int) bool { return v != 0 }

var reservedNodes = map[string]struct{}{
	"control":       {},
	"fleet-control": {},
}

func ReservedNode(id string) bool {
	_, ok := reservedNodes[id]
	return ok
}

func (s *Store) Audit(actor, action, service, nodeID, detailJSON string) {
	if detailJSON == "" {
		detailJSON = "{}"
	}
	_, _ = s.DB.Exec(`INSERT INTO audit_events(at, actor, action, service, node_id, detail_json) VALUES (?,?,?,?,?,?)`,
		s.now(), actor, action, nullStr(service), nullStr(nodeID), detailJSON)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func scanNull(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

func (s *Store) EnsureBootstrapTokens(operatorPlain, nodePlain string) (operatorInserted bool, err error) {
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(1) FROM tokens WHERE kind = 'operator' AND revoked_at IS NULL`).Scan(&n); err != nil {
		return false, err
	}
	if n == 0 && operatorPlain != "" {
		iss, err := tokenFromPlain(token.KindOperator, operatorPlain, "bootstrap-operator")
		if err != nil {
			return false, err
		}
		if err := s.insertToken(iss, "", "bootstrap-operator"); err != nil {
			return false, err
		}
		operatorInserted = true
	}
	if nodePlain != "" {
		var exists int
		h := token.Hash(nodePlain)
		if err := s.DB.QueryRow(`SELECT COUNT(1) FROM tokens WHERE hash = ?`, h).Scan(&exists); err != nil {
			return operatorInserted, err
		}
		if exists == 0 {
			iss, err := tokenFromPlain(token.KindBootstrap, nodePlain, "bootstrap-node")
			if err != nil {
				return operatorInserted, err
			}
			if err := s.insertToken(iss, "", "bootstrap-node"); err != nil {
				return operatorInserted, err
			}
		}
	}
	return operatorInserted, nil
}

func tokenFromPlain(kind, plain, name string) (token.Issued, error) {
	want, err := token.PrefixFor(kind)
	if err != nil {
		return token.Issued{}, err
	}
	if !strings.HasPrefix(plain, want) {
		return token.Issued{}, fmt.Errorf("bootstrap token must start with %s", want)
	}
	id, err := token.NewID("tok")
	if err != nil {
		return token.Issued{}, err
	}
	rest := strings.TrimPrefix(plain, want)
	pfx := want
	if len(rest) >= 4 {
		pfx = want + rest[:4]
	}
	return token.Issued{ID: id, Kind: kind, Prefix: pfx, Hash: token.Hash(plain), Plain: plain}, nil
}

func (s *Store) insertToken(iss token.Issued, nodeID, name string) error {
	_, err := s.DB.Exec(`INSERT INTO tokens(id, kind, node_id, name, prefix, hash, created_at) VALUES (?,?,?,?,?,?,?)`,
		iss.ID, iss.Kind, nullStr(nodeID), name, iss.Prefix, iss.Hash, s.now())
	return err
}
