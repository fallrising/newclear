package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var backupNow = time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)

func TestBackupRestorePreservesStateAndNoClobber(t *testing.T) {
	s, path := newStore(t)
	seq := put(t, s, parsed(t, "backup-event", "2026-10-01T12:00:00Z", nil))
	if _, err := s.db.Exec(`INSERT INTO audit_log(at,actor,action,target,reason) VALUES('2026-10-01T12:00:00Z','owner','delivery.replay','synthetic','before snapshot'); UPDATE sqlite_sequence SET seq=1000 WHERE name='events'`); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "snapshot.sqlite")
	manifest, err := s.Backup(t.Context(), output, backupNow)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(original)
	if manifest.SizeBytes != int64(len(original)) || manifest.SHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("manifest %+v", manifest)
	}
	if info, err := os.Stat(output); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("mode %v %v", info, err)
	}
	verified, err := VerifyBackup(t.Context(), output)
	if err != nil || verified != manifest {
		t.Fatalf("verify %+v %v", verified, err)
	}
	if _, err := s.Backup(t.Context(), output, backupNow); err == nil {
		t.Fatal("overwrote backup")
	}
	if _, err := s.Backup(t.Context(), path, backupNow); err == nil {
		t.Fatal("overwrote source")
	}
	restored := filepath.Join(t.TempDir(), "restored.sqlite")
	if _, err := RestoreBackup(t.Context(), output, restored, "synthetic isolated drill", backupNow); err != nil {
		t.Fatal(err)
	}
	isolated, err := OpenExisting(restored)
	if err != nil {
		t.Fatal(err)
	}
	defer isolated.Close()
	if _, err := isolated.Detail(t.Context(), seq); err != nil {
		t.Fatal(err)
	}
	var audit, actor, reason, target string
	if err := isolated.db.QueryRow(`SELECT action,actor,reason,target FROM audit_log ORDER BY seq DESC LIMIT 1`).Scan(&audit, &actor, &reason, &target); err != nil {
		t.Fatal(err)
	}
	if audit != "backup.restore" || actor != "owner" || reason != "synthetic isolated drill" || target != manifest.SHA256 {
		t.Fatalf("audit %q %q %q %q", audit, actor, reason, target)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM audit_log").Scan(&count); err != nil || count != 1 {
		t.Fatalf("source audit %d %v", count, err)
	}
	next := put(t, isolated, parsed(t, "new-isolated-event", "2026-10-13T12:00:00Z", nil))
	if next != 1001 {
		t.Fatalf("lost sqlite highwater: %d", next)
	}
	if _, err := RestoreBackup(t.Context(), output, restored, "repeat", backupNow); err == nil {
		t.Fatal("clobbered running isolated database")
	}
	if _, err := RestoreBackup(t.Context(), output, output, "self", backupNow); err == nil {
		t.Fatal("clobbered snapshot")
	}
	after, _ := os.ReadFile(output)
	if !bytes.Equal(original, after) {
		t.Fatal("snapshot modified")
	}
	if _, err := VerifyBackup(t.Context(), output); err != nil {
		t.Fatal(err)
	}
}

func TestBackupConsistentDuringWALWrites(t *testing.T) {
	s, path := newStore(t)
	if _, err := s.db.Exec(`CREATE TABLE backup_probe(id INTEGER PRIMARY KEY,value INTEGER NOT NULL); INSERT INTO backup_probe VALUES(1,0),(2,0)`); err != nil {
		t.Fatal(err)
	}
	writer, err := OpenExisting(path)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	started := make(chan struct{})
	stop := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		for i := 1; i <= 1000; i++ {
			select {
			case <-stop:
				done <- nil
				return
			default:
			}
			tx, err := writer.db.BeginTx(t.Context(), nil)
			if err != nil {
				done <- err
				return
			}
			if _, err = tx.ExecContext(t.Context(), "UPDATE backup_probe SET value=? WHERE id=1", i); err == nil {
				_, err = tx.ExecContext(t.Context(), "UPDATE backup_probe SET value=? WHERE id=2", i)
			}
			if err != nil {
				_ = tx.Rollback()
				done <- err
				return
			}
			if err = tx.Commit(); err != nil {
				done <- err
				return
			}
			if i == 1 {
				close(started)
			}
		}
		done <- nil
	}()
	select {
	case <-started:
	case err := <-done:
		t.Fatalf("writer stopped: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("writer did not start")
	}
	snapshot := filepath.Join(t.TempDir(), "concurrent.sqlite")
	_, backupErr := s.Backup(t.Context(), snapshot, backupNow)
	close(stop)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if backupErr != nil {
		t.Fatal(backupErr)
	}
	readonly, err := backupDB(snapshot, true)
	if err != nil {
		t.Fatal(err)
	}
	defer readonly.Close()
	var low, high int
	if err := readonly.QueryRow("SELECT MIN(value),MAX(value) FROM backup_probe").Scan(&low, &high); err != nil {
		t.Fatal(err)
	}
	if low != high || low < 1 {
		t.Fatalf("torn snapshot %d %d", low, high)
	}
	var mode string
	if err := s.db.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		t.Fatalf("source mode %q %v", mode, err)
	}
}

func TestBackupRestoreFailsClosed(t *testing.T) {
	cases := []struct {
		name      string
		breakPair func(t *testing.T, path string)
	}{
		{"missing_manifest", func(t *testing.T, path string) {
			if err := os.Remove(path + ".manifest.json"); err != nil {
				t.Fatal(err)
			}
		}},
		{"hash_mismatch", func(t *testing.T, path string) {
			file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
			if err != nil {
				t.Fatal(err)
			}
			_, err = file.Write([]byte("corruption"))
			_ = file.Close()
			if err != nil {
				t.Fatal(err)
			}
		}},
		{"forged_corrupt_sqlite", func(t *testing.T, path string) {
			raw := []byte("not a SQLite database")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			backupRewriteManifest(t, path, func(m *BackupManifest) {
				sum := sha256.Sum256(raw)
				m.SHA256 = hex.EncodeToString(sum[:])
				m.SizeBytes = int64(len(raw))
			})
		}},
		{"wrong_name", func(t *testing.T, path string) {
			backupRewriteManifest(t, path, func(m *BackupManifest) { m.File = "other.sqlite" })
		}},
		{"stale_wal", func(t *testing.T, path string) {
			if err := os.WriteFile(path+"-wal", []byte("stale"), 0600); err != nil {
				t.Fatal(err)
			}
		}},
		{"duplicate_manifest_key", func(t *testing.T, path string) {
			raw, err := os.ReadFile(path + ".manifest.json")
			if err != nil {
				t.Fatal(err)
			}
			raw = bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1)
			if err := os.WriteFile(path+".manifest.json", raw, 0600); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newStore(t)
			snapshot := filepath.Join(t.TempDir(), "snapshot.sqlite")
			if _, err := s.Backup(t.Context(), snapshot, backupNow); err != nil {
				t.Fatal(err)
			}
			tc.breakPair(t, snapshot)
			if _, err := VerifyBackup(t.Context(), snapshot); err == nil {
				t.Fatal("invalid pair verified")
			}
			destination := filepath.Join(t.TempDir(), "isolated.sqlite")
			if _, err := RestoreBackup(t.Context(), snapshot, destination, "drill", backupNow); err == nil {
				t.Fatal("invalid pair restored")
			}
			if _, err := os.Lstat(destination); !os.IsNotExist(err) {
				t.Fatalf("failed restore published destination %v", err)
			}
		})
	}
}

func backupRewriteManifest(t *testing.T, path string, change func(*BackupManifest)) {
	t.Helper()
	raw, err := os.ReadFile(path + ".manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest BackupManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	change(&manifest)
	raw, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".manifest.json", raw, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreAuditFailureAndDestinationSidecars(t *testing.T) {
	s, _ := newStore(t)
	if _, err := s.db.Exec(`CREATE TRIGGER deny_restore BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(t.TempDir(), "snapshot.sqlite")
	if _, err := s.Backup(t.Context(), snapshot, backupNow); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "restored.sqlite")
	if _, err := RestoreBackup(t.Context(), snapshot, destination, "drill", backupNow); err == nil {
		t.Fatal("restore ignored audit failure")
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("unaudited destination %v", err)
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		t.Run(suffix, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "restored.sqlite")
			if err := os.WriteFile(path+suffix, []byte("preserve"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := RestoreBackup(t.Context(), snapshot, path, "drill", backupNow); err == nil {
				t.Fatal("accepted sidecar")
			}
			raw, _ := os.ReadFile(path + suffix)
			if string(raw) != "preserve" {
				t.Fatal("sidecar changed")
			}
		})
	}
}

func TestBackupExistingPathsCancellationAndSymlinks(t *testing.T) {
	s, path := newStore(t)
	missing := filepath.Join(t.TempDir(), "missing.sqlite")
	if db, err := OpenExisting(missing); err == nil {
		_ = db.Close()
		t.Fatal("created missing db")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("missing db path created")
	}
	snapshot := filepath.Join(t.TempDir(), "snapshot.sqlite")
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := s.Backup(canceled, snapshot, backupNow); err == nil {
		t.Fatal("canceled backup succeeded")
	}
	if _, err := os.Stat(snapshot); !os.IsNotExist(err) {
		t.Fatal("canceled backup published")
	}
	if err := os.WriteFile(snapshot+".manifest.json", []byte("orphan metadata"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Backup(t.Context(), snapshot, backupNow); err == nil {
		t.Fatal("replaced manifest")
	}
	raw, _ := os.ReadFile(snapshot + ".manifest.json")
	if string(raw) != "orphan metadata" {
		t.Fatal("manifest changed")
	}
	link := filepath.Join(t.TempDir(), "link.sqlite")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if db, err := OpenExisting(link); err == nil {
		_ = db.Close()
		t.Fatal("accepted DB symlink")
	}
	if _, err := s.Backup(t.Context(), link, backupNow); err == nil {
		t.Fatal("accepted output symlink")
	}
	parent := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(filepath.Dir(path), parent); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Backup(t.Context(), filepath.Join(parent, "new.sqlite"), backupNow); err == nil {
		t.Fatal("accepted parent symlink")
	}
	for _, bad := range []string{"", ":memory:", "file:example.sqlite", "example.sqlite?mode=rw"} {
		if db, err := OpenExisting(bad); err == nil {
			_ = db.Close()
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestRestoreReasonRequired(t *testing.T) {
	for _, reason := range []string{"", " \n ", strings.Repeat("x", 4097), string([]byte{0xff})} {
		if _, err := RestoreBackup(t.Context(), "absent", "new", reason, backupNow); err == nil {
			t.Fatalf("accepted %q", reason)
		}
	}
}

func TestBackupRejectsUnrelatedSQLiteWithoutMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unrelated.sqlite")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	db, err := backupDB(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES('preserve'); PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if opened, err := OpenExisting(path); err == nil {
		_ = opened.Close()
		t.Fatal("accepted unrelated SQLite")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("maintenance mutated unrelated SQLite")
	}
	digest := sha256.Sum256(before)
	manifest := BackupManifest{Version: 1, File: filepath.Base(path), SizeBytes: int64(len(before)), SHA256: hex.EncodeToString(digest[:]), CreatedAt: backupNow.Format(time.RFC3339Nano)}
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(path+".manifest.json", raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyBackup(t.Context(), path); err == nil {
		t.Fatal("verified unrelated SQLite")
	}
}
