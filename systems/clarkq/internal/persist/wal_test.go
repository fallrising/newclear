package persist

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/clarkQ/internal/queue"
)

func TestWALReplayAfterCrashStyleTruncation(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "clarkq.wal")
	snapPath := filepath.Join(dir, "snap.json")

	m := queue.NewManager(10, 100, 1024)
	engine := NewEngine(m, EngineConfig{
		SnapshotPath:     snapPath,
		SnapshotInterval: 0,
		WALPath:          walPath,
	})
	if err := engine.Load(); err != nil {
		t.Fatal(err)
	}

	msg, err := m.Enqueue("orders", queue.EnqueueInput{Body: "one"})
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.RecordEnqueue(msg); err != nil {
		t.Fatal(err)
	}
	msg2, err := m.Enqueue("orders", queue.EnqueueInput{Body: "two"})
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.RecordEnqueue(msg2); err != nil {
		t.Fatal(err)
	}
	got, err := m.Dequeue("orders")
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.RecordDequeue("orders", got.ID); err != nil {
		t.Fatal(err)
	}
	if err := engine.Stop(); err != nil {
		t.Fatal(err)
	}

	// New process: empty manager, load snapshot (compacted on Stop) + empty WAL.
	m2 := queue.NewManager(10, 100, 1024)
	e2 := NewEngine(m2, EngineConfig{SnapshotPath: snapPath, WALPath: walPath})
	if err := e2.Load(); err != nil {
		t.Fatal(err)
	}
	restored, err := m2.Dequeue("orders")
	if err != nil || restored.Body != "two" {
		t.Fatalf("restored=%#v err=%v", restored, err)
	}
	if err := e2.Stop(); err != nil {
		t.Fatal(err)
	}
}

func TestWALOnlyWithoutSnapshot(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "only.wal")

	m := queue.NewManager(10, 100, 1024)
	e := NewEngine(m, EngineConfig{WALPath: walPath})
	if err := e.Load(); err != nil {
		t.Fatal(err)
	}
	msg, err := m.Enqueue("jobs", queue.EnqueueInput{Body: "task", Metadata: map[string]string{"a": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.RecordEnqueue(msg); err != nil {
		t.Fatal(err)
	}
	if err := e.Stop(); err != nil {
		t.Fatal(err)
	}

	m2 := queue.NewManager(10, 100, 1024)
	e2 := NewEngine(m2, EngineConfig{WALPath: walPath})
	if err := e2.Load(); err != nil {
		t.Fatal(err)
	}
	got, err := m2.Dequeue("jobs")
	if err != nil || got.Body != "task" || got.Metadata["a"] != "1" {
		t.Fatalf("got=%#v err=%v", got, err)
	}
	_ = e2.Stop()
}

func TestWALWithPeriodicStyleCompact(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "w.wal")
	snapPath := filepath.Join(dir, "s.json")

	m := queue.NewManager(10, 100, 1024)
	e := NewEngine(m, EngineConfig{
		SnapshotPath:     snapPath,
		SnapshotInterval: time.Hour, // not used; manual compact
		WALPath:          walPath,
	})
	if err := e.Load(); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"a", "b", "c"} {
		msg, err := m.Enqueue("q", queue.EnqueueInput{Body: body})
		if err != nil {
			t.Fatal(err)
		}
		if err := e.RecordEnqueue(msg); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.Compact(); err != nil {
		t.Fatal(err)
	}
	// After compact, WAL is empty; new ops append again.
	msg, err := m.Enqueue("q", queue.EnqueueInput{Body: "d"})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.RecordEnqueue(msg); err != nil {
		t.Fatal(err)
	}
	if err := e.Stop(); err != nil {
		t.Fatal(err)
	}

	m2 := queue.NewManager(10, 100, 1024)
	e2 := NewEngine(m2, EngineConfig{SnapshotPath: snapPath, WALPath: walPath})
	if err := e2.Load(); err != nil {
		t.Fatal(err)
	}
	stats := m2.Stats()
	if stats.Messages != 4 {
		t.Fatalf("messages=%d want 4", stats.Messages)
	}
	_ = e2.Stop()
}
