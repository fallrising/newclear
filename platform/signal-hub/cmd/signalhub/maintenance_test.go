package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

func TestMaintenanceLoopIndependentFailureAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ticks := make(chan time.Time)
	archiveRuns, backupRuns := 0, 0
	var output bytes.Buffer
	archive := func(ctx context.Context) error {
		archiveRuns++
		return errors.New("synthetic secret path must be hidden")
	}
	backup := func(ctx context.Context) error {
		backupRuns++
		if backupRuns == 2 {
			cancel()
		}
		return nil
	}
	done := make(chan struct{})
	go func() { defer close(done); maintenanceLoop(ctx, ticks, archive, backup, &output) }()
	select {
	case ticks <- time.Now():
	case <-time.After(5 * time.Second):
		t.Fatal("startup operations did not finish")
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("maintenance ignored cancellation")
	}
	if archiveRuns != 2 || backupRuns != 2 {
		t.Fatalf("operations %d/%d", archiveRuns, backupRuns)
	}
	if strings.Contains(output.String(), "secret") || strings.Count(output.String(), "archive maintenance failed") != 2 {
		t.Fatalf("unsafe or missing summary %q", output.String())
	}
}

func TestMaintenanceLoopCancelsInProgressOperation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	started := make(chan struct{})
	done := make(chan struct{})
	backupCalled := false
	archive := func(ctx context.Context) error { close(started); <-ctx.Done(); return ctx.Err() }
	go func() {
		defer close(done)
		maintenanceLoop(ctx, make(chan time.Time), archive, func(context.Context) error { backupCalled = true; return nil }, &bytes.Buffer{})
	}()
	<-started
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("operation context not canceled")
	}
	if backupCalled {
		t.Fatal("started backup after cancellation")
	}
}

func TestRuntimeBackupDistinctAndOptIn(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "source.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if op := runtimeBackup(db, "", time.Now); op != nil {
		t.Fatal("backup enabled without explicit directory")
	}
	directory := filepath.Join(t.TempDir(), "backups")
	fixed := func() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC) }
	operation := runtimeBackup(db, directory, fixed)
	for range 2 {
		if err := operation(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	files, err := filepath.Glob(filepath.Join(directory, "*.sqlite"))
	if err != nil || len(files) != 2 {
		t.Fatalf("distinct snapshots %v %v", files, err)
	}
	for _, path := range files {
		if _, err := store.VerifyBackup(t.Context(), path); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMaintenanceCLIValidationDoesNotCreateDatabase(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing.sqlite")
	tests := [][]string{
		{"backup"},
		{"archive"},
		{"archive", "unknown"},
		{"archive", "run", "--db", missing, "--archive-dir", filepath.Join(dir, "archive")},
		{"archive", "verify", "--db", missing, "--archive-dir", dir, "--day", "2026-99-01"},
		{"archive", "import", "--db", missing, "--archive-dir", dir, "--day", "2026-01-01", "--reason", " "},
		{"archive", "import", "--db", missing, "--archive-dir", dir, "--day", "2026-01-01", "--reason", "drill", "--retention-days", "0"},
		{"backup", "--db", missing, "--output", filepath.Join(dir, "out.sqlite")},
		{"backup", "--db", missing, "--output", filepath.Join(dir, "out.sqlite"), "extra"},
		{"backup", "--unsafe", "private-sensitive-value"},
		{"restore", "--backup", missing, "--db", filepath.Join(dir, "new.sqlite"), "--reason", " "},
		{"restore", "--backup", missing, "--db", filepath.Join(dir, "new.sqlite"), "--reason", "drill"},
	}
	for _, args := range tests {
		var output bytes.Buffer
		err := run(t.Context(), args, &output)
		if err == nil {
			t.Fatalf("accepted %v", args)
		}
		if strings.Contains(output.String()+err.Error(), dir) || strings.Contains(output.String()+err.Error(), "private-sensitive-value") {
			t.Fatalf("leaked command value %q %v", output.String(), err)
		}
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatalf("invalid command created files %v %v", files, err)
	}
	for _, args := range [][]string{{"backup", "-help"}, {"restore", "-help"}} {
		var output bytes.Buffer
		if err := run(t.Context(), args, &output); err != nil || output.Len() == 0 {
			t.Fatalf("help %q %v", output.String(), err)
		}
	}
}

func TestMaintenanceDirectoryNestedAndSymlink(t *testing.T) {
	base := t.TempDir()
	nested := filepath.Join(base, "new", "nested")
	if err := maintenanceDirectory(nested); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Dir(nested), nested} {
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
			t.Fatalf("directory %v %v", info, err)
		}
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(nested, link); err != nil {
		t.Fatal(err)
	}
	if err := maintenanceDirectory(filepath.Join(link, "must-not-exist")); err == nil {
		t.Fatal("created through symlink ancestor")
	}
	if _, err := os.Stat(filepath.Join(nested, "must-not-exist")); !os.IsNotExist(err) {
		t.Fatalf("symlink target changed %v", err)
	}
}
