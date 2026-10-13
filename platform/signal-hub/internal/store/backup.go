package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

// BackupManifest describes one immutable, self-contained SQLite snapshot.
// Its companion file is <snapshot>.manifest.json; neither file is replaceable.
type BackupManifest struct {
	Version   int    `json:"version"`
	File      string `json:"file"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
	CreatedAt string `json:"created_at"`
}

var ErrInvalidBackup = errors.New("backup is invalid or unavailable")

// OpenExisting never creates a database for a mistyped maintenance command.
func OpenExisting(path string) (*Store, error) {
	absolute, err := backupPath(path)
	if err != nil {
		return nil, unavailable(err)
	}
	file, err := backupRegular(absolute)
	if err != nil {
		return nil, unavailable(err)
	}
	info, err := file.Stat()
	_ = file.Close()
	if err != nil || info.Size() == 0 {
		return nil, unavailable(errors.New("existing database is empty or unavailable"))
	}
	db, err := backupDB(absolute, false)
	if err != nil {
		return nil, unavailable(err)
	}
	s := &Store{db: db}
	if err := backupSchema(context.Background(), db); err != nil {
		_ = db.Close()
		return nil, unavailable(err)
	}
	if err := s.initialize(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Backup uses SQLite's consistent snapshot mechanism, including committed WAL
// pages. A failed publication may leave an incomplete pair, never a replacement.
func (s *Store) Backup(ctx context.Context, output string, now time.Time) (BackupManifest, error) {
	if !backupTime(now) {
		return BackupManifest{}, ErrInvalidBackup
	}
	absolute, err := backupPath(output)
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupAbsent(absolute, true); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".signalhub-backup-*.sqlite")
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	tempPath := temporary.Name()
	defer os.Remove(tempPath)
	if err := temporary.Close(); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if _, err := s.db.ExecContext(ctx, "VACUUM INTO ?", tempPath); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupIntegrity(ctx, tempPath); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	file, err := os.OpenFile(tempPath, os.O_RDWR, 0)
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	defer file.Close()
	if err := file.Sync(); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	hash, size, err := backupHash(ctx, file)
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	manifest := BackupManifest{Version: 1, File: filepath.Base(absolute), SizeBytes: size, SHA256: hash, CreatedAt: now.UTC().Format(time.RFC3339Nano)}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	metadata, err := os.CreateTemp(filepath.Dir(absolute), ".signalhub-manifest-*.json")
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	defer os.Remove(metadata.Name())
	if _, err := metadata.Write(append(raw, '\n')); err != nil {
		_ = metadata.Close()
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := metadata.Sync(); err != nil {
		_ = metadata.Close()
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := metadata.Close(); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := ctx.Err(); err != nil {
		return BackupManifest{}, err
	}
	// Link is an atomic no-replace publication, unlike Rename on Unix.
	if err := backupAbsent(absolute, true); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := os.Link(tempPath, absolute); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupSyncDir(filepath.Dir(absolute)); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := os.Link(metadata.Name(), absolute+".manifest.json"); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupSyncDir(filepath.Dir(absolute)); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	return manifest, nil
}

// VerifyBackup rejects incomplete pairs, malformed manifests, hash/size
// mismatches, sidecars and SQLite corruption without writing to the snapshot.
func VerifyBackup(ctx context.Context, path string) (BackupManifest, error) {
	manifest, file, err := backupVerified(ctx, path)
	if err != nil {
		return BackupManifest{}, err
	}
	defer file.Close()
	return manifest, nil
}

// RestoreBackup exclusively publishes an audited isolated copy. It does not
// start a service, migrate the schema or reset leases/cursors/delivery attempts.
func RestoreBackup(ctx context.Context, source, destination, reason string, now time.Time) (BackupManifest, error) {
	if !backupTime(now) || strings.TrimSpace(reason) == "" || len(reason) > 4096 || !utf8.ValidString(reason) {
		return BackupManifest{}, ErrInvalidBackup
	}
	absolute, err := backupPath(destination)
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupAbsent(absolute, false); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	manifest, input, err := backupVerified(ctx, source)
	if err != nil {
		return BackupManifest{}, err
	}
	defer input.Close()
	temp, err := os.CreateTemp(filepath.Dir(absolute), ".signalhub-restore-*.sqlite")
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	temporary := temp.Name()
	defer os.Remove(temporary)
	defer os.Remove(temporary + "-journal")
	defer os.Remove(temporary + "-wal")
	defer os.Remove(temporary + "-shm")
	hash := sha256.New()
	count, copyErr := io.Copy(io.MultiWriter(temp, hash), backupContextReader{ctx: ctx, reader: input})
	syncErr := temp.Sync()
	closeErr := temp.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || count != manifest.SizeBytes || hex.EncodeToString(hash.Sum(nil)) != manifest.SHA256 {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupIntegrity(ctx, temporary); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	db, err := backupDB(temporary, false)
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	auditErr := func() error {
		if _, err := db.ExecContext(ctx, "PRAGMA journal_mode = DELETE"); err != nil {
			return err
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO audit_log(at,actor,action,target,reason) VALUES(?,'owner','backup.restore',?,?)", now.UTC().Format(time.RFC3339Nano), manifest.SHA256, reason); err != nil {
			return err
		}
		return nil
	}()
	dbCloseErr := db.Close()
	if auditErr != nil || dbCloseErr != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupIntegrity(ctx, temporary); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	synced, err := os.OpenFile(temporary, os.O_RDWR, 0)
	if err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	syncErr = synced.Sync()
	closeErr = synced.Close()
	if syncErr != nil || closeErr != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := ctx.Err(); err != nil {
		return BackupManifest{}, err
	}
	// Check all destination companions again after the potentially long copy.
	if err := backupAbsent(absolute, false); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := os.Link(temporary, absolute); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	if err := backupSyncDir(filepath.Dir(absolute)); err != nil {
		return BackupManifest{}, ErrInvalidBackup
	}
	return manifest, nil
}

func backupVerified(ctx context.Context, path string) (BackupManifest, *os.File, error) {
	absolute, err := backupPath(path)
	if err != nil {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err := os.Lstat(absolute + suffix); !errors.Is(err, os.ErrNotExist) {
			return BackupManifest{}, nil, ErrInvalidBackup
		}
	}
	metadata, err := backupRegular(absolute + ".manifest.json")
	if err != nil {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	raw, readErr := io.ReadAll(io.LimitReader(metadata, 8193))
	closeErr := metadata.Close()
	if readErr != nil || closeErr != nil || len(raw) > 8192 {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	if _, err := event.Decode(raw); err != nil {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	var manifest BackupManifest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	timestamp, err := time.Parse(time.RFC3339Nano, manifest.CreatedAt)
	digest, hashErr := hex.DecodeString(manifest.SHA256)
	if err != nil || !backupTime(timestamp) || hashErr != nil || len(digest) != sha256.Size || strings.ToLower(manifest.SHA256) != manifest.SHA256 || manifest.Version != 1 || manifest.File != filepath.Base(absolute) || manifest.SizeBytes <= 0 {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	input, err := backupRegular(absolute)
	if err != nil {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	failed := true
	defer func() {
		if failed {
			_ = input.Close()
		}
	}()
	hash, size, err := backupHash(ctx, input)
	if err != nil || hash != manifest.SHA256 || size != manifest.SizeBytes {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	if err := backupIntegrity(ctx, absolute); err != nil {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	if _, err := input.Seek(0, io.SeekStart); err != nil {
		return BackupManifest{}, nil, ErrInvalidBackup
	}
	failed = false
	return manifest, input, nil
}

func backupTime(now time.Time) bool {
	return !now.IsZero() && now.UTC().Year() >= 1 && now.UTC().Year() <= 9999
}

func backupPath(path string) (string, error) {
	if path == "" || path == ":memory:" || strings.HasPrefix(path, "file:") || strings.ContainsAny(path, "?\x00") {
		return "", ErrInvalidBackup
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	// Refuse symlinked parents as well as symlinked files. Parent directories must
	// already exist; maintenance never guesses/create a missing database tree.
	for parent := filepath.Dir(absolute); ; parent = filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", ErrInvalidBackup
		}
		if parent == filepath.Dir(parent) {
			break
		}
	}
	return absolute, nil
}

func backupRegular(path string) (*os.File, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, ErrInvalidBackup
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	actual, err := file.Stat()
	if err != nil || !actual.Mode().IsRegular() || !os.SameFile(info, actual) {
		_ = file.Close()
		return nil, ErrInvalidBackup
	}
	return file, nil
}

func backupAbsent(path string, manifest bool) error {
	suffixes := []string{"", "-wal", "-shm", "-journal"}
	if manifest {
		suffixes = append(suffixes, ".manifest.json")
	}
	for _, suffix := range suffixes {
		if _, err := os.Lstat(path + suffix); !errors.Is(err, os.ErrNotExist) {
			return ErrInvalidBackup
		}
	}
	return nil
}

func backupDB(path string, readonly bool) (*sql.DB, error) {
	uri := &url.URL{Scheme: "file", Path: path}
	params := url.Values{}
	params.Set("mode", "rw")
	params.Add("_pragma", "busy_timeout(1000)")
	params.Add("_pragma", "synchronous(FULL)")
	if readonly {
		params.Set("mode", "ro")
		params.Set("immutable", "1")
	}
	uri.RawQuery = params.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, nil
}

func backupIntegrity(ctx context.Context, path string) error {
	db, err := backupDB(path, true)
	if err != nil {
		return err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, "PRAGMA integrity_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var result string
		if err := rows.Scan(&result); err != nil {
			return err
		}
		if result != "ok" {
			return ErrInvalidBackup
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if count != 1 {
		return ErrInvalidBackup
	}
	if err := rows.Close(); err != nil {
		return err
	}
	return backupSchema(ctx, db)
}

// Maintenance only accepts an existing SignalHub application database. A valid
// but unrelated SQLite file must never be implicitly initialized by a typo.
func backupSchema(ctx context.Context, db *sql.DB) error {
	var version int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil || version < 1 {
		return ErrInvalidBackup
	}
	rows, err := db.QueryContext(ctx, "SELECT seq,source,id,content_hash,raw_json FROM events LIMIT 0")
	if err != nil {
		return ErrInvalidBackup
	}
	return rows.Close()
}

func backupHash(ctx context.Context, file *os.File) (string, int64, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", 0, err
	}
	hash := sha256.New()
	size, err := io.Copy(hash, backupContextReader{ctx: ctx, reader: file})
	return fmt.Sprintf("%x", hash.Sum(nil)), size, err
}

type backupContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r backupContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
func backupSyncDir(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
