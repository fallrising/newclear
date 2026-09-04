package queue

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestManagerFIFO(t *testing.T) {
	m := NewManager(10, 100, 1024)

	for i := 0; i < 3; i++ {
		msg, err := m.Enqueue("orders", EnqueueInput{Body: string(rune('a' + i))})
		if err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
		if msg.ID == "" || msg.Body == "" {
			t.Fatalf("enqueue returned empty message: %#v", msg)
		}
	}

	first, err := m.Dequeue("orders")
	if err != nil || first.Body != "a" {
		t.Fatalf("first = %#v, err = %v", first, err)
	}
	second, err := m.Dequeue("orders")
	if err != nil || second.Body != "b" {
		t.Fatalf("second = %#v, err = %v", second, err)
	}
}

func TestManagerQueueNotFound(t *testing.T) {
	m := NewManager(10, 100, 1024)
	_, err := m.Dequeue("missing")
	if !errors.Is(err, ErrQueueNotFound) {
		t.Fatalf("expected ErrQueueNotFound, got %v", err)
	}
}

func TestCompareAndPopAndPushFront(t *testing.T) {
	m := NewManager(10, 100, 1024)
	a, _ := m.Enqueue("q", EnqueueInput{Body: "a"})
	_, _ = m.Enqueue("q", EnqueueInput{Body: "b"})

	head, err := m.PeekFront("q")
	if err != nil || head.ID != a.ID {
		t.Fatalf("peek=%#v err=%v", head, err)
	}
	// Wrong ID fails
	if _, err := m.CompareAndPop("q", "nope"); err == nil {
		t.Fatal("expected fail")
	}
	got, err := m.CompareAndPop("q", a.ID)
	if err != nil || got.Body != "a" {
		t.Fatalf("pop=%#v err=%v", got, err)
	}
	// Restore to front ahead of b
	if err := m.PushFront("q", a); err != nil {
		t.Fatal(err)
	}
	again, err := m.PeekFront("q")
	if err != nil || again.ID != a.ID {
		t.Fatalf("after pushfront %#v", again)
	}
}

func TestManagerMergeMessages(t *testing.T) {
	m := NewManager(10, 100, 1024)
	a, _ := m.Enqueue("q", EnqueueInput{Body: "a"})
	added, err := m.MergeMessages("q", []Message{
		{ID: a.ID, Queue: "q", Body: "a"}, // duplicate
		{ID: "m2", Queue: "q", Body: "b"},
		{ID: "m3", Queue: "q", Body: "c"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 2 {
		t.Fatalf("added=%d", len(added))
	}
	if m.Stats().Messages != 3 {
		t.Fatalf("depth=%d", m.Stats().Messages)
	}
}

func TestManagerRemoveByID(t *testing.T) {
	m := NewManager(10, 100, 1024)
	a, err := m.Enqueue("q", EnqueueInput{Body: "a"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := m.Enqueue("q", EnqueueInput{Body: "b"})
	if err != nil {
		t.Fatal(err)
	}
	ok, err := m.RemoveByID("q", a.ID)
	if err != nil || !ok {
		t.Fatalf("remove a: ok=%v err=%v", ok, err)
	}
	msg, err := m.Dequeue("q")
	if err != nil || msg.ID != b.ID {
		t.Fatalf("expected b, got %#v err=%v", msg, err)
	}
}

func TestManagerSnapshotRoundTrip(t *testing.T) {
	m := NewManager(10, 100, 1024)
	_, err := m.Enqueue("orders", EnqueueInput{Body: "a", Metadata: map[string]string{"x": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.Enqueue("orders", EnqueueInput{Body: "b"})
	if err != nil {
		t.Fatal(err)
	}

	snap := m.ExportSnapshot()
	other := NewManager(10, 100, 1024)
	if err := other.ImportSnapshot(snap); err != nil {
		t.Fatal(err)
	}

	stats := other.Stats()
	if stats.Queues != 1 || stats.Messages != 2 || stats.QueueDepths["orders"] != 2 {
		t.Fatalf("stats = %+v", stats)
	}
	first, err := other.Dequeue("orders")
	if err != nil || first.Body != "a" || first.Metadata["x"] != "1" {
		t.Fatalf("first = %#v err=%v", first, err)
	}
}

func TestManagerQueueEmpty(t *testing.T) {
	m := NewManager(10, 100, 1024)
	_, err := m.Enqueue("orders", EnqueueInput{Body: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Dequeue("orders"); err != nil {
		t.Fatal(err)
	}
	_, err = m.Dequeue("orders")
	if !errors.Is(err, ErrQueueEmpty) {
		t.Fatalf("expected ErrQueueEmpty, got %v", err)
	}
}

func TestManagerPeekDoesNotRemoveMessage(t *testing.T) {
	m := NewManager(10, 100, 1024)
	if _, err := m.Enqueue("orders", EnqueueInput{Body: "x"}); err != nil {
		t.Fatal(err)
	}

	peeked, err := m.Read(context.Background(), "orders", true, 0)
	if err != nil || peeked.Body != "x" {
		t.Fatalf("peek = %#v, err = %v", peeked, err)
	}
	consumed, err := m.Dequeue("orders")
	if err != nil || consumed.ID != peeked.ID {
		t.Fatalf("dequeue = %#v, err = %v", consumed, err)
	}
}

func TestManagerClear(t *testing.T) {
	m := NewManager(10, 100, 1024)
	for i := 0; i < 2; i++ {
		if _, err := m.Enqueue("orders", EnqueueInput{Body: "x"}); err != nil {
			t.Fatal(err)
		}
	}

	cleared, err := m.Clear("orders")
	if err != nil || cleared != 2 {
		t.Fatalf("cleared = %d, err = %v", cleared, err)
	}
	if _, err := m.Dequeue("orders"); !errors.Is(err, ErrQueueEmpty) {
		t.Fatalf("expected empty queue, got %v", err)
	}
}

func TestManagerLongPollReceivesMessage(t *testing.T) {
	m := NewManager(10, 100, 1024)
	if _, err := m.Enqueue("orders", EnqueueInput{Body: "first"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Dequeue("orders"); err != nil {
		t.Fatal(err)
	}

	result := make(chan Message, 1)
	errResult := make(chan error, 1)
	go func() {
		msg, err := m.Read(context.Background(), "orders", false, time.Second)
		result <- msg
		errResult <- err
	}()

	if _, err := m.Enqueue("orders", EnqueueInput{Body: "second"}); err != nil {
		t.Fatal(err)
	}
	if err := <-errResult; err != nil {
		t.Fatal(err)
	}
	if msg := <-result; msg.Body != "second" {
		t.Fatalf("body = %q", msg.Body)
	}
}

func TestManagerLongPollTimesOut(t *testing.T) {
	m := NewManager(10, 100, 1024)
	if _, err := m.Enqueue("orders", EnqueueInput{Body: "x"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Dequeue("orders"); err != nil {
		t.Fatal(err)
	}

	_, err := m.Read(context.Background(), "orders", false, 10*time.Millisecond)
	if !errors.Is(err, ErrQueueEmpty) {
		t.Fatalf("expected ErrQueueEmpty, got %v", err)
	}
}

func TestManagerCanceledReadDoesNotConsume(t *testing.T) {
	m := NewManager(10, 100, 1024)
	if _, err := m.Enqueue("orders", EnqueueInput{Body: "x"}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.Read(ctx, "orders", false, time.Second); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if msg, err := m.Dequeue("orders"); err != nil || msg.Body != "x" {
		t.Fatalf("dequeue = %#v, err = %v", msg, err)
	}
}

func TestManagerConcurrency(t *testing.T) {
	m := NewManager(10, 10000, 1024)
	const workers = 32
	const perWorker = 50

	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				if _, err := m.Enqueue("jobs", EnqueueInput{Body: "job"}); err != nil {
					t.Errorf("enqueue: %v", err)
				}
			}
		}()
	}
	wg.Wait()

	count := 0
	for {
		_, err := m.Dequeue("jobs")
		if errors.Is(err, ErrQueueEmpty) {
			break
		}
		if err != nil {
			t.Fatalf("dequeue: %v", err)
		}
		count++
	}
	if count != workers*perWorker {
		t.Fatalf("got %d messages, want %d", count, workers*perWorker)
	}
}

func TestValidName(t *testing.T) {
	cases := map[string]bool{
		"orders":   true,
		"order_1":  true,
		"ORDER-2":  true,
		"":         false,
		"bad name": false,
		"bad/name": false,
		"toolongnametoolongnametoolongnametoolongnametoolongnametoolongnameX": false,
	}
	for name, want := range cases {
		if got := ValidName(name); got != want {
			t.Fatalf("ValidName(%q) = %v, want %v", name, got, want)
		}
	}
}
