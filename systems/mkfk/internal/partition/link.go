package partition

import (
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// link is one peer's bounded send queue. A plain AppendEntries (no read
// context) replaces any queued plain AppendEntries of the same Raft group:
// the newer one starts at the leader's current nextIndex and carries every
// entry the older one did that is not yet acknowledged, so sending both only
// repeats work. Votes and read-barrier appends keep their place.
type link struct {
	mu       sync.Mutex
	queue    []raft.Message
	capacity int
	ready    chan struct{}
}

func newLink(capacity int) *link {
	return &link{capacity: capacity, ready: make(chan struct{}, 1)}
}

// push queues message and reports false when the link is full.
func (l *link) push(message raft.Message) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if supersedes(message) {
		kept := l.queue[:0]
		for _, queued := range l.queue {
			if !supersedes(queued) || queued.Identity.GroupID != message.Identity.GroupID {
				kept = append(kept, queued)
			}
		}
		l.queue = kept
	}
	if len(l.queue) >= l.capacity {
		return false
	}
	l.queue = append(l.queue, message)
	select {
	case l.ready <- struct{}{}:
	default:
	}
	return true
}

// pop takes the oldest queued message.
func (l *link) pop() (raft.Message, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.queue) == 0 {
		return raft.Message{}, false
	}
	message := l.queue[0]
	l.queue = l.queue[1:]
	if len(l.queue) > 0 {
		select {
		case l.ready <- struct{}{}:
		default:
		}
	}
	return message, true
}

func supersedes(message raft.Message) bool {
	return message.Kind == raft.MessageAppendEntries && message.Append != nil && message.Append.ReadContext == ""
}
