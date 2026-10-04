package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"

	"github.com/fallrising/newclear/platform/prism/internal/compat/otlp"
	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/limits"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	prismserver "github.com/fallrising/newclear/platform/prism/internal/server"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/client_golang/prometheus"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

func pipelineOptions(c *config.Config) ingest.Options {
	options := ingest.DefaultOptions()
	options.MaxTenants = 1
	options.MaxInputBytes = int(c.Ingest.MaxRequestBytes)
	for _, pair := range []struct {
		source config.BatchSignalConfig
		target *ingest.BatchOptions
	}{
		{c.Ingest.Batch.Metrics, &options.Metrics}, {c.Ingest.Batch.Logs, &options.Logs}, {c.Ingest.Batch.Traces, &options.Traces},
	} {
		pair.target.MaxItems = pair.source.MaxItems
		pair.target.MaxBytes = int(pair.source.MaxBytes)
		pair.target.FlushInterval = pair.source.FlushInterval.Std()
		pair.target.QueueDepth = c.Ingest.QueueDepth
	}
	options.Normalize = normalize.Options{ClockSkewPolicy: normalize.ClockSkewPolicy(c.Ingest.ClockSkewPolicy), MaxPast: c.Ingest.MaxPast.Std(), MaxFuture: c.Ingest.MaxFuture.Std()}
	active := c.Limits.MaxActiveSeriesPerTenant
	logBytes := int(c.Limits.MaxLogLineBytes)
	cardinality := c.Limits.CardinalityAlarmThreshold
	autoDrop := c.Limits.AutoDropHighCardinality
	options.Limits.Global = limits.Overrides{MaxActiveSeriesPerTenant: &active, MaxLogLineBytes: &logBytes, CardinalityAlarmThreshold: &cardinality, AutoDropHighCardinality: &autoDrop}
	return options
}

func runIngest(ctx context.Context, c *config.Config, logger *slog.Logger, registry *prometheus.Registry, backend spi.Backend) (result error) {
	// Direct runtime callers receive the same fail-closed checks as config-check.
	if err := c.Validate(ctx); err != nil {
		return fmt.Errorf("validate ingest runtime: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	var grpcOptions []grpc.ServerOption
	if c.Server.TLSCertFile != "" {
		certificate, err := tls.LoadX509KeyPair(c.Server.TLSCertFile, c.Server.TLSKeyFile)
		if err != nil {
			return fmt.Errorf("load gRPC TLS certificate: %w", err)
		}
		grpcOptions = append(grpcOptions, grpc.Creds(credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}})))
	}
	lifecycle, cancel := context.WithCancel(context.WithoutCancel(ctx))
	defer cancel()
	pipeline, err := ingest.New(lifecycle, backend, pipelineOptions(c))
	if err != nil {
		return fmt.Errorf("create ingest pipeline: %w", err)
	}
	// Covers constructor failures; normal server completion has already drained.
	defer func(cleanupContext context.Context) {
		shutdown, stop := context.WithCancel(context.WithoutCancel(cleanupContext))
		stop()
		result = errors.Join(result, pipeline.Close(shutdown))
	}(ctx)
	receiver, err := otlp.New(pipeline, otlp.Options{Tenant: c.Tenancy.DefaultTenant, APIKey: c.Auth.IngestAPIKey, MaxRequestBytes: int(c.Ingest.MaxRequestBytes), MaxRecvMsgSize: int(c.Ingest.OTLP.MaxRecvMsgSize), MaxConcurrentRequests: c.Ingest.OTLP.MaxConcurrentRequests})
	if err != nil {
		return fmt.Errorf("create OTLP receiver: %w", err)
	}
	//nolint:contextcheck // gRPC supplies per-RPC contexts; construction must not bind requests to daemon cancellation.
	grpcServer := receiver.NewGRPCServer(grpcOptions...)
	server, err := prismserver.New(prismserver.Options{Address: c.Server.HTTPListen, GRPCAddress: c.Server.GRPCListen, GRPCServer: grpcServer, ShutdownTimeout: c.Server.ShutdownTimeout.Std(), TLSCertFile: c.Server.TLSCertFile, TLSKeyFile: c.Server.TLSKeyFile, Gatherer: registry, Handler: receiver.HTTPHandler(), Logger: logger, StopReceiving: receiver.Stop, Drain: pipeline.Close})
	if err != nil {
		receiver.Stop()
		grpcServer.Stop()
		return fmt.Errorf("create ingest server: %w", err)
	}
	logger.InfoContext(ctx, "OTLP servers starting", "component", "ingest", "http_address", c.Server.HTTPListen, "grpc_address", c.Server.GRPCListen, "mode", c.Server.Mode)
	result = server.Run(ctx)
	logger.InfoContext(ctx, "OTLP servers stopped", "component", "ingest")
	return result
}
