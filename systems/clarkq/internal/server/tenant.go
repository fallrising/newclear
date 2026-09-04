package server

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// tenantTracker enforces multi-tenant resource quotas.
type tenantTracker struct {
	mu sync.Mutex

	// queue owner tenant: queue name -> tenant
	queueTenant map[string]string
	// per-tenant queue set
	queues map[string]map[string]struct{}
	// enqueue rate: tenant -> sliding window timestamps
	enqueues map[string][]time.Time

	maxQueues      int
	maxDepth       int // max messages per tenant (sum of depths)
	maxEnqueueRate int // per second; 0 = unlimited
	header         string
	claim          string
}

func newTenantTracker(maxQueues, maxDepth, maxRate int, header, claim string) *tenantTracker {
	if header == "" {
		header = "X-Tenant-ID"
	}
	if claim == "" {
		claim = "tenant"
	}
	return &tenantTracker{
		queueTenant:    make(map[string]string),
		queues:         make(map[string]map[string]struct{}),
		enqueues:       make(map[string][]time.Time),
		maxQueues:      maxQueues,
		maxDepth:       maxDepth,
		maxEnqueueRate: maxRate,
		header:         header,
		claim:          claim,
	}
}

func (s *Server) tenantsEnabled() bool {
	return s.cfg.TenantQuotas && s.tenants != nil
}

func (s *Server) resolveTenant(r *http.Request) string {
	if !s.tenantsEnabled() {
		return ""
	}
	if h := strings.TrimSpace(r.Header.Get(s.tenants.header)); h != "" {
		return h
	}
	// JWT claim
	if p := principalFrom(r.Context()); p != nil && p.Claims != nil {
		// MapClaims-style fields aren't on RegisteredClaims; use Scope custom via raw?
		// We store tenant in a simple way: check Authorization already validated;
		// use header primarily. For JWT, allow claim via Scope field misuse — better parse from custom.
	}
	// Optional: metadata on enqueue is checked separately in checkEnqueueQuota
	return "default"
}

// tenantFromRequest uses header, then JWT custom claim via token re-parse is heavy;
// use header or "default". Also allow query ?tenant= for demos.
func (s *Server) tenantFromRequest(r *http.Request) string {
	if !s.tenantsEnabled() {
		return ""
	}
	if h := strings.TrimSpace(r.Header.Get(s.tenants.header)); h != "" {
		return h
	}
	if q := strings.TrimSpace(r.URL.Query().Get("tenant")); q != "" {
		return q
	}
	if p := principalFrom(r.Context()); p != nil && p.Method == "jwt" && p.Claims != nil {
		// Prefer sub as weak tenant if claim name is "sub"
		if s.tenants.claim == "sub" && p.Claims.Subject != "" {
			return p.Claims.Subject
		}
	}
	return "default"
}

func (t *tenantTracker) checkEnqueue(tenant, queue string, currentTenantMessages int) error {
	if t == nil || tenant == "" {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	// Bind queue to tenant on first use.
	if owner, ok := t.queueTenant[queue]; ok && owner != tenant {
		return errTenantForbidden
	}
	if _, ok := t.queueTenant[queue]; !ok {
		// new queue for tenant
		set := t.queues[tenant]
		if set == nil {
			set = make(map[string]struct{})
			t.queues[tenant] = set
		}
		if t.maxQueues > 0 && len(set) >= t.maxQueues {
			if _, exists := set[queue]; !exists {
				return errTenantQuota
			}
		}
		t.queueTenant[queue] = tenant
		set[queue] = struct{}{}
	}

	if t.maxDepth > 0 && currentTenantMessages >= t.maxDepth {
		return errTenantQuota
	}

	if t.maxEnqueueRate > 0 {
		now := time.Now()
		window := t.enqueues[tenant]
		// drop older than 1s
		cutoff := now.Add(-time.Second)
		n := window[:0]
		for _, ts := range window {
			if ts.After(cutoff) {
				n = append(n, ts)
			}
		}
		if len(n) >= t.maxEnqueueRate {
			t.enqueues[tenant] = n
			return errTenantRate
		}
		n = append(n, now)
		t.enqueues[tenant] = n
	}
	return nil
}

func (t *tenantTracker) noteQueue(tenant, queue string) {
	if t == nil || tenant == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.queueTenant[queue]; !ok {
		t.queueTenant[queue] = tenant
		set := t.queues[tenant]
		if set == nil {
			set = make(map[string]struct{})
			t.queues[tenant] = set
		}
		set[queue] = struct{}{}
	}
}

func (s *Server) tenantMessageCount(tenant string) int {
	if s.tenants == nil || tenant == "" {
		return 0
	}
	s.tenants.mu.Lock()
	queues := s.tenants.queues[tenant]
	names := make([]string, 0, len(queues))
	for q := range queues {
		names = append(names, q)
	}
	s.tenants.mu.Unlock()

	total := 0
	for _, q := range names {
		for _, info := range s.manager.List() {
			if info.Name == q {
				total += info.Depth
			}
		}
	}
	return total
}

func (s *Server) checkTenantEnqueue(r *http.Request, queueName string) (tenant string, err error) {
	if !s.tenantsEnabled() {
		return "", nil
	}
	tenant = s.tenantFromRequest(r)
	msgs := s.tenantMessageCount(tenant)
	if err := s.tenants.checkEnqueue(tenant, queueName, msgs); err != nil {
		return tenant, err
	}
	return tenant, nil
}
