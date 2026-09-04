package token

import (
	"strings"
	"testing"
)

func TestGenerateHashOnce(t *testing.T) {
	iss, err := Generate(KindCI)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(iss.Plain, PrefixCI) {
		t.Fatalf("plain %q", iss.Plain)
	}
	if !strings.HasPrefix(iss.Prefix, PrefixCI) {
		t.Fatalf("prefix %q", iss.Prefix)
	}
	if Hash(iss.Plain) != iss.Hash {
		t.Fatal("hash mismatch")
	}
	if iss.Hash == iss.Plain {
		t.Fatal("hash must not equal plaintext")
	}
	if KindFromPlain(iss.Plain) != KindCI {
		t.Fatal("kind")
	}
}

func TestPrefixes(t *testing.T) {
	for _, kind := range []string{KindOperator, KindAgent, KindCI, KindBootstrap} {
		iss, err := Generate(kind)
		if err != nil {
			t.Fatal(err)
		}
		want, _ := PrefixFor(kind)
		if !strings.HasPrefix(iss.Plain, want) {
			t.Fatalf("%s: %s", kind, iss.Plain)
		}
	}
}

func TestUnknownKind(t *testing.T) {
	if _, err := Generate("nope"); err == nil {
		t.Fatal("expected error")
	}
}
