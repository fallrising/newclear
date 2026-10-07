package partition

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

const (
	DefaultLinkQueue   = 256
	DefaultPeerTimeout = time.Second
)

var ErrUnknownGroup = errors.New("no local actor serves this Raft group")

// Remote carries a peer request to another broker and returns the responses
// that broker addressed back to the sender.
type Remote interface {
	Step(ctx context.Context, request raft.Message) ([]raft.Message, error)
}

// Registry maps Raft group IDs to this broker's actors. It routes inbound
// requests (Step) and responses (Deliver) to the owning actor.
type Registry struct {
	mu     sync.RWMutex
	actors map[string]*Actor
}

func NewRegistry() *Registry {
	return &Registry{actors: make(map[string]*Actor)}
}

func (r *Registry) Add(group string, actor *Actor) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.actors[group] = actor
}

func (r *Registry) actor(group string) *Actor {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.actors[group]
}

func (r *Registry) Step(ctx context.Context, request raft.Message) ([]raft.Message, error) {
	actor := r.actor(request.Identity.GroupID)
	if actor == nil {
		return nil, ErrUnknownGroup
	}
	return actor.Step(ctx, request)
}

func (r *Registry) Deliver(message raft.Message) bool {
	actor := r.actor(message.Identity.GroupID)
	return actor != nil && actor.Deliver(message)
}

// Outbox is a broker's Sender: one bounded link per peer, so a slow or
// partitioned peer delays only its own link. Responses are delivered back to
// the local registry. A full link drops the message; Raft retransmits.
type Outbox struct {
	local   *Registry
	links   map[uint32]*link
	remotes map[uint32]Remote
	timeout time.Duration
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	dropped atomic.Uint64
	failed  atomic.Uint64
}

func NewOutbox(local *Registry, remotes map[uint32]Remote, queue int, timeout time.Duration) (*Outbox, error) {
	if local == nil || len(remotes) == 0 {
		return nil, errors.New("local registry and remotes are required")
	}
	if queue == 0 {
		queue = DefaultLinkQueue
	}
	if timeout == 0 {
		timeout = DefaultPeerTimeout
	}
	if queue < 0 || timeout < 0 {
		return nil, errors.New("link queue and timeout must be positive")
	}
	outbox := &Outbox{
		local: local, links: make(map[uint32]*link), remotes: make(map[uint32]Remote),
		timeout: timeout,
	}
	outbox.ctx, outbox.cancel = context.WithCancel(context.Background())
	for peer, remote := range remotes {
		if remote == nil {
			return nil, errors.New("remote is required")
		}
		outbox.remotes[peer] = remote
		outbox.links[peer] = newLink(queue)
	}
	for peer := range outbox.links {
		outbox.wg.Add(1)
		go outbox.run(peer)
	}
	return outbox, nil
}

func (o *Outbox) Send(message raft.Message) {
	link, known := o.links[message.To]
	if !known || !link.push(message) {
		o.dropped.Add(1)
	}
}

// Dropped counts messages discarded on full or unknown links; Failed counts
// requests whose peer call returned an error.
func (o *Outbox) Dropped() uint64 { return o.dropped.Load() }
func (o *Outbox) Failed() uint64  { return o.failed.Load() }

// Close stops every link worker and waits for in-flight calls to return.
func (o *Outbox) Close() {
	o.cancel()
	o.wg.Wait()
}

func (o *Outbox) run(peer uint32) {
	defer o.wg.Done()
	link, remote := o.links[peer], o.remotes[peer]
	for {
		select {
		case <-o.ctx.Done():
			return
		case <-link.ready:
		}
		for {
			message, ok := link.pop()
			if !ok || o.ctx.Err() != nil {
				break
			}
			o.call(remote, message)
		}
	}
}

func (o *Outbox) call(remote Remote, message raft.Message) {
	ctx, cancel := context.WithTimeout(o.ctx, o.timeout)
	defer cancel()
	replies, err := remote.Step(ctx, message)
	if err != nil {
		o.failed.Add(1)
		return
	}
	for _, reply := range replies {
		o.local.Deliver(reply)
	}
}
