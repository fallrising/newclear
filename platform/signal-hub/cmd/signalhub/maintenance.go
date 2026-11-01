package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

// synchronizedOutput serializes runtime workers' status messages, including
// deterministic test writers which are not necessarily concurrency-safe.
type synchronizedOutput struct {
	mu     sync.Mutex
	writer io.Writer
}

func (w *synchronizedOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.writer.Write(p)
}

func maintenanceCommand(ctx context.Context, args []string, output io.Writer, now time.Time) (bool, error) {
	if len(args) == 0 {
		return false, nil
	}
	switch args[0] {
	case "backup":
		return true, backupCommand(ctx, args[1:], output, now)
	case "restore":
		return true, restoreCommand(ctx, args[1:], output, now)
	case "archive":
		return true, archiveCommand(ctx, args[1:], output, now)
	}
	return false, nil
}

func maintenanceFlags(name string) *flag.FlagSet {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	// Do not echo caller-controlled paths/reasons on parse errors.
	flags.SetOutput(io.Discard)
	return flags
}

func backupCommand(ctx context.Context, args []string, output io.Writer, now time.Time) error {
	flags := maintenanceFlags("signalhub backup")
	dbPath := flags.String("db", "", "existing SQLite database")
	destination := flags.String("output", "", "new SQLite snapshot file")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			_, err = fmt.Fprintln(output, "signalhub backup --db EXISTING.sqlite --output NEW.sqlite")
			return err
		}
		return errors.New("invalid backup options")
	}
	if flags.NArg() != 0 || *dbPath == "" || *destination == "" {
		return errors.New("backup requires db and output")
	}
	db, err := store.OpenExisting(*dbPath)
	if err != nil {
		return errors.New("existing database could not be opened")
	}
	defer db.Close()
	result, err := db.Backup(ctx, *destination, now)
	if err != nil {
		return errors.New("backup failed; destination must be new and writable")
	}
	return json.NewEncoder(output).Encode(result)
}

func restoreCommand(ctx context.Context, args []string, output io.Writer, now time.Time) error {
	flags := maintenanceFlags("signalhub restore")
	snapshot := flags.String("backup", "", "verified SQLite snapshot")
	dbPath := flags.String("db", "", "new isolated database")
	reason := flags.String("reason", "", "audit reason (required)")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			_, err = fmt.Fprintln(output, "signalhub restore --backup SNAPSHOT.sqlite --db NEW.sqlite --reason TEXT")
			return err
		}
		return errors.New("invalid restore options")
	}
	if flags.NArg() != 0 || *snapshot == "" || *dbPath == "" || !maintenanceReason(*reason) {
		return errors.New("restore requires backup, new db and nonblank reason (at most 4096 bytes)")
	}
	result, err := store.RestoreBackup(ctx, *snapshot, *dbPath, *reason, now)
	if err != nil {
		return errors.New("restore failed; verify backup pair and new isolated destination")
	}
	return json.NewEncoder(output).Encode(result)
}

func maintenanceReason(reason string) bool {
	return strings.TrimSpace(reason) != "" && len(reason) <= 4096 && utf8.ValidString(reason)
}

type maintenanceOperation func(context.Context) error

// maintenanceLoop starts immediately and then receives daily ticks. A failure
// does not suppress the other operation, and shutdown never starts another.
func maintenanceLoop(ctx context.Context, ticks <-chan time.Time, archive, backup maintenanceOperation, output io.Writer) {
	for {
		if ctx.Err() != nil {
			return
		}
		if archive != nil {
			if err := archive(ctx); err != nil && ctx.Err() == nil {
				fmt.Fprintln(output, "signalhub: archive maintenance failed; retrying next day")
			}
		}
		if ctx.Err() != nil {
			return
		}
		if backup != nil {
			if err := backup(ctx); err != nil && ctx.Err() == nil {
				fmt.Fprintln(output, "signalhub: backup maintenance failed; retrying next day")
			}
		}
		select {
		case <-ctx.Done():
			return
		case _, ok := <-ticks:
			if !ok {
				return
			}
		}
	}
}

func runtimeBackup(db *store.Store, directory string, now func() time.Time) maintenanceOperation {
	if directory == "" {
		return nil
	}
	return func(ctx context.Context) error {
		if err := maintenanceDirectory(directory); err != nil {
			return err
		}
		var random [8]byte
		if _, err := rand.Read(random[:]); err != nil {
			return err
		}
		at := now().UTC()
		filename := "signalhub-" + at.Format("20060102T150405.000000000Z") + "-" + hex.EncodeToString(random[:]) + ".sqlite"
		_, err := db.Backup(ctx, filepath.Join(directory, filename), at)
		return err
	}
}

// archiveCommand is the local-only adapter for the store's frozen M5 contract.
func archiveCommand(ctx context.Context, args []string, output io.Writer, now time.Time) error {
	if len(args) == 0 {
		return errors.New("archive requires run, verify or import")
	}
	action := args[0]
	if action != "run" && action != "verify" && action != "import" {
		return errors.New("archive requires run, verify or import")
	}
	flags := maintenanceFlags("signalhub archive " + action)
	dbPath := flags.String("db", "", "existing SQLite database")
	directory := flags.String("archive-dir", "", "archive directory")
	day, reason := "", ""
	retention := 7
	if action != "run" {
		flags.StringVar(&day, "day", "", "UTC date YYYY-MM-DD")
	}
	if action == "import" {
		flags.StringVar(&reason, "reason", "", "audit reason")
		flags.IntVar(&retention, "retention-days", 7, "restored hot retention in days")
	}
	if err := flags.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			_, err = fmt.Fprintln(output, "signalhub archive "+action+" --db EXISTING.sqlite --archive-dir DIR"+map[string]string{"run": "", "verify": " --day YYYY-MM-DD", "import": " --day YYYY-MM-DD --reason TEXT [--retention-days 7]"}[action])
			return err
		}
		return errors.New("invalid archive options")
	}
	if flags.NArg() != 0 || *dbPath == "" || *directory == "" {
		return errors.New("archive requires db and archive-dir")
	}
	if action != "run" {
		parsed, err := time.Parse("2006-01-02", day)
		if err != nil || parsed.Format("2006-01-02") != day {
			return errors.New("archive day must be YYYY-MM-DD")
		}
	}
	if action == "import" && (!maintenanceReason(reason) || retention <= 0) {
		return errors.New("archive import requires nonblank reason (at most 4096 bytes) and positive retention-days")
	}
	db, err := store.OpenExisting(*dbPath)
	if err != nil {
		return errors.New("existing database could not be opened")
	}
	defer db.Close()
	switch action {
	case "run":
		result, err := db.Archive(ctx, store.ArchiveOptions{Directory: *directory, Now: now})
		if err != nil {
			return errors.New("archive failed; hot events were retained for the failed part")
		}
		return json.NewEncoder(output).Encode(struct {
			Parts  []store.ArchiveManifest `json:"parts"`
			Events int64                   `json:"events"`
		}{result.Parts, result.Events})
	case "verify":
		parts, err := db.VerifyArchives(ctx, *directory, day)
		if err != nil {
			return errors.New("archive verification failed")
		}
		return json.NewEncoder(output).Encode(struct {
			Parts []store.ArchiveManifest `json:"parts"`
		}{parts})
	case "import":
		result, err := db.ImportArchives(ctx, *directory, day, reason, now, retention)
		if err != nil {
			return errors.New("archive import failed; verify archive files and database identities")
		}
		return json.NewEncoder(output).Encode(struct {
			Imported   int64 `json:"imported"`
			Duplicates int64 `json:"duplicates"`
		}{result.Imported, result.Duplicates})
	}
	return errors.New("invalid archive command")
}

func runtimeArchive(db *store.Store, directory string, now func() time.Time) maintenanceOperation {
	if directory == "" {
		return nil
	}
	return func(ctx context.Context) error {
		_, err := db.Archive(ctx, store.ArchiveOptions{Directory: directory, Now: now().UTC()})
		return err
	}
}

// Persist new directory entries before declaring their snapshots durable. Never
// create through a symlink ancestor, including when only a child was missing.
func maintenanceDirectory(path string) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	var missing []string
	for current := absolute; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			missing = append(missing, current)
		} else if err != nil {
			return err
		} else if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("maintenance directory must not contain symlinks")
		}
		if current == filepath.Dir(current) {
			break
		}
	}
	for i := len(missing) - 1; i >= 0; i-- {
		directory := missing[i]
		if err := os.Mkdir(directory, 0700); err != nil {
			if !errors.Is(err, os.ErrExist) {
				return err
			}
			info, err := os.Lstat(directory)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return errors.New("maintenance directory changed")
			}
		}
		for _, syncPath := range []string{directory, filepath.Dir(directory)} {
			file, err := os.Open(syncPath)
			if err != nil {
				return err
			}
			syncErr := file.Sync()
			closeErr := file.Close()
			if syncErr != nil {
				return syncErr
			}
			if closeErr != nil {
				return closeErr
			}
		}
	}
	return nil
}
