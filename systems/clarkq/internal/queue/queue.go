package queue

import (
	"context"
	"sync"
	"time"
)

type Queue struct {
	mu       sync.Mutex
	name     string
	messages []Message
	maxDepth int
	notify   chan struct{}

	// removed remembers IDs taken out of this queue so catch-up and replica
	// pushes cannot bring a consumed message back. Entries expire after removedTTL.
	removed    map[string]time.Time
	removedTTL time.Duration
	nextPrune  time.Time

	// unconfirmed holds IDs loaded from disk at startup that peers have not yet
	// vouched for; they may have been consumed elsewhere while this node was down.
	unconfirmed map[string]struct{}
}

func newQueue(name string, maxDepth int, removedTTL time.Duration) *Queue {
	return &Queue{
		name:        name,
		maxDepth:    maxDepth,
		notify:      make(chan struct{}),
		removed:     make(map[string]time.Time),
		removedTTL:  removedTTL,
		unconfirmed: make(map[string]struct{}),
	}
}

func (q *Queue) markAllUnconfirmed() {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, msg := range q.messages {
		q.unconfirmed[msg.ID] = struct{}{}
	}
}

func (q *Queue) confirmAll() {
	q.mu.Lock()
	defer q.mu.Unlock()
	clear(q.unconfirmed)
}

func (q *Queue) unconfirmedIDs() map[string]struct{} {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make(map[string]struct{}, len(q.unconfirmed))
	for id := range q.unconfirmed {
		out[id] = struct{}{}
	}
	return out
}

func (q *Queue) markRemovedLocked(id string) {
	now := time.Now()
	delete(q.unconfirmed, id)
	q.removed[id] = now
	if now.Before(q.nextPrune) {
		return
	}
	for removedID, at := range q.removed {
		if now.Sub(at) > q.removedTTL {
			delete(q.removed, removedID)
		}
	}
	q.nextPrune = now.Add(q.removedTTL / 2)
}

func (q *Queue) wasRemovedLocked(id string) bool {
	at, ok := q.removed[id]
	return ok && time.Since(at) <= q.removedTTL
}

// restore appends msg unless its ID is already queued or was removed. Reports whether it was added.
func (q *Queue) restore(msg Message) (bool, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.wasRemovedLocked(msg.ID) || q.hasIDLocked(msg.ID) {
		return false, nil
	}
	if len(q.messages) >= q.maxDepth {
		return false, ErrQueueFull
	}
	q.messages = append(q.messages, msg)
	close(q.notify)
	q.notify = make(chan struct{})
	return true, nil
}

// removedIDs returns the unexpired IDs removed from this queue.
func (q *Queue) removedIDs() []string {
	q.mu.Lock()
	defer q.mu.Unlock()
	ids := make([]string, 0, len(q.removed))
	for id := range q.removed {
		if q.wasRemovedLocked(id) {
			ids = append(ids, id)
		}
	}
	return ids
}

func (q *Queue) push(msg Message) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(q.messages) >= q.maxDepth {
		return ErrQueueFull
	}
	q.messages = append(q.messages, msg)
	close(q.notify)
	q.notify = make(chan struct{})
	return nil
}

func (q *Queue) read(ctx context.Context, peek bool, timeout time.Duration) (Message, bool) {
	var timeoutC <-chan time.Time
	if timeout > 0 {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		timeoutC = timer.C
	}

	for {
		q.mu.Lock()
		if ctx.Err() != nil {
			q.mu.Unlock()
			return Message{}, false
		}
		if len(q.messages) > 0 {
			msg := q.messages[0]
			if !peek {
				q.messages[0] = Message{}
				q.messages = q.messages[1:]
				q.markRemovedLocked(msg.ID)
			}
			q.mu.Unlock()
			return msg, true
		}
		notify := q.notify
		q.mu.Unlock()

		if timeout <= 0 {
			return Message{}, false
		}

		select {
		case <-notify:
		case <-timeoutC:
			return Message{}, false
		case <-ctx.Done():
			return Message{}, false
		}
	}
}

func (q *Queue) clear() int {
	q.mu.Lock()
	defer q.mu.Unlock()

	count := len(q.messages)
	for _, msg := range q.messages {
		q.markRemovedLocked(msg.ID)
	}
	q.messages = nil
	return count
}

func (q *Queue) depth() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.messages)
}

// exportMessages returns a deep-ish copy of queued messages (FIFO order).
func (q *Queue) exportMessages() []Message {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.messages) == 0 {
		return nil
	}
	out := make([]Message, len(q.messages))
	for i, msg := range q.messages {
		out[i] = cloneMessage(msg)
	}
	return out
}

// replaceMessages overwrites the queue contents. Caller must enforce maxDepth.
func (q *Queue) replaceMessages(msgs []Message) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.messages = msgs
	// Wake any long-poll waiters so they re-check after restore.
	close(q.notify)
	q.notify = make(chan struct{})
}

// removeByID deletes the first message with the given ID. Returns true if found.
// The ID is remembered even when absent, so a later copy cannot resurrect it.
func (q *Queue) removeByID(id string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.markRemovedLocked(id)
	for i, msg := range q.messages {
		if msg.ID == id {
			copy(q.messages[i:], q.messages[i+1:])
			q.messages[len(q.messages)-1] = Message{}
			q.messages = q.messages[:len(q.messages)-1]
			return true
		}
	}
	return false
}

func (q *Queue) hasID(id string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.hasIDLocked(id)
}

func (q *Queue) hasIDLocked(id string) bool {
	for _, msg := range q.messages {
		if msg.ID == id {
			return true
		}
	}
	return false
}

func (q *Queue) peekFront() (Message, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.messages) == 0 {
		return Message{}, false
	}
	return cloneMessage(q.messages[0]), true
}

// compareAndPop removes the head only if its ID matches expectedID.
func (q *Queue) compareAndPop(expectedID string) (Message, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.messages) == 0 {
		return Message{}, false
	}
	if q.messages[0].ID != expectedID {
		return Message{}, false
	}
	msg := q.messages[0]
	q.messages[0] = Message{}
	q.messages = q.messages[1:]
	q.markRemovedLocked(msg.ID)
	return cloneMessage(msg), true
}

// pushFront puts a message back at the head (compensation), undoing its removal record.
func (q *Queue) pushFront(msg Message) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.messages) >= q.maxDepth {
		return ErrQueueFull
	}
	delete(q.removed, msg.ID)
	q.messages = append([]Message{msg}, q.messages...)
	close(q.notify)
	q.notify = make(chan struct{})
	return nil
}
