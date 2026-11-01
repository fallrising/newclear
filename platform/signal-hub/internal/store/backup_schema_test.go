package store

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenExistingRejectsCounterfeitWithoutMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "counterfeit.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE events(seq INTEGER,source TEXT,id TEXT,content_hash BLOB,raw_json BLOB); PRAGMA user_version=5;"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	opened, openErr := OpenExisting(path)
	if opened != nil {
		_ = opened.Close()
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if openErr == nil || !bytes.Equal(before, after) {
		t.Fatalf("counterfeit accepted or modified: accepted=%v bytes_equal=%v", openErr == nil, bytes.Equal(before, after))
	}
	backupSchemaNoSidecars(t, path)
}

func backupSchemaNoSidecars(t *testing.T, path string) {
	t.Helper()
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err := os.Lstat(path + suffix); !os.IsNotExist(err) {
			t.Fatalf("unexpected sidecar %s: %v", suffix, err)
		}
	}
}

func backupSchemaFixture(t *testing.T, version int, mutate string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "schema.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range []string{migration1, migration2, migration3, migration4, migration5}[:version] {
		if _, err := db.Exec(migration); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(fmt.Sprintf("PRAGMA user_version=%d", version)); err != nil {
		t.Fatal(err)
	}
	if mutate != "" {
		if _, err := db.Exec(mutate); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func backupSchemaManifest(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	manifest := BackupManifest{Version: 1, File: filepath.Base(path), SizeBytes: int64(len(raw)), SHA256: hex.EncodeToString(digest[:]), CreatedAt: backupNow.Format("2006-01-02T15:04:05Z07:00")}
	metadata, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".manifest.json", metadata, 0600); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestBackupRestoreRejectsIncompleteAndFutureSchema(t *testing.T) {
	cases := []struct {
		name    string
		version int
		mutate  string
	}{
		{"v1_labeled_v5", 1, "PRAGMA user_version=5"},
		{"complete_v5_labeled_v6", 5, "PRAGMA user_version=6"},
		{"zero_version", 5, "PRAGMA user_version=0"},
		{"missing_delivery_table", 5, "DROP TABLE delivery_attempts"},
		{"missing_archive_index", 5, "DROP INDEX archive_members_event"},
		{"missing_identity_trigger", 5, "DROP TRIGGER events_identity_insert"},
		{"altered_required_table", 5, "ALTER TABLE audit_log ADD COLUMN unwanted TEXT"},
		{"wrong_required_index", 5, "DROP INDEX events_time; CREATE INDEX events_time ON events(id)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := backupSchemaFixture(t, tc.version, tc.mutate)
			before := backupSchemaManifest(t, path)
			opened, openErr := OpenExisting(path)
			if opened != nil {
				_ = opened.Close()
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if openErr == nil || !bytes.Equal(before, after) {
				t.Errorf("invalid source accepted or modified: accepted=%v bytes_equal=%v", openErr == nil, bytes.Equal(before, after))
			}
			backupSchemaNoSidecars(t, path)
			// Rebuild the valid hash after the preceding assertion so snapshot validation
			// is independently tested even when the original implementation mutated it.
			snapshotBefore := backupSchemaManifest(t, path)
			if _, err := VerifyBackup(t.Context(), path); err == nil {
				t.Error("verified unsupported/incomplete application schema")
			}
			destination := filepath.Join(t.TempDir(), "restored.sqlite")
			if _, err := RestoreBackup(t.Context(), path, destination, "synthetic schema rejection", backupNow); err == nil {
				t.Error("restored unsupported/incomplete application schema")
			}
			if _, err := os.Lstat(destination); !os.IsNotExist(err) {
				t.Errorf("invalid restore published destination: %v", err)
			}
			after, err = os.ReadFile(path)
			if err != nil || !bytes.Equal(snapshotBefore, after) {
				t.Errorf("snapshot changed: %v", err)
			}
			backupSchemaNoSidecars(t, path)
		})
	}
}

func TestOpenExistingSupportedVersionsUpgradeBackupRestore(t *testing.T) {
	for version := 1; version <= 5; version++ {
		t.Run(fmt.Sprintf("v%d", version), func(t *testing.T) {
			path := backupSchemaFixture(t, version, "")
			rawDB, err := backupDB(path, false)
			if err != nil {
				t.Fatal(err)
			}
			original := parsed(t, "legacy-event", "2026-01-02T12:00:00Z", nil)
			if _, err := rawDB.Exec(`INSERT INTO events(seq,source,id,type,subject,time,received_at,severity,severity_rank,summary,originurl,correlationid,causationid,content_hash,raw_json,clock_skew) VALUES(1,'urn:test','legacy-event','test.event','',?,'2026-10-13T12:00:00Z','info',1,'','','','',?,?,0)`, func() string {
				key, err := exactTimeKey("2026-01-02T12:00:00Z")
				if err != nil {
					t.Fatal(err)
				}
				return key
			}(), original.ContentHash[:], original.Raw); err != nil {
				t.Fatal(err)
			}
			if _, err := rawDB.Exec("UPDATE sqlite_sequence SET seq=1000 WHERE name='events'"); err != nil {
				t.Fatal(err)
			}
			if err := rawDB.Close(); err != nil {
				t.Fatal(err)
			}
			db, err := OpenExisting(path)
			if err != nil {
				t.Fatalf("genuine v%d not upgraded: %v", version, err)
			}
			defer db.Close()
			var upgraded int
			if err := db.db.QueryRow("PRAGMA user_version").Scan(&upgraded); err != nil || upgraded != 5 {
				t.Fatalf("upgrade %d %v", upgraded, err)
			}
			detail, err := db.Detail(t.Context(), 1)
			if err != nil || !bytes.Equal(detail.Item.Event, original.Raw) {
				t.Fatalf("legacy payload changed %s %v", detail.Item.Event, err)
			}
			snapshot := filepath.Join(t.TempDir(), "snapshot.sqlite")
			if _, err := db.Backup(t.Context(), snapshot, backupNow); err != nil {
				t.Fatal(err)
			}
			isolatedPath := filepath.Join(t.TempDir(), "isolated.sqlite")
			if _, err := RestoreBackup(t.Context(), snapshot, isolatedPath, "supported schema drill", backupNow); err != nil {
				t.Fatal(err)
			}
			isolated, err := OpenExisting(isolatedPath)
			if err != nil {
				t.Fatal(err)
			}
			defer isolated.Close()
			detail, err = isolated.Detail(t.Context(), 1)
			if err != nil || !bytes.Equal(detail.Item.Event, original.Raw) {
				t.Fatalf("restore changed payload %s %v", detail.Item.Event, err)
			}
			next := put(t, isolated, parsed(t, "next", "2026-10-13T12:00:00Z", nil))
			if next != 1001 {
				t.Fatalf("highwater lost: %d", next)
			}
			var audits int
			if err := isolated.db.QueryRow("SELECT count(*) FROM audit_log WHERE action='backup.restore'").Scan(&audits); err != nil || audits != 1 {
				t.Fatalf("audits %d %v", audits, err)
			}
		})
	}
}

func TestOpenExistingReadsCommittedWALSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.sqlite")
	writer, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	writer.SetMaxOpenConns(1)
	writer.SetMaxIdleConns(1)
	if _, err := writer.Exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0"); err != nil {
		t.Fatal(err)
	}
	for _, migration := range []string{migration1, migration2, migration3, migration4, migration5} {
		if _, err := writer.Exec(migration); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := writer.Exec("PRAGMA user_version=5"); err != nil {
		t.Fatal(err)
	}
	immutable, err := backupReadDB(path, true)
	if err != nil {
		t.Fatal(err)
	}
	var mainVersion int
	if err := immutable.QueryRow("PRAGMA user_version").Scan(&mainVersion); err != nil {
		t.Fatal(err)
	}
	if err := immutable.Close(); err != nil {
		t.Fatal(err)
	}
	if mainVersion != 0 {
		t.Fatalf("fixture did not isolate committed schema in WAL: %d", mainVersion)
	}
	opened, err := OpenExisting(path)
	if err != nil {
		t.Fatalf("ignored committed WAL schema: %v", err)
	}
	defer opened.Close()
	var version int
	if err := opened.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 5 {
		t.Fatalf("version %d %v", version, err)
	}
	if _, err := opened.Backup(t.Context(), filepath.Join(t.TempDir(), "snapshot.sqlite"), backupNow); err != nil {
		t.Fatal(err)
	}
}
