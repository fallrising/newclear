package batcher

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }
func TestReserve_QueueFullImmediateAndAcceptedPreserved(t *testing.T) {
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	b, err := New(context.Background(), Options[int]{MaxItems: 1, MaxBytes: 100, QueueDepth: 1, Workers: 1, MaxTenants: 2, FlushInterval: time.Hour, WriteTimeout: time.Minute, Size: func(int) int { return 1 }, Priority: func(int) Priority { return High }, Clone: func(i int) int { return i }, Write: func(ctx context.Context, _ string, _ []int) error {
		select {
		case entered <- struct{}{}:
		default:
		}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		close(release)
		if err := b.Close(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	admit := func(i int) error {
		r, err := reserveReady(b, []int{i})
		if err == nil {
			err = r.Commit([]int{i})
		}
		return err
	}
	if err := admit(1); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("worker did not start")
	}
	if err := admit(2); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	err = admit(3)
	if !queueFull(err) {
		t.Fatalf("full queue accepted third batch: err=%v stats=%+v", err, b.Snapshot())
	}
	if time.Since(start) > time.Second {
		t.Fatal("full queue admission blocked")
	}
	if b.Snapshot().Accepted != 2 {
		t.Fatal("rejected request affected accepted data")
	}
}

func options(write func(context.Context, string, []int) error) Options[int] {
	return Options[int]{MaxItems: 1, MaxBytes: 100, QueueDepth: 4, Workers: 1, MaxTenants: 4, FlushInterval: time.Hour, WriteTimeout: time.Second, Size: func(int) int { return 1 }, Priority: func(i int) Priority {
		switch i % 3 {
		case 1:
			return Normal
		case 2:
			return High
		default:
			return Low
		}
	}, Clone: func(i int) int { return i }, Write: write}
}

// Only documented lock contention may be retried; queue/capacity errors stay immediate.
func reserveReady(b *Batcher[int], input []int) (*Reservation[int], error) {
	deadline := time.Now().Add(time.Second)
	for {
		r, err := b.Reserve(context.Background(), "tenant", input)
		var classified *spi.Error
		busy := errors.As(err, &classified) && classified.Class == spi.ErrThrottled && classified.Err.Error() == "admission busy"
		if !busy || time.Now().After(deadline) {
			return r, err
		}
		time.Sleep(time.Millisecond)
	}
}
func queueFull(err error) bool {
	var classified *spi.Error
	return errors.As(err, &classified) && classified.Class == spi.ErrThrottled && classified.Err.Error() == "priority queue full"
}
func commit(t *testing.T, b *Batcher[int], input ...int) {
	t.Helper()
	r, err := reserveReady(b, input)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Abort()
	if err := r.Commit(input); err != nil {
		t.Fatal(err)
	}
}
func await(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for worker")
	}
}
func TestReserve_MixedPriorityAtomicAndHighProtected(t *testing.T) {
	entered := make(chan struct{}, 8)
	release := make(chan struct{})
	o := options(func(ctx context.Context, _ string, _ []int) error {
		entered <- struct{}{}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	o.QueueDepth = 1
	b, err := New(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		close(release)
		if err := b.Close(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	commit(t, b, 0)
	await(t, entered)
	commit(t, b, 0)
	r, err := reserveReady(b, []int{2, 0})
	if r != nil {
		r.Abort()
	}
	if !queueFull(err) {
		t.Fatalf("mixed admission: %v", err)
	}
	if b.Snapshot().Accepted != 2 {
		t.Fatal("mixed rejection changed acceptance")
	}
	commit(t, b, 2)
	if b.Snapshot().QueueDepth != [3]int{1, 0, 1} {
		t.Fatal("priority isolation lost")
	}
}
func TestFlush_ByteItemTimerAndFullQueuePreserved(t *testing.T) {
	for _, trigger := range []string{"item", "byte", "timer"} {
		t.Run(trigger, func(t *testing.T) {
			entered := make(chan struct{}, 8)
			release := make(chan struct{})
			o := options(func(ctx context.Context, _ string, _ []int) error {
				entered <- struct{}{}
				select {
				case <-release:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			})
			o.MaxItems = 3
			o.Priority = func(int) Priority { return High }
			if trigger == "byte" {
				o.MaxItems = 100
				o.MaxBytes = 3
			}
			if trigger == "timer" {
				o.FlushInterval = 5 * time.Millisecond
			}
			b, err := New(context.Background(), o)
			if err != nil {
				t.Fatal(err)
			}
			if trigger == "timer" {
				commit(t, b, 1)
			} else {
				commit(t, b, 1, 1, 1)
			}
			await(t, entered)
			commit(t, b, 1)
			close(release)
			if err := b.Close(context.Background()); err != nil {
				t.Fatal(err)
			}
			if b.Snapshot().Written != b.Snapshot().Accepted {
				t.Fatal("flush did not drain accepted items")
			}
		})
	}
	entered := make(chan struct{}, 8)
	release := make(chan struct{})
	o := options(func(ctx context.Context, _ string, _ []int) error {
		entered <- struct{}{}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	o.MaxItems = 2
	o.QueueDepth = 1
	o.Priority = func(int) Priority { return High }
	b, err := New(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		close(release)
		if err := b.Close(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	commit(t, b, 1, 1)
	await(t, entered)
	r, err := b.Reserve(context.Background(), "other", []int{1})
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Commit([]int{1}); err != nil {
		t.Fatal(err)
	}
	commit(t, b, 1, 1)
	b.flushAt(time.Unix(1<<40, 0))
	s := b.Snapshot()
	if s.QueueDepth[High] != 1 || s.BufferedItems != 1 || s.Accepted != 5 {
		t.Fatalf("timer lost accepted partial bucket: %+v", s)
	}
}
func TestWorkers_ConcurrentBoundAndParentCanceledClose(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	entered := make(chan struct{}, 8)
	o := options(func(ctx context.Context, _ string, _ []int) error {
		entered <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	})
	o.Workers = 2
	o.Priority = func(int) Priority { return High }
	b, err := New(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	commit(t, b, 1, 2)
	await(t, entered)
	await(t, entered)
	commit(t, b, 3)
	cancel()
	if err := b.Close(context.Background()); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("parent cancellation: %v", err)
	}
	s := b.Snapshot()
	if s.Shutdown != 3 || s.Inflight != 0 || s.BufferedItems != 0 || s.QueueDepth != [3]int{} {
		t.Fatalf("undrained shutdown: %+v", s)
	}
	if err := b.Close(context.Background()); err != nil {
		t.Fatalf("second close: %v", err)
	}
}
func TestClose_DeadlineAndReject(t *testing.T) {
	entered := make(chan struct{}, 1)
	o := options(func(ctx context.Context, _ string, _ []int) error {
		entered <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	})
	b, err := New(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	commit(t, b, 2)
	await(t, entered)
	commit(t, b, 2)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := b.Close(ctx); spi.Classify(err) != spi.ErrTimeout {
		t.Fatal(err)
	}
	if b.Snapshot().Shutdown != 2 {
		t.Fatal("deadline failed to account accepted records")
	}
	r, err := b.Reserve(context.Background(), "tenant", []int{2})
	if r != nil {
		r.Abort()
	}
	if spi.Classify(err) != spi.ErrUnavailable {
		t.Fatal("close admitted more")
	}
}
func TestWrite_RetryClassesAndExhaustion(t *testing.T) {
	classes := []spi.ErrClass{spi.ErrBadRequest, spi.ErrUnsupported, spi.ErrNotFound, spi.ErrTooLarge, spi.ErrThrottled, spi.ErrUnavailable, spi.ErrTimeout, spi.ErrInternal}
	for _, class := range classes {
		t.Run(string(class), func(t *testing.T) {
			var calls atomic.Int64
			o := options(func(context.Context, string, []int) error {
				calls.Add(1)
				return spi.Wrap(class, "", "test", fmt.Errorf("test error"))
			})
			b, err := New(context.Background(), o)
			if err != nil {
				t.Fatal(err)
			}
			commit(t, b, 2)
			if err := b.Close(context.Background()); err != nil {
				t.Fatal(err)
			}
			want := int64(1)
			if spi.Retryable(class) {
				want = 4
			}
			if calls.Load() != want {
				t.Fatalf("attempts %d want %d", calls.Load(), want)
			}
			s := b.Snapshot()
			if s.WriteFailed != 1 || s.Retries != uint64(want-1) {
				t.Fatalf("stats %+v", s)
			}
		})
	}
}
func TestReserve_OversizeAbortAndInvalidCommit(t *testing.T) {
	o := options(func(context.Context, string, []int) error { return nil })
	o.QueueDepth = 1
	b, err := New(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := b.Close(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	r, err := b.Reserve(context.Background(), "tenant", []int{2, 2})
	if r != nil {
		r.Abort()
	}
	if spi.Classify(err) != spi.ErrTooLarge {
		t.Fatal(err)
	}
	r, err = reserveReady(b, []int{2})
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Commit([]int{2, 2}); spi.Classify(err) != spi.ErrBadRequest {
		t.Fatal("commit bypassed reservation")
	}
	r.Abort()
	if b.Snapshot().Accepted != 0 {
		t.Fatal("invalid commit mutated state")
	}
}
func TestFlushBound_ExhaustiveNextFit(t *testing.T) {
	// Exercise packing holes from removals/shrinking without relying on monotonicity.
	var walk func([]int, int)
	walk = func(input []int, depth int) {
		if len(input) > 0 {
			for maxItems := 1; maxItems <= 5; maxItems++ {
				bytes := 0
				for _, size := range input {
					bytes += size
				}
				count, used, flushes := 0, 0, 0
				for _, size := range input {
					if count > 0 && (count == maxItems || size > 8-used) {
						flushes++
						count = 0
						used = 0
					}
					count++
					used += size
					if count == maxItems || used == 8 {
						flushes++
						count = 0
						used = 0
					}
				}
				bound := flushBound(len(input), bytes, maxItems, 8)
				if flushes > bound {
					t.Fatalf("input %v items %d flushes %d bound %d", input, maxItems, flushes, bound)
				}
			}
		}
		if depth == 0 {
			return
		}
		for size := 1; size <= 8; size++ {
			walk(append(input, size), depth-1)
		}
	}
	walk(nil, 5)
}

func TestReserve_ShrinkPackingWithExistingBucket(t *testing.T) {
	o := options(func(context.Context, string, []int) error { return nil })
	o.MaxItems = 10
	o.MaxBytes = 8
	o.QueueDepth = 8
	o.Size = func(i int) int { return i }
	o.Priority = func(int) Priority { return High }
	b, err := New(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := b.Close(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	commit(t, b, 3)
	r, err := reserveReady(b, []int{5, 3, 5, 3, 5})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Abort()
	if err := r.Commit([]int{4, 3, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if s := b.Snapshot(); s.Accepted != 5 || s.QueueDepth[High] > o.QueueDepth {
		t.Fatalf("shrunken packing escaped reservation %+v", s)
	}
}
