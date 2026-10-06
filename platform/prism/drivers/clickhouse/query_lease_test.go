package clickhouse

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

type leaseTestRows struct {
	chdriver.Rows
	mu                sync.Mutex
	remaining, closes int
	closed            chan struct{}
	closeErr          error
}

func newLeaseTestRows(n int) *leaseTestRows {
	return &leaseTestRows{remaining: n, closed: make(chan struct{})}
}
func (r *leaseTestRows) Next() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.remaining == 0 || r.closes > 0 {
		return false
	}
	r.remaining--
	return true
}
func (*leaseTestRows) Scan(...any) error { return nil }
func (*leaseTestRows) Err() error        { return nil }
func (r *leaseTestRows) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closes++
	if r.closes == 1 {
		close(r.closed)
	}
	return r.closeErr
}

type leaseTestConn struct {
	connection
	rows   *leaseTestRows
	hook   func()
	mu     sync.Mutex
	closes int
}

func (c *leaseTestConn) Query(context.Context, string, ...any) (chdriver.Rows, error) {
	if c.hook != nil {
		c.hook()
	}
	return c.rows, nil
}
func (c *leaseTestConn) Close() error { c.mu.Lock(); defer c.mu.Unlock(); c.closes++; return nil }

func TestReadLeaseAbandonedCancelAndDeadlineRelease(t *testing.T) {
	for _, tc := range []struct {
		name string
		ctx  func() (context.Context, context.CancelFunc)
		want error
	}{
		{"cancel", func() (context.Context, context.CancelFunc) { return context.WithCancel(t.Context()) }, context.Canceled},
		{"deadline", func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(t.Context(), 20*time.Millisecond)
		}, context.DeadlineExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows := newLeaseTestRows(1)
			conn := &leaseTestConn{rows: rows}
			b := newBackend(conn, options{maxOpen: 1, timeout: time.Second})
			defer func() {
				if err := b.Close(); err != nil {
					t.Error(err)
				}
			}()
			ctx, cancel := tc.ctx()
			defer cancel()
			lease, err := b.queryRows(ctx, "test.read", "SELECT 1")
			if err != nil {
				t.Fatal(err)
			}
			if tc.name == "cancel" {
				cancel()
			}
			select {
			case <-rows.closed:
			case <-time.After(time.Second):
				t.Fatal("abandoned lease did not close after context ended")
			}
			if err := lease.Err(); !errors.Is(err, tc.want) || spi.Classify(err) != spi.ErrTimeout {
				t.Fatalf("lease Err=%v", err)
			}
			if _, err := b.queryRows(t.Context(), "test.next", "SELECT 1"); err != nil {
				t.Fatalf("admission not released: %v", err)
			}
		})
	}
}

func TestReadLeaseBackendCloseDrainsAndClassifies(t *testing.T) {
	rows := newLeaseTestRows(0)
	conn := &leaseTestConn{rows: rows}
	b := newBackend(conn, options{maxOpen: 1, timeout: time.Second})
	lease, err := b.queryRows(t.Context(), "test.read", "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- b.Close() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("backend Close did not drain idle iterator")
	}
	if spi.Classify(lease.Err()) != spi.ErrUnavailable {
		t.Fatalf("closed lease error=%v", lease.Err())
	}
	if err := lease.Close(); spi.Classify(err) != spi.ErrUnavailable {
		t.Fatalf("idempotent Close=%v", err)
	}
	conn.mu.Lock()
	closes := conn.closes
	conn.mu.Unlock()
	if closes != 1 {
		t.Fatalf("native connection closes=%d", closes)
	}
}

func TestReadLeaseClientRowsAndCloseErrorAreBoundedRedacted(t *testing.T) {
	rows := newLeaseTestRows(2)
	rows.closeErr = errors.New("secret-native-close")
	conn := &leaseTestConn{rows: rows}
	b := newBackend(conn, options{maxOpen: 1, maxRowsRead: 5, maxResultRows: 1, maxResultBytes: 32, timeout: time.Second})
	defer func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	}()
	lease, err := b.queryRows(t.Context(), "test.read", "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	if !lease.Next(func(chdriver.Rows) (int, error) { return 8, nil }) {
		t.Fatal("first row missing")
	}
	if lease.Next(func(chdriver.Rows) (int, error) { return 8, nil }) {
		t.Fatal("second result row exceeded configured max_result_rows")
	}
	if spi.Classify(lease.Err()) != spi.ErrTooLarge || strings.Contains(lease.Err().Error(), "secret-native-close") {
		t.Fatalf("limit/close error=%v", lease.Err())
	}
	rows.mu.Lock()
	closes := rows.closes
	rows.mu.Unlock()
	if closes != 1 {
		t.Fatalf("rows Close calls=%d", closes)
	}
}

func TestReadLeaseAlreadyCanceledAtRowsRegistration(t *testing.T) {
	for range 100 {
		ctx, cancel := context.WithCancel(t.Context())
		rows := newLeaseTestRows(0)
		conn := &leaseTestConn{rows: rows, hook: cancel}
		b := newBackend(conn, options{maxOpen: 1, timeout: time.Second})
		lease, err := b.queryRows(ctx, "test.read", "SELECT 1")
		if err == nil {
			if closeErr := lease.Close(); !errors.Is(closeErr, context.Canceled) {
				t.Fatalf("cancel identity lost: %v", closeErr)
			}
		} else if !errors.Is(err, context.Canceled) {
			t.Fatalf("query cancellation lost: %v", err)
		}
		if closeErr := b.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
		select {
		case <-rows.closed:
		case <-time.After(time.Second):
			t.Fatal("native rows leaked during registration race")
		}
	}
}
