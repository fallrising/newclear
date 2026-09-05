package main

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigCheck(t *testing.T) {
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	exitCode := run(context.Background(), []string{"--config", path, "--config-check"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("run() = %d, want 0; stderr = %s", exitCode, stderr.String())
	}
	if stdout.String() != "prismd: configuration valid\n" {
		t.Fatalf("stdout = %q", stdout.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want empty", stderr.String())
	}
}

func TestConfigCheckRejectsInvalidConfiguration(t *testing.T) {
	var stdout, stderr bytes.Buffer
	exitCode := run(context.Background(), []string{"--config", filepath.Join(t.TempDir(), "missing.yaml"), "--config-check"}, &stdout, &stderr)
	if exitCode != 1 {
		t.Fatalf("run() = %d, want 1", exitCode)
	}
	if !strings.Contains(stderr.String(), "configuration invalid") {
		t.Fatalf("stderr = %q, want configuration error", stderr.String())
	}
}

func TestConfigCheckEmitsStartupWarnings(t *testing.T) {
	t.Setenv("PRISM_SERVER_HTTP_LISTEN", "0.0.0.0:9090")
	t.Setenv("PRISM_AUTH_ALLOW_ANONYMOUS_READ", "false")
	path, err := filepath.Abs(filepath.Join("..", "..", "internal", "config", "testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	exitCode := run(context.Background(), []string{"--config", path, "--config-check"}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("run() = %d, stderr = %q", exitCode, stderr.String())
	}
	if !strings.Contains(stderr.String(), "WARN public-listener-without-transport-security") {
		t.Fatalf("stderr = %q, want startup security warning", stderr.String())
	}
}

func TestConfigCheckHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var stdout, stderr bytes.Buffer
	exitCode := run(ctx, []string{"--config", "unused.yaml", "--config-check"}, &stdout, &stderr)
	if exitCode != 1 || !strings.Contains(stderr.String(), context.Canceled.Error()) {
		t.Fatalf("run() = %d, stderr = %q; want canceled error", exitCode, stderr.String())
	}
}
