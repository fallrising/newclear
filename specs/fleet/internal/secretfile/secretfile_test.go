package secretfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMerge(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "secrets.env")
	if err := os.WriteFile(p, []byte("RELAY_TOKEN=s3cret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := Merge("LOG_LEVEL=info\n", p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "LOG_LEVEL=info") || !strings.Contains(out, "RELAY_TOKEN=s3cret") {
		t.Fatal(out)
	}
}

func TestMergePreservesDotenvSyntax(t *testing.T) {
	p := filepath.Join(t.TempDir(), "secrets.env")
	secret := "TOKEN='a secret'\n"
	if err := os.WriteFile(p, []byte(secret), 0o600); err != nil {
		t.Fatal(err)
	}
	env := "MULTI='first\nline without equals\nEXTRA=literal'\nDOLLAR='${LITERAL}'\nTAIL=\"ends\\\\\"\n"
	out, err := Merge(env, p)
	if err != nil {
		t.Fatal(err)
	}
	if out != env+secret {
		t.Fatalf("dotenv syntax changed: %q", out)
	}
}
