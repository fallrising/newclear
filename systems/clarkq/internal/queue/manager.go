package queue

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/fallrising/clarkQ/internal/crypto"
)

type Manager struct {
	mu        sync.RWMutex
	queues    map[string]*Queue
	maxQueues int
	maxDepth  int
	maxBytes  int
}

func NewManager(maxQueues, maxDepth, maxBytes int) *Manager {
	return &Manager{
		queues:    make(map[string]*Queue),
		maxQueues: maxQueues,
		maxDepth:  maxDepth,
		maxBytes:  maxBytes,
	}
}

func (m *Manager) Enqueue(name string, input EnqueueInput) (Message, error) {
	if !ValidName(name) {
		return Message{}, ErrInvalidName
	}
	if input.Body == "" {
		return Message{}, ErrEmptyBody
	}
	if len(input.Body) > m.maxBytes {
		return Message{}, ErrMessageTooLarge
	}

	q, err := m.getOrCreate(name)
	if err != nil {
		return Message{}, err
	}

	now := time.Now().UTC()
	msg := Message{
		ID:         newMessageID(),
		Queue:      name,
		Body:       input.Body,
		Metadata:   cloneMetadata(input.Metadata),
		Encryption: cloneEncryption(input.Encryption),
		CreatedAt:  now,
	}
	if err := q.push(msg); err != nil {
		return Message{}, err
	}
	return msg, nil
}

// RestoreMessage re-inserts a previously persisted message (WAL / snapshot / replica).
func (m *Manager) RestoreMessage(msg Message) error {
	if !ValidName(msg.Queue) {
		return ErrInvalidName
	}
	if msg.Body == "" {
		return ErrEmptyBody
	}
	if len(msg.Body) > m.maxBytes {
		return ErrMessageTooLarge
	}
	q, err := m.getOrCreate(msg.Queue)
	if err != nil {
		return err
	}
	return q.push(cloneMessage(msg))
}

// RemoveByID removes a message by ID from the named queue (replica sync / compensation).
// Returns true if a message was removed.
func (m *Manager) RemoveByID(name, id string) (bool, error) {
	if !ValidName(name) {
		return false, ErrInvalidName
	}
	if id == "" {
		return false, ErrEmptyBody
	}
	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return false, ErrQueueNotFound
	}
	return q.removeByID(id), nil
}

// HasMessage reports whether queue contains message id.
func (m *Manager) HasMessage(name, id string) bool {
	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	return q.hasID(id)
}

// ExportQueue returns a copy of all messages in a queue (FIFO order).
func (m *Manager) ExportQueue(name string) ([]Message, error) {
	if !ValidName(name) {
		return nil, ErrInvalidName
	}
	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return nil, ErrQueueNotFound
	}
	return q.exportMessages(), nil
}

// MessageIDs returns IDs currently in the queue (FIFO order).
func (m *Manager) MessageIDs(name string) ([]string, error) {
	msgs, err := m.ExportQueue(name)
	if err != nil {
		if errors.Is(err, ErrQueueNotFound) {
			return []string{}, nil
		}
		return nil, err
	}
	ids := make([]string, len(msgs))
	for i, msg := range msgs {
		ids[i] = msg.ID
	}
	return ids, nil
}

// PeekFront returns the head message without removing it.
func (m *Manager) PeekFront(name string) (Message, error) {
	if !ValidName(name) {
		return Message{}, ErrInvalidName
	}
	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return Message{}, ErrQueueNotFound
	}
	msg, ok := q.peekFront()
	if !ok {
		return Message{}, ErrQueueEmpty
	}
	return msg, nil
}

// CompareAndPop removes the head only if its ID matches expectedID.
func (m *Manager) CompareAndPop(name, expectedID string) (Message, error) {
	if !ValidName(name) {
		return Message{}, ErrInvalidName
	}
	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return Message{}, ErrQueueNotFound
	}
	msg, ok := q.compareAndPop(expectedID)
	if !ok {
		return Message{}, ErrQueueEmpty
	}
	return msg, nil
}

// PushFront inserts a message at the head (compensation after failed quorum delete).
func (m *Manager) PushFront(name string, msg Message) error {
	if !ValidName(name) {
		return ErrInvalidName
	}
	if msg.Body == "" {
		return ErrEmptyBody
	}
	if len(msg.Body) > m.maxBytes {
		return ErrMessageTooLarge
	}
	q, err := m.getOrCreate(name)
	if err != nil {
		return err
	}
	msg.Queue = name
	return q.pushFront(cloneMessage(msg))
}

// MergeMessages inserts messages missing by ID (catch-up). Preserves FIFO of existing;
// new messages are appended in the order provided. Returns the messages actually added.
func (m *Manager) MergeMessages(name string, msgs []Message) (added []Message, err error) {
	if !ValidName(name) {
		return nil, ErrInvalidName
	}
	for _, msg := range msgs {
		if msg.ID == "" || msg.Body == "" {
			continue
		}
		if len(msg.Body) > m.maxBytes {
			return added, ErrMessageTooLarge
		}
		if m.HasMessage(name, msg.ID) {
			continue
		}
		msg.Queue = name
		if err := m.RestoreMessage(msg); err != nil {
			return added, err
		}
		added = append(added, msg)
	}
	return added, nil
}

func (m *Manager) Dequeue(name string) (Message, error) {
	return m.Read(context.Background(), name, false, 0)
}

func (m *Manager) Read(ctx context.Context, name string, peek bool, timeout time.Duration) (Message, error) {
	if !ValidName(name) {
		return Message{}, ErrInvalidName
	}

	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return Message{}, ErrQueueNotFound
	}

	msg, ok := q.read(ctx, peek, timeout)
	if !ok {
		if err := ctx.Err(); err != nil {
			return Message{}, err
		}
		return Message{}, ErrQueueEmpty
	}
	return msg, nil
}

func (m *Manager) Clear(name string) (int, error) {
	if !ValidName(name) {
		return 0, ErrInvalidName
	}

	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return 0, ErrQueueNotFound
	}

	return q.clear(), nil
}

func (m *Manager) List() []QueueInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]QueueInfo, 0, len(m.queues))
	for name, q := range m.queues {
		out = append(out, QueueInfo{
			Name:  name,
			Depth: q.depth(),
		})
	}
	return out
}

// Stats returns aggregate queue counts for metrics.
func (m *Manager) Stats() ManagerStats {
	m.mu.RLock()
	defer m.mu.RUnlock()

	stats := ManagerStats{
		Queues:      len(m.queues),
		QueueDepths: make(map[string]int, len(m.queues)),
	}
	for name, q := range m.queues {
		depth := q.depth()
		stats.QueueDepths[name] = depth
		stats.Messages += depth
	}
	return stats
}

// ExportSnapshot copies all in-memory queues for persistence.
func (m *Manager) ExportSnapshot() map[string][]Message {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make(map[string][]Message, len(m.queues))
	for name, q := range m.queues {
		msgs := q.exportMessages()
		if len(msgs) == 0 {
			// Keep empty queues so names survive restarts.
			out[name] = []Message{}
			continue
		}
		out[name] = msgs
	}
	return out
}

// ImportSnapshot replaces in-memory queues with the snapshot payload.
// Existing queues are discarded. Invalid names and oversize queues are rejected.
func (m *Manager) ImportSnapshot(data map[string][]Message) error {
	if len(data) > m.maxQueues {
		return ErrQueueLimit
	}

	restored := make(map[string]*Queue, len(data))
	for name, msgs := range data {
		if !ValidName(name) {
			return ErrInvalidName
		}
		if len(msgs) > m.maxDepth {
			return ErrQueueFull
		}
		for _, msg := range msgs {
			if len(msg.Body) > m.maxBytes {
				return ErrMessageTooLarge
			}
		}

		cloned := make([]Message, len(msgs))
		for i, msg := range msgs {
			cloned[i] = cloneMessage(msg)
			if cloned[i].Queue == "" {
				cloned[i].Queue = name
			}
		}
		q := newQueue(name, m.maxDepth)
		q.replaceMessages(cloned)
		restored[name] = q
	}

	m.mu.Lock()
	m.queues = restored
	m.mu.Unlock()
	return nil
}

type QueueInfo struct {
	Name  string `json:"name"`
	Depth int    `json:"depth"`
}

type ManagerStats struct {
	Queues      int
	Messages    int
	QueueDepths map[string]int
}

func (m *Manager) getOrCreate(name string) (*Queue, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if q, ok := m.queues[name]; ok {
		return q, nil
	}
	if len(m.queues) >= m.maxQueues {
		return nil, ErrQueueLimit
	}

	q := newQueue(name, m.maxDepth)
	m.queues[name] = q
	return q, nil
}

func cloneMessage(msg Message) Message {
	out := msg
	out.Metadata = cloneMetadata(msg.Metadata)
	out.Encryption = cloneEncryption(msg.Encryption)
	return out
}

func cloneMetadata(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func cloneEncryption(in *crypto.EncryptionMeta) *crypto.EncryptionMeta {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}
