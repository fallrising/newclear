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
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

type Query struct {
	Source, Type, SeverityMin, SubjectPrefix, CorrelationID, Q string
	From, To, Cursor                                           string
	Limit                                                      int
}
type cursor struct {
	Version  int    `json:"v"`
	Filters  string `json:"f"`
	Snapshot int64  `json:"s"`
	Time     string `json:"-"`
	Seq      int64  `json:"n"`
}

var typePattern = regexp.MustCompile(`^[a-z0-9]+(?:\.[a-z0-9]+)*(?:\.\*|\*)?$`)

const selectEvent = "seq,received_at,clock_skew,raw_json"

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidQuery, fmt.Sprintf(format, args...))
}
func (q Query) validated() (Query, error) {
	if q.Limit == 0 {
		q.Limit = 100
	}
	if q.Limit < 1 || q.Limit > 200 {
		return q, invalid("limit must be 1–200")
	}
	if q.Type != "" && !typePattern.MatchString(q.Type) {
		return q, invalid("invalid type pattern")
	}
	if q.SeverityMin != "" {
		if _, ok := severities[q.SeverityMin]; !ok {
			return q, invalid("invalid severity_min")
		}
	}
	if utf8.RuneCountInString(q.CorrelationID) > 128 {
		return q, invalid("correlationid exceeds 128 characters")
	}
	// The HTTP envelope bounds request allocation. The cursor has its own strict
	// bound; other strings retain the lengths allowed by the API contract.
	for _, v := range []string{q.Source, q.Type, q.SubjectPrefix, q.CorrelationID, q.Q, q.From, q.To} {
		if !utf8.ValidString(v) {
			return q, invalid("query string is invalid UTF-8")
		}
	}
	if q.Source != "" {
		if !event.ValidURI(q.Source, false) {
			return q, invalid("invalid source URI reference")
		}
	}
	for _, p := range []*string{&q.From, &q.To} {
		if *p == "" {
			continue
		}
		key, err := exactTimeKey(*p)
		if err != nil {
			return q, invalid("time bounds must be RFC3339")
		}
		*p = key
	}
	if q.From != "" && q.To != "" && q.From >= q.To {
		return q, invalid("from must precede to")
	}
	return q, nil
}
func filterHash(q Query) string {
	// Limit is a page size, not a filter; callers may change it between pages.
	raw, _ := json.Marshal([]string{q.Source, q.Type, q.SeverityMin, q.SubjectPrefix, q.CorrelationID, q.Q, q.From, q.To})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func decodeCursor(raw, filters string) (cursor, error) {
	var c cursor
	if len(raw) > 4096 {
		return c, invalid("cursor too long")
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(raw)
	if err != nil {
		return c, invalid("malformed cursor")
	}
	d := json.NewDecoder(bytes.NewReader(decoded))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, invalid("malformed cursor")
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return c, invalid("malformed cursor")
	}
	if c.Version != 1 || c.Filters != filters || c.Snapshot < 1 || c.Seq < 1 || c.Seq > c.Snapshot {
		return c, invalid("cursor does not match query or valid position")
	}
	return c, nil
}
func encodeCursor(c cursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func (s *Store) List(ctx context.Context, q Query) (Page, error) {
	page := Page{Items: []StoredEvent{}}
	q, err := q.validated()
	if err != nil {
		return page, err
	}
	filters := filterHash(q)
	var position cursor
	if q.Cursor != "" {
		position, err = decodeCursor(q.Cursor, filters)
		if err != nil {
			return page, err
		}
		err = s.db.QueryRowContext(ctx, "SELECT time FROM events WHERE seq = ?", position.Seq).Scan(&position.Time)
		if errors.Is(err, sql.ErrNoRows) {
			return page, invalid("cursor position no longer exists")
		}
		if err != nil {
			return page, unavailable(err)
		}
		if !validTimeKey(position.Time) {
			return page, unavailable(errors.New("invalid stored time key"))
		}
	} else {
		position = cursor{Version: 1, Filters: filters}
		if err := s.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(seq),0) FROM events").Scan(&position.Snapshot); err != nil {
			return page, unavailable(err)
		}
	}
	clauses := []string{"seq <= ?"}
	args := []any{position.Snapshot}
	add := func(sql string, value any) { clauses = append(clauses, sql); args = append(args, value) }
	if q.Source != "" {
		add("source = ?", q.Source)
	}
	if q.Type != "" {
		if strings.HasSuffix(q.Type, "*") {
			p := strings.TrimSuffix(q.Type, "*")
			clauses = append(clauses, "substr(type,1,?) = ?")
			args = append(args, utf8.RuneCountInString(p), p)
		} else {
			add("type = ?", q.Type)
		}
	}
	if q.SeverityMin != "" {
		add("severity_rank >= ?", severities[q.SeverityMin])
	}
	if q.SubjectPrefix != "" {
		clauses = append(clauses, "substr(CAST(subject AS BLOB),1,?) = ?")
		args = append(args, len([]byte(q.SubjectPrefix)), []byte(q.SubjectPrefix))
	}
	if q.CorrelationID != "" {
		add("correlationid = ?", q.CorrelationID)
	}
	if q.Q != "" {
		clauses = append(clauses, "(instr(type,?) > 0 OR instr(subject,?) > 0 OR instr(summary,?) > 0)")
		args = append(args, q.Q, q.Q, q.Q)
	}
	if q.From != "" {
		add("time >= ?", q.From)
	}
	if q.To != "" {
		add("time < ?", q.To)
	}
	if q.Cursor != "" {
		clauses = append(clauses, "(time < ? OR (time = ? AND seq < ?))")
		args = append(args, position.Time, position.Time, position.Seq)
	}
	args = append(args, q.Limit+1)
	rows, err := s.db.QueryContext(ctx, "SELECT "+selectEvent+",time FROM events WHERE "+strings.Join(clauses, " AND ")+" ORDER BY time DESC,seq DESC LIMIT ?", args...)
	if err != nil {
		return page, unavailable(err)
	}
	defer rows.Close()
	var lastTime string
	for rows.Next() {
		var item StoredEvent
		var key string
		if err := rows.Scan(&item.Seq, &item.ReceivedAt, &item.ClockSkew, &item.Event, &key); err != nil {
			return page, unavailable(err)
		}
		if len(page.Items) == q.Limit {
			position.Time = lastTime
			position.Seq = page.Items[len(page.Items)-1].Seq
			next := encodeCursor(position)
			page.NextCursor = &next
			break
		}
		page.Items = append(page.Items, item)
		lastTime = key
	}
	if err := rows.Err(); err != nil {
		return page, unavailable(err)
	}
	return page, nil
}

func (s *Store) Detail(ctx context.Context, seq int64) (Detail, error) {
	detail := Detail{Related: []StoredEvent{}}
	if seq < 1 {
		return detail, invalid("seq must be positive")
	}
	var correlation, causation string
	err := s.db.QueryRowContext(ctx, "SELECT "+selectEvent+",correlationid,causationid FROM events WHERE seq = ?", seq).Scan(&detail.Item.Seq, &detail.Item.ReceivedAt, &detail.Item.ClockSkew, &detail.Item.Event, &correlation, &causation)
	if errors.Is(err, sql.ErrNoRows) {
		return detail, ErrNotFound
	}
	if err != nil {
		return detail, unavailable(err)
	}
	conditions := []string{}
	args := []any{seq}
	if correlation != "" {
		conditions = append(conditions, "correlationid = ?")
		args = append(args, correlation)
	}
	if source, id, ok := decodeCausation(causation); ok {
		conditions = append(conditions, "(source = ? AND id = ?)")
		args = append(args, source, id)
	}
	if len(conditions) == 0 {
		return detail, nil
	}
	rows, err := s.db.QueryContext(ctx, "SELECT "+selectEvent+" FROM events WHERE seq != ? AND ("+strings.Join(conditions, " OR ")+") ORDER BY time ASC,seq ASC", args...)
	if err != nil {
		return detail, unavailable(err)
	}
	defer rows.Close()
	for rows.Next() {
		var item StoredEvent
		if err := rows.Scan(&item.Seq, &item.ReceivedAt, &item.ClockSkew, &item.Event); err != nil {
			return detail, unavailable(err)
		}
		detail.Related = append(detail.Related, item)
	}
	if err := rows.Err(); err != nil {
		return detail, unavailable(err)
	}
	return detail, nil
}
func decodeCausation(value string) (string, string, bool) {
	if strings.Count(value, "#") != 1 {
		return "", "", false
	}
	parts := strings.SplitN(value, "#", 2)
	// Only %25 and %23 are legal escapes in the causation encoding. Replace
	// simultaneously: %2523 becomes literal %23, never a second decoded #.
	decode := func(v string) (string, bool) {
		var b strings.Builder
		for i := 0; i < len(v); i++ {
			if v[i] != '%' {
				b.WriteByte(v[i])
				continue
			}
			if i+2 >= len(v) {
				return "", false
			}
			switch v[i : i+3] {
			case "%25":
				b.WriteByte('%')
			case "%23":
				b.WriteByte('#')
			default:
				return "", false
			}
			i += 2
		}
		return b.String(), true
	}
	source, ok := decode(parts[0])
	if !ok || source == "" {
		return "", "", false
	}
	id, ok := decode(parts[1])
	return source, id, ok && id != ""
}
