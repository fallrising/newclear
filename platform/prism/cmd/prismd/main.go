package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/config"
)

func main() {
	os.Exit(realMain())
}

func realMain() int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return run(ctx, os.Args[1:], os.Stdout, os.Stderr)
}

func run(ctx context.Context, arguments []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("prismd", flag.ContinueOnError)
	flags.SetOutput(stderr)
	configPath := flags.String("config", config.DefaultPath, "path to prismd YAML configuration")
	configCheck := flags.Bool("config-check", false, "validate configuration and exit")
	if err := flags.Parse(arguments); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		writef(stderr, "prismd: unexpected arguments: %v\n", flags.Args())
		return 2
	}

	configuration, err := config.LoadContext(ctx, *configPath)
	if err != nil {
		writef(stderr, "prismd: configuration invalid: %v\n", err)
		return 1
	}
	for _, warning := range configuration.SecurityWarnings(config.SecurityState{}) {
		if !writef(stderr, "prismd: WARN %s: %s\n", warning.Code, warning.Message) {
			return 1
		}
	}
	if *configCheck {
		if !writef(stdout, "prismd: configuration valid\n") {
			return 1
		}
		return 0
	}
	writef(stderr, "prismd: runtime startup is not implemented yet; use --config-check\n")
	return 1
}

func writef(writer io.Writer, format string, arguments ...any) bool {
	_, err := fmt.Fprintf(writer, format, arguments...)
	return err == nil
}
