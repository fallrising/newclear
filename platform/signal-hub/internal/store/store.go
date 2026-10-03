// Package store owns the append-only SQLite event log. Every successful ingest
// returns only after its transaction has committed.
package store

import (
	"bytes"
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	_ "modernc.org/sqlite"
)

var (
	ErrConflict     = errors.New("event content conflicts with existing source and id")
	ErrUnavailable  = errors.New("event database unavailable")
	ErrNotFound     = errors.New("event not found")
	ErrInvalidQuery = errors.New("invalid event query")
)

// BusyTimeout bounds SQLite lock waits. Context cancellation may shorten them.
const BusyTimeout = 1000 * time.Millisecond

//go:embed migrations/001_events.sql
var migration1 string

type Store struct{ db *sql.DB }
type Result struct {
	Seq       int64
	Duplicate bool
}
type StoredEvent struct {
	Seq        int64           `json:"seq"`
	ReceivedAt string          `json:"received_at"`
	ClockSkew  bool            `json:"clock_skew"`
	Event      json.RawMessage `json:"event"`
}
type Page struct {
	Items      []StoredEvent `json:"items"`
	NextCursor *string       `json:"next_cursor"`
}
type Detail struct {
	Item    StoredEvent   `json:"item"`
	Related []StoredEvent `json:"related"`
}

func unavailable(err error) error { return fmt.Errorf("%w: %v", ErrUnavailable, err) }

func Open(path string) (*Store, error) {
	if path == "" || path == ":memory:" || strings.HasPrefix(path, "file:") || strings.Contains(path, "?") {
		return nil, unavailable(errors.New("a persistent database path is required"))
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, unavailable(err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, unavailable(err)
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		if err := file.Close(); err != nil {
			return nil, unavailable(err)
		}
	} else if !errors.Is(err, os.ErrExist) {
		return nil, unavailable(err)
	}
	uri := &url.URL{Scheme: "file", Path: absolute}
	params := url.Values{}
	params.Add("_pragma", "busy_timeout(1000)")
	params.Add("_pragma", "synchronous(FULL)")
	uri.RawQuery = params.Encode()
	dsn := uri.String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, unavailable(err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	s := &Store{db: db}
	if err = s.initialize(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) initialize(ctx context.Context) error {
	// One retained connection ensures that these connection-local pragmas apply
	// to every operation, without a second connection silently weakening durability.
	if _, err := s.db.ExecContext(ctx, "PRAGMA busy_timeout = 1000"); err != nil {
		return unavailable(err)
	}
	var mode string
	if err := s.db.QueryRowContext(ctx, "PRAGMA journal_mode = WAL").Scan(&mode); err != nil {
		return unavailable(err)
	}
	if mode != "wal" {
		return unavailable(fmt.Errorf("WAL unavailable (journal mode %s)", mode))
	}
	if _, err := s.db.ExecContext(ctx, "PRAGMA synchronous = FULL"); err != nil {
		return unavailable(err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	var version int
	if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return unavailable(err)
	}
	switch version {
	case 0:
		if _, err := tx.ExecContext(ctx, migration1); err != nil {
			return unavailable(err)
		}
		if _, err := tx.ExecContext(ctx, "PRAGMA user_version = 1"); err != nil {
			return unavailable(err)
		}
	case 1:
	default:
		return unavailable(fmt.Errorf("unsupported schema version %d", version))
	}
	if err := tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Ready(ctx context.Context) error {
	var value int
	if err := s.db.QueryRowContext(ctx, "SELECT 1 FROM events LIMIT 0").Scan(&value); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return unavailable(err)
	}
	return nil
}

// timeKey uses lexically ordered UTC civil time rather than UnixNano, which
// overflows for valid RFC3339 dates outside 1678–2262. A five-digit year offset
// by one also handles local boundary dates whose UTC year becomes -1 or 10000.
// Keys are internal; original RFC3339 timestamps stay in raw_json.
func timeKey(t time.Time) string {
	u := t.UTC()
	fraction := strings.TrimRight(fmt.Sprintf("%09d", u.Nanosecond()), "0")
	return secondKey(u) + "." + fraction + "!"
}

func secondKey(t time.Time) string {
	u := t.UTC()
	return fmt.Sprintf("%05d", u.Year()+1) + u.Format("-01-02T15:04:05")
}

// RFC3339 permits arbitrary fractional precision. time.Parse validates its
// syntax and UTC second, but truncates after nanoseconds. Retain the original
// decimal fraction so ordering, bounds, and clock skew never collapse it.
func exactTimeKey(raw string) (string, error) {
	t, err := event.ParseTime(raw)
	if err != nil {
		return "", err
	}
	fraction := ""
	if dot := strings.IndexByte(raw, '.'); dot >= 0 {
		end := dot + 1
		for end < len(raw) && raw[end] >= '0' && raw[end] <= '9' {
			end++
		}
		fraction = strings.TrimRight(raw[dot+1:end], "0")
	}
	return secondKey(t) + "." + fraction + "!", nil
}

func validTimeKey(key string) bool {
	if len(key) < 22 || key[20] != '.' || key[len(key)-1] != '!' {
		return false
	}
	year, err := strconv.Atoi(key[:5])
	if err != nil || year < 0 || year > 10001 {
		return false
	}
	// A leap-year placeholder lets time.Date validate the actual year afterward.
	t, err := time.Parse(time.RFC3339Nano, "2000"+key[5:20]+"Z")
	if err != nil {
		return false
	}
	u := time.Date(year-1, t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC)
	if secondKey(u) != key[:20] {
		return false
	}
	fraction := key[21 : len(key)-1]
	for _, c := range fraction {
		if c < '0' || c > '9' {
			return false
		}
	}
	return fraction == "" || fraction[len(fraction)-1] != '0'
}
func attr(e *event.Event, key string) string { v, _ := e.Fields[key].(string); return v }

var severities = map[string]int{"debug": 0, "info": 1, "notice": 2, "warning": 3, "error": 4, "critical": 5}

func (s *Store) Ingest(ctx context.Context, e *event.Event, received time.Time) (Result, error) {
	if e == nil {
		return Result{}, errors.New("nil validated event")
	}
	key, err := exactTimeKey(attr(e, "time"))
	if err != nil {
		return Result{}, err
	}
	// Fields retain the original attributes, including optional nulls. Hashing
	// uses Event.ContentHash, whose canonicalization omits those null attributes.
	raw := e.Raw
	if len(raw) == 0 {
		raw, err = json.Marshal(e.Fields)
		if err != nil {
			return Result{}, err
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, unavailable(err)
	}
	defer tx.Rollback()
	var seq int64
	var hash []byte
	err = tx.QueryRowContext(ctx, "SELECT seq, content_hash FROM events WHERE source = ? AND id = ?", attr(e, "source"), attr(e, "id")).Scan(&seq, &hash)
	if err == nil {
		if bytes.Equal(hash, e.ContentHash[:]) {
			if err := tx.Commit(); err != nil {
				return Result{}, unavailable(err)
			}
			return Result{Seq: seq, Duplicate: true}, nil
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO ingest_conflicts(source,id,received_at,content_hash,raw_json) VALUES(?,?,?,?,?)", attr(e, "source"), attr(e, "id"), received.UTC().Format(time.RFC3339Nano), e.ContentHash[:], raw)
		if err != nil {
			return Result{}, unavailable(err)
		}
		if err := tx.Commit(); err != nil {
			return Result{}, unavailable(err)
		}
		return Result{}, ErrConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Result{}, unavailable(err)
	}
	severity := attr(e, "severity")
	if severity == "" {
		severity = "info"
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO events(source,id,type,subject,time,received_at,severity,severity_rank,summary,originurl,correlationid,causationid,content_hash,raw_json,clock_skew) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		attr(e, "source"), attr(e, "id"), attr(e, "type"), attr(e, "subject"), key, received.UTC().Format(time.RFC3339Nano), severity, severities[severity], attr(e, "summary"), attr(e, "originurl"), attr(e, "correlationid"), attr(e, "causationid"), e.ContentHash[:], raw, key > timeKey(received.Add(5*time.Minute)))
	if err != nil {
		return Result{}, unavailable(err)
	}
	seq, err = result.LastInsertId()
	if err != nil {
		return Result{}, unavailable(err)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, unavailable(err)
	}
	return Result{Seq: seq}, nil
}
