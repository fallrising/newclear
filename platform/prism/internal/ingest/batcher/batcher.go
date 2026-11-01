// Package batcher owns bounded, tenant-scoped asynchronous ingestion batches.
package batcher

import (
	"context"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// Priority selects an independent admission queue. Higher values are preferred.
type Priority uint8

const (
	Low Priority = iota
	Normal
	High
	priorityCount
)

// Options configures one signal. Functions must be bounded and nonblocking,
// except Write which must honor its context. Size must include owned payload.
type Options[T any] struct {
	MaxItems, MaxBytes, QueueDepth, Workers, MaxTenants int
	FlushInterval, WriteTimeout                         time.Duration
	Size                                                func(T) int
	Priority                                            func(T) Priority
	Clone                                               func(T) T
	Write                                               func(context.Context, string, []T) error
}

type key struct {
	tenant   string
	priority Priority
}
type batch[T any] struct {
	key   key
	items []T
	bytes int
	since time.Time
}

// Stats has fixed domains and never retains tenant IDs or backend error text.
type Stats struct {
	QueueDepth                                        [3]int
	BufferedItems, BufferedBytes, Inflight            int
	Accepted, Written, WriteFailed, Shutdown, Retries uint64
	Errors                                            [8]uint64
}

// Batcher owns queues, buckets, workers and their lifecycle. mu protects queues,
// buckets and stats. Reservations retain mu until Commit or Abort.
type Batcher[T any] struct {
	mu      sync.Mutex
	options Options[T]
	queues  [3][]batch[T]
	buckets map[key]batch[T]
	stats   Stats
	ctx     context.Context
	cancel  context.CancelFunc
	wake    chan struct{}
	done    chan struct{}
	wg      sync.WaitGroup
	closing bool
}

// New starts finite workers and one timer. The caller must Close the batcher.
func New[T any](ctx context.Context, options Options[T]) (*Batcher[T], error) {
	if options.MaxItems <= 0 || options.MaxItems > 1000000 || options.MaxBytes > 1<<30 || options.QueueDepth > 1024 || options.Workers > 128 || options.MaxTenants > 1024 || options.MaxBytes <= 0 || options.QueueDepth <= 0 || options.Workers <= 0 || options.MaxTenants <= 0 || options.FlushInterval <= 0 || options.WriteTimeout <= 0 || options.Size == nil || options.Priority == nil || options.Clone == nil || options.Write == nil {
		return nil, failure(spi.ErrBadRequest, "invalid batcher options")
	}
	runCtx, cancel := context.WithCancel(ctx) //nolint:gosec // cancel is owned by Batcher.Close; parent cancellation is also observed.
	b := &Batcher[T]{options: options, buckets: make(map[key]batch[T]), ctx: runCtx, cancel: cancel, wake: make(chan struct{}, 1), done: make(chan struct{})}
	b.wg.Add(options.Workers + 1)
	for range options.Workers {
		go b.worker()
	}
	go b.timer()
	go func() { b.wg.Wait(); close(b.done) }()
	return b, nil
}

// Reservation is an exclusive, bounded admission decision. Abort is mandatory
// unless Commit is called; callers must not perform I/O while holding it.
type Reservation[T any] struct {
	owner         *Batcher[T]
	tenant        string
	counts, sizes [3]int
}

// Reserve performs an all-or-none conservative projection. Input contains the
// upper bound for the final payload; Commit must only shrink it. No queue wait.
func (b *Batcher[T]) Reserve(ctx context.Context, tenant string, input []T) (*Reservation[T], error) {
	return b.ReserveSized(ctx, tenant, input, b.options.Size)
}

// ReserveSized accepts a conservative size function; Commit uses the real Size.
func (b *Batcher[T]) ReserveSized(ctx context.Context, tenant string, input []T, size func(T) int) (*Reservation[T], error) {
	if len(input) > 1000000 || size == nil {
		return nil, failure(spi.ErrTooLarge, "request too large")
	}
	if err := ctx.Err(); err != nil {
		return nil, spi.Wrap(spi.ErrTimeout, "", "batcher.Reserve", err)
	}
	if !b.mu.TryLock() {
		return nil, failure(spi.ErrThrottled, "admission busy")
	}
	if b.closing || b.ctx.Err() != nil {
		b.mu.Unlock()
		return nil, failure(spi.ErrUnavailable, "batcher closed")
	}
	if tenant == "" {
		b.mu.Unlock()
		return nil, failure(spi.ErrBadRequest, "tenant required")
	}
	if err := b.project(tenant, input, size); err != nil {
		b.mu.Unlock()
		return nil, err
	}
	r := &Reservation[T]{owner: b, tenant: strings.Clone(tenant)}
	for _, item := range input {
		p := b.options.Priority(item)
		r.counts[p]++
		r.sizes[p] += size(item)
	}
	return r, nil
}

// project never changes accepted state. Conservative sizes and removal-only
// limits ensure the reserved flush count cannot increase after admission.
//
//nolint:gosec // Priority is checked against priorityCount before every array access.
func (b *Batcher[T]) project(tenant string, input []T, itemSize func(T) int) error {
	counts, sizes := [3]int{}, [3]int{}
	tenants := make(map[string]struct{}, b.options.MaxTenants)
	for k, bucket := range b.buckets {
		tenants[k.tenant] = struct{}{}
		if k.tenant == tenant {
			counts[k.priority] = len(bucket.items)
			sizes[k.priority] = bucket.bytes
		}
	}
	if _, found := tenants[tenant]; !found && len(tenants) >= b.options.MaxTenants {
		return failure(spi.ErrThrottled, "tenant bucket capacity reached")
	}
	incoming := [3]int{}
	incomingBytes := [3]int{}
	for _, item := range input {
		p := b.options.Priority(item)
		if p >= priorityCount {
			return failure(spi.ErrBadRequest, "invalid priority")
		}
		size := itemSize(item)
		if size <= 0 || size > b.options.MaxBytes {
			return failure(spi.ErrTooLarge, "record exceeds batch byte capacity")
		}
		if counts[p] == int(^uint(0)>>1) || size > int(^uint(0)>>1)-sizes[p] {
			return failure(spi.ErrTooLarge, "request size overflow")
		}
		counts[p]++
		incoming[p]++
		incomingBytes[p] += size
		sizes[p] += size
	}
	for p, n := range incoming {
		if n == 0 {
			continue
		}
		// Item-trigger flushes <= floor(N/MaxItems). For byte-trigger flushes,
		// disjoint adjacent pairs exceed MaxBytes; therefore <= 2*floor(B/MaxBytes)+1.
		// Cap by N (each flush contains an item). Division precedes multiplication.
		slots := flushBound(counts[p], sizes[p], b.options.MaxItems, b.options.MaxBytes)
		if slots > b.options.QueueDepth {
			if flushBound(incoming[p], incomingBytes[p], b.options.MaxItems, b.options.MaxBytes) > b.options.QueueDepth {
				return failure(spi.ErrTooLarge, "request exceeds priority reservation capacity")
			}
			return failure(spi.ErrThrottled, "existing bucket consumes reservation capacity")
		}
		if len(b.queues[p]) >= b.options.QueueDepth || slots > b.options.QueueDepth-len(b.queues[p]) {
			return failure(spi.ErrThrottled, "priority queue full")
		}
	}
	return nil
}
func flushBound(count, bytes, maxItems, maxBytes int) int {
	byteBound := 0
	if bytes == maxBytes {
		byteBound = 1
	} else if bytes > maxBytes {
		quotient := bytes / maxBytes
		if quotient >= count/2 {
			return count
		}
		byteBound = 2*quotient + 1
	}
	return min(count, count/maxItems+byteBound)
}
func (r *Reservation[T]) Abort() {
	if r.owner != nil {
		r.owner.mu.Unlock()
		r.owner = nil
	}
}

//nolint:gosec // Priority is checked against priorityCount before every array access.
func (r *Reservation[T]) Commit(items []T) error {
	b := r.owner
	if b == nil {
		return failure(spi.ErrBadRequest, "reservation already completed")
	}
	counts, sizes := [3]int{}, [3]int{}
	for _, item := range items {
		p := b.options.Priority(item)
		size := b.options.Size(item)
		if p >= priorityCount || size <= 0 || size > b.options.MaxBytes {
			return failure(spi.ErrBadRequest, "invalid committed item")
		}
		counts[p]++
		if counts[p] > r.counts[p] || size > r.sizes[p]-sizes[p] {
			return failure(spi.ErrBadRequest, "commit exceeds reservation")
		}
		sizes[p] += size
	}
	for _, item := range items {
		p := b.options.Priority(item)
		k := key{r.tenant, p}
		bucket := b.buckets[k]
		bucket.key = k
		if len(bucket.items) == 0 {
			bucket.since = time.Now()
		}
		size := b.options.Size(item)
		if len(bucket.items) > 0 && (len(bucket.items) == b.options.MaxItems || size > b.options.MaxBytes-bucket.bytes) {
			b.queues[p] = append(b.queues[p], bucket)
			bucket = batch[T]{key: k, since: time.Now()}
		}
		bucket.items = append(bucket.items, b.options.Clone(item))
		bucket.bytes += size
		b.stats.Accepted++
		if len(bucket.items) == b.options.MaxItems || bucket.bytes == b.options.MaxBytes {
			b.queues[p] = append(b.queues[p], bucket)
			delete(b.buckets, k)
		} else {
			b.buckets[k] = bucket
		}
	}
	r.Abort()
	b.notify()
	return nil
}
func (b *Batcher[T]) notify() {
	select {
	case b.wake <- struct{}{}:
	default:
	}
}
func (b *Batcher[T]) next() (batch[T], bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for p := int(High); p >= int(Low); p-- {
		if len(b.queues[p]) > 0 {
			job := b.queues[p][0]
			b.queues[p][0] = batch[T]{}
			b.queues[p] = b.queues[p][1:]
			if len(b.queues[p]) == 0 {
				b.queues[p] = nil
			}
			b.stats.Inflight++
			b.notify()
			return job, true
		}
	}
	return batch[T]{}, false
}
func (b *Batcher[T]) worker() {
	defer b.wg.Done()
	for {
		if b.ctx.Err() != nil {
			return
		}
		job, ok := b.next()
		if !ok {
			select {
			case <-b.ctx.Done():
				return
			case <-b.wake:
				continue
			}
		}
		err := b.write(job)
		b.mu.Lock()
		b.stats.Inflight--
		if err != nil {
			if b.ctx.Err() != nil {
				b.stats.Shutdown += uint64(len(job.items))
			} else {
				b.stats.WriteFailed += uint64(len(job.items))
			}
		} else {
			b.stats.Written += uint64(len(job.items))
		}
		b.mu.Unlock()
		b.flush()
		b.notify()
	}
}
func (b *Batcher[T]) write(job batch[T]) error {
	for attempt := range 4 {
		if err := b.ctx.Err(); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(b.ctx, b.options.WriteTimeout)
		err := b.options.Write(ctx, job.key.tenant, job.items)
		cancel()
		if err == nil {
			return nil
		}
		class := spi.Classify(err)
		b.mu.Lock()
		b.stats.Errors[classIndex(class)]++
		b.mu.Unlock()
		if !spi.Retryable(class) || attempt == 3 || b.ctx.Err() != nil {
			return err
		}
		delay := time.Duration(float64((100*time.Millisecond)<<attempt) * (0.8 + rand.Float64()*0.4)) //nolint:gosec // Retry jitter is non-security randomness.
		timer := time.NewTimer(delay)
		select {
		case <-b.ctx.Done():
			timer.Stop()
			return b.ctx.Err()
		case <-timer.C:
		}
		b.mu.Lock()
		b.stats.Retries++
		b.mu.Unlock()
	}
	return nil
}
func classIndex(class spi.ErrClass) int {
	switch class {
	case spi.ErrBadRequest:
		return 0
	case spi.ErrUnsupported:
		return 1
	case spi.ErrNotFound:
		return 2
	case spi.ErrTooLarge:
		return 3
	case spi.ErrThrottled:
		return 4
	case spi.ErrUnavailable:
		return 5
	case spi.ErrTimeout:
		return 6
	default:
		return 7
	}
}
func (b *Batcher[T]) flush() { b.flushAt(time.Now()) }
func (b *Batcher[T]) flushAt(now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for k, bucket := range b.buckets {
		if len(b.queues[k.priority]) < b.options.QueueDepth && (b.closing || now.Sub(bucket.since) >= b.options.FlushInterval) {
			b.queues[k.priority] = append(b.queues[k.priority], bucket)
			delete(b.buckets, k)
		}
	}
	b.notify()
}
func (b *Batcher[T]) timer() {
	defer b.wg.Done()
	ticker := time.NewTicker(b.options.FlushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-b.ctx.Done():
			return
		case <-ticker.C:
			b.flush()
		}
	}
}

// Snapshot returns fixed-domain observations.
func (b *Batcher[T]) Snapshot() Stats {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.stats
	for p := range b.queues {
		s.QueueDepth[p] = len(b.queues[p])
	}
	for _, bucket := range b.buckets {
		s.BufferedItems += len(bucket.items)
		s.BufferedBytes += bucket.bytes
	}
	return s
}

// Close rejects admission and drains accepted items until ctx ends. Backend
// ownership stays with the caller. Concurrent callers may safely call Close.
func (b *Batcher[T]) Close(ctx context.Context) error {
	b.mu.Lock()
	b.closing = true
	b.mu.Unlock()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		b.flush()
		s := b.Snapshot()
		if s.BufferedItems == 0 && s.Inflight == 0 && s.QueueDepth == [3]int{} {
			b.cancel()
			<-b.done
			return nil
		}
		select {
		case <-ctx.Done():
			b.cancel()
			<-b.done
			b.discard()
			return spi.Wrap(spi.ErrTimeout, "", "batcher.Close", ctx.Err())
		case <-b.ctx.Done():
			<-b.done
			b.discard()
			return spi.Wrap(spi.ErrTimeout, "", "batcher.Close", b.ctx.Err())
		case <-ticker.C:
		}
	}
}
func failure(class spi.ErrClass, message string) error {
	return spi.Wrap(class, "", "batcher", fmt.Errorf("%s", message))
}

func (b *Batcher[T]) discard() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for p := range b.queues {
		for _, job := range b.queues[p] {
			b.stats.Shutdown += uint64(len(job.items))
		}
		b.queues[p] = nil
	}
	for _, bucket := range b.buckets {
		b.stats.Shutdown += uint64(len(bucket.items))
	}
	clear(b.buckets)
}
