package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupCLIAndIsolatedRestore(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.sqlite")
	db, err := store.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(dir, "snapshot.sqlite")
	var output bytes.Buffer
	if err := run(t.Context(), []string{"backup", "--db", source, "--output", snapshot}, &output); err != nil {
		t.Fatalf("backup command failed: %v", err)
	}
	var result map[string]any
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatalf("backup result not JSON: %q %v", output.String(), err)
	}
	if result["version"] != float64(1) || result["file"] != "snapshot.sqlite" || len(result["sha256"].(string)) != 64 {
		t.Fatalf("manifest = %#v", result)
	}
	output.Reset()
	destination := filepath.Join(dir, "restored.sqlite")
	if err := run(t.Context(), []string{"restore", "--backup", snapshot, "--db", destination, "--reason", "synthetic drill"}, &output); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(destination); err != nil {
		t.Fatal(err)
	}
	if err := run(t.Context(), []string{"restore", "--backup", snapshot, "--db", destination, "--reason", "repeat"}, &output); err == nil {
		t.Fatal("restore clobbered existing database")
	}
}

func TestArchiveCLIRoundTrip(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.sqlite")
	db, err := store.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := event.Parse([]byte(`{"specversion":"1.0","source":"urn:test:archive-cli","id":"old","type":"test.event","time":"2026-01-02T12:00:00Z"}`))
	if err != nil {
		t.Fatal(err)
	}
	stored, err := db.Ingest(t.Context(), parsed, time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(dir, "archive")
	var output bytes.Buffer
	if err := run(t.Context(), []string{"archive", "run", "--db", source, "--archive-dir", archive}, &output); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Events int64             `json:"events"`
		Parts  []json.RawMessage `json:"parts"`
	}
	if err := json.Unmarshal(output.Bytes(), &result); err != nil || result.Events != 1 || len(result.Parts) != 1 {
		t.Fatalf("run result %s %v", output.String(), err)
	}
	db, err = store.OpenExisting(source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Detail(t.Context(), stored.Seq); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("archive retained detail %v", err)
	}
	_ = db.Close()
	output.Reset()
	if err := run(t.Context(), []string{"archive", "verify", "--db", source, "--archive-dir", archive, "--day", "2026-01-02"}, &output); err != nil {
		t.Fatal(err)
	}
	for _, want := range []int64{1, 0} {
		output.Reset()
		if err := run(t.Context(), []string{"archive", "import", "--db", source, "--archive-dir", archive, "--day", "2026-01-02", "--reason", "synthetic CLI drill"}, &output); err != nil {
			t.Fatal(err)
		}
		var imported struct {
			Imported int64 `json:"imported"`
		}
		if err := json.Unmarshal(output.Bytes(), &imported); err != nil || imported.Imported != want {
			t.Fatalf("import %s %v", output.String(), err)
		}
	}
	db, err = store.OpenExisting(source)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	detail, err := db.Detail(t.Context(), stored.Seq)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(detail.Item)
	if err != nil {
		t.Fatal(err)
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil || item["restored"] != true {
		t.Fatalf("restored item %s %v", raw, err)
	}
}
