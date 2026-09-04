package cluster

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fallrising/clarkQ/internal/queue"
)

// OutboxOp is a pending peer replication operation.
type OutboxOp string

const (
	OutboxEnqueue OutboxOp = "enqueue"
	OutboxDequeue OutboxOp = "dequeue"
	OutboxClear   OutboxOp = "clear"
)

// OutboxItem is one retry unit. When Path is set on Outbox, items survive process restart.
type OutboxItem struct {
	ID        string         `json:"id"`
	Op        OutboxOp       `json:"op"`
	Target    string         `json:"target"`
	Queue     string         `json:"queue"`
	MessageID string         `json:"message_id,omitempty"`
	Message   *queue.Message `json:"message,omitempty"`
	Attempts  int            `json:"attempts"`
	NextTry   time.Time      `json:"next_try"`
	CreatedAt time.Time      `json:"created_at"`
	LastError string         `json:"last_error,omitempty"`
}

type outboxFile struct {
	Version int          `json:"version"`
	Seq     uint64       `json:"seq"`
	Items   []OutboxItem `json:"items"`
}

// Outbox queues replication work for retry, optionally persisted to disk.
type Outbox struct {
	mu          sync.Mutex
	items       map[string]*OutboxItem
	order       []string
	maxAttempts int
	baseBackoff time.Duration
	seq         uint64
	path        string // empty = memory only
}

// NewOutbox creates an outbox. path empty disables durability.
func NewOutbox(maxAttempts int, baseBackoff time.Duration, path string) *Outbox {
	if maxAttempts <= 0 {
		maxAttempts = 8
	}
	if baseBackoff <= 0 {
		baseBackoff = 500 * time.Millisecond
	}
	return &Outbox{
		items:       make(map[string]*OutboxItem),
		maxAttempts: maxAttempts,
		baseBackoff: baseBackoff,
		path:        path,
	}
}

// Load reads durable state from disk if path is set. Missing file is OK.
func (o *Outbox) Load() error {
	if o == nil || o.path == "" {
		return nil
	}
	data, err := os.ReadFile(o.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read outbox: %w", err)
	}
	var f outboxFile
	if err := json.Unmarshal(data, &f); err != nil {
		return fmt.Errorf("parse outbox: %w", err)
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.seq = f.Seq
	o.items = make(map[string]*OutboxItem, len(f.Items))
	o.order = make([]string, 0, len(f.Items))
	now := time.Now().UTC()
	for i := range f.Items {
		it := f.Items[i]
		// Ready soon after restart.
		if it.NextTry.After(now.Add(time.Minute)) {
			it.NextTry = now
		}
		cp := it
		o.items[it.ID] = &cp
		o.order = append(o.order, it.ID)
	}
	slog.Info("outbox loaded", "path", o.path, "items", len(o.items))
	return nil
}

func (o *Outbox) persistLocked() error {
	if o.path == "" {
		return nil
	}
	f := outboxFile{Version: 1, Seq: o.seq, Items: make([]OutboxItem, 0, len(o.items))}
	for _, id := range o.order {
		if it := o.items[id]; it != nil {
			f.Items = append(f.Items, *it)
		}
	}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(o.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".clarkq-outbox-*.tmp")
	if err != nil {
		return err
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
		return err
	}
	_ = tmp.Chmod(0o600)
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, o.path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

// Save flushes to disk (no-op if memory-only).
func (o *Outbox) Save() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.persistLocked()
}

// Add enqueues a new item.
func (o *Outbox) Add(item OutboxItem) {
	if o == nil {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if item.ID == "" {
		o.seq++
		item.ID = formatID(o.seq)
	}
	if item.CreatedAt.IsZero() {
		item.CreatedAt = time.Now().UTC()
	}
	if item.NextTry.IsZero() {
		item.NextTry = time.Now().UTC()
	}
	if _, exists := o.items[item.ID]; !exists {
		o.order = append(o.order, item.ID)
	}
	cp := item
	o.items[item.ID] = &cp
	if err := o.persistLocked(); err != nil {
		slog.Error("outbox persist failed", "error", err, "path", o.path)
	}
}

// Ready returns items whose NextTry is due, without removing them.
func (o *Outbox) Ready(now time.Time, limit int) []OutboxItem {
	if o == nil {
		return nil
	}
	if limit <= 0 {
		limit = 32
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []OutboxItem
	for _, id := range o.order {
		it := o.items[id]
		if it == nil {
			continue
		}
		if it.NextTry.After(now) {
			continue
		}
		out = append(out, *it)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// Complete removes a successfully processed item.
func (o *Outbox) Complete(id string) {
	if o == nil {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.items, id)
	n := o.order[:0]
	for _, x := range o.order {
		if x != id {
			n = append(n, x)
		}
	}
	o.order = n
	if err := o.persistLocked(); err != nil {
		slog.Error("outbox persist failed", "error", err, "path", o.path)
	}
}

// Fail increments attempts and schedules backoff, or drops after maxAttempts.
func (o *Outbox) Fail(id string, errMsg string) (dropped bool) {
	if o == nil {
		return true
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	it := o.items[id]
	if it == nil {
		return true
	}
	it.Attempts++
	it.LastError = errMsg
	if it.Attempts >= o.maxAttempts {
		delete(o.items, id)
		n := o.order[:0]
		for _, x := range o.order {
			if x != id {
				n = append(n, x)
			}
		}
		o.order = n
		_ = o.persistLocked()
		return true
	}
	shift := it.Attempts - 1
	if shift > 6 {
		shift = 6
	}
	backoff := o.baseBackoff * time.Duration(1<<shift)
	if backoff > 30*time.Second {
		backoff = 30 * time.Second
	}
	it.NextTry = time.Now().UTC().Add(backoff)
	_ = o.persistLocked()
	return false
}

// Len returns pending item count.
func (o *Outbox) Len() int {
	if o == nil {
		return 0
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.items)
}

// Snapshot copies pending items for status APIs.
func (o *Outbox) Snapshot() []OutboxItem {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make([]OutboxItem, 0, len(o.items))
	for _, id := range o.order {
		if it := o.items[id]; it != nil {
			out = append(out, *it)
		}
	}
	return out
}

// Path returns the durable file path (may be empty).
func (o *Outbox) Path() string {
	if o == nil {
		return ""
	}
	return o.path
}

func formatID(n uint64) string {
	return time.Now().UTC().Format("20060102T150405") + "-" + itoa(n)
}

func itoa(n uint64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
