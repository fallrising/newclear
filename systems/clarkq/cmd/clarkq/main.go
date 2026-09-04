package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/fallrising/clarkQ/internal/config"
	"github.com/fallrising/clarkQ/internal/observability"
	"github.com/fallrising/clarkQ/internal/server"
	"github.com/fallrising/clarkQ/internal/version"
)

func main() {
	cfg, err := config.MustLoad()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}
	v := version.Get()
	slog.Info("starting clarkQ",
		"addr", cfg.Addr,
		"version", v.Version,
		"commit", v.Commit,
	)

	otelShutdown, err := observability.Setup(context.Background(), cfg.OTELServiceName, cfg.OTELEndpoint)
	if err != nil {
		slog.Error("failed to setup opentelemetry", "error", err)
		os.Exit(1)
	}

	srv, err := server.New(cfg)
	if err != nil {
		slog.Error("failed to start server", "error", err)
		os.Exit(1)
	}
	srv.StartBackground()

	tlsCfg, err := server.BuildTLSConfig(cfg)
	if err != nil {
		slog.Error("failed to configure TLS", "error", err)
		os.Exit(1)
	}

	slog.Info("clarkQ ready",
		"auth_enabled", cfg.AuthEnabled(),
		"api_key_auth", len(cfg.APIKeys) > 0,
		"jwt_auth", cfg.JWTEnabled(),
		"jwt_acl", cfg.JWTACL,
		"oidc_issuer", cfg.OIDCIssuer,
		"encryption_mode", cfg.EncryptionMode,
		"encryption_queue_overrides", len(cfg.EncryptionQueues),
		"snapshot_enabled", cfg.SnapshotPath != "",
		"snapshot_path", cfg.SnapshotPath,
		"snapshot_interval", cfg.SnapshotInterval.String(),
		"wal_enabled", cfg.WALPath != "",
		"wal_path", cfg.WALPath,
		"tls_enabled", cfg.TLSEnabled(),
		"mtls_enabled", cfg.TLSClientCAFile != "",
		"otel_enabled", cfg.OTELEndpoint != "",
		"cluster_nodes", len(cfg.ClusterNodes),
		"cluster_advertise", cfg.ClusterAdvertiseURL,
		"replication_factor", cfg.ReplicationFactor,
		"replication_mode", cfg.ReplicationMode,
	)

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		TLSConfig:         tlsCfg,
	}

	errCh := make(chan error, 1)
	go func() {
		if cfg.TLSEnabled() {
			errCh <- httpServer.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
		} else {
			errCh <- httpServer.ListenAndServe()
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server stopped", "error", err)
			_ = srv.Shutdown()
			_ = otelShutdown(context.Background())
			os.Exit(1)
		}
	case sig := <-sigCh:
		slog.Info("shutdown signal received", "signal", sig.String())
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			slog.Error("graceful shutdown failed", "error", err)
			_ = srv.Shutdown()
			_ = otelShutdown(context.Background())
			os.Exit(1)
		}
		if err := srv.Shutdown(); err != nil {
			slog.Error("durability flush failed", "error", err)
			_ = otelShutdown(context.Background())
			os.Exit(1)
		}
		if err := otelShutdown(context.Background()); err != nil {
			slog.Error("otel shutdown failed", "error", err)
			os.Exit(1)
		}
		slog.Info("clarkQ stopped")
	}
}
