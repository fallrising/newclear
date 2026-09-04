package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/token"
)

func (s *Server) handleLoginGet(w http.ResponseWriter, r *http.Request) {
	if s.isAPIHost(r) {
		writeError(w, http.StatusNotFound, "not_found", "no HTML on API host", nil)
		return
	}
	if s.html != nil {
		s.html.Login(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, `<!doctype html><title>Fleet login</title>
<form method="post" action="/login">
<label>operator token <input name="token" type="password"></label>
<button type="submit">Sign in</button>
</form>`)
}

func (s *Server) handleLoginPost(w http.ResponseWriter, r *http.Request) {
	if s.isAPIHost(r) {
		writeError(w, http.StatusNotFound, "not_found", "no HTML on API host", nil)
		return
	}
	var tok string
	ct := r.Header.Get("Content-Type")
	if strings.Contains(ct, "application/json") {
		var body struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
			return
		}
		tok = body.Token
	} else {
		_ = r.ParseForm()
		tok = r.FormValue("token")
	}
	t, err := s.st.Authenticate(tok)
	if err != nil || t.Kind != token.KindOperator {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid token", nil)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     config.CookieName,
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
	if strings.Contains(r.Header.Get("Accept"), "application/json") || strings.Contains(ct, "application/json") {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	if s.html != nil {
		s.html.Catalog(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, `<!doctype html><title>Fleet Catalog</title><p>catalog</p>`)
}

func (s *Server) handleNodePage(w http.ResponseWriter, r *http.Request) {
	if s.html != nil {
		s.html.Node(w, r, r.PathValue("id"))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, `<!doctype html><title>node</title>`)
}

func (s *Server) handleServicePage(w http.ResponseWriter, r *http.Request) {
	if s.html != nil {
		s.html.Service(w, r, r.PathValue("name"))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, `<!doctype html><title>service</title>`)
}
