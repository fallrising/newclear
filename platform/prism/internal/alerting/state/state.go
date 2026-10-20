package state

import (
	"context"
	"fmt"
	"maps"
	"sync"
	"time"
)

const (
	// Pending is alert_state.state while the alert has not reached for.
	Pending int16 = 1
	// Firing is alert_state.state after for has elapsed.
	Firing int16 = 2

	maxRows = 100_000
)

// Row is one pending or firing alert. Inactive alerts are not stored.
type Row struct {
	Fingerprint int64
	Labels      map[string]string
	State       int16
	ActiveAt    time.Time
	FiredAt     *time.Time
}

// Store loads and replaces the rows of one tenant.
type Store interface {
	Load(ctx context.Context, tenant string) ([]Row, error)
	Save(ctx context.Context, tenant string, rows []Row) error
}

// Mem is an in-memory Store for the state machine. Postgres is DB.
type Mem struct {
	mu   sync.Mutex
	rows map[string][]Row
}

// NewMem returns an empty memory store.
func NewMem() *Mem {
	return &Mem{rows: make(map[string][]Row)}
}

// Load returns a copy of the tenant's rows.
func (m *Mem) Load(_ context.Context, tenant string) ([]Row, error) {
	if m == nil {
		return nil, fmt.Errorf("nil alert state store")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	cloned := make([]Row, len(m.rows[tenant]))
	for i, row := range m.rows[tenant] {
		cloned[i] = cloneRow(row)
	}
	return cloned, nil
}

// Save replaces the tenant's rows. State 0 is rejected.
func (m *Mem) Save(_ context.Context, tenant string, rows []Row) error {
	if m == nil {
		return fmt.Errorf("nil alert state store")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := validate(rows); err != nil {
		return err
	}
	cloned := make([]Row, len(rows))
	for i, row := range rows {
		cloned[i] = cloneRow(row)
	}
	if m.rows == nil {
		m.rows = make(map[string][]Row)
	}
	m.rows[tenant] = cloned
	return nil
}

func validate(rows []Row) error {
	if len(rows) > maxRows {
		return fmt.Errorf("alert_state row count %d exceeds %d", len(rows), maxRows)
	}
	seen := make(map[int64]struct{}, len(rows))
	for _, row := range rows {
		if row.State != Pending && row.State != Firing {
			return fmt.Errorf("alert_state does not store state %d", row.State)
		}
		if len(row.Labels) == 0 {
			return fmt.Errorf("alert_state labels are empty")
		}
		if _, ok := seen[row.Fingerprint]; ok {
			return fmt.Errorf("duplicate alert_state fingerprint %d", row.Fingerprint)
		}
		seen[row.Fingerprint] = struct{}{}
	}
	return nil
}

func cloneRow(row Row) Row {
	row.Labels = maps.Clone(row.Labels)
	if row.FiredAt != nil {
		fired := *row.FiredAt
		row.FiredAt = &fired
	}
	return row
}
