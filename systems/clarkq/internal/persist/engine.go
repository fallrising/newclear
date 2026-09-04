package persist

import (
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/fallrising/clarkQ/internal/queue"
)

// Engine combines optional snapshot checkpoints with an append-only WAL.
// Mutations are journaled when a WAL path is configured; periodic compaction
// writes a snapshot and truncates the WAL when a snapshot path is set.
type Engine struct {
	manager  *queue.Manager
	snapshot *Store
	wal      *WAL
	interval time.Duration

	mu      sync.Mutex
	stopCh  chan struct{}
	doneCh  chan struct{}
	running bool
}

// EngineConfig configures durable storage.
type EngineConfig struct {
	SnapshotPath     string
	SnapshotInterval time.Duration
	WALPath          string
}

// NewEngine builds a persistence engine. At least one of snapshot or WAL path
// should be set for durability; both is recommended.
func NewEngine(manager *queue.Manager, cfg EngineConfig) *Engine {
	e := &Engine{
		manager:  manager,
		interval: cfg.SnapshotInterval,
	}
	if cfg.SnapshotPath != "" {
		e.snapshot = NewStore(cfg.SnapshotPath, 0, manager)
	}
	if cfg.WALPath != "" {
		e.wal = NewWAL(cfg.WALPath)
	}
	return e
}

// Enabled reports whether any durable backend is configured.
func EngineEnabled(cfg EngineConfig) bool {
	return cfg.SnapshotPath != "" || cfg.WALPath != ""
}

// Load restores state from snapshot (if any) then replays the WAL.
func (e *Engine) Load() error {
	if e.snapshot != nil {
		if err := e.snapshot.Load(); err != nil {
			return err
		}
	}
	if e.wal != nil {
		if err := e.wal.Open(); err != nil {
			return err
		}
		n, err := e.wal.Replay(e.applyRecord)
		if err != nil {
			return fmt.Errorf("replay wal: %w", err)
		}
		if n > 0 {
			stats := e.manager.Stats()
			slog.Info("wal replayed",
				"path", e.wal.Path(),
				"records", n,
				"queues", stats.Queues,
				"messages", stats.Messages,
			)
		}
	}
	return nil
}

func (e *Engine) applyRecord(rec WALRecord) error {
	switch rec.Op {
	case opEnqueue:
		if rec.Message == nil {
			return fmt.Errorf("wal enqueue missing message")
		}
		if rec.Message.Queue == "" {
			rec.Message.Queue = rec.Queue
		}
		return e.manager.RestoreMessage(*rec.Message)
	case opDequeue:
		msg, err := e.manager.Dequeue(rec.Queue)
		if err != nil {
			// Empty/missing after snapshot is acceptable for partially compacted logs.
			if errors.Is(err, queue.ErrQueueEmpty) || errors.Is(err, queue.ErrQueueNotFound) {
				return nil
			}
			return err
		}
		if rec.MessageID != "" && msg.ID != rec.MessageID {
			// Best-effort: state diverged; keep going after log.
			slog.Warn("wal dequeue id mismatch", "want", rec.MessageID, "got", msg.ID, "queue", rec.Queue)
		}
		return nil
	case opClear:
		_, err := e.manager.Clear(rec.Queue)
		if errors.Is(err, queue.ErrQueueNotFound) {
			return nil
		}
		return err
	default:
		return fmt.Errorf("unknown wal op %q", rec.Op)
	}
}

// RecordEnqueue journals a successful enqueue.
func (e *Engine) RecordEnqueue(msg queue.Message) error {
	if e.wal == nil {
		return nil
	}
	cp := msg
	return e.wal.Append(WALRecord{Op: opEnqueue, Queue: msg.Queue, Message: &cp})
}

// RecordDequeue journals a successful consume.
func (e *Engine) RecordDequeue(queueName, messageID string) error {
	if e.wal == nil {
		return nil
	}
	return e.wal.Append(WALRecord{Op: opDequeue, Queue: queueName, MessageID: messageID})
}

// RecordClear journals a successful clear.
func (e *Engine) RecordClear(queueName string) error {
	if e.wal == nil {
		return nil
	}
	return e.wal.Append(WALRecord{Op: opClear, Queue: queueName})
}

// Compact writes a snapshot (if configured) and truncates the WAL.
func (e *Engine) Compact() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.compactLocked()
}

func (e *Engine) compactLocked() error {
	if e.snapshot != nil {
		if err := e.snapshot.Save(); err != nil {
			return err
		}
	}
	if e.wal != nil {
		if err := e.wal.Truncate(); err != nil {
			return err
		}
	}
	return nil
}

// Start runs periodic compaction when an interval is configured and a snapshot
// path exists (WAL-only mode still journals every mutation).
func (e *Engine) Start() {
	if e.interval <= 0 || e.snapshot == nil {
		return
	}
	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		return
	}
	e.stopCh = make(chan struct{})
	e.doneCh = make(chan struct{})
	e.running = true
	e.mu.Unlock()
	go e.loop()
}

func (e *Engine) loop() {
	defer close(e.doneCh)
	ticker := time.NewTicker(e.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := e.Compact(); err != nil {
				slog.Error("periodic compaction failed", "error", err)
			}
		case <-e.stopCh:
			return
		}
	}
}

// Stop ends background compaction and flushes durable state.
func (e *Engine) Stop() error {
	e.mu.Lock()
	if e.running {
		close(e.stopCh)
		e.running = false
		done := e.doneCh
		e.mu.Unlock()
		<-done
	} else {
		e.mu.Unlock()
	}

	// Prefer full compaction when snapshot is available; otherwise keep WAL.
	if e.snapshot != nil {
		if err := e.Compact(); err != nil {
			_ = e.closeWAL()
			return err
		}
	}
	return e.closeWAL()
}

func (e *Engine) closeWAL() error {
	if e.wal == nil {
		return nil
	}
	return e.wal.Close()
}

// SnapshotEnabled reports whether checkpoint files are used.
func (e *Engine) SnapshotEnabled() bool { return e.snapshot != nil }

// WALEnabled reports whether the append-only log is used.
func (e *Engine) WALEnabled() bool { return e.wal != nil }
