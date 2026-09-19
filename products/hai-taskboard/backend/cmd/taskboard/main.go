package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	exitCode := runProcess(ctx, os.Args[1:], os.Getenv, os.Unsetenv, os.Stderr)
	stop()
	os.Exit(exitCode)
}

func runProcess(ctx context.Context, args []string, getenv func(string) string, unsetenv func(string) error, stderr io.Writer) int {
	config, err := loadRuntimeConfig(getenv, args)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "taskboard: invalid runtime configuration")
		return 1
	}
	if unsetenv != nil {
		_ = unsetenv("HAI_TASKBOARD_SESSION_TOKEN")
	}
	runtime, err := startRuntime(ctx, config, nil)
	config.SessionToken = ""
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "taskboard: startup failed")
		return 1
	}
	_, _ = fmt.Fprintf(stderr, "taskboard: listening on %s\n", runtime.Address())
	if err := runtime.Wait(context.Background()); err != nil {
		_, _ = fmt.Fprintln(stderr, "taskboard: runtime failed")
		return 1
	}
	return 0
}
