package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/fallrising/clarkQ/internal/auth"
)

type ctxKey int

const principalKey ctxKey = 1

// Principal describes the authenticated caller.
type Principal struct {
	Method string // "apikey" | "jwt"
	Claims *auth.Claims
}

func principalFrom(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey).(*Principal)
	return p
}

func withPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

func (s *Server) authRequired() bool {
	return len(s.cfg.APIKeys) > 0 || s.jwt != nil
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	if !s.authRequired() {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		p, ok := s.authorize(r)
		if !ok {
			s.writeError(w, errUnauthorized)
			return
		}
		next(w, r.WithContext(withPrincipal(r.Context(), p)))
	}
}

// authorize accepts either a configured API key or a valid JWT bearer token.
func (s *Server) authorize(r *http.Request) (*Principal, bool) {
	if key := strings.TrimSpace(r.Header.Get("X-API-Key")); key != "" {
		if s.validAPIKeyValue(key) {
			return &Principal{Method: "apikey"}, true
		}
	}

	bearer := extractBearer(r)
	if bearer == "" {
		return nil, false
	}

	if s.jwt != nil && auth.LooksLikeJWT(bearer) {
		claims, err := s.jwt.Validate(r.Context(), bearer)
		if err == nil {
			return &Principal{Method: "jwt", Claims: claims}, true
		}
	}

	if s.validAPIKeyValue(bearer) {
		return &Principal{Method: "apikey"}, true
	}
	return nil, false
}

func (s *Server) validAPIKeyValue(key string) bool {
	if key == "" || len(s.cfg.APIKeys) == 0 {
		return false
	}
	for _, allowed := range s.cfg.APIKeys {
		if key == allowed {
			return true
		}
	}
	return false
}

func extractBearer(r *http.Request) string {
	authz := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(authz) < 8 {
		return ""
	}
	if !strings.EqualFold(authz[:7], "bearer ") {
		return ""
	}
	return strings.TrimSpace(authz[7:])
}

// requireACL enforces JWT queue permissions when ACL is enabled.
// API-key principals always pass. When ACL is off, everyone passes.
func (s *Server) requireACL(r *http.Request, queueName, action string) error {
	if !s.cfg.JWTACL {
		return nil
	}
	p := principalFrom(r.Context())
	if p == nil || p.Method == "apikey" {
		return nil
	}
	if auth.AllowQueue(p.Claims, s.cfg.JWTAdminRole, queueName, action) {
		return nil
	}
	return errForbidden
}
