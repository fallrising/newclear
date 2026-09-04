package auth

import (
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Claims are JWT claims used for authn + optional queue ACL.
type Claims struct {
	jwt.RegisteredClaims
	// Scope is a space-delimited OAuth2-style scope string.
	Scope string `json:"scope,omitempty"`
	// Scopes is an array form used by some IdPs.
	Scopes []string `json:"scopes,omitempty"`
	// Roles / Role carry coarse authorization (e.g. "admin").
	Roles []string `json:"roles,omitempty"`
	Role  string   `json:"role,omitempty"`
}

// Permission strings extracted from claims.
// Recognized patterns:
//
//	queue:<name>:<action>   action in read|write|admin|*
//	queue:*:<action>
//	queue:<name>:*
//	queue:*:*
//	admin                   full access
func (c *Claims) Permissions() []string {
	if c == nil {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	if c.Scope != "" {
		for _, p := range strings.Fields(c.Scope) {
			add(p)
		}
	}
	for _, p := range c.Scopes {
		add(p)
	}
	return out
}

// AllRoles returns role claim values.
func (c *Claims) AllRoles() []string {
	if c == nil {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(r string) {
		r = strings.TrimSpace(r)
		if r == "" {
			return
		}
		if _, ok := seen[r]; ok {
			return
		}
		seen[r] = struct{}{}
		out = append(out, r)
	}
	add(c.Role)
	for _, r := range c.Roles {
		add(r)
	}
	return out
}
