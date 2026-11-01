package store

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
)

const archivePartRecords = 1000
const archiveLineBytes = 4 << 20
const archivePartBytes = 16 << 20

// The civil supported range is less than 3.66 million days. Larger retention
// is never useful and can overflow time arithmetic supplied with arbitrary ints.
const maxRetentionDays = 3_660_000

type ArchiveOptions struct {
	Directory            string
	Now                  time.Time
	DefaultRetentionDays int
}
type ArchiveManifest struct {
	Day        string `json:"day"`
	Part       int64  `json:"part"`
	Path       string `json:"path"`
	EventCount int64  `json:"event_count"`
	SHA256     string `json:"sha256"`
	FirstSeq   int64  `json:"first_seq"`
	LastSeq    int64  `json:"last_seq"`
	CreatedAt  string `json:"created_at"`
	VerifiedAt string `json:"verified_at"`
	PurgedAt   string `json:"purged_at"`
}
type ArchiveResult struct {
	Parts  []ArchiveManifest `json:"parts"`
	Events int64             `json:"events"`
}
type ImportResult struct {
	Imported   int64 `json:"imported"`
	Duplicates int64 `json:"duplicates"`
}
type archiveRecord struct {
	seq                       int64
	source, id, key, received string
	hash                      []byte
	skew                      bool
	raw                       []byte
}

const identityColumns = "seq,source,id,time,received_at,content_hash,clock_skew"
const manifestColumns = "day,part,path,event_count,sha256,first_seq,last_seq,created_at,verified_at,purged_at"

func archiveNow(now time.Time) error {
	if now.IsZero() || now.UTC().Year() < 1 || now.UTC().Year() > 9999 {
		return errors.New("archive time outside supported civil range")
	}
	return nil
}
func archiveDay(day string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", day)
	if err != nil || t.Year() < 1 || t.Format("2006-01-02") != day {
		return time.Time{}, errors.New("archive day must be YYYY-MM-DD in years 0001-9999")
	}
	return t, nil
}

// Open each directory relative to an already-open parent. Never follow a
// symlink, even while creating the requested root, and sync every new link.
func archiveRoot(directory string, create bool) (*os.Root, error) {
	if strings.TrimSpace(directory) == "" {
		return nil, errors.New("archive directory is required")
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	current, err := os.OpenRoot(string(filepath.Separator))
	if err != nil {
		return nil, err
	}
	for part := range strings.SplitSeq(strings.TrimPrefix(absolute, string(filepath.Separator)), string(filepath.Separator)) {
		if part == "" {
			continue
		}
		info, err := current.Lstat(part)
		if errors.Is(err, os.ErrNotExist) && create {
			if err = current.Mkdir(part, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				current.Close()
				return nil, err
			}
			if err = syncRootDirectory(current, "."); err != nil {
				current.Close()
				return nil, err
			}
			info, err = current.Lstat(part)
		}
		if err != nil {
			current.Close()
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			current.Close()
			return nil, errors.New("archive directory must not traverse symlinks or non-directories")
		}
		next, err := current.OpenRoot(part)
		current.Close()
		if err != nil {
			return nil, err
		}
		actual, err := next.Stat(".")
		if err != nil || !os.SameFile(info, actual) {
			next.Close()
			return nil, errors.New("archive directory changed during open")
		}
		current = next
	}
	return current, nil
}

func archivePath(day string, part int64) (string, error) {
	if _, err := archiveDay(day); err != nil {
		return "", err
	}
	if part < 1 {
		return "", errors.New("invalid archive part")
	}
	return fmt.Sprintf("events/%s/%s/%s.part-%d.jsonl.gz", day[:4], day[5:7], day[8:], part), nil
}
func syncRootDirectory(root *os.Root, path string) error {
	f, err := root.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func archiveLock(ctx context.Context, tx *sql.Tx) error {
	// First statement obtains SQLite's writer reservation before selection or I/O.
	// Separate processes cannot select and purge against different snapshots.
	_, err := tx.ExecContext(ctx, "UPDATE archive_state SET restore_generation=restore_generation WHERE singleton=1")
	return err
}
func (s *Store) archiveNotice(ctx context.Context, kind string, now time.Time, count int64) {
	if archiveNow(now) != nil {
		return
	}
	bounded, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(bounded, nil)
	if err != nil {
		return
	}
	defer tx.Rollback()
	err = internalEventTx(bounded, tx, map[string]any{"source": "urn:signalhub:archives", "id": "archive:" + rand.Text(), "type": "signalhub.archive." + kind, "time": now.UTC().Format(time.RFC3339Nano), "summary": "Archive " + kind, "data": map[string]any{"event_count": count}}, now, false)
	if err == nil {
		_ = tx.Commit()
	}
}

// Archive publishes immutable bounded parts, reopens and verifies actual bytes,
// then records membership and purges exact identities in the same transaction.
// Failure may leave an orphan file; it never leaves a manifest or purged rows.
func (s *Store) Archive(ctx context.Context, options ArchiveOptions) (result ArchiveResult, err error) {
	result.Parts = []ArchiveManifest{}
	defer func() {
		if err != nil {
			s.archiveNotice(ctx, "failed", options.Now, 0)
		}
	}()
	if err = archiveNow(options.Now); err != nil {
		return result, err
	}
	if options.DefaultRetentionDays == 0 {
		options.DefaultRetentionDays = 90
	}
	if options.DefaultRetentionDays < 1 || options.DefaultRetentionDays > maxRetentionDays {
		return result, errors.New("invalid archive retention days")
	}
	root, err := archiveRoot(options.Directory, true)
	if err != nil {
		return result, err
	}
	defer root.Close()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, unavailable(err)
	}
	defer tx.Rollback()
	if err = archiveLock(ctx, tx); err != nil {
		return ArchiveResult{}, unavailable(err)
	}
	if err = selectArchiveCandidates(ctx, tx, options); err != nil {
		return ArchiveResult{}, err
	}
	for {
		var day string
		err = tx.QueryRowContext(ctx, "SELECT day FROM archive_candidates ORDER BY seq LIMIT 1").Scan(&day)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return ArchiveResult{}, unavailable(err)
		}
		records, readErr := archiveHotRecords(ctx, tx, day)
		if readErr != nil {
			return ArchiveResult{}, readErr
		}
		manifest, writeErr := writeArchivePart(ctx, tx, root, day, records, options.Now)
		if writeErr != nil {
			return ArchiveResult{}, writeErr
		}
		if _, err = verifyArchivePart(ctx, root, manifest, records, nil); err != nil {
			return ArchiveResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO archives("+manifestColumns+") VALUES(?,?,?,?,?,?,?,?,?,?)", manifest.Day, manifest.Part, manifest.Path, manifest.EventCount, manifest.SHA256, manifest.FirstSeq, manifest.LastSeq, manifest.CreatedAt, manifest.VerifiedAt, manifest.PurgedAt); err != nil {
			return ArchiveResult{}, unavailable(err)
		}
		for i, r := range records {
			if _, err = tx.ExecContext(ctx, "INSERT INTO archive_members(day,part,ordinal,event_seq) VALUES(?,?,?,?)", day, manifest.Part, i+1, r.seq); err != nil {
				return ArchiveResult{}, unavailable(err)
			}
			deleted, deleteErr := tx.ExecContext(ctx, "DELETE FROM events WHERE seq=? AND source=? AND id=? AND content_hash=?", r.seq, r.source, r.id, r.hash)
			if deleteErr != nil {
				return ArchiveResult{}, unavailable(deleteErr)
			}
			n, countErr := deleted.RowsAffected()
			if countErr != nil || n != 1 {
				return ArchiveResult{}, errors.New("archive exact delete count mismatch")
			}
			if _, err = tx.ExecContext(ctx, "DELETE FROM archive_candidates WHERE seq=?", r.seq); err != nil {
				return ArchiveResult{}, unavailable(err)
			}
		}
		result.Parts = append(result.Parts, manifest)
		result.Events += manifest.EventCount
	}
	if result.Events > 0 {
		if err = internalEventTx(ctx, tx, map[string]any{"source": "urn:signalhub:archives", "id": "archive:" + rand.Text(), "type": "signalhub.archive.succeeded", "time": options.Now.UTC().Format(time.RFC3339Nano), "summary": "Archive succeeded", "data": map[string]any{"event_count": result.Events}}, options.Now, false); err != nil {
			return ArchiveResult{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return ArchiveResult{}, unavailable(err)
	}
	return result, nil
}

type retentionPolicy struct {
	prefix string
	days   *int
	known  bool
}
type archiveProtection struct {
	allRules      bool
	ruleFrom      string
	subscriptions []subscriptionState
}

func archiveProtectedInputs(ctx context.Context, tx *sql.Tx, now time.Time) (archiveProtection, error) {
	var out archiveProtection
	rows, err := tx.QueryContext(ctx, `SELECT d.definition,s.needs_backfill,s.last_computed_at FROM rules_state s JOIN rule_definitions d ON d.rule_id=s.rule_id AND d.version=s.version WHERE s.active=1`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var raw json.RawMessage
		var backfill bool
		var last *string
		if err = rows.Scan(&raw, &backfill, &last); err != nil {
			rows.Close()
			return out, err
		}
		if backfill {
			out.allRules = true
			continue
		}
		parsed, parseErr := rules.Parse([]json.RawMessage{raw})
		if parseErr != nil {
			rows.Close()
			return out, parseErr
		}
		r := parsed[0]
		current := r.Start(now)
		start := maxTime(current.Add(-2*r.Duration()), current.Add(-24*time.Hour))
		if last != nil {
			previous, parseErr := event.ParseTime(*last)
			if parseErr != nil {
				rows.Close()
				return out, parseErr
			}
			if previous = r.Start(previous); previous.Before(start) {
				start = previous
			}
		}
		if key := timeKey(start); out.ruleFrom == "" || key < out.ruleFrom {
			out.ruleFrom = key
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	// Paused subscriptions retain their saved position and can resume unchanged.
	rows, err = tx.QueryContext(ctx, "SELECT definition,activation_seq,scan_seq,digest_start FROM subscriptions")
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var state subscriptionState
		var raw []byte
		if err = rows.Scan(&raw, &state.activation, &state.scan, &state.digestStart); err != nil {
			return out, err
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		if err = dec.Decode(&state.definition); err != nil {
			return out, err
		}
		out.subscriptions = append(out.subscriptions, state)
	}
	return out, rows.Err()
}
func (p archiveProtection) required(r archiveRecord, restored bool) bool {
	if p.allRules || (p.ruleFrom != "" && r.key >= p.ruleFrom) {
		return true
	}
	if restored {
		return false
	}
	for _, sub := range p.subscriptions {
		if sub.definition.Mode == "immediate" && r.seq > sub.scan {
			return true
		}
		if sub.definition.Mode == "digest" && r.seq > sub.activation && (sub.digestStart == nil || r.key >= timeKey(time.Unix(*sub.digestStart, 0))) {
			return true
		}
	}
	return false
}
func selectArchiveCandidates(ctx context.Context, tx *sql.Tx, options ArchiveOptions) error {
	if _, err := tx.ExecContext(ctx, "CREATE TEMP TABLE IF NOT EXISTS archive_candidates(seq INTEGER PRIMARY KEY,day TEXT NOT NULL); DELETE FROM archive_candidates"); err != nil {
		return unavailable(err)
	}
	protection, err := archiveProtectedInputs(ctx, tx, options.Now)
	if err != nil {
		return unavailable(err)
	}
	policies := []retentionPolicy{}
	rows, err := tx.QueryContext(ctx, "SELECT source_prefix,retention_days,retention_policy_known FROM sources_state WHERE active=1")
	if err != nil {
		return unavailable(err)
	}
	for rows.Next() {
		var policy retentionPolicy
		if err = rows.Scan(&policy.prefix, &policy.days, &policy.known); err != nil {
			rows.Close()
			return unavailable(err)
		}
		policies = append(policies, policy)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return unavailable(err)
	}
	rows, err = tx.QueryContext(ctx, "SELECT seq,source,id,time,restored,restore_until FROM events ORDER BY seq")
	if err != nil {
		return unavailable(err)
	}
	defer rows.Close()
	for rows.Next() {
		var r archiveRecord
		var restored bool
		var until *string
		if err = rows.Scan(&r.seq, &r.source, &r.id, &r.key, &restored, &until); err != nil {
			return unavailable(err)
		}
		if !validTimeKey(r.key) {
			return errors.New("invalid stored archive event time")
		}
		if protection.required(r, restored) {
			continue
		}
		days := options.DefaultRetentionDays
		matched := false
		unknownPolicy := false
		for _, p := range policies {
			if strings.HasPrefix(r.source, p.prefix) {
				if !p.known {
					unknownPolicy = true
					break
				}
				n := options.DefaultRetentionDays
				if p.days != nil {
					n = *p.days
				}
				if n < 1 || n > maxRetentionDays {
					return errors.New("invalid persisted retention days")
				}
				if !matched || n > days {
					days = n
				}
				matched = true
			}
		}
		if unknownPolicy {
			continue
		}
		if restored {
			if until == nil || !validTimeKey(*until) {
				return errors.New("invalid restored retention deadline")
			}
			if *until > timeKey(options.Now) {
				continue
			}
		}
		// Recover civil day from the sortable key without truncating fractional time.
		year, parseErr := time.Parse("2006-01-02", fmt.Sprintf("%04d%s", mustArchiveYear(r.key), r.key[5:11]))
		if parseErr != nil {
			return errors.New("archive event outside supported civil years")
		}
		cutoff := options.Now.UTC().AddDate(0, 0, -days)
		next := year.AddDate(0, 0, 1)
		if !restored && next.After(cutoff) {
			continue
		}
		if year.Year() < 1 || year.Year() > 9999 {
			return errors.New("archive event outside supported civil years")
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO archive_candidates(seq,day) VALUES(?,?)", r.seq, year.Format("2006-01-02")); err != nil {
			return unavailable(err)
		}
	}
	return rows.Err()
}
func mustArchiveYear(key string) int {
	n := 0
	for _, r := range key[:5] {
		n = n*10 + int(r-'0')
	}
	return n - 1
}
func archiveHotRecords(ctx context.Context, tx *sql.Tx, day string) ([]archiveRecord, error) {
	rows, err := tx.QueryContext(ctx, "SELECT i.seq,i.source,i.id,i.time,i.received_at,i.content_hash,i.clock_skew,e.raw_json FROM events e JOIN event_identities i ON i.seq=e.seq JOIN archive_candidates c ON c.seq=e.seq WHERE c.day=? ORDER BY e.seq LIMIT ?", day, archivePartRecords)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []archiveRecord{}
	size := 0
	for rows.Next() {
		var r archiveRecord
		if err = rows.Scan(&r.seq, &r.source, &r.id, &r.key, &r.received, &r.hash, &r.skew, &r.raw); err != nil {
			return nil, err
		}
		if len(r.raw) > archiveLineBytes {
			return nil, errors.New("archive event exceeds bounded line size")
		}
		if len(out) > 0 && size+len(r.raw) > archivePartBytes {
			break
		}
		size += len(r.raw)
		out = append(out, r)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, errors.New("archive candidate missing")
	}
	return out, nil
}
func writeArchivePart(ctx context.Context, tx *sql.Tx, root *os.Root, day string, records []archiveRecord, now time.Time) (ArchiveManifest, error) {
	m := ArchiveManifest{Day: day, EventCount: int64(len(records)), FirstSeq: records[0].seq, LastSeq: records[len(records)-1].seq, CreatedAt: now.UTC().Format(time.RFC3339Nano), VerifiedAt: now.UTC().Format(time.RFC3339Nano), PurgedAt: now.UTC().Format(time.RFC3339Nano)}
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(part),0) FROM archives WHERE day=?", day).Scan(&m.Part); err != nil {
		return m, err
	}
	var file *os.File
	for collisions := 0; collisions < 10000; collisions++ {
		if err := ctx.Err(); err != nil {
			return m, err
		}
		if m.Part == math.MaxInt64 {
			return m, errors.New("archive part numbers exhausted")
		}
		m.Part++
		path, err := archivePath(day, m.Part)
		if err != nil {
			return m, err
		}
		m.Path = path
		parent := filepath.Dir(path)
		if err = root.MkdirAll(parent, 0700); err != nil {
			return m, err
		}
		file, err = root.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return m, err
		}
		break
	}
	if file == nil {
		return m, errors.New("too many orphan archive parts")
	}
	defer file.Close()
	hash := sha256.New()
	writer := gzip.NewWriter(io.MultiWriter(file, hash))
	for _, r := range records {
		if err := ctx.Err(); err != nil {
			_ = writer.Close()
			return m, err
		}
		var compact bytes.Buffer
		if err := json.Compact(&compact, r.raw); err != nil {
			_ = writer.Close()
			return m, err
		}
		if _, err := writer.Write(append(compact.Bytes(), '\n')); err != nil {
			_ = writer.Close()
			return m, err
		}
	}
	if err := writer.Close(); err != nil {
		return m, err
	}
	if err := file.Sync(); err != nil {
		return m, err
	}
	if err := file.Close(); err != nil {
		return m, err
	}
	// Persist every new directory link before the SQLite manifest can commit.
	for parent := filepath.Dir(m.Path); ; parent = filepath.Dir(parent) {
		if err := syncRootDirectory(root, parent); err != nil {
			return m, err
		}
		if parent == "." {
			break
		}
	}
	m.SHA256 = hex.EncodeToString(hash.Sum(nil))
	return m, nil
}
func verifyArchivePart(ctx context.Context, root *os.Root, m ArchiveManifest, records []archiveRecord, consume func(archiveRecord, *event.Event) error) (int64, error) {
	want, err := archivePath(m.Day, m.Part)
	if err != nil || want != m.Path {
		return 0, errors.New("invalid recorded archive path")
	}
	if m.EventCount < 1 || m.EventCount > archivePartRecords || int64(len(records)) != m.EventCount {
		return 0, errors.New("archive membership count mismatch")
	}
	if records[0].seq != m.FirstSeq || records[len(records)-1].seq != m.LastSeq {
		return 0, errors.New("archive sequence bounds mismatch")
	}
	info, err := root.Lstat(m.Path)
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, errors.New("archive is not a regular file")
	}
	file, err := root.Open(m.Path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil {
		return 0, err
	}
	if !actual.Mode().IsRegular() || !os.SameFile(info, actual) || actual.Size() > archivePartBytes+archiveLineBytes {
		return 0, errors.New("archive file changed or exceeds size bound")
	}
	hash := sha256.New()
	compressed := bufio.NewReader(io.TeeReader(file, hash))
	reader, err := gzip.NewReader(compressed)
	if err != nil {
		return 0, err
	}
	reader.Multistream(false)
	defer reader.Close()
	scanner := bufio.NewScanner(io.LimitReader(reader, archivePartBytes+archiveLineBytes+1))
	scanner.Buffer(make([]byte, 64<<10), archiveLineBytes+1)
	var count int64
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		if count >= m.EventCount {
			return 0, errors.New("archive has extra records")
		}
		e, err := event.Parse(scanner.Bytes())
		if err != nil {
			return 0, errors.New("archive contains invalid event JSON")
		}
		r := records[count]
		if count > 0 && r.seq <= records[count-1].seq {
			return 0, errors.New("archive membership order mismatch")
		}
		key, err := exactTimeKey(attr(e, "time"))
		if err != nil {
			return 0, err
		}
		if attr(e, "source") != r.source || attr(e, "id") != r.id || !bytes.Equal(e.ContentHash[:], r.hash) || key != r.key {
			return 0, errors.New("archive content differs from permanent identity")
		}
		if fmt.Sprintf("%04d%s", mustArchiveYear(key), key[5:11]) != m.Day {
			return 0, errors.New("archive event day mismatch")
		}
		if consume != nil {
			if err := consume(r, e); err != nil {
				return 0, err
			}
		}
		count++
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	if count != m.EventCount {
		return 0, errors.New("archive record count mismatch")
	}
	if err := reader.Close(); err != nil {
		return 0, err
	}
	if _, err := compressed.ReadByte(); !errors.Is(err, io.EOF) {
		return 0, errors.New("archive has trailing compressed bytes")
	}
	if hex.EncodeToString(hash.Sum(nil)) != m.SHA256 {
		return 0, errors.New("archive SHA-256 mismatch")
	}
	return count, nil
}
func archiveManifests(ctx context.Context, tx *sql.Tx, day string) ([]ArchiveManifest, error) {
	rows, err := tx.QueryContext(ctx, "SELECT "+manifestColumns+" FROM archives WHERE day=? ORDER BY part", day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ArchiveManifest{}
	for rows.Next() {
		var m ArchiveManifest
		if err = rows.Scan(&m.Day, &m.Part, &m.Path, &m.EventCount, &m.SHA256, &m.FirstSeq, &m.LastSeq, &m.CreatedAt, &m.VerifiedAt, &m.PurgedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func archiveMembership(ctx context.Context, tx *sql.Tx, m ArchiveManifest) ([]archiveRecord, error) {
	rows, err := tx.QueryContext(ctx, `SELECT i.seq,i.source,i.id,i.time,i.received_at,i.content_hash,i.clock_skew,m.ordinal FROM archive_members m JOIN event_identities i ON i.seq=m.event_seq WHERE m.day=? AND m.part=? ORDER BY m.ordinal`, m.Day, m.Part)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []archiveRecord{}
	for rows.Next() {
		var r archiveRecord
		var ordinal int
		if err = rows.Scan(&r.seq, &r.source, &r.id, &r.key, &r.received, &r.hash, &r.skew, &ordinal); err != nil {
			return nil, err
		}
		if ordinal != len(out)+1 || ordinal > archivePartRecords {
			return nil, errors.New("archive membership ordinal mismatch")
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) VerifyArchives(ctx context.Context, directory, day string) (out []ArchiveManifest, err error) {
	defer func() {
		if err != nil {
			s.archiveNotice(ctx, "failed", time.Now(), 0)
		}
	}()
	if _, err = archiveDay(day); err != nil {
		return nil, err
	}
	root, err := archiveRoot(directory, false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, unavailable(err)
	}
	defer tx.Rollback()
	out, err = archiveManifests(ctx, tx, day)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	for _, m := range out {
		records, readErr := archiveMembership(ctx, tx, m)
		if readErr != nil {
			return nil, readErr
		}
		if _, err = verifyArchivePart(ctx, root, m, records, nil); err != nil {
			return nil, err
		}
	}
	return out, nil
}
func (s *Store) ImportArchives(ctx context.Context, directory, day, reason string, now time.Time, retentionDays int) (result ImportResult, err error) {
	defer func() {
		if err != nil {
			s.archiveNotice(ctx, "failed", now, 0)
		}
	}()
	if err = archiveNow(now); err != nil {
		return result, err
	}
	if _, err = archiveDay(day); err != nil {
		return result, err
	}
	if strings.TrimSpace(reason) == "" || !utf8.ValidString(reason) || len(reason) > 4096 {
		return result, ErrInvalidReason
	}
	if retentionDays == 0 {
		retentionDays = 7
	}
	if retentionDays < 1 || retentionDays > maxRetentionDays {
		return result, errors.New("invalid restore retention days")
	}
	deadline := now.UTC().AddDate(0, 0, retentionDays)
	if deadline.Year() > 9999 {
		return result, errors.New("restore retention exceeds supported civil range")
	}
	root, err := archiveRoot(directory, false)
	if err != nil {
		return result, err
	}
	defer root.Close()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, unavailable(err)
	}
	defer tx.Rollback()
	if err = archiveLock(ctx, tx); err != nil {
		return result, unavailable(err)
	}
	manifests, err := archiveManifests(ctx, tx, day)
	if err != nil {
		return result, err
	}
	if len(manifests) == 0 {
		return result, ErrNotFound
	}
	if _, err = tx.ExecContext(ctx, "CREATE TEMP TABLE IF NOT EXISTS archive_import_seen(seq INTEGER PRIMARY KEY); DELETE FROM archive_import_seen"); err != nil {
		return result, err
	}
	for _, m := range manifests {
		records, readErr := archiveMembership(ctx, tx, m)
		if readErr != nil {
			return ImportResult{}, readErr
		}
		_, err = verifyArchivePart(ctx, root, m, records, func(r archiveRecord, e *event.Event) error {
			seen, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO archive_import_seen(seq) VALUES(?)", r.seq)
			if err != nil {
				return err
			}
			n, err := seen.RowsAffected()
			if err != nil {
				return err
			}
			if n == 0 {
				return nil
			}
			var hash, raw []byte
			err = tx.QueryRowContext(ctx, "SELECT content_hash,raw_json FROM events WHERE seq=?", r.seq).Scan(&hash, &raw)
			if err == nil {
				existing, parseErr := event.Parse(raw)
				if parseErr != nil || !bytes.Equal(hash, r.hash) || !bytes.Equal(existing.ContentHash[:], r.hash) {
					return errors.New("existing hot event conflicts with archive")
				}
				result.Duplicates++
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			severity := attr(e, "severity")
			if severity == "" {
				severity = "info"
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO events(seq,source,id,type,subject,time,received_at,severity,severity_rank,summary,originurl,correlationid,causationid,content_hash,raw_json,clock_skew,restored,restore_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`, r.seq, r.source, r.id, attr(e, "type"), attr(e, "subject"), r.key, r.received, severity, severities[severity], attr(e, "summary"), attr(e, "originurl"), attr(e, "correlationid"), attr(e, "causationid"), r.hash, e.Raw, r.skew, timeKey(deadline))
			if err == nil {
				result.Imported++
			}
			return err
		})
		if err != nil {
			return ImportResult{}, err
		}
	}
	if result.Imported > 0 {
		changed, changeErr := tx.ExecContext(ctx, "UPDATE archive_state SET restore_generation=restore_generation+1 WHERE singleton=1 AND restore_generation<?", int64(math.MaxInt64))
		if changeErr != nil {
			return ImportResult{}, changeErr
		}
		n, countErr := changed.RowsAffected()
		if countErr != nil || n != 1 {
			return ImportResult{}, errors.New("restore generation exhausted")
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO audit_log(at,actor,action,target,reason) VALUES(?,'owner','archive.import',?,?)", now.UTC().Format(time.RFC3339Nano), day, reason); err != nil {
		return ImportResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return ImportResult{}, unavailable(err)
	}
	return result, nil
}
