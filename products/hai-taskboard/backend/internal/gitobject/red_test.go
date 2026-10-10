package gitobject

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

const realManifest = `{"schema_version":1,"nodes":[{"id":"SPEC-A","path":"a.md","required":true,"work_item_ids":["wi_A"],"required_ac_revisions":[{"ac_id":"AC-A","ac_revision_digest":"1111111111111111111111111111111111111111111111111111111111111111"}],"recipe_digest":"2222222222222222222222222222222222222222222222222222222222222222"}],"edges":[]}`
const realSource = "Committed source\n"

func gitFixtureCommand(t *testing.T, dir string, input []byte, args ...string) string {
	t.Helper()
	cmd := exec.Command("/usr/bin/git", args...)
	cmd.Dir = dir
	cmd.Env = []string{"HOME=" + dir, "LC_ALL=C", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid"}
	cmd.Stdin = bytes.NewReader(input)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("fixture Git failed: %v: %s", err, out)
	}
	return strings.TrimSpace(string(out))
}
func realObjectHash(format specification.ObjectFormat, kind string, data []byte) string {
	raw := append([]byte(fmt.Sprintf("%s %d\x00", kind, len(data))), data...)
	if format == specification.SHA1 {
		s := sha1.Sum(raw)
		return hex.EncodeToString(s[:])
	}
	s := sha256.Sum256(raw)
	return hex.EncodeToString(s[:])
}
func realFixture(t *testing.T, format specification.ObjectFormat, packed bool) (Config, specification.Request, string) {
	t.Helper()
	dir := t.TempDir()
	gitFixtureCommand(t, dir, nil, "init", "--object-format="+string(format), "--initial-branch=main")
	m := gitFixtureCommand(t, dir, []byte(realManifest), "hash-object", "-w", "--stdin")
	s := gitFixtureCommand(t, dir, []byte(realSource), "hash-object", "-w", "--stdin")
	if m != realObjectHash(format, "blob", []byte(realManifest)) || s != realObjectHash(format, "blob", []byte(realSource)) {
		t.Fatal("Git fixture blob identity mismatch")
	}
	tr := gitFixtureCommand(t, dir, []byte("100644 blob "+s+"\ta.md\n100644 blob "+m+"\tmanifest.json\n"), "mktree")
	raw := []byte("tree " + tr + "\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n")
	c := gitFixtureCommand(t, dir, raw, "hash-object", "-t", "commit", "-w", "--stdin")
	if c != realObjectHash(format, "commit", raw) {
		t.Fatal("Git fixture commit identity mismatch")
	}
	gitFixtureCommand(t, dir, nil, "update-ref", "refs/heads/main", c)
	if packed {
		gitFixtureCommand(t, dir, nil, "repack", "-ad")
		gitFixtureCommand(t, dir, nil, "prune-packed")
		gitFixtureCommand(t, dir, nil, "pack-refs", "--all", "--prune")
	}
	if err := os.WriteFile(filepath.Join(dir, "a.md"), []byte("dirty uncommitted"), 0600); err != nil {
		t.Fatal(err)
	}
	config := Config{GitExecutable: "/usr/bin/git", GitDir: filepath.Join(dir, ".git"), ScratchDir: t.TempDir(), ObjectFormat: format, AllowedRefs: []string{"refs/heads/main"}}
	request := specification.Request{Binding: specification.RepositoryBinding{ProjectID: "project", ID: "binding", Version: 1, Digest: domain.HashString("approved"), ObjectFormat: format}, Ref: "refs/heads/main", ManifestPath: "manifest.json"}
	return config, request, c
}
func TestGitReader_RealObjectsAndRefCapture(t *testing.T) {
	for _, format := range []specification.ObjectFormat{specification.SHA1, specification.SHA256} {
		for _, packed := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/packed=%t/valid_real_import", format, packed), func(t *testing.T) {
				config, request, commit := realFixture(t, format, packed)
				r, err := New(config)
				if err != nil {
					t.Fatal(err)
				}
				snap, err := r.Open(context.Background(), request.Ref)
				if err != nil {
					t.Fatalf("valid immutable Git capture failed: %v", err)
				}
				if snap.Commit().String() != commit {
					t.Fatal("capture mismatch")
				}
				if err := snap.Close(); err != nil {
					t.Fatal(err)
				}
				p, err := specification.Import(t.Context(), r, request)
				if err != nil {
					t.Fatalf("valid real import failed: %v", err)
				}
				if p.Commit().String() != commit || len(p.Nodes()) != 1 || p.Nodes()[0].ContentDigest != domain.HashString(realSource) {
					t.Fatal("real object provenance mismatch")
				}
			})
		}
	}
	realControls(t)
}
