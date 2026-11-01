package gitobject

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

func inventoryCancellationControls(t *testing.T, r *Reader, q specification.Request) {
	t.Helper()
	t.Run("direct_open_private_deadline_during_inventory", func(t *testing.T) {
		start := time.Now()
		_, e := r.open(t.Context(), q.Ref, 20*time.Millisecond)
		if !errors.Is(e, context.DeadlineExceeded) || time.Since(start) > time.Second {
			t.Fatalf("direct Open deadline %v", e)
		}
		assertEmptyScratch(t, r.config.ScratchDir)
	})
	// A dedicated inventory of whitelisted files ensures links occur throughout
	// capture, independently of source directory iteration order.
	cfg, request, _ := realFixture(t, specification.SHA1, false)
	source := realObjectHash(specification.SHA1, "blob", []byte(realSource))
	dir := filepath.Join(cfg.GitDir, "objects", "aa")
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	for i := range 2000 {
		if e := os.Link(filepath.Join(cfg.GitDir, "objects", source[:2], source[2:]), filepath.Join(dir, fmt.Sprintf("%038x", i))); e != nil {
			t.Fatal(e)
		}
	}
	captureReader, e := New(cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Run("caller_cancel_after_first_hardlink", func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		observed := make(chan struct{})
		done := make(chan struct{})
		var wg sync.WaitGroup
		wg.Go(func() {
			defer close(done)
			ticker := time.NewTicker(time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					found := false
					filepath.WalkDir(captureReader.config.ScratchDir, func(path string, entry fs.DirEntry, e error) error {
						if e == nil && !entry.IsDir() {
							info, e := entry.Info()
							if e == nil && info.Mode().IsRegular() && filepath.Base(filepath.Dir(path)) != "proposal" && filepath.Base(path) != "config" && filepath.Base(path) != "HEAD" {
								found = true
							}
						}
						return nil
					})
					if found {
						close(observed)
						cancel()
						return
					}
				}
			}
		})
		snapshot, e := captureReader.Open(ctx, request.Ref)
		if snapshot != nil {
			defer snapshot.Close()
		}
		cancel()
		wg.Wait()
		<-done
		if !errors.Is(e, context.Canceled) {
			t.Fatalf("inventory cancellation %v", e)
		}
		select {
		case <-observed:
		default:
			t.Fatal("no captured hardlink before cancellation")
		}
		assertEmptyScratch(t, captureReader.config.ScratchDir)
	})
	t.Run("subsequent_open_after_inventory_cancellation", func(t *testing.T) {
		s, e := captureReader.Open(t.Context(), request.Ref)
		if e != nil {
			t.Fatal(e)
		}
		if e := s.Close(); e != nil {
			t.Fatal(e)
		}
		assertEmptyScratch(t, captureReader.config.ScratchDir)
	})
}
func boundaryAdditional(t *testing.T) {
	t.Run("header_accounting_exact_plus_one", func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		id := readID(t, specification.SHA1, "1111111111111111111111111111111111111111")
		w := &frameWriter{id: id, maximum: 4, cancel: cancel}
		if _, e := w.Write(make([]byte, 128)); e != nil {
			t.Fatal("exact header storage rejected", e)
		}
		if len(w.header) != 128 || ctx.Err() != nil {
			t.Fatal("exact header cap changed")
		}
		_, e := w.Write([]byte{'x'})
		expectCode(t, e, specification.Capacity)
		if !errors.Is(ctx.Err(), context.Canceled) {
			t.Fatal("header excess did not cancel process")
		}
	})
	t.Run("frame_terminal_newline_missing_and_empty_blob", func(t *testing.T) {
		id := readID(t, specification.SHA1, "1111111111111111111111111111111111111111")
		exe, e := os.Executable()
		if e != nil {
			t.Fatal(e)
		}
		for _, mode := range []string{"empty", "bad_terminal"} {
			facade := t.TempDir()
			mustWrite(t, filepath.Join(facade, "helper-mode"), []byte(mode))
			o, e := runBatch(t.Context(), exe, facade, id, 1)
			if mode == "empty" {
				if e != nil || len(o.Data) != 0 {
					t.Fatal(e)
				}
			} else {
				expectCode(t, e, specification.Integrity)
			}
		}
	})
}
