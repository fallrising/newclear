package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

type SourceFreshness struct {
	Name             string  `json:"name"`
	SourcePrefix     string  `json:"source_prefix"`
	ExpectedInterval *string `json:"expected_interval"`
	LastReceivedAt   *string `json:"last_received_at"`
	LastEventTime    *string `json:"last_event_time"`
	Status           string  `json:"status"`
}
type SourcePage struct {
	Items      []SourceFreshness `json:"items"`
	NextCursor *string           `json:"next_cursor"`
}
type SourceQuery struct {
	Cursor string
	Limit  int
}
type sourceState struct {
	SourceFreshness
	scopeHash, configHash, interval string
	generation, transition          int64
	active                          bool
}

var sourceIntervalPattern = regexp.MustCompile(`^[1-9][0-9]*[smhd]$`)

func intervalNanos(value string) (*big.Int, error) {
	if !sourceIntervalPattern.MatchString(value) {
		return nil, fmt.Errorf("invalid expected interval")
	}
	n, _ := new(big.Int).SetString(value[:len(value)-1], 10)
	multiplier := map[byte]int64{'s': 1, 'm': 60, 'h': 3600, 'd': 86400}[value[len(value)-1]]
	return n.Mul(n, big.NewInt(multiplier*1e9)), nil
}
func hashJSON(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// ConfigureSources reconciles attribution scopes without guessing from event URIs.
func (s *Store) ConfigureSources(ctx context.Context, sources []config.Source, now time.Time) error {
	seen := map[string]bool{}
	for _, source := range sources {
		if seen[source.Name] {
			return fmt.Errorf("duplicate source name")
		}
		seen[source.Name] = true
		if source.ExpectedInterval != "" {
			if _, err := intervalNanos(source.ExpectedInterval); err != nil {
				return err
			}
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	existing, err := loadSources(ctx, tx, false)
	if err != nil {
		return err
	}
	byName := map[string]sourceState{}
	for _, row := range existing {
		byName[row.Name] = row
	}
	if _, err = tx.ExecContext(ctx, "UPDATE sources_state SET active=0"); err != nil {
		return unavailable(err)
	}
	for _, source := range sources {
		types := append([]string(nil), source.AllowedTypes...)
		sort.Strings(types)
		scope := hashJSON([]any{source.Name, source.SourcePrefix, types, source.TokenRef})
		fingerprint := hashJSON([]any{scope, source.ExpectedInterval, source.RetentionDays})
		old, exists := byName[source.Name]
		if !exists || old.scopeHash != scope || !old.active {
			if old.generation == math.MaxInt64 {
				return unavailable(errors.New("source generation exhausted"))
			}
			generation, generationErr := unusedSourceGeneration(ctx, tx, source.Name, old.generation+1)
			if generationErr != nil {
				return generationErr
			}
			if !exists {
				_, err = tx.ExecContext(ctx, `INSERT INTO sources_state(name,scope_hash,config_hash,source_prefix,expected_interval,active,generation,status) VALUES(?,?,?,?,?,1,?,'never')`, source.Name, scope, fingerprint, source.SourcePrefix, source.ExpectedInterval, generation)
			} else {
				_, err = tx.ExecContext(ctx, `UPDATE sources_state SET scope_hash=?,config_hash=?,source_prefix=?,expected_interval=?,active=1,generation=?,transition=0,last_received_at=NULL,last_event_time=NULL,status='never' WHERE name=?`, scope, fingerprint, source.SourcePrefix, source.ExpectedInterval, generation, source.Name)
			}
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE sources_state SET config_hash=?,expected_interval=?,active=1 WHERE name=?`, fingerprint, source.ExpectedInterval, source.Name)
			if err == nil && old.interval != source.ExpectedInterval {
				old.interval = source.ExpectedInterval
				state, stateErr := freshnessAt(old, now)
				if stateErr != nil {
					return stateErr
				}
				err = setSourceStatus(ctx, tx, &old, state, now)
			}
		}
		if err != nil {
			return unavailable(err)
		}
	}
	if err = tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}

// M1 did not reserve the internal URI namespace. Never reuse a generation
// whose IDs were occupied by historical events before producer isolation existed.
func unusedSourceGeneration(ctx context.Context, tx *sql.Tx, name string, generation int64) (int64, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM events WHERE source=?", "urn:signalhub:sources:"+name)
	if err != nil {
		return 0, unavailable(err)
	}
	defer rows.Close()
	used := map[int64]bool{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return 0, unavailable(err)
		}
		parts := strings.Split(id, ":")
		if len(parts) == 3 && parts[0] == "source" {
			n, parseErr := strconv.ParseInt(parts[1], 10, 64)
			if parseErr == nil && parts[1] == strconv.FormatInt(n, 10) {
				used[n] = true
			}
		}
	}
	if err = rows.Err(); err != nil {
		return 0, unavailable(err)
	}
	for used[generation] {
		if generation == math.MaxInt64 {
			return 0, unavailable(errors.New("source generation exhausted"))
		}
		generation++
	}
	return generation, nil
}

func loadSources(ctx context.Context, tx *sql.Tx, activeOnly bool) ([]sourceState, error) {
	query := `SELECT name,scope_hash,config_hash,source_prefix,expected_interval,active,generation,transition,last_received_at,last_event_time,status FROM sources_state`
	if activeOnly {
		query += " WHERE active=1"
	}
	query += " ORDER BY name ASC"
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return nil, unavailable(err)
	}
	defer rows.Close()
	out := []sourceState{}
	for rows.Next() {
		var row sourceState
		if err = rows.Scan(&row.Name, &row.scopeHash, &row.configHash, &row.SourcePrefix, &row.interval, &row.active, &row.generation, &row.transition, &row.LastReceivedAt, &row.LastEventTime, &row.Status); err != nil {
			return nil, unavailable(err)
		}
		if row.interval != "" {
			v := row.interval
			row.ExpectedInterval = &v
		}
		out = append(out, row)
	}
	if err = rows.Err(); err != nil {
		return nil, unavailable(err)
	}
	return out, nil
}
func freshnessAt(row sourceState, now time.Time) (string, error) {
	if row.LastReceivedAt == nil {
		return "never", nil
	}
	if row.interval == "" {
		return "fresh", nil
	}
	last, err := time.Parse(time.RFC3339Nano, *row.LastReceivedAt)
	if err != nil {
		return "", unavailable(err)
	}
	threshold, err := intervalNanos(row.interval)
	if err != nil {
		return "", unavailable(err)
	}
	age := new(big.Int).Sub(big.NewInt(now.Unix()), big.NewInt(last.Unix()))
	age.Mul(age, big.NewInt(1e9))
	age.Add(age, big.NewInt(int64(now.Nanosecond()-last.Nanosecond())))
	if age.Cmp(new(big.Int).Mul(new(big.Int).Set(threshold), big.NewInt(2))) > 0 {
		return "silent", nil
	}
	if age.Cmp(threshold) > 0 {
		return "late", nil
	}
	return "fresh", nil
}
func setSourceStatus(ctx context.Context, tx *sql.Tx, row *sourceState, status string, now time.Time) error {
	if row.Status == status {
		return nil
	}
	transition := ""
	if status == "silent" {
		transition = "silent"
	} else if row.Status == "silent" {
		transition = "recovered"
	}
	if transition != "" {
		if row.transition == math.MaxInt64 {
			return unavailable(errors.New("source transitions exhausted"))
		}
		row.transition++
		severity := "info"
		if transition == "silent" {
			severity = "warning"
		}
		raw, err := json.Marshal(map[string]any{"specversion": "1.0", "source": "urn:signalhub:sources:" + row.Name, "id": fmt.Sprintf("source:%d:%d", row.generation, row.transition), "type": "signalhub.source." + transition, "subject": row.Name, "time": now.UTC().Format(time.RFC3339Nano), "severity": severity, "summary": "Source " + row.Name + " " + transition})
		if err != nil {
			return unavailable(err)
		}
		e, err := event.Parse(raw)
		if err != nil {
			return unavailable(err)
		}
		if _, err = ingestTx(ctx, tx, e, now); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE sources_state SET status=?,transition=? WHERE name=?", status, row.transition, row.Name); err != nil {
		return unavailable(err)
	}
	row.Status = status
	return nil
}
func refreshSource(ctx context.Context, tx *sql.Tx, name, eventTime string, received time.Time) error {
	rows, err := loadSources(ctx, tx, true)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if row.Name != name {
			continue
		}
		effectiveReceived := received
		if row.LastReceivedAt != nil {
			last, err := time.Parse(time.RFC3339Nano, *row.LastReceivedAt)
			if err != nil {
				return unavailable(err)
			}
			if received.Before(last) {
				effectiveReceived = last
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE sources_state SET last_received_at=?,last_event_time=? WHERE name=?", effectiveReceived.UTC().Format(time.RFC3339Nano), eventTime, name); err != nil {
			return unavailable(err)
		}
		return setSourceStatus(ctx, tx, &row, "fresh", received)
	}
	// Legacy store clients may ingest before configuration; runtime configures first.
	return nil
}
func evaluateSourcesTx(ctx context.Context, tx *sql.Tx, now time.Time) ([]sourceState, error) {
	rows, err := loadSources(ctx, tx, true)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		state, err := freshnessAt(rows[i], now)
		if err != nil {
			return nil, err
		}
		// Only a delivery or a deliberate interval change can recover silent state.
		if rows[i].Status == "silent" && state != "silent" {
			continue
		}
		if err = setSourceStatus(ctx, tx, &rows[i], state, now); err != nil {
			return nil, err
		}
	}
	return rows, nil
}
func (s *Store) EvaluateSources(ctx context.Context, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return unavailable(err)
	}
	defer tx.Rollback()
	if _, err = evaluateSourcesTx(ctx, tx, now); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return unavailable(err)
	}
	return nil
}

type sourceCursor struct {
	Version     int    `json:"v"`
	Fingerprint string `json:"f"`
	Name        string `json:"n"`
}

func (s *Store) ListSources(ctx context.Context, q SourceQuery, now time.Time) (SourcePage, error) {
	page := SourcePage{Items: []SourceFreshness{}}
	if q.Limit == 0 {
		q.Limit = 100
	}
	if q.Limit < 1 || q.Limit > 200 {
		return page, invalid("limit must be 1–200")
	}
	var cursor sourceCursor
	if q.Cursor != "" {
		if len(q.Cursor) > 4096 {
			return page, invalid("cursor too long")
		}
		raw, err := base64.RawURLEncoding.Strict().DecodeString(q.Cursor)
		if err != nil {
			return page, invalid("malformed cursor")
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err = dec.Decode(&cursor); err != nil {
			return page, invalid("malformed cursor")
		}
		if err = dec.Decode(new(any)); !errors.Is(err, io.EOF) {
			return page, invalid("malformed cursor")
		}
		if cursor.Version != 1 || cursor.Name == "" {
			return page, invalid("invalid cursor")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return page, unavailable(err)
	}
	defer tx.Rollback()
	rows, err := loadSources(ctx, tx, true)
	if err != nil {
		return page, err
	}
	hashes := []string{}
	positionExists := q.Cursor == ""
	for _, row := range rows {
		hashes = append(hashes, row.configHash)
		if row.Name == cursor.Name {
			positionExists = true
		}
	}
	fingerprint := hashJSON(hashes)
	if q.Cursor != "" && (cursor.Fingerprint != fingerprint || !positionExists) {
		return page, invalid("cursor configuration or position changed")
	}
	rows, err = evaluateSourcesTx(ctx, tx, now)
	if err != nil {
		return page, err
	}
	for _, row := range rows {
		if strings.Compare(row.Name, cursor.Name) <= 0 {
			continue
		}
		if len(page.Items) == q.Limit {
			raw, _ := json.Marshal(sourceCursor{1, fingerprint, page.Items[len(page.Items)-1].Name})
			next := base64.RawURLEncoding.EncodeToString(raw)
			page.NextCursor = &next
			break
		}
		page.Items = append(page.Items, row.SourceFreshness)
	}
	if err = tx.Commit(); err != nil {
		return page, unavailable(err)
	}
	return page, nil
}
