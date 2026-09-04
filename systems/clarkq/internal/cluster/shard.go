package cluster

import (
	"hash/fnv"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sort"
	"strings"
)

const (
	ForwardHeader    = "X-ClarkQ-Forwarded"
	GenerationHeader = "X-ClarkQ-Generation"
	EpochHeader      = "X-ClarkQ-Epoch"
	CatchUpHeader    = "X-ClarkQ-CatchUp"
)

// Ring maps queue names to owner nodes via consistent hashing (FNV of name).
// When Membership is attached, only *alive* nodes participate in ownership.
type Ring struct {
	Self       string   // this node's advertise URL (normalized, no trailing slash)
	Nodes      []string // configured sorted unique node URLs including self
	Membership *Membership
}

// New builds a shard ring. nodes is a slice of base URLs.
// self must be one of the nodes (or will be appended).
func New(self string, nodes []string) *Ring {
	self = normalizeURL(self)
	set := map[string]struct{}{}
	if self != "" {
		set[self] = struct{}{}
	}
	for _, n := range nodes {
		n = normalizeURL(n)
		if n != "" {
			set[n] = struct{}{}
		}
	}
	list := make([]string, 0, len(set))
	for n := range set {
		list = append(list, n)
	}
	sort.Strings(list)
	if len(list) == 0 {
		return nil
	}
	return &Ring{Self: self, Nodes: list}
}

// Enabled reports multi-node sharding is active (more than one configured node).
func (r *Ring) Enabled() bool {
	return r != nil && len(r.Nodes) > 1 && r.Self != ""
}

// activeNodes is the set used for hashing: alive peers + self, or full config.
func (r *Ring) activeNodes() []string {
	if r == nil {
		return nil
	}
	if r.Membership != nil {
		alive := r.Membership.AliveNodes()
		if len(alive) > 0 {
			return alive
		}
	}
	return r.Nodes
}

// Owner returns the node base URL that owns queueName among active nodes.
func (r *Ring) Owner(queueName string) string {
	nodes := r.activeNodes()
	if len(nodes) == 0 {
		return ""
	}
	if len(nodes) == 1 {
		return nodes[0]
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(queueName))
	idx := int(h.Sum32() % uint32(len(nodes)))
	return nodes[idx]
}

// IsLocal reports whether this node owns the queue (among alive set).
func (r *Ring) IsLocal(queueName string) bool {
	if r == nil || !r.Enabled() {
		return true
	}
	return r.Owner(queueName) == r.Self
}

// ownerIndex returns the index of the primary owner in the active node list.
func (r *Ring) ownerIndex(queueName string) int {
	nodes := r.activeNodes()
	owner := r.Owner(queueName)
	for i, n := range nodes {
		if n == owner {
			return i
		}
	}
	return 0
}

// Replicas returns up to factor nodes responsible for queueName (primary first),
// chosen from the alive set so failover promotes the next live node.
func (r *Ring) Replicas(queueName string, factor int) []string {
	nodes := r.activeNodes()
	if len(nodes) == 0 {
		return nil
	}
	if factor < 1 {
		factor = 1
	}
	if factor > len(nodes) {
		factor = len(nodes)
	}
	start := r.ownerIndex(queueName)
	out := make([]string, 0, factor)
	for i := 0; i < factor; i++ {
		out = append(out, nodes[(start+i)%len(nodes)])
	}
	return out
}

// IsReplica reports whether this node is among the replica set for the queue.
func (r *Ring) IsReplica(queueName string, factor int) bool {
	if r == nil || r.Self == "" {
		return false
	}
	for _, n := range r.Replicas(queueName, factor) {
		if n == r.Self {
			return true
		}
	}
	return false
}

// Peers returns configured peer URLs except self (includes dead peers).
func (r *Ring) Peers() []string {
	if r == nil {
		return nil
	}
	out := make([]string, 0, len(r.Nodes))
	for _, n := range r.Nodes {
		if n != r.Self {
			out = append(out, n)
		}
	}
	return out
}

// AlivePeers returns currently live peer URLs (excludes self).
func (r *Ring) AlivePeers() []string {
	if r == nil {
		return nil
	}
	if r.Membership == nil {
		return r.Peers()
	}
	var out []string
	for _, n := range r.Membership.AliveNodes() {
		if n != r.Self {
			out = append(out, n)
		}
	}
	return out
}

// Generation returns membership generation for fencing headers.
func (r *Ring) Generation() uint64 {
	if r == nil || r.Membership == nil {
		return 0
	}
	return r.Membership.Generation()
}

// Epoch is a deterministic fingerprint of the current alive set.
// All nodes that agree on membership compute the same epoch (no shared counter needed).
// Used for write fencing across partitions with divergent views.
func (r *Ring) Epoch() uint64 {
	if r == nil {
		return 0
	}
	nodes := r.activeNodes()
	if len(nodes) == 0 {
		return 0
	}
	h := fnv.New64a()
	for _, n := range nodes {
		_, _ = h.Write([]byte(n))
		_, _ = h.Write([]byte{0})
	}
	return h.Sum64()
}

// Proxy returns a reverse proxy to the owner node for queueName.
// Returns nil if the request should be handled locally.
func (r *Ring) Proxy(queueName string) *httputil.ReverseProxy {
	if r == nil || !r.Enabled() || r.IsLocal(queueName) {
		return nil
	}
	owner := r.Owner(queueName)
	// If owner is self or empty, local.
	if owner == "" || owner == r.Self {
		return nil
	}
	// Do not proxy to a known-dead peer (handle locally if we are a replica / sole survivor).
	if r.Membership != nil && !r.Membership.IsAlive(owner) {
		return nil
	}
	target, err := url.Parse(owner)
	if err != nil {
		return nil
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	gen := r.Generation()
	epoch := r.Epoch()
	proxy.Director = func(req *http.Request) {
		original(req)
		req.Host = target.Host
		req.Header.Set(ForwardHeader, "1")
		if gen > 0 {
			req.Header.Set(GenerationHeader, formatUint(gen))
		}
		if epoch > 0 {
			req.Header.Set(EpochHeader, formatUint(epoch))
		}
	}
	// On proxy error, fall through is hard with ReverseProxy; leave default error page.
	return proxy
}

func normalizeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimRight(raw, "/")
	return raw
}

// ParseNodes splits a comma-separated peer list.
func ParseNodes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = normalizeURL(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func formatUint(n uint64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
