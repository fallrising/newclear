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
