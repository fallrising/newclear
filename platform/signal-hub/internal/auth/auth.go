// Package auth authenticates bearer credentials and enforces the distinct
// producer and query roles. Only SHA-256 hashes remain after initialization.
package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"os"
	"strings"

	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

const (
	SourceRole   = "source"
	OwnerRole    = "owner"
	ReadOnlyRole = "readonly"
)

type Principal struct {
	Role   string
	Source *config.Source
}
type credential struct {
	hash      [32]byte
	principal Principal
}
type Authenticator struct{ credentials []credential }

// New loads required owner and source credentials and an optional read-only
// credential. Files contain at least 32 ASCII bearer characters; exactly one
// final LF or CRLF is ignored. All other whitespace is rejected. Duplicate
// credentials across any roles or sources fail initialization.
func New(sources []config.Source, ownerRef, readonlyRef string) (*Authenticator, error) {
	a := &Authenticator{}
	add := func(ref string, p Principal) error {
		hash, err := loadHash(ref)
		if err != nil {
			return err
		}
		for _, c := range a.credentials {
			if subtle.ConstantTimeCompare(c.hash[:], hash[:]) == 1 {
				return fmt.Errorf("credential collision")
			}
		}
		a.credentials = append(a.credentials, credential{hash: hash, principal: p})
		return nil
	}
	if err := add(ownerRef, Principal{Role: OwnerRole}); err != nil {
		return nil, fmt.Errorf("owner credential: %w", err)
	}
	if readonlyRef != "" {
		if err := add(readonlyRef, Principal{Role: ReadOnlyRole}); err != nil {
			return nil, fmt.Errorf("read-only credential: %w", err)
		}
	}
	for _, source := range sources {
		s := source
		s.AllowedTypes = append([]string(nil), source.AllowedTypes...)
		if err := add(s.TokenRef, Principal{Role: SourceRole, Source: &s}); err != nil {
			return nil, fmt.Errorf("source credential: %w", err)
		}
	}
	return a, nil
}

func loadHash(ref string) ([32]byte, error) {
	var zero [32]byte
	if !config.ValidTokenRef(ref) {
		return zero, fmt.Errorf("credential requires an absolute file reference")
	}
	raw, err := os.ReadFile(strings.TrimPrefix(ref, "file:"))
	if err != nil {
		return zero, fmt.Errorf("cannot read credential file")
	}
	defer func() {
		for i := range raw {
			raw[i] = 0
		}
	}()
	token := raw
	if len(token) > 0 && token[len(token)-1] == '\n' {
		token = token[:len(token)-1]
		if len(token) > 0 && token[len(token)-1] == '\r' {
			token = token[:len(token)-1]
		}
	}
	if len(token) < 32 || !validBearer(token) {
		return zero, fmt.Errorf("credential must contain at least 32 ASCII bearer characters")
	}
	return sha256.Sum256(token), nil
}

func validBearer(token []byte) bool {
	if len(token) == 0 {
		return false
	}
	padding := false
	for _, c := range token {
		if c == '=' {
			padding = true
			continue
		}
		if padding {
			return false
		}
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("-._~+/", rune(c))) {
			return false
		}
	}
	return token[0] != '='
}

// Authenticate accepts the token bytes, without the HTTP Bearer prefix.
func (a *Authenticator) Authenticate(bearer string) (Principal, bool) {
	if !validBearer([]byte(bearer)) {
		return Principal{}, false
	}
	hash := sha256.Sum256([]byte(bearer))
	found := -1
	for i, c := range a.credentials {
		if subtle.ConstantTimeCompare(c.hash[:], hash[:]) == 1 {
			found = i
		}
	}
	if found < 0 {
		return Principal{}, false
	}
	p := a.credentials[found].principal
	if p.Source != nil {
		s := *p.Source
		s.AllowedTypes = append([]string(nil), s.AllowedTypes...)
		p.Source = &s
	}
	return p, true
}

// Authorize permits only source principals to write their registered scope.
// Owner and read-only credentials deliberately do not confer ingest rights.
func Authorize(p Principal, e *event.Event) bool {
	if p.Role != SourceRole || p.Source == nil || e == nil {
		return false
	}
	source, ok := e.Fields["source"].(string)
	if !ok || !strings.HasPrefix(source, p.Source.SourcePrefix) || strings.HasPrefix(source, "urn:signalhub:sources:") {
		return false
	}
	typ, ok := e.Fields["type"].(string)
	if !ok || strings.HasPrefix(typ, "signalhub.") {
		return false
	}
	for _, pattern := range p.Source.AllowedTypes {
		if pattern == typ || strings.HasSuffix(pattern, ".*") && strings.HasPrefix(typ, strings.TrimSuffix(pattern, "*")) {
			return true
		}
	}
	return false
}

func CanQuery(p Principal) bool { return p.Role == OwnerRole || p.Role == ReadOnlyRole }
