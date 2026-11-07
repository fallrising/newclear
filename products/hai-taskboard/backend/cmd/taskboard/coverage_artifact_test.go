package main

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestCoverageArtifact_DefiniteObjectAndUnknownStoreFailures(t *testing.T) {
	for _, entry := range []string{"legacy", "bounded"} {
		for _, kind := range []string{"missing", "tamper", "directory", "symlink", "zero-size", "closed", "root-replaced", "lstat-open-race"} {
			t.Run(entry+"/"+kind, func(t *testing.T) {
				parent := privateTestRoot(t)
				root := filepath.Join(parent, "artifacts")
				store, err := newLocalArtifactStore(root)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = store.Close() })
				d, _, err := store.Put(t.Context(), strings.NewReader("candidate"))
				if err != nil {
					t.Fatal(err)
				}
				path := filepath.Join(root, d.String())
				switch kind {
				case "missing":
					if err = os.Remove(path); err != nil {
						t.Fatal(err)
					}
				case "tamper":
					if err = os.WriteFile(path, []byte("wrong"), 0600); err != nil {
						t.Fatal(err)
					}
				case "zero-size":
					if err = os.WriteFile(path, nil, 0600); err != nil {
						t.Fatal(err)
					}
				case "directory":
					if err = os.Remove(path); err != nil {
						t.Fatal(err)
					}
					if err = os.Mkdir(path, 0700); err != nil {
						t.Fatal(err)
					}
				case "symlink":
					if err = os.Remove(path); err != nil {
						t.Fatal(err)
					}
					if err = os.Symlink("missing", path); err != nil {
						t.Fatal(err)
					}
				case "closed":
					if err = store.Close(); err != nil {
						t.Fatal(err)
					}
				case "root-replaced":
					if err = os.Rename(root, root+"-old"); err != nil {
						t.Fatal(err)
					}
					if err = os.Mkdir(root, 0700); err != nil {
						t.Fatal(err)
					}
				}
				if kind == "lstat-open-race" {
					open := store.openValidatedWith
					if entry == "bounded" {
						open = store.openObject
					}
					_, err = open(d, func(string) (*os.File, error) {
						return nil, &os.PathError{Op: "open", Path: d.String(), Err: fs.ErrNotExist}
					})
				} else {
					if entry == "bounded" {
						_, err = store.OpenBounded(t.Context(), d, 9)
					} else {
						_, err = store.Open(t.Context(), d)
					}
				}
				if err == nil {
					t.Fatal("fault accepted")
				}
				switch kind {
				case "missing", "lstat-open-race":
					if !errors.Is(err, fs.ErrNotExist) {
						t.Fatal("absence cause erased", err)
					}
				case "closed", "root-replaced":
					if errors.Is(err, port.ErrArtifactUnavailable) || errors.Is(err, fs.ErrNotExist) {
						t.Fatal("store fault became object unavailable", err)
					}
				default:
					if !errors.Is(err, port.ErrArtifactUnavailable) {
						t.Fatal("definite object failure was not typed", err)
					}
				}
			})
		}
	}
	var store *localArtifactStore
	if _, err := store.Open(t.Context(), domain.HashString("candidate")); err == nil || errors.Is(err, port.ErrArtifactUnavailable) {
		t.Fatal("nil store classification", err)
	}
}

func TestCoverageArtifact_BoundedOpenChecksSizeWithoutReadingHash(t *testing.T) {
	root := filepath.Join(privateTestRoot(t), "artifacts")
	store, err := newLocalArtifactStore(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	d, _, err := store.Put(t.Context(), strings.NewReader("candidate"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, d.String())
	// A 10MiB actual object with a one-byte declaration must be rejected by stat,
	// without the legacy Open path's whole-object integrity scan.
	if err = os.Truncate(path, maximumArtifactBytes); err != nil {
		t.Fatal(err)
	}
	if r, err := store.OpenBounded(t.Context(), d, 1); r != nil || !errors.Is(err, port.ErrArtifactUnavailable) {
		t.Fatal(r, err)
	}
	// Same-size corrupt bytes prove the bounded opener leaves hash verification
	// to the caller and returns the descriptor at byte zero. Legacy Open still
	// rejects them before returning, preserving existing consumer semantics.
	if err = os.WriteFile(path, []byte("tampered!"), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := store.OpenBounded(t.Context(), d, 9)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(r)
	_ = r.Close()
	if err != nil || string(got) != "tampered!" {
		t.Fatal(string(got), err)
	}
	if _, err := store.Open(t.Context(), d); !errors.Is(err, port.ErrArtifactUnavailable) {
		t.Fatal("legacy integrity changed", err)
	}
}
