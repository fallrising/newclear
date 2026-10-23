package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestBrowserStatic_FileToFIFOSwapCannotBlockOpen(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "asset.js")
	safe := filepath.Join(directory, "safe")
	fifo := filepath.Join(directory, "fifo")
	if err := os.WriteFile(path, []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	assertSafe := func() {
		body, err := readBrowserAsset(root, "asset.js", 100)
		if err != nil || string(body) != "safe" {
			t.Fatalf("regular-file control: body=%q error=%v", body, err)
		}
	}
	assertSafe()
	stop := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		for {
			select {
			case <-stop:
				return
			default:
			}
			os.Rename(path, safe)
			os.Rename(fifo, path)
			runtime.Gosched()
			os.Rename(path, fifo)
			os.Rename(safe, path)
			time.Sleep(10 * time.Microsecond)
		}
	}()
	active := true
	stopSwaps := func() {
		if active {
			close(stop)
			<-stopped
			active = false
		}
	}
	defer stopSwaps()
	deadline := time.Now().Add(time.Second)
	attempts := 0
	type assetReadResult struct {
		body []byte
		err  error
	}
	for time.Now().Before(deadline) {
		attempts++
		done := make(chan assetReadResult, 1)
		go func() { body, err := readBrowserAsset(root, "asset.js", 100); done <- assetReadResult{body, err} }()
		select {
		case result := <-done:
			if result.err == nil && string(result.body) != "safe" {
				t.Fatalf("raced read returned unvalidated bytes: %q", result.body)
			}
		case <-time.After(200 * time.Millisecond):
			stopSwaps()
			stack := make([]byte, 1<<20)
			stack = stack[:runtime.Stack(stack, true)]
			// Release a reader stuck on the exact FIFO inode before reporting failure.
			var descriptors []int
			for _, name := range []string{fifo, path} {
				info, err := os.Lstat(name)
				if err == nil && info.Mode()&os.ModeNamedPipe != 0 {
					fd, err := syscall.Open(name, syscall.O_RDWR|syscall.O_NONBLOCK, 0)
					if err == nil {
						descriptors = append(descriptors, fd)
					}
				}
			}
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Error("asset reader failed to release")
			}
			for _, fd := range descriptors {
				syscall.Close(fd)
			}
			if strings.Contains(string(stack), "readBrowserAsset") && strings.Contains(string(stack), "Open") {
				t.Fatal("asset load blocked opening a FIFO swapped after regular-file validation")
			}
			t.Fatal("asset load exceeded its bounded nonblocking-open window")
		}
	}
	stopSwaps()
	assertSafe()
	t.Logf("completed %d asset reads during regular-file/FIFO swaps", attempts)
}

func TestBrowserStatic_DirectoryToFIFOSwapCannotBlockStartup(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "web")
	safe := filepath.Join(directory, "safe")
	fifo := filepath.Join(directory, "fifo")
	if err := os.MkdirAll(filepath.Join(path, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "index.html"), []byte(`<script src="/assets/main.js"></script>`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "assets/main.js"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	load := func() ([]byte, error) {
		assets, err := loadBrowserAssets(path, filepath.Join(directory, "data"))
		if err != nil {
			return nil, err
		}
		return assets.routes["/assets/main.js"].body, nil
	}
	assertSafe := func() {
		body, err := load()
		if err != nil || string(body) != "safe" {
			t.Fatalf("regular-file control: body=%q error=%v", body, err)
		}
	}
	assertSafe()
	stop := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		for {
			select {
			case <-stop:
				return
			default:
			}
			os.Rename(path, safe)
			os.Rename(fifo, path)
			runtime.Gosched()
			os.Rename(path, fifo)
			os.Rename(safe, path)
			time.Sleep(10 * time.Microsecond)
		}
	}()
	active := true
	stopSwaps := func() {
		if active {
			close(stop)
			<-stopped
			active = false
		}
	}
	defer stopSwaps()
	deadline := time.Now().Add(time.Second)
	attempts := 0
	type assetReadResult struct {
		body []byte
		err  error
	}
	for time.Now().Before(deadline) {
		attempts++
		done := make(chan assetReadResult, 1)
		go func() { body, err := load(); done <- assetReadResult{body, err} }()
		select {
		case result := <-done:
			if result.err == nil && string(result.body) != "safe" {
				t.Fatalf("raced read returned unvalidated bytes: %q", result.body)
			}
		case <-time.After(200 * time.Millisecond):
			stopSwaps()
			stack := make([]byte, 1<<20)
			stack = stack[:runtime.Stack(stack, true)]
			// Release a reader stuck on the exact FIFO inode before reporting failure.
			var descriptors []int
			for _, name := range []string{fifo, path} {
				info, err := os.Lstat(name)
				if err == nil && info.Mode()&os.ModeNamedPipe != 0 {
					fd, err := syscall.Open(name, syscall.O_RDWR|syscall.O_NONBLOCK, 0)
					if err == nil {
						descriptors = append(descriptors, fd)
					}
				}
			}
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Error("asset reader failed to release")
			}
			for _, fd := range descriptors {
				syscall.Close(fd)
			}
			if strings.Contains(string(stack), "loadBrowserAssets") && strings.Contains(string(stack), "Open") {
				t.Fatal("startup blocked opening a FIFO swapped after directory validation")
			}
			t.Fatal("asset load exceeded its bounded nonblocking-open window")
		}
	}
	stopSwaps()
	assertSafe()
	t.Logf("completed %d asset reads during regular-file/FIFO swaps", attempts)
}
