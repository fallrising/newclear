package main

import (
	json "encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func repositoryConfigBytes(t *testing.T, git, dir string) []byte {
	t.Helper()
	data, err := json.Marshal(map[string]any{"schema_version": 1, "repositories": []any{map[string]any{"project_id": testProjectID, "id": "binding", "version": 1, "object_format": "sha1", "configuration_id": "approved-local", "approved_by_actor": "local-operator", "refs": []string{"refs/heads/main"}, "manifest_paths": []string{"manifest.json"}, "git_executable": git, "git_dir": dir}}})
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func writeRepositoryConfig(t *testing.T, git, dir string) string {
	t.Helper()
	path := filepath.Join(privateTestRoot(t), "approved.json")
	if err := os.WriteFile(path, repositoryConfigBytes(t, git, dir), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
func TestRepositoryConfiguration_RejectsUnsafeInput(t *testing.T) {
	root := privateTestRoot(t)
	file := filepath.Join(root, "approved.json")
	valid := repositoryConfigBytes(t, "/usr/bin/git", filepath.Join(root, "repo.git"))
	if got, err := loadRepositoryRegistry("", "local-operator", root); err != nil || got != nil {
		t.Fatalf("unset must stay unavailable: %v %v", got, err)
	}
	if err := os.WriteFile(file, valid, 0600); err != nil {
		t.Fatal(err)
	}
	registry, err := loadRepositoryRegistry(file, "local-operator", root)
	if err != nil {
		t.Fatalf("private positive: %v", err)
	}
	first, err := registry.Lookup(testProjectID, "binding")
	if err != nil {
		t.Fatal(err)
	}
	first.Refs[0] = "refs/heads/evil"
	first.ManifestPaths[0] = "evil.json"
	second, err := registry.Lookup(testProjectID, "binding")
	if err != nil || second.Refs[0] != "refs/heads/main" || second.ManifestPaths[0] != "manifest.json" {
		t.Fatal("registry leaked mutable scopes")
	}
	if _, err := registry.Lookup(domain.ProjectID("another-project"), "binding"); err == nil {
		t.Fatal("cross-project registry lookup")
	}
	cases := map[string][]byte{
		"unknown":          []byte(strings.Replace(string(valid), `"schema_version":1`, `"schema_version":1,"unknown":true`, 1)),
		"duplicate_member": []byte(strings.Replace(string(valid), `"schema_version":1`, `"schema_version":1,"schema_version":1`, 1)),
		"version":          []byte(strings.Replace(string(valid), `"schema_version":1`, `"schema_version":2`, 1)),
		"fraction_schema":  []byte(strings.Replace(string(valid), `"schema_version":1`, `"schema_version":1.0`, 1)),
		"approver":         []byte(strings.Replace(string(valid), `"local-operator"`, `"another-operator"`, 1)),
		"refs_null":        []byte(strings.Replace(string(valid), `["refs/heads/main"]`, `null`, 1)),
		"duplicate_ref":    []byte(strings.Replace(string(valid), `["refs/heads/main"]`, `["refs/heads/main","refs/heads/main"]`, 1)),
		"invalid_ref":      []byte(strings.Replace(string(valid), `refs/heads/main`, `refs/heads/../evil`, 1)),
		"bad_path":         []byte(strings.Replace(string(valid), `manifest.json`, `../manifest.json`, 1)),

		"exponent_version": []byte(strings.Replace(string(valid), `"version":1`, `"version":1e0`, 1)),
		"null_entry":       []byte(`{"schema_version":1,"repositories":[null]}`),
		"oversize":         []byte(strings.Repeat(" ", maximumRepositoryFile+1)),
		"case_variant":     []byte(strings.Replace(string(valid), `"schema_version"`, `"Schema_version"`, 1)),
	}
	var parsed map[string]any
	if err := json.Unmarshal(valid, &parsed); err != nil {
		t.Fatal(err)
	}
	entries := parsed["repositories"].([]any)
	parsed["repositories"] = []any{entries[0], entries[0]}
	cases["duplicate_entry"], _ = json.Marshal(parsed)
	many := make([]any, 33)
	for i := range many {
		many[i] = entries[0]
	}
	parsed["repositories"] = many
	cases["too_many"], _ = json.Marshal(parsed)
	delete(entries[0].(map[string]any), "manifest_paths")
	parsed["repositories"] = []any{entries[0]}
	cases["missing_path"], _ = json.Marshal(parsed)
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(file, data, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := loadRepositoryRegistry(file, "local-operator", root); err == nil {
				t.Fatal("unsafe configuration accepted")
			} else if strings.Contains(err.Error(), root) {
				t.Fatal("private path in error")
			}
		})
	}
	if err := os.WriteFile(file, valid, 0600); err != nil {
		t.Fatal(err)
	}
	t.Run("mode", func(t *testing.T) {
		if err := os.Chmod(file, 0644); err != nil {
			t.Fatal(err)
		}
		defer os.Chmod(file, 0600)
		if _, err := loadRepositoryRegistry(file, "local-operator", root); err == nil {
			t.Fatal("public file accepted")
		}
	})
	t.Run("symlink_file", func(t *testing.T) {
		link := filepath.Join(root, "link")
		if err := os.Symlink(file, link); err != nil {
			t.Fatal(err)
		}
		if _, err := loadRepositoryRegistry(link, "local-operator", root); err == nil {
			t.Fatal("symlink accepted")
		}
	})
	t.Run("symlink_parent", func(t *testing.T) {
		link := filepath.Join(privateTestRoot(t), "link")
		if err := os.Symlink(root, link); err != nil {
			t.Fatal(err)
		}
		if _, err := loadRepositoryRegistry(filepath.Join(link, "approved.json"), "local-operator", root); err == nil {
			t.Fatal("symlink parent accepted")
		}
	})
	t.Run("fifo", func(t *testing.T) {
		fifo := filepath.Join(root, "fifo")
		if err := syscall.Mkfifo(fifo, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadRepositoryRegistry(fifo, "local-operator", root); err == nil {
			t.Fatal("FIFO accepted")
		}
	})
	t.Run("directory", func(t *testing.T) {
		if _, err := loadRepositoryRegistry(root, "local-operator", root); err == nil {
			t.Fatal("directory accepted")
		}
	})
	t.Run("hardlink", func(t *testing.T) {
		link := filepath.Join(root, "hardlink")
		if err := os.Link(file, link); err != nil {
			t.Fatal(err)
		}
		if _, err := loadRepositoryRegistry(link, "local-operator", root); err == nil {
			t.Fatal("hardlink accepted")
		}
	})
	t.Run("relative", func(t *testing.T) {
		if _, err := loadRepositoryRegistry("approved.json", "local-operator", root); err == nil {
			t.Fatal("relative file accepted")
		}
	})
	t.Run("wrong_owner", func(t *testing.T) {
		if os.Geteuid() != 0 {
			t.Log("ownership change is unavailable to this unprivileged process; UID comparison covered by implementation")
			return
		}
		owned := filepath.Join(root, "foreign.json")
		if err := os.WriteFile(owned, valid, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chown(owned, 65534, 65534); err != nil {
			t.Fatal(err)
		}
		defer os.Chown(owned, 0, 0)
		if _, err := loadRepositoryRegistry(owned, "local-operator", root); err == nil {
			t.Fatal("foreign owner accepted")
		}
	})
}
