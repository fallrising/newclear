package port

import (
	"bytes"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

func TestRepositoryBinding_CanonicalAuthority(t *testing.T) {
	approved := ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: "project", ID: "binding", Version: 1, ObjectFormat: specification.SHA1}, ConfigurationID: "local-1", ApprovedBy: "operator", Refs: []string{"refs/tags/v1", "refs/heads/main"}, ManifestPaths: []string{"z.json", "a.json"}}
	canonical, digest, err := CanonicalRepositoryBinding(approved)
	if err != nil {
		t.Fatal(err)
	}
	approved.Binding.Digest = digest
	decoded, err := DecodeRepositoryBinding(canonical, digest)
	if err != nil || decoded.Binding != approved.Binding {
		t.Fatalf("binding decode %v", err)
	}
	approved.Refs = []string{"refs/heads/main", "refs/tags/v1"}
	approved.ManifestPaths = []string{"a.json", "z.json"}
	sorted, again, err := CanonicalRepositoryBinding(approved)
	if err != nil || again != digest || !bytes.Equal(sorted, canonical) {
		t.Fatal("allowlist order changes identity")
	}
	for _, path := range []string{".", "../a", "a//b", "a/../b", "/absolute", "a:b", "a b", "a\n.json"} {
		t.Run("path_"+path, func(t *testing.T) {
			copy := approved
			copy.ManifestPaths = []string{path}
			if _, _, err := CanonicalRepositoryBinding(copy); err == nil {
				t.Fatal("invalid path accepted")
			}
		})
	}
	for _, ref := range []string{"HEAD", "refs/other/a", "refs/heads/", "refs/heads/.hidden", "refs/heads/a.lock", "refs/heads/a.", "refs/heads/a@{b}", "refs/heads/a//b", "refs/heads/a b"} {
		t.Run("ref_"+ref, func(t *testing.T) {
			copy := approved
			copy.Refs = []string{ref}
			if _, _, err := CanonicalRepositoryBinding(copy); err == nil {
				t.Fatal("invalid ref accepted")
			}
		})
	}
	for _, kind := range []string{"empty", "duplicate", "zero_version", "bad_identity", "claimed_digest"} {
		t.Run(kind, func(t *testing.T) {
			copy := approved
			switch kind {
			case "empty":
				copy.Refs = nil
			case "duplicate":
				copy.Refs = []string{"refs/heads/main", "refs/heads/main"}
			case "zero_version":
				copy.Binding.Version = 0
			case "bad_identity":
				copy.ConfigurationID = "/private/path"
			case "claimed_digest":
				copy.Binding.Digest = domain.HashString("forged")
			}
			if err := VerifyRepositoryBinding(copy, canonical); err == nil {
				t.Fatal("invalid binding verified")
			}
		})
	}
}
