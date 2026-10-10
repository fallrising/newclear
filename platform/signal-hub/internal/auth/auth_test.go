package auth

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

func secret(t *testing.T, name, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	return "file:" + path
}
func fixture(t *testing.T) (*Authenticator, string, string, string) {
	t.Helper()
	owner := strings.Repeat("o", 32)
	reader := strings.Repeat("r", 32)
	producer := strings.Repeat("p", 32)
	a, err := New([]config.Source{{Name: "release", SourcePrefix: "urn:example:release:", AllowedTypes: []string{"release.deploy.*", "inspection.check.passed"}, TokenRef: secret(t, "source", producer+"\r\n")}}, secret(t, "owner", owner+"\n"), secret(t, "readonly", reader))
	if err != nil {
		t.Fatal(err)
	}
	return a, owner, reader, producer
}
func parsed(t *testing.T, source, typ string) *event.Event {
	t.Helper()
	e, err := event.Parse([]byte(`{"specversion":"1.0","id":"a","source":"` + source + `","type":"` + typ + `","time":"2026-10-03T10:00:00Z"}`))
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestRoleSeparationAndScope(t *testing.T) {
	a, owner, reader, producer := fixture(t)
	for _, tc := range []struct {
		token, role  string
		write, query bool
	}{{owner, OwnerRole, false, true}, {reader, ReadOnlyRole, false, true}, {producer, SourceRole, true, false}} {
		p, ok := a.Authenticate(tc.token)
		if !ok || p.Role != tc.role {
			t.Fatal("authentication failed")
		}
		if Authorize(p, parsed(t, "urn:example:release:main", "release.deploy.succeeded")) != tc.write {
			t.Fatal("incorrect write permission")
		}
		if CanQuery(p) != tc.query {
			t.Fatal("incorrect query permission")
		}
	}
	p, _ := a.Authenticate(producer)
	for _, tc := range []struct {
		source, typ string
		allowed     bool
	}{{"urn:example:release:main", "inspection.check.passed", true}, {"urn:example:other:main", "release.deploy.succeeded", false}, {"urn:example:release-evil:main", "release.deploy.succeeded", false}, {"urn:example:release:main", "release.deployment.succeeded", false}, {"urn:example:release:main", "signalhub.rule.threshold.crossed", false}} {
		if Authorize(p, parsed(t, tc.source, tc.typ)) != tc.allowed {
			t.Errorf("incorrect scope check: %+v", tc)
		}
	}
	for _, token := range []string{"", producer + "\n", "Bearer " + producer, strings.Repeat("x", 32)} {
		if _, ok := a.Authenticate(token); ok {
			t.Error("invalid token authenticated")
		}
	}
	// Caller mutation cannot widen a credential's stored source policy.
	p.Source.SourcePrefix = ""
	p.Source.AllowedTypes[0] = "other.events.*"
	fresh, _ := a.Authenticate(producer)
	if fresh.Source.SourcePrefix == "" || fresh.Source.AllowedTypes[0] != "release.deploy.*" {
		t.Fatal("principal mutates credential policy")
	}
}

func TestSecretValidationAndCollisions(t *testing.T) {
	valid := strings.Repeat("x", 32)
	for _, contents := range []string{"", strings.Repeat("a", 31), valid + "\n\n", valid + " ", valid + "\r", strings.Repeat("é", 32), "=" + valid, valid + "=a"} {
		ref := secret(t, "invalid", contents)
		if _, err := New(nil, ref, ""); err == nil {
			t.Errorf("accepted malformed credential %q", contents)
		}
	}
	ref := secret(t, "duplicate", valid)
	if _, err := New(nil, ref, ref); err == nil {
		t.Fatal("role collision accepted")
	}
	if _, err := New([]config.Source{{TokenRef: ref}}, ref, ""); err == nil {
		t.Fatal("source/owner collision accepted")
	}
	if _, err := New(nil, "", ""); err == nil {
		t.Fatal("missing owner accepted")
	}
	a, err := New(nil, ref, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := a.Authenticate(valid); !ok {
		t.Fatal("optional reader failed")
	}
}
