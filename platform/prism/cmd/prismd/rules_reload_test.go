package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestAC89AndAC90ConfigCheck(t *testing.T) {
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	t.Run("AC-89", func(t *testing.T) {
		dir := t.TempDir()
		writeRuntimeRule(t, dir, "two.yaml", "groups:\n  - name: g\n    rules:\n      - alert: A\n        expr: up\n---\ngroups:\n  - name: h\n    rules:\n      - alert: B\n        expr: up\n")
		t.Setenv("PRISM_RULES_PATH", dir)
		var stdout, stderr syncBuffer
		code := run(t.Context(), []string{"--config", path, "--config-check"}, &stdout, &stderr)
		if code != 1 || !strings.Contains(stderr.String(), "more than one YAML document") {
			t.Fatalf("code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
		}
	})
	t.Run("AC-90", func(t *testing.T) {
		for _, body := range []string{"", "# only\n", "groups: []\n", "groups:\n", "groups:\n  - name: g\n    rules: []\n"} {
			dir := t.TempDir()
			writeRuntimeRule(t, dir, "empty.yaml", body)
			t.Setenv("PRISM_RULES_PATH", dir)
			var stdout, stderr syncBuffer
			code := run(t.Context(), []string{"--config", path, "--config-check"}, &stdout, &stderr)
			if code != 0 || !strings.Contains(stdout.String(), "configuration valid") {
				t.Fatalf("body %q code=%d stdout=%q stderr=%q", body, code, stdout.String(), stderr.String())
			}
		}
	})
}

func TestAC92SIGHUPReload(t *testing.T) {
	dir := t.TempDir()
	writeRuntimeRule(t, dir, "a.yml", "groups:\n  - name: host\n    rules:\n      - alert: Old\n        expr: up\n")
	t.Setenv("PRISM_RULES_PATH", dir)
	address := availableAddress(t)
	t.Setenv("PRISM_SERVER_HTTP_LISTEN", address)
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan int, 1)
	finished := false
	var stdout, stderr syncBuffer
	go runForTest(ctx, []string{"--config", path, "--mode", "query"}, &stdout, &stderr, result)
	t.Cleanup(func() {
		if finished {
			return
		}
		cancel()
		select {
		case <-result:
		case <-time.After(2 * time.Second):
		}
	})
	waitForEndpoint(t, "http://"+address+"/-/healthy", "ok\n")
	if got := ruleAlert(); got != "Old" {
		t.Fatalf("loaded alert = %q", got)
	}
	writeRuntimeRule(t, dir, "a.yml", "groups:\n  - name: host\n    rules:\n      - alert: New\n        expr: up\n")
	time.Sleep(2 * time.Second)
	if got := ruleAlert(); got != "Old" {
		t.Fatalf("alert changed without SIGHUP: %q", got)
	}
	waitForEndpoint(t, "http://"+address+"/-/healthy", "ok\n")
	if err := syscall.Kill(os.Getpid(), syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	waitForAlert(t, "New")
	writeRuntimeRule(t, dir, "a.yml", "groups:\n  - name: host\n    rules:\n      - alert: Bad\n")
	if err := syscall.Kill(os.Getpid(), syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		logs := stderr.String()
		if strings.Contains(logs, "loading groups failed") && strings.Contains(logs, "previous rule set restored") && strings.Contains(logs, "field 'expr' must be set in rule") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("stderr = %s", logs)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := ruleAlert(); got != "New" {
		t.Fatalf("failed SIGHUP replaced alert with %q", got)
	}
	waitForEndpoint(t, "http://"+address+"/-/healthy", "ok\n")
	select {
	case code := <-result:
		t.Fatalf("SIGHUP exited prismd: %d stderr=%s", code, stderr.String())
	default:
	}
	cancel()
	select {
	case code := <-result:
		finished = true
		if code != 0 {
			t.Fatalf("run() = %d stderr=%s", code, stderr.String())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("process context was not canceled by the test")
	}
}

func ruleAlert() string {
	set, ok := activeRuleSet()
	if !ok || len(set.Groups) == 0 || len(set.Groups[0].Rules) == 0 {
		return ""
	}
	return set.Groups[0].Rules[0].Alert
}

func waitForAlert(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if ruleAlert() == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("alert = %q, want %q", ruleAlert(), want)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func writeRuntimeRule(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}
