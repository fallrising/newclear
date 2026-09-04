package persist

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fallrising/clarkQ/internal/queue"
)

func TestSnapshotRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "snapshot.json")

	src := queue.NewManager(10, 100, 1024)
	_, err := src.Enqueue("orders", queue.EnqueueInput{
		Body:     "hello",
		Metadata: map[string]string{"k": "v"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = src.Enqueue("orders", queue.EnqueueInput{Body: "world"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = src.Enqueue("jobs", queue.EnqueueInput{Body: "task"})
	if err != nil {
		t.Fatal(err)
	}

	store := NewStore(path, 0, src)
	if err := store.Save(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}

	dst := queue.NewManager(10, 100, 1024)
	loader := NewStore(path, 0, dst)
	if err := loader.Load(); err != nil {
		t.Fatal(err)
	}

	stats := dst.Stats()
	if stats.Queues != 2 || stats.Messages != 3 {
		t.Fatalf("stats = %+v", stats)
	}

	first, err := dst.Dequeue("orders")
	if err != nil || first.Body != "hello" || first.Metadata["k"] != "v" {
		t.Fatalf("first = %#v err=%v", first, err)
	}
	second, err := dst.Dequeue("orders")
	if err != nil || second.Body != "world" {
		t.Fatalf("second = %#v err=%v", second, err)
	}
	job, err := dst.Dequeue("jobs")
	if err != nil || job.Body != "task" {
		t.Fatalf("job = %#v err=%v", job, err)
	}
}

func TestSnapshotLoadMissingIsOK(t *testing.T) {
	m := queue.NewManager(10, 100, 1024)
	store := NewStore(filepath.Join(t.TempDir(), "nope.json"), 0, m)
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
}

func TestSnapshotPeriodicAndStop(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "snap.json")
	m := queue.NewManager(10, 100, 1024)
	_, _ = m.Enqueue("q", queue.EnqueueInput{Body: "x"})

	store := NewStore(path, 50*time.Millisecond, m)
	store.Start()
	time.Sleep(120 * time.Millisecond)
	if err := store.Stop(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}

	dst := queue.NewManager(10, 100, 1024)
	if err := NewStore(path, 0, dst).Load(); err != nil {
		t.Fatal(err)
	}
	msg, err := dst.Dequeue("q")
	if err != nil || msg.Body != "x" {
		t.Fatalf("restored = %#v err=%v", msg, err)
	}
}
