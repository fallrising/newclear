package persist

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fallrising/clarkQ/internal/queue"
)

const (
	opEnqueue = "enqueue"
	opDequeue = "dequeue"
	opClear   = "clear"
)

// WALRecord is one append-only journal entry (NDJSON line).
type WALRecord struct {
	Op        string         `json:"op"`
	Queue     string         `json:"queue"`
	Message   *queue.Message `json:"message,omitempty"`
	MessageID string         `json:"message_id,omitempty"`
	TS        time.Time      `json:"ts"`
}

// WAL is a durable append-only operation log.
type WAL struct {
	path string

	mu   sync.Mutex
	file *os.File
}

func NewWAL(path string) *WAL {
	return &WAL{path: path}
}

func (w *WAL) Path() string { return w.path }

// Open creates/opens the WAL file for append.
func (w *WAL) Open() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(w.path), 0o755); err != nil {
		return fmt.Errorf("create wal dir: %w", err)
	}
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return fmt.Errorf("open wal: %w", err)
	}
	w.file = f
	return nil
}

// Close closes the underlying file handle.
func (w *WAL) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}

// Append writes one record and fsyncs for crash safety.
func (w *WAL) Append(rec WALRecord) error {
	if rec.TS.IsZero() {
		rec.TS = time.Now().UTC()
	}
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	data = append(data, '\n')

	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return fmt.Errorf("wal not open")
	}
	if _, err := w.file.Write(data); err != nil {
		return fmt.Errorf("write wal: %w", err)
	}
	if err := w.file.Sync(); err != nil {
		return fmt.Errorf("sync wal: %w", err)
	}
	return nil
}

// Replay applies all readable records via apply. Truncated last line is ignored.
func (w *WAL) Replay(apply func(WALRecord) error) (int, error) {
	f, err := os.Open(w.path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	defer f.Close()

	reader := bufio.NewReader(f)
	count := 0
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			// Strip trailing newline if present.
			payload := line
			if payload[len(payload)-1] == '\n' {
				payload = payload[:len(payload)-1]
			}
			if len(payload) == 0 {
				// empty line
			} else {
				var rec WALRecord
				if uerr := json.Unmarshal(payload, &rec); uerr != nil {
					// Incomplete trailing line after crash: stop without failing.
					if err == io.EOF || err == nil {
						break
					}
					return count, fmt.Errorf("parse wal record: %w", uerr)
				}
				if aerr := apply(rec); aerr != nil {
					return count, aerr
				}
				count++
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, err
		}
	}
	return count, nil
}

// Truncate clears the WAL after a successful snapshot compaction.
func (w *WAL) Truncate() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		if err := w.file.Close(); err != nil {
			return err
		}
		w.file = nil
	}
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("truncate wal: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	// Re-open in append mode for subsequent records.
	_ = f.Close()
	f, err = os.OpenFile(w.path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	w.file = f
	return nil
}
