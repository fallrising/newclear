package gitobject

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

func expectCode(t *testing.T, err error, code specification.ErrorCode) {
	t.Helper()
	typed, ok := errors.AsType[*specification.Error](err)
	if !ok || typed.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}
func mustWrite(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}
func assertEmptyScratch(t *testing.T, path string) {
	t.Helper()
	f, e := os.Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	entries, e := f.ReadDir(10)
	if e != nil && e != io.EOF {
		t.Fatal(e)
	}
	if len(entries) != 0 {
		t.Fatalf("facade leaked: %v", entries)
	}
}

type snapshotReader struct {
	snapshot specification.Snapshot
	opens    int
}

func (r *snapshotReader) Open(context.Context, string) (specification.Snapshot, error) {
	r.opens++
	return r.snapshot, nil
}
func readID(t *testing.T, format specification.ObjectFormat, s string) specification.ObjectID {
	t.Helper()
	id, e := specification.ParseObjectID(format, s)
	if e != nil {
		t.Fatal(e)
	}
	return id
}
func realControls(t *testing.T) {
	for _, format := range []specification.ObjectFormat{specification.SHA1, specification.SHA256} {
		for _, packed := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/packed=%t/captured_ref_moves_and_object_hashes", format, packed), func(t *testing.T) {
				config, q, commit := realFixture(t, format, packed)
				r, e := New(config)
				if e != nil {
					t.Fatal(e)
				}
				s, e := r.Open(t.Context(), q.Ref)
				if e != nil {
					t.Fatal(e)
				}
				o, e := s.ReadObject(t.Context(), s.Commit(), 1<<20)
				if e != nil || o.Kind != specification.CommitObject || realObjectHash(format, "commit", o.Data) != commit {
					t.Fatalf("raw commit %v", e)
				}
				treeOID := strings.Split(strings.Split(string(o.Data), "\n")[0], " ")[1]
				tree, e := s.ReadObject(t.Context(), readID(t, format, treeOID), 4<<20)
				if e != nil || tree.Kind != specification.TreeObject || realObjectHash(format, "tree", tree.Data) != treeOID {
					t.Fatalf("tree hash %v", e)
				}
				src := realObjectHash(format, "blob", []byte(realSource))
				manifest := realObjectHash(format, "blob", []byte(realManifest))
				sourceRaw, _ := hex.DecodeString(src)
				manifestRaw, _ := hex.DecodeString(manifest)
				expectedTree := append([]byte("100644 a.md\x00"), sourceRaw...)
				expectedTree = append(expectedTree, []byte("100644 manifest.json\x00")...)
				expectedTree = append(expectedTree, manifestRaw...)
				if !bytes.Equal(tree.Data, expectedTree) {
					t.Fatal("real raw tree differs from independent bytes")
				}
				sourceOID := readID(t, format, src)
				object, e := s.ReadObject(t.Context(), sourceOID, 10<<20)
				if e != nil || string(object.Data) != realSource {
					t.Fatalf("dirty working-tree affected blob: %v", e)
				}
				// Replace the source ref with malformed content: acquired capture remains valid.
				mustWrite(t, filepath.Join(config.GitDir, q.Ref), []byte("ref: refs/heads/other\n"))
				cr := &snapshotReader{snapshot: s}
				p, e := specification.Import(t.Context(), cr, q)
				if e != nil || p.Commit().String() != commit || cr.opens != 1 {
					t.Fatalf("second ref resolution occurred: %v", e)
				}
				assertEmptyScratch(t, config.ScratchDir)
				if _, e := r.Open(t.Context(), q.Ref); e == nil {
					t.Fatal("new Open accepted malformed moved ref")
				}
				assertEmptyScratch(t, config.ScratchDir)
			})
		}
	}
	for _, format := range []specification.ObjectFormat{specification.SHA1, specification.SHA256} {
		t.Run(string(format)+"/tags_missing_and_wrong_type", func(t *testing.T) {
			cfg, q, commit := realFixture(t, format, false)
			dir := filepath.Dir(cfg.GitDir)
			gitFixtureCommand(t, dir, nil, "tag", "lightweight", commit)
			gitFixtureCommand(t, dir, nil, "tag", "-am", "annotated", "annotated", commit)
			cfg.AllowedRefs = []string{"refs/heads/main", "refs/tags/lightweight", "refs/tags/annotated"}
			r, e := New(cfg)
			if e != nil {
				t.Fatal(e)
			}
			q.Ref = "refs/tags/lightweight"
			if _, e := specification.Import(t.Context(), r, q); e != nil {
				t.Fatal(e)
			}
			q.Ref = "refs/tags/annotated"
			_, e = specification.Import(t.Context(), r, q)
			expectCode(t, e, specification.Integrity)
			assertEmptyScratch(t, cfg.ScratchDir)
			q.Ref = "refs/heads/main"
			blob := realObjectHash(format, "blob", []byte(realSource))
			mustWrite(t, filepath.Join(cfg.GitDir, q.Ref), []byte(blob+"\n"))
			_, e = specification.Import(t.Context(), r, q)
			expectCode(t, e, specification.Integrity)
			mustWrite(t, filepath.Join(cfg.GitDir, q.Ref), []byte(commit+"\n"))
			if e := os.Remove(filepath.Join(cfg.GitDir, "objects", blob[:2], blob[2:])); e != nil {
				t.Fatal(e)
			}
			_, e = specification.Import(t.Context(), r, q)
			expectCode(t, e, specification.Unavailable)
			assertEmptyScratch(t, cfg.ScratchDir)
		})
	}
	t.Run("packed_unrelated_refs_and_relevant_corruption", func(t *testing.T) {
		cfg, q, commit := realFixture(t, specification.SHA1, true)
		r, e := New(cfg)
		if e != nil {
			t.Fatal(e)
		}
		data := []byte("# pack-refs with: peeled fully-peeled sorted\n" + commit + " refs/remotes/origin/main\n" + commit + " refs/replace/" + commit + "\n" + commit + " " + q.Ref + "\n^" + commit + "\n")
		mustWrite(t, filepath.Join(cfg.GitDir, "packed-refs"), data)
		if _, e := specification.Import(t.Context(), r, q); e != nil {
			t.Fatal(e)
		}
		for _, raw := range []string{commit + " " + q.Ref + "\n" + commit + " " + q.Ref + "\n", "bad " + q.Ref + "\n", "^" + commit + "\n", commit + " " + q.Ref + "\n^bad\n"} {
			mustWrite(t, filepath.Join(cfg.GitDir, "packed-refs"), []byte(raw))
			if _, e := r.Open(t.Context(), q.Ref); e == nil {
				t.Fatal("malformed relevant packed record accepted")
			}
			assertEmptyScratch(t, cfg.ScratchDir)
		}
	})
}
func TestGitReader_Confinement(t *testing.T) {
	for _, format := range []specification.ObjectFormat{specification.SHA1, specification.SHA256} {
		for _, packed := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/packed=%t/hostile_config_environment_and_missing_no_fetch", format, packed), func(t *testing.T) {
				cfg, q, commit := realFixture(t, format, packed)
				dir := filepath.Dir(cfg.GitDir)
				marker := filepath.Join(t.TempDir(), "executed")
				helper := filepath.Join(t.TempDir(), "evil")
				mustWrite(t, helper, []byte("#!/bin/sh\n/usr/bin/touch "+marker+"\nexit 1\n"))
				if e := os.Chmod(helper, 0700); e != nil {
					t.Fatal(e)
				}
				include := filepath.Join(t.TempDir(), "included")
				mustWrite(t, include, []byte("[core]\n hooksPath="+filepath.Dir(helper)+"\n"))
				hostile := "[include]\n path=" + include + "\n[core]\n hooksPath=" + filepath.Dir(helper) + "\n[filter \"evil\"]\n clean=" + helper + "\n smudge=" + helper + "\n[diff \"evil\"]\n textconv=" + helper + "\n[remote \"origin\"]\n url=ext::" + helper + "\n promisor=true\n[extensions]\n partialClone=origin\n[credential]\n helper=" + helper + "\n"
				mustWrite(t, filepath.Join(cfg.GitDir, "config"), []byte(hostile))
				mustWrite(t, filepath.Join(cfg.GitDir, "hooks", "post-checkout"), []byte("#!/bin/sh\n"+helper+"\n"))
				mustWrite(t, filepath.Join(cfg.GitDir, "info", "grafts"), []byte(commit+"\n"))
				mustWrite(t, filepath.Join(cfg.GitDir, "info", "attributes"), []byte("* filter=evil diff=evil\n"))
				mustWrite(t, filepath.Join(dir, ".gitattributes"), []byte("* filter=evil diff=evil\n"))
				mustWrite(t, filepath.Join(cfg.GitDir, "refs", "replace", commit), []byte(strings.Repeat("1", len(commit))+"\n"))
				// Poison inherited variables only after fixture generation. The production
				// command must receive exactly its replacement environment.
				for key, value := range map[string]string{"PATH": filepath.Dir(helper), "HOME": filepath.Dir(helper), "XDG_CONFIG_HOME": filepath.Dir(helper), "GIT_CONFIG_SYSTEM": include, "GIT_CONFIG_GLOBAL": include, "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.hooksPath", "GIT_CONFIG_VALUE_0": filepath.Dir(helper), "GIT_OBJECT_DIRECTORY": filepath.Dir(helper), "GIT_ALTERNATE_OBJECT_DIRECTORIES": filepath.Dir(helper), "GIT_DIR": filepath.Dir(helper), "GIT_WORK_TREE": filepath.Dir(helper), "GIT_SSH_COMMAND": helper, "GIT_PROXY_COMMAND": helper, "HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1", "SECRET_PROVIDER_TOKEN": "should-not-inherit"} {
					t.Setenv(key, value)
				}
				before, e := os.ReadFile(filepath.Join(cfg.GitDir, "config"))
				if e != nil {
					t.Fatal(e)
				}
				r, e := New(cfg)
				if e != nil {
					t.Fatal(e)
				}
				p, e := specification.Import(t.Context(), r, q)
				if e != nil || p.Commit().String() != commit || p.Nodes()[0].ContentDigest != domain.HashString(realSource) {
					t.Fatalf("source config influenced capture %v", e)
				}
				assertEmptyScratch(t, cfg.ScratchDir)
				after, _ := os.ReadFile(filepath.Join(cfg.GitDir, "config"))
				if !bytes.Equal(before, after) {
					t.Fatal("source config written")
				}
				if _, e := os.Stat(marker); !errors.Is(e, os.ErrNotExist) {
					t.Fatal("repository helper executed")
				}
				// Delete the commit object/pack after the first read and prove no config-only
				// partial clone can cause a fetch or source-dir fallback.
				if packed {
					entries, e := os.ReadDir(filepath.Join(cfg.GitDir, "objects", "pack"))
					if e != nil {
						t.Fatal(e)
					}
					for _, entry := range entries {
						if e := os.Remove(filepath.Join(cfg.GitDir, "objects", "pack", entry.Name())); e != nil {
							t.Fatal(e)
						}
					}
				} else {
					if e := os.Remove(filepath.Join(cfg.GitDir, "objects", commit[:2], commit[2:])); e != nil {
						t.Fatal(e)
					}
				}
				_, e = specification.Import(t.Context(), r, q)
				expectCode(t, e, specification.Unavailable)
				assertEmptyScratch(t, cfg.ScratchDir)
				if _, e := os.Stat(marker); !errors.Is(e, os.ErrNotExist) {
					t.Fatal("missing object invoked remote/helper")
				}
			})
		}
	}
	for _, attack := range []string{"alternates", "http_alternates", "shallow", "promisor", "commondir", "object_symlink", "directory_symlink", "ref_symlink", "ref_parent_symlink", "fifo_ref", "fifo_object", "source_root_symlink", "scratch_root_symlink", "missing_pack_index", "missing_index_pack"} {
		t.Run("reject_"+attack, func(t *testing.T) {
			cfg, q, _ := realFixture(t, specification.SHA1, false)
			outside := t.TempDir()
			switch attack {
			case "alternates":
				mustWrite(t, filepath.Join(cfg.GitDir, "objects/info/alternates"), []byte(outside))
			case "http_alternates":
				mustWrite(t, filepath.Join(cfg.GitDir, "objects/info/http-alternates"), []byte("https://example.invalid"))
			case "shallow":
				mustWrite(t, filepath.Join(cfg.GitDir, "shallow"), []byte("x"))
			case "promisor":
				mustWrite(t, filepath.Join(cfg.GitDir, "objects/pack/pack-x.promisor"), nil)
			case "commondir":
				mustWrite(t, filepath.Join(cfg.GitDir, "commondir"), []byte("../other"))
			case "object_symlink":
				if e := os.Symlink(outside, filepath.Join(cfg.GitDir, "objects", "evil")); e != nil {
					t.Fatal(e)
				}
			case "directory_symlink":
				if e := os.Symlink("../refs", filepath.Join(cfg.GitDir, "objects", "linked")); e != nil {
					t.Fatal(e)
				}
			case "ref_symlink":
				p := filepath.Join(cfg.GitDir, q.Ref)
				if e := os.Remove(p); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink(filepath.Join(outside, "ref"), p); e != nil {
					t.Fatal(e)
				}
			case "ref_parent_symlink":
				p := filepath.Join(cfg.GitDir, "refs", "heads")
				if e := os.Rename(p, p+"-old"); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink("heads-old", p); e != nil {
					t.Fatal(e)
				}
			case "fifo_ref":
				p := filepath.Join(cfg.GitDir, q.Ref)
				if e := os.Remove(p); e != nil {
					t.Fatal(e)
				}
				if e := syscall.Mkfifo(p, 0600); e != nil {
					t.Fatal(e)
				}
			case "fifo_object":
				if e := syscall.Mkfifo(filepath.Join(cfg.GitDir, "objects", "pipe"), 0600); e != nil {
					t.Fatal(e)
				}
			case "source_root_symlink":
				link := filepath.Join(outside, "git")
				if e := os.Symlink(cfg.GitDir, link); e != nil {
					t.Fatal(e)
				}
				cfg.GitDir = link
			case "scratch_root_symlink":
				link := filepath.Join(outside, "scratch")
				if e := os.Symlink(cfg.ScratchDir, link); e != nil {
					t.Fatal(e)
				}
				cfg.ScratchDir = link
			case "missing_index_pack":
				mustWrite(t, filepath.Join(cfg.GitDir, "objects", "pack", "pack-"+strings.Repeat("1", 40)+".idx"), []byte("orphan index"))
			case "missing_pack_index":
				mustWrite(t, filepath.Join(cfg.GitDir, "objects", "pack", "pack-"+strings.Repeat("1", 40)+".pack"), []byte("not a pack"))
			}
			r, e := New(cfg)
			if e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()
			_, e = r.Open(ctx, q.Ref)
			if e == nil {
				t.Fatal("confinement attack accepted")
			}
			if strings.Contains(e.Error(), cfg.GitDir) {
				t.Fatal("path leaked")
			}
			assertEmptyScratch(t, cfg.ScratchDir)
		})
	}
	t.Run("constructor_clone_and_shape", func(t *testing.T) {
		cfg, q, _ := realFixture(t, specification.SHA1, false)
		refs := cfg.AllowedRefs
		r, e := New(cfg)
		if e != nil {
			t.Fatal(e)
		}
		refs[0] = "refs/heads/evil"
		cfg.GitDir = "/changed"
		if _, e := specification.Import(t.Context(), r, q); e != nil {
			t.Fatal("constructor retained mutable config", e)
		}
		for _, bad := range []string{"HEAD", "refs/heads/../x", "refs/heads/a.lock", "refs/heads/.a", "refs/heads/a.", "refs/heads/a//b", "refs/heads/a@{1}", "refs/heads/a:b", "refs/heads/a\\b", "refs/heads/a*", "-x", "refs/heads/a b", "refs/heads/" + strings.Repeat("x", 200)} {
			cfg = r.config
			cfg.AllowedRefs = []string{bad}
			if _, e := New(cfg); e == nil {
				t.Fatalf("invalid allowed ref %q", bad)
			}
		}
		for _, mutate := range []func(*Config){func(c *Config) { c.GitExecutable = "git" }, func(c *Config) { c.GitDir = "relative" }, func(c *Config) { c.ScratchDir = c.GitDir }, func(c *Config) { c.ScratchDir = filepath.Dir(c.GitDir) }, func(c *Config) { c.ScratchDir = filepath.Join(c.GitDir, "nested") }, func(c *Config) { c.GitDir = filepath.Dir(c.ScratchDir) }, func(c *Config) { c.ObjectFormat = "sha512" }, func(c *Config) { c.AllowedRefs = nil }} {
			cfg = r.config
			mutate(&cfg)
			_, e := New(cfg)
			expectCode(t, e, specification.Invalid)
		}
	})
	t.Run("source_and_scratch_preserved_on_success_failure", func(t *testing.T) {
		cfg, q, _ := realFixture(t, specification.SHA1, false)
		scratchMarker := filepath.Join(cfg.ScratchDir, "keep")
		sourceMarker := filepath.Join(cfg.GitDir, "keep")
		mustWrite(t, scratchMarker, []byte("scratch"))
		mustWrite(t, sourceMarker, []byte("source"))
		r, e := New(cfg)
		if e != nil {
			t.Fatal(e)
		}
		if _, e := specification.Import(t.Context(), r, q); e != nil {
			t.Fatal(e)
		}
		mustWrite(t, filepath.Join(cfg.GitDir, "shallow"), []byte("x"))
		if _, e := r.Open(t.Context(), q.Ref); e == nil {
			t.Fatal("failure setup accepted")
		}
		for path, want := range map[string]string{scratchMarker: "scratch", sourceMarker: "source"} {
			raw, e := os.ReadFile(path)
			if e != nil || string(raw) != want {
				t.Fatal("source/scratch damaged")
			}
		}
		entries, e := os.ReadDir(cfg.ScratchDir)
		if e != nil || len(entries) != 1 {
			t.Fatal("failure leaked facade")
		}
	})
}

// TestMain's helper is a deterministic private subprocess, invoked only by
// runBatch tests with the test executable. No production runtime hook exists.
func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "--no-pager" {
		mode, _ := os.ReadFile("helper-mode")
		input, _ := io.ReadAll(io.LimitReader(os.Stdin, 100))
		id := strings.TrimSuffix(string(input), "\n")
		switch string(mode) {
		case "empty":
			fmt.Printf("%s blob 0\n\n", id)
		case "bad_terminal":
			fmt.Printf("%s blob 1\nxx", id)
		case "exact":
			fmt.Printf("%s blob 4\nDATA\n", id)
		case "size_plus_one":
			fmt.Printf("%s blob 5\nDATAx\n", id)
		case "header":
			fmt.Print(strings.Repeat("h", 129))
		case "stdout":
			fmt.Printf("%s blob 4\n", id)
			fmt.Print(strings.Repeat("x", 1<<20))
		case "stderr_exact":
			fmt.Fprint(os.Stderr, strings.Repeat("e", 8192))
			fmt.Printf("%s blob 4\nDATA\n", id)
		case "stderr_plus_one":
			fmt.Fprint(os.Stderr, strings.Repeat("e", 8193))
			fmt.Printf("%s blob 4\nDATA\n", id)
		case "truncated":
			fmt.Printf("%s blob 4\nDA", id)
		case "extra":
			fmt.Printf("%s blob 4\nDATA\nextra", id)
		case "wrong_oid":
			fmt.Printf("%s blob 4\nDATA\n", strings.Repeat("a", len(id)))
		case "wrong_kind":
			fmt.Printf("%s tag 4\nDATA\n", id)
		case "bad_size":
			fmt.Printf("%s blob 04\nDATA\n", id)
		case "huge_size":
			fmt.Printf("%s blob 9223372036854775808\n", id)
		case "negative_size":
			fmt.Printf("%s blob -1\n", id)
		case "missing":
			fmt.Printf("%s missing\n", id)
		case "nonzero":
			fmt.Printf("%s blob 4\nDATA\n", id)
			os.Exit(3)
		case "hang":
			os.WriteFile("helper-pid", []byte(strconv.Itoa(os.Getpid())), 0600)
			time.Sleep(time.Minute)
		case "environment":
			expected := sterileEnv(filepath.Dir(os.Getenv("HOME")))
			actual := os.Environ()
			slices.Sort(expected)
			slices.Sort(actual)
			if !slices.Equal(expected, actual) {
				os.Exit(4)
			}
			fmt.Printf("%s blob 4\nDATA\n", id)
		default:
			os.Exit(5)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func TestGitReader_BoundsAndCancellation(t *testing.T) {
	boundaryAdditional(t)
	t.Run("helper_framing_output_size_exit_and_environment", func(t *testing.T) {
		exe, e := os.Executable()
		if e != nil {
			t.Fatal(e)
		}
		id := readID(t, specification.SHA1, strings.Repeat("1", 40))
		for _, c := range []struct {
			mode string
			code specification.ErrorCode
		}{{"exact", ""}, {"size_plus_one", specification.Capacity}, {"header", specification.Capacity}, {"stdout", specification.Integrity}, {"stderr_exact", ""}, {"stderr_plus_one", specification.Capacity}, {"truncated", specification.Integrity}, {"extra", specification.Integrity}, {"wrong_oid", specification.Integrity}, {"wrong_kind", specification.Integrity}, {"bad_size", specification.Integrity}, {"huge_size", specification.Integrity}, {"negative_size", specification.Integrity}, {"missing", specification.Unavailable}, {"nonzero", specification.Unavailable}, {"environment", ""}} {
			t.Run(c.mode, func(t *testing.T) {
				facade := t.TempDir()
				mustWrite(t, filepath.Join(facade, "helper-mode"), []byte(c.mode))
				o, e := runBatch(t.Context(), exe, facade, id, 4)
				if c.code != "" {
					expectCode(t, e, c.code)
				} else if e != nil || string(o.Data) != "DATA" {
					t.Fatalf("positive helper %v", e)
				}
			})
		}
	})
	t.Run("hung_helper_caller_and_private_deadline_wait_reaps", func(t *testing.T) {
		exe, e := os.Executable()
		if e != nil {
			t.Fatal(e)
		}
		id := readID(t, specification.SHA1, strings.Repeat("1", 40))
		for _, callerDeadline := range []bool{true, false} {
			facade := t.TempDir()
			mustWrite(t, filepath.Join(facade, "helper-mode"), []byte("hang"))
			ctx := t.Context()
			cancel := func() {}
			if callerDeadline {
				ctx, cancel = context.WithTimeout(ctx, 50*time.Millisecond)
			}
			start := time.Now()
			_, e := runBatch(ctx, exe, facade, id, 4)
			cancel()
			if !errors.Is(e, context.DeadlineExceeded) || time.Since(start) > objectTimeout+time.Second {
				t.Fatalf("deadline not enforced %v", e)
			}
			raw, e := os.ReadFile(filepath.Join(facade, "helper-pid"))
			if e != nil {
				t.Fatal(e)
			}
			pid, e := strconv.Atoi(string(raw))
			if e != nil {
				t.Fatal(e)
			}
			if e := syscall.Kill(pid, 0); !errors.Is(e, syscall.ESRCH) {
				t.Fatalf("child survived Wait: %v", e)
			}
		}
	})
	t.Run("object_actual_exact_plus_one_caller_caps_and_close", func(t *testing.T) {
		cfg, q, _ := realFixture(t, specification.SHA256, false)
		dir := filepath.Dir(cfg.GitDir)
		data := bytes.Repeat([]byte{'x'}, maximumObject)
		oid := gitFixtureCommand(t, dir, data, "hash-object", "-w", "--stdin")
		id := readID(t, cfg.ObjectFormat, oid)
		r, e := New(cfg)
		if e != nil {
			t.Fatal(e)
		}
		s, e := r.Open(t.Context(), q.Ref)
		if e != nil {
			t.Fatal(e)
		}
		for _, maximum := range []int64{-1, 0, maximumObject + 1} {
			_, e := s.ReadObject(t.Context(), id, maximum)
			expectCode(t, e, specification.Invalid)
		}
		o, e := s.ReadObject(t.Context(), id, maximumObject)
		if e != nil || len(o.Data) != maximumObject {
			t.Fatal(e)
		}
		_, e = s.ReadObject(t.Context(), id, maximumObject-1)
		expectCode(t, e, specification.Capacity)
		if e := s.Close(); e != nil {
			t.Fatal(e)
		}
		if e := s.Close(); e != nil {
			t.Fatal(e)
		}
		_, e = s.ReadObject(t.Context(), id, 1)
		expectCode(t, e, specification.Invalid)
		assertEmptyScratch(t, cfg.ScratchDir)
		larger := append(data, 'y')
		oid = gitFixtureCommand(t, dir, larger, "hash-object", "-w", "--stdin")
		id = readID(t, cfg.ObjectFormat, oid)
		s, e = r.Open(t.Context(), q.Ref)
		if e != nil {
			t.Fatal(e)
		}
		_, e = s.ReadObject(t.Context(), id, maximumObject)
		expectCode(t, e, specification.Capacity)
		if e := s.Close(); e != nil {
			t.Fatal(e)
		}
		if _, e := specification.Import(t.Context(), r, q); e != nil {
			t.Fatal("subsequent import failed", e)
		}
		assertEmptyScratch(t, cfg.ScratchDir)
	})
	t.Run("inventory_actual_exact_plus_one_and_sparse_bytes", func(t *testing.T) {
		cfg, q, _ := realFixture(t, specification.SHA1, false)
		dir := filepath.Join(cfg.GitDir, "objects", "metadata")
		if e := os.Mkdir(dir, 0700); e != nil {
			t.Fatal(e)
		}
		entries := 0
		var rawBytes int64
		if e := filepath.Walk(filepath.Join(cfg.GitDir, "objects"), func(path string, info os.FileInfo, e error) error {
			if e != nil {
				return e
			}
			if path != filepath.Join(cfg.GitDir, "objects") {
				entries++
				if info.Mode().IsRegular() {
					rawBytes += info.Size()
				}
			}
			return nil
		}); e != nil {
			t.Fatal(e)
		}
		for i := range maximumInventory - entries {
			mustWrite(t, filepath.Join(dir, fmt.Sprintf("meta%06d", i)), nil)
		}
		r, e := New(cfg)
		if e != nil {
			t.Fatal(e)
		}
		s, e := r.Open(t.Context(), q.Ref)
		if e != nil {
			t.Fatal("exact inventory rejected", e)
		}
		if e := s.Close(); e != nil {
			t.Fatal(e)
		}
		inventoryCancellationControls(t, r, q)
		mustWrite(t, filepath.Join(dir, "plus-one"), nil)
		_, e = r.Open(t.Context(), q.Ref)
		expectCode(t, e, specification.Capacity)
		assertEmptyScratch(t, cfg.ScratchDir)
		// A separate sparse ignored metadata file reaches the actual2GiB accounting
		// ceiling without allocating or copying its contents.
		cfg, q, _ = realFixture(t, specification.SHA1, false)
		rawBytes = 0
		if e := filepath.Walk(filepath.Join(cfg.GitDir, "objects"), func(path string, info os.FileInfo, e error) error {
			if e != nil {
				return e
			}
			if info.Mode().IsRegular() {
				rawBytes += info.Size()
			}
			return nil
		}); e != nil {
			t.Fatal(e)
		}
		path := filepath.Join(cfg.GitDir, "objects", "large-metadata")
		f, e := os.Create(path)
		if e != nil {
			t.Fatal(e)
		}
		if e := f.Truncate(maximumInventoryBytes - rawBytes); e != nil {
			t.Fatal(e)
		}
		if e := f.Close(); e != nil {
			t.Fatal(e)
		}
		r, e = New(cfg)
		if e != nil {
			t.Fatal(e)
		}
		s, e = r.Open(t.Context(), q.Ref)
		if e != nil {
			t.Fatal("exact byte inventory rejected", e)
		}
		if e := s.Close(); e != nil {
			t.Fatal(e)
		}
		if e := os.Truncate(path, maximumInventoryBytes-rawBytes+1); e != nil {
			t.Fatal(e)
		}
		_, e = r.Open(t.Context(), q.Ref)
		expectCode(t, e, specification.Capacity)
		assertEmptyScratch(t, cfg.ScratchDir)
	})
	t.Run("ref_file_caps_nonblocking_and_packed_record_limits", func(t *testing.T) {
		cfg, q, commit := realFixture(t, specification.SHA1, true)
		root, e := openRoot(cfg.GitDir)
		if e != nil {
			t.Fatal(e)
		}
		defer root.Close()
		path := "bounded"
		mustWrite(t, filepath.Join(cfg.GitDir, path), bytes.Repeat([]byte{'x'}, maximumRef))
		if raw, e := boundedFile(t.Context(), root, path, maximumRef); e != nil || len(raw) != maximumRef {
			t.Fatal(e)
		}
		mustWrite(t, filepath.Join(cfg.GitDir, path), bytes.Repeat([]byte{'x'}, maximumRef+1))
		_, e = boundedFile(t.Context(), root, path, maximumRef)
		expectCode(t, e, specification.Capacity)
		mustWrite(t, filepath.Join(cfg.GitDir, path), bytes.Repeat([]byte{'x'}, maximumPackedRefs))
		if raw, e := boundedFile(t.Context(), root, path, maximumPackedRefs); e != nil || len(raw) != maximumPackedRefs {
			t.Fatal(e)
		}
		mustWrite(t, filepath.Join(cfg.GitDir, path), bytes.Repeat([]byte{'x'}, maximumPackedRefs+1))
		_, e = boundedFile(t.Context(), root, path, maximumPackedRefs)
		expectCode(t, e, specification.Capacity)
		var raw strings.Builder
		for i := range maximumPackedRecords - 1 {
			fmt.Fprintf(&raw, "%s refs/tags/t%05d\n", commit, i)
		}
		fmt.Fprintf(&raw, "%s %s\n", commit, q.Ref)
		mustWrite(t, filepath.Join(cfg.GitDir, "packed-refs"), []byte(raw.String()))
		if id, e := resolveRef(t.Context(), cfg, q.Ref); e != nil || id.String() != commit {
			t.Fatal("exact packed record count", e)
		}
		fmt.Fprintf(&raw, "%s refs/tags/plus-one\n", commit)
		mustWrite(t, filepath.Join(cfg.GitDir, "packed-refs"), []byte(raw.String()))
		_, e = resolveRef(t.Context(), cfg, q.Ref)
		expectCode(t, e, specification.Capacity)
	})
	t.Run("pre_cancel_typed_nil_direct_open_and_inventory_cancel", func(t *testing.T) {
		cfg, q, _ := realFixture(t, specification.SHA1, false)
		r, e := New(cfg)
		if e != nil {
			t.Fatal(e)
		}
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		_, e = r.Open(ctx, q.Ref)
		if !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
		assertEmptyScratch(t, cfg.ScratchDir)
		_, e = r.Open(nil, q.Ref)
		expectCode(t, e, specification.Invalid)
		var nc *adapterNilContext
		_, e = r.Open(nc, q.Ref)
		expectCode(t, e, specification.Invalid)
		s, e := r.Open(t.Context(), q.Ref)
		if e != nil {
			t.Fatal(e)
		}
		_, e = s.ReadObject(nc, s.Commit(), 1<<20)
		expectCode(t, e, specification.Invalid)
		_, e = s.ReadObject(ctx, s.Commit(), 1<<20)
		if !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
		if e := s.Close(); e != nil {
			t.Fatal(e)
		}
		facade := t.TempDir()
		if e := os.Mkdir(filepath.Join(facade, "objects"), 0700); e != nil {
			t.Fatal(e)
		}
		_, cancel2 := context.WithCancel(t.Context())
		cancel2()
		if e := captureObjects(ctx, cfg, facade); !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
		expired, ec := context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
		defer ec()
		_, e = r.Open(expired, q.Ref)
		if !errors.Is(e, context.DeadlineExceeded) {
			t.Fatal(e)
		}
		if openTimeout != 30*time.Second || objectTimeout != 2*time.Second {
			t.Fatal("production deadline changed")
		}
		if _, e := specification.Import(t.Context(), r, q); e != nil {
			t.Fatal(e)
		}
	})
}

type adapterNilContext struct{}

func (*adapterNilContext) Deadline() (time.Time, bool) { panic("nil context") }
func (*adapterNilContext) Done() <-chan struct{}       { panic("nil context") }
func (*adapterNilContext) Err() error                  { panic("nil context") }
func (*adapterNilContext) Value(any) any               { panic("nil context") }
