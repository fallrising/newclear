package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/config"
	prismserver "github.com/fallrising/newclear/platform/prism/internal/server"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
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
	var modeOverride string
	flags.Func("mode", "override server mode (all-in-one, ingest, query, ruler, or console)", func(value string) error {
		if !slices.Contains([]string{"all-in-one", "ingest", "query", "ruler", "console"}, value) {
			return fmt.Errorf("unknown server mode %q", value)
		}
		modeOverride = value
		return nil
	})
	if err := flags.Parse(arguments); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		writef(stderr, "prismd: unexpected arguments: %v\n", flags.Args())
		return 2
	}

	environment := os.Environ()
	if modeOverride != "" {
		environment = append(environment, "PRISM_SERVER_MODE="+modeOverride)
	}
	configuration, err := config.LoadWithEnvironment(ctx, *configPath, environment)
	if err != nil {
		writef(stderr, "prismd: configuration invalid: %v\n", err)
		return 1
	}
	logger := newLogger(configuration.Telemetry, stderr)
	for _, warning := range configuration.SecurityWarnings(config.SecurityState{}) {
		logger.WarnContext(
			ctx,
			"configuration security warning",
			"component", "server",
			"code", warning.Code,
			"warning", warning.Message,
		)
	}
	if *configCheck {
		if !writef(stdout, "prismd: configuration valid\n") {
			return 1
		}
		return 0
	}
	if err := runService(ctx, configuration, logger); err != nil {
		logger.ErrorContext(ctx, "prismd stopped with error", "component", "server", "error", err)
		return 1
	}
	return 0
}

func writef(writer io.Writer, format string, arguments ...any) bool {
	_, err := fmt.Fprintf(writer, format, arguments...)
	return err == nil
}

func runService(ctx context.Context, configuration *config.Config, logger *slog.Logger) error {
	registry, err := newRuntimeRegistry()
	if err != nil {
		return err
	}
	backend, err := spi.Open(ctx, configuration.Storage.Driver, spi.Config{
		DSN:        configuration.Storage.DSN,
		Options:    maps.Clone(configuration.Storage.Options),
		Logger:     logger,
		Registerer: registry,
		Clock:      spi.SystemClock,
	})
	if err != nil {
		return fmt.Errorf("open storage backend: %w", err)
	}

	runErr := runConfiguredMode(ctx, configuration, logger, registry, backend)
	closeErr := backend.Close()
	if closeErr != nil {
		closeErr = fmt.Errorf("close storage backend: %w", closeErr)
	}
	return errors.Join(runErr, closeErr)
}

func runConfiguredMode(
	ctx context.Context,
	configuration *config.Config,
	logger *slog.Logger,
	registry *prometheus.Registry,
	backend spi.Backend,
) error {
	if err := backend.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate storage backend: %w", err)
	}
	if err := backend.Ping(ctx); err != nil {
		return fmt.Errorf("ping storage backend: %w", err)
	}
	switch configuration.Server.Mode {
	case "all-in-one":
		return runAllInOne(ctx, configuration, logger, registry)
	case "ingest":
		return runIngest(ctx, configuration, logger, registry)
	case "query":
		return runQuery(ctx, configuration, logger, registry)
	case "ruler":
		return runRuler(ctx, configuration, logger, registry)
	case "console":
		return runConsole(ctx, configuration, logger, registry)
	default:
		return fmt.Errorf("unsupported configured mode %q", configuration.Server.Mode)
	}
}

func runAllInOne(ctx context.Context, configuration *config.Config, logger *slog.Logger, registry *prometheus.Registry) error {
	return runHTTPServer(ctx, configuration, logger, registry)
}

func runIngest(ctx context.Context, configuration *config.Config, logger *slog.Logger, registry *prometheus.Registry) error {
	return runHTTPServer(ctx, configuration, logger, registry)
}

func runQuery(ctx context.Context, configuration *config.Config, logger *slog.Logger, registry *prometheus.Registry) error {
	return runHTTPServer(ctx, configuration, logger, registry)
}

func runRuler(ctx context.Context, configuration *config.Config, logger *slog.Logger, registry *prometheus.Registry) error {
	return runHTTPServer(ctx, configuration, logger, registry)
}

func runConsole(ctx context.Context, configuration *config.Config, logger *slog.Logger, registry *prometheus.Registry) error {
	return runHTTPServer(ctx, configuration, logger, registry)
}

func runHTTPServer(
	ctx context.Context,
	configuration *config.Config,
	logger *slog.Logger,
	registry *prometheus.Registry,
) error {
	httpServer, err := prismserver.New(prismserver.Options{
		Address:         configuration.Server.HTTPListen,
		ShutdownTimeout: configuration.Server.ShutdownTimeout.Std(),
		TLSCertFile:     configuration.Server.TLSCertFile,
		TLSKeyFile:      configuration.Server.TLSKeyFile,
		Gatherer:        registry,
		Logger:          logger,
	})
	if err != nil {
		return fmt.Errorf("create HTTP server: %w", err)
	}
	logger.InfoContext(
		ctx,
		"HTTP server starting",
		"component", "server",
		"address", configuration.Server.HTTPListen,
		"driver", configuration.Storage.Driver,
		"mode", configuration.Server.Mode,
	)
	if err := httpServer.Run(ctx); err != nil {
		return fmt.Errorf("serve HTTP: %w", err)
	}
	logger.InfoContext(ctx, "HTTP server stopped", "component", "server")
	return nil
}

func newRuntimeRegistry() (*prometheus.Registry, error) {
	registry := prometheus.NewRegistry()
	for _, collector := range []prometheus.Collector{
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	} {
		if err := registry.Register(collector); err != nil {
			return nil, fmt.Errorf("register runtime metrics: %w", err)
		}
	}
	return registry, nil
}

func newLogger(telemetry config.TelemetryConfig, output io.Writer) *slog.Logger {
	options := &slog.HandlerOptions{
		Level: logLevel(telemetry.LogLevel),
		ReplaceAttr: func(_ []string, attribute slog.Attr) slog.Attr {
			if attribute.Key == slog.LevelKey {
				attribute.Value = slog.StringValue(strings.ToLower(attribute.Value.String()))
			}
			return attribute
		},
	}
	if telemetry.LogFormat == "text" {
		return slog.New(slog.NewTextHandler(output, options))
	}
	return slog.New(slog.NewJSONHandler(output, options))
}

func logLevel(value string) slog.Level {
	switch value {
	case "trace":
		return slog.LevelDebug - 4
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
