package api

import (
	"context"
	"net"
	"net/http"
	"strings"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/model"
	"github.com/fallrising/fleet-catalog/internal/token"
)

type ctxKey int

const ctxToken ctxKey = 1

func tokenFrom(ctx context.Context) *model.Token {
	t, _ := ctx.Value(ctxToken).(*model.Token)
	return t
}

func (s *Server) hostOf(r *http.Request) string {
	h := r.Header.Get("X-Forwarded-Host")
	if h == "" {
		h = r.Host
	}
	if h == "" {
		h = r.Header.Get("Host")
	}
	host, _, err := net.SplitHostPort(h)
	if err != nil {
		return strings.ToLower(h)
	}
	return strings.ToLower(host)
}

func (s *Server) isAPIHost(r *http.Request) bool {
	return s.hostOf(r) == strings.ToLower(s.cfg.APIHostname)
}

func (s *Server) isUIHost(r *http.Request) bool {
	h := s.hostOf(r)
	if h == strings.ToLower(s.cfg.UIHostname) {
		return true
	}
	// local bind (no Host match): treat as UI for operator curl
	if !s.isAPIHost(r) && (h == "127.0.0.1" || h == "localhost" || h == "") {
		return true
	}
	return h == strings.ToLower(s.cfg.UIHostname)
}

func bearerOrCookie(r *http.Request) string {
	if a := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(a), "bearer ") {
		return strings.TrimSpace(a[7:])
	}
	if c, err := r.Cookie(config.CookieName); err == nil {
		return c.Value
	}
	return ""
}

func (s *Server) authenticate(r *http.Request) (*model.Token, error) {
	plain := bearerOrCookie(r)
	if plain == "" {
		return nil, storeUnauth()
	}
	return s.st.Authenticate(plain)
}

func storeUnauth() error { return errUnauth }

var errUnauth = statusErr{code: "unauthorized", status: http.StatusUnauthorized, msg: "unauthorized"}

type statusErr struct {
	code   string
	status int
	msg    string
}

func (e statusErr) Error() string { return e.msg }

func (s *Server) require(kinds ...string) func(http.HandlerFunc) http.HandlerFunc {
	set := map[string]struct{}{}
	for _, k := range kinds {
		set[k] = struct{}{}
	}
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			tok, err := s.authenticate(r)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", nil)
				return
			}
			if _, ok := set[tok.Kind]; !ok {
				writeError(w, http.StatusForbidden, "forbidden", "token kind not allowed", nil)
				return
			}
			if tok.Kind == token.KindAgent {
				if id := r.PathValue("id"); id != "" && tok.NodeID != "" && tok.NodeID != id {
					writeError(w, http.StatusForbidden, "node_scope_mismatch", "token is not scoped to this node", nil)
					return
				}
				if hdr := r.Header.Get("X-Fleet-Node"); hdr != "" && hdr != tok.NodeID {
					writeError(w, http.StatusForbidden, "node_scope_mismatch", "X-Fleet-Node mismatch", nil)
					return
				}
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				if !s.originOK(r) {
					writeError(w, http.StatusForbidden, "forbidden", "origin mismatch", nil)
					return
				}
			}
			next(w, r.WithContext(context.WithValue(r.Context(), ctxToken, tok)))
		}
	}
}

func (s *Server) originOK(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	// SameSite cookie + Origin/Host check.
	want := []string{s.cfg.UIHostname, s.cfg.APIHostname, s.hostOf(r)}
	o = strings.ToLower(o)
	for _, h := range want {
		h = strings.ToLower(h)
		if h == "" {
			continue
		}
		if strings.Contains(o, "://"+h) || strings.HasSuffix(o, h) {
			return true
		}
	}
	return false
}

func (s *Server) htmlAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.isAPIHost(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized", "HTML is not served on the API host", nil)
			return
		}
		c, err := r.Cookie(config.CookieName)
		if err != nil || c.Value == "" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`<!doctype html><meta http-equiv="refresh" content="0;url=/login"><p>login required</p>`))
			return
		}
		tok, err := s.st.Authenticate(c.Value)
		if err != nil || tok.Kind != token.KindOperator {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`<!doctype html><meta http-equiv="refresh" content="0;url=/login"><p>login required</p>`))
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxToken, tok)))
	}
}
