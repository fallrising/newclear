package server

import (
	"net/http"

	"github.com/fallrising/clarkQ/internal/cluster"
)

// maybeForward reverse-proxies queue operations to the owning node.
// Returns true if the request was handled (forwarded).
func (s *Server) maybeForward(w http.ResponseWriter, r *http.Request, queueName string) bool {
	if s.cluster == nil || !s.cluster.Enabled() {
		return false
	}
	// Already forwarded once — handle locally to break loops.
	if r.Header.Get(cluster.ForwardHeader) != "" {
		return false
	}
	proxy := s.cluster.Proxy(queueName)
	if proxy == nil {
		return false
	}
	proxy.ServeHTTP(w, r)
	return true
}
