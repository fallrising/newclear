package cluster

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// PeerInfo is a snapshot of one peer's health.
type PeerInfo struct {
	URL       string    `json:"url"`
	Alive     bool      `json:"alive"`
	LastOK    time.Time `json:"last_ok,omitempty"`
	LastError string    `json:"last_error,omitempty"`
	Failures  int       `json:"failures"`
}

// Membership tracks peer liveness via periodic /health probes.
// Alive set drives owner hashing so dead nodes automatically lose ownership.
type Membership struct {
	self          string
	configured    []string // all configured nodes including self
	interval      time.Duration
	timeout       time.Duration
	failThreshold int
	client        *http.Client

	mu    sync.RWMutex
	peers map[string]*peerState // excludes self

	generation atomic.Uint64
	onChange   func(gen uint64)

	stopCh  chan struct{}
	doneCh  chan struct{}
	running bool
}

// SetOnChange registers a callback invoked when a peer flips alive/dead.
func (m *Membership) SetOnChange(fn func(gen uint64)) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.onChange = fn
	m.mu.Unlock()
}

type peerState struct {
	url       string
	alive     bool
	lastOK    time.Time
	lastError string
	failures  int
}

// MembershipConfig tunes health probing.
type MembershipConfig struct {
	Interval      time.Duration // default 2s
	Timeout       time.Duration // default 1s
	FailThreshold int           // consecutive failures before dead (default 2)
}

// NewMembership creates membership for the given ring node list.
func NewMembership(self string, nodes []string, cfg MembershipConfig) *Membership {
	self = normalizeURL(self)
	if cfg.Interval <= 0 {
		cfg.Interval = 2 * time.Second
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 1 * time.Second
	}
	if cfg.FailThreshold <= 0 {
		cfg.FailThreshold = 2
	}

	set := map[string]struct{}{}
	for _, n := range nodes {
		n = normalizeURL(n)
		if n != "" {
			set[n] = struct{}{}
		}
	}
	if self != "" {
		set[self] = struct{}{}
	}
	list := make([]string, 0, len(set))
	for n := range set {
		list = append(list, n)
	}
	sort.Strings(list)

	m := &Membership{
		self:          self,
		configured:    list,
		interval:      cfg.Interval,
		timeout:       cfg.Timeout,
		failThreshold: cfg.FailThreshold,
		client:        &http.Client{Timeout: cfg.Timeout},
		peers:         make(map[string]*peerState),
	}
	for _, n := range list {
		if n == self {
			continue
		}
		m.peers[n] = &peerState{url: n, alive: true} // optimistic until first probe fails
	}
	m.generation.Store(1)
	return m
}

// Generation increases when the alive set changes (fencing / observability).
func (m *Membership) Generation() uint64 {
	if m == nil {
		return 0
	}
	return m.generation.Load()
}

// Start begins the health probe loop.
func (m *Membership) Start() {
	if m == nil {
		return
	}
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return
	}
	m.stopCh = make(chan struct{})
	m.doneCh = make(chan struct{})
	m.running = true
	m.mu.Unlock()
	go m.loop()
}

// Stop ends probing.
func (m *Membership) Stop() {
	if m == nil {
		return
	}
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return
	}
	close(m.stopCh)
	m.running = false
	done := m.doneCh
	m.mu.Unlock()
	<-done
}

func (m *Membership) loop() {
	defer close(m.doneCh)
	// Immediate first probe.
	m.probeAll()
	t := time.NewTicker(m.interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			m.probeAll()
		case <-m.stopCh:
			return
		}
	}
}

func (m *Membership) probeAll() {
	m.mu.RLock()
	urls := make([]string, 0, len(m.peers))
	for u := range m.peers {
		urls = append(urls, u)
	}
	m.mu.RUnlock()

	for _, u := range urls {
		m.probeOne(u)
	}
}

func (m *Membership) probeOne(peerURL string) {
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, peerURL+"/health", nil)
	alive := false
	errMsg := ""
	if err == nil {
		resp, err2 := m.client.Do(req)
		if err2 != nil {
			errMsg = err2.Error()
		} else {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				alive = true
			} else {
				errMsg = "status " + resp.Status
			}
		}
	} else {
		errMsg = err.Error()
	}

	m.mu.Lock()
	st, ok := m.peers[peerURL]
	if !ok {
		m.mu.Unlock()
		return
	}
	prev := st.alive
	if alive {
		st.alive = true
		st.failures = 0
		st.lastOK = time.Now().UTC()
		st.lastError = ""
	} else {
		st.failures++
		st.lastError = errMsg
		if st.failures >= m.failThreshold {
			st.alive = false
		}
	}
	var (
		gen uint64
		cb  func(uint64)
	)
	if prev != st.alive {
		gen = m.generation.Add(1)
		cb = m.onChange
		slog.Warn("cluster membership changed",
			"peer", peerURL,
			"alive", st.alive,
			"generation", gen,
			"error", st.lastError,
		)
	}
	m.mu.Unlock()
	if cb != nil {
		cb(gen)
	}
}

// AliveNodes returns sorted URLs of live peers plus self (for hashing).
func (m *Membership) AliveNodes() []string {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]string, 0, len(m.configured))
	if m.self != "" {
		out = append(out, m.self)
	}
	for _, st := range m.peers {
		if st.alive {
			out = append(out, st.url)
		}
	}
	sort.Strings(out)
	return out
}

// Snapshot returns peer health for status APIs.
func (m *Membership) Snapshot() []PeerInfo {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]PeerInfo, 0, len(m.peers)+1)
	// Self always alive from our perspective.
	if m.self != "" {
		out = append(out, PeerInfo{URL: m.self, Alive: true, LastOK: time.Now().UTC()})
	}
	for _, st := range m.peers {
		out = append(out, PeerInfo{
			URL:       st.url,
			Alive:     st.alive,
			LastOK:    st.lastOK,
			LastError: st.lastError,
			Failures:  st.failures,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].URL < out[j].URL })
	return out
}

// SetAlive is used by tests to force peer state.
func (m *Membership) SetAlive(peerURL string, alive bool) {
	if m == nil {
		return
	}
	peerURL = normalizeURL(peerURL)
	m.mu.Lock()
	st, ok := m.peers[peerURL]
	if !ok {
		m.mu.Unlock()
		return
	}
	changed := st.alive != alive
	st.alive = alive
	var gen uint64
	var cb func(uint64)
	if changed {
		gen = m.generation.Add(1)
		cb = m.onChange
	}
	if alive {
		st.failures = 0
		st.lastOK = time.Now().UTC()
		st.lastError = ""
	} else {
		st.failures = m.failThreshold
		st.lastError = "forced dead"
	}
	m.mu.Unlock()
	if cb != nil {
		cb(gen)
	}
}

// IsAlive reports whether a peer is currently considered live.
func (m *Membership) IsAlive(peerURL string) bool {
	if m == nil {
		return true
	}
	peerURL = normalizeURL(peerURL)
	if peerURL == m.self {
		return true
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	st, ok := m.peers[peerURL]
	if !ok {
		return false
	}
	return st.alive
}
