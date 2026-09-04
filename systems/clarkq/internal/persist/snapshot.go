package persist

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fallrising/newclear/systems/clarkq/internal/queue"
)

const snapshotVersion = 1

// SnapshotFile is the on-disk JSON schema for queue durability.
type SnapshotFile struct {
	Version int                         `json:"version"`
	SavedAt time.Time                   `json:"saved_at"`
	Queues  map[string][]queue.Message  `json:"queues"`
}

// Store periodically and on demand writes queue snapshots to disk.
type Store struct {
	path     string
	interval time.Duration
	manager  *queue.Manager

	mu       sync.Mutex
	stopCh   chan struct{}
	doneCh   chan struct{}
	running  bool
}

// NewStore creates a snapshot store. path must be non-empty.
// interval <= 0 disables background saves (manual/shutdown saves still work).
func NewStore(path string, interval time.Duration, manager *queue.Manager) *Store {
	return &Store{
		path:     path,
		interval: interval,
		manager:  manager,
	}
}

// Enabled reports whether snapshot persistence is configured.
func Enabled(path string) bool {
	return path != ""
}

// Load restores queues from the snapshot file if it exists.
// Missing file is not an error (fresh start).
func (s *Store) Load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read snapshot: %w", err)
	}

	var snap SnapshotFile
	if err := json.Unmarshal(data, &snap); err != nil {
		return fmt.Errorf("parse snapshot: %w", err)
	}
	if snap.Version != 0 && snap.Version != snapshotVersion {
		return fmt.Errorf("unsupported snapshot version %d", snap.Version)
	}
	if snap.Queues == nil {
		snap.Queues = map[string][]queue.Message{}
	}

	if err := s.manager.ImportSnapshot(snap.Queues); err != nil {
		return fmt.Errorf("import snapshot: %w", err)
	}

	stats := s.manager.Stats()
	slog.Info("snapshot loaded",
		"path", s.path,
		"queues", stats.Queues,
		"messages", stats.Messages,
		"saved_at", snap.SavedAt,
	)
	return nil
}

// Save writes the current queue state atomically (temp file + rename).
func (s *Store) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked()
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}

	snap := SnapshotFile{
		Version: snapshotVersion,
		SavedAt: time.Now().UTC(),
		Queues:  s.manager.ExportSnapshot(),
	}

	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("encode snapshot: %w", err)
	}

	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create snapshot dir: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".clarkq-snapshot-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp snapshot: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write snapshot: %w", err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod snapshot: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync snapshot: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close snapshot: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("rename snapshot: %w", err)
	}
	cleanup = false
	return nil
}

// Start begins periodic background saves when interval > 0.
func (s *Store) Start() {
	if s.interval <= 0 {
		return
	}
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.stopCh = make(chan struct{})
	s.doneCh = make(chan struct{})
	s.running = true
	s.mu.Unlock()

	go s.loop()
}

func (s *Store) loop() {
	defer close(s.doneCh)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := s.Save(); err != nil {
				slog.Error("periodic snapshot failed", "error", err, "path", s.path)
			}
		case <-s.stopCh:
			return
		}
	}
}

// Stop ends the background loop and writes a final snapshot.
func (s *Store) Stop() error {
	s.mu.Lock()
	if s.running {
		close(s.stopCh)
		s.running = false
		done := s.doneCh
		s.mu.Unlock()
		<-done
	} else {
		s.mu.Unlock()
	}
	return s.Save()
}
