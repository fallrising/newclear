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
}

func newQueue(name string, maxDepth int) *Queue {
	return &Queue{
		name:     name,
		maxDepth: maxDepth,
		notify:   make(chan struct{}),
	}
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
func (q *Queue) removeByID(id string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
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
	return cloneMessage(msg), true
}

func (q *Queue) pushFront(msg Message) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.messages) >= q.maxDepth {
		return ErrQueueFull
	}
	q.messages = append([]Message{msg}, q.messages...)
	close(q.notify)
	q.notify = make(chan struct{})
	return nil
}
