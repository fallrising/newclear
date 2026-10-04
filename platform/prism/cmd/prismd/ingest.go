package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/fallrising/newclear/platform/prism/internal/compat/lokiapi"
	"github.com/fallrising/newclear/platform/prism/internal/compat/otlp"
	"github.com/fallrising/newclear/platform/prism/internal/compat/promapi"
	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/limits"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	prismserver "github.com/fallrising/newclear/platform/prism/internal/server"
	"github.com/fallrising/newclear/platform/prism/internal/telemetry"
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

func runIngest(ctx context.Context, c *config.Config, logger *slog.Logger, registry *prometheus.Registry, backend spi.Backend, metrics *telemetry.Registry) (result error) {
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
	defer receiver.Stop()
	writeReceiver, err := promapi.NewWriteReceiver(pipeline, promapi.WriteOptions{Tenant: c.Tenancy.DefaultTenant, APIKey: c.Auth.IngestAPIKey, MaxRequestBytes: int(c.Ingest.MaxRequestBytes), Normalize: pipelineOptions(c).Normalize, Logger: logger})
	if err != nil {
		return fmt.Errorf("create remote_write receiver: %w", err)
	}
	defer writeReceiver.Stop()
	pushReceiver, err := lokiapi.NewPushReceiver(pipeline, lokiapi.PushOptions{Tenant: c.Tenancy.DefaultTenant, APIKey: c.Auth.IngestAPIKey, MaxRequestBytes: int(c.Ingest.MaxRequestBytes), Normalize: pipelineOptions(c).Normalize, Logger: logger})
	if err != nil {
		return fmt.Errorf("create Loki push receiver: %w", err)
	}
	defer pushReceiver.Stop()
	var queryHandler *promapi.QueryHandler
	if c.Server.Mode == "all-in-one" {
		queryHandler, err = promapi.NewQueryHandler(backend, promapi.QueryOptions{
			Tenant: c.Tenancy.DefaultTenant, APIKey: c.Auth.IngestAPIKey,
			AllowAnonymousRead: c.Auth.AllowAnonymousRead, Config: c.Query,
			Telemetry: metrics, Logger: logger, Clock: spi.SystemClock,
		})
		if err != nil {
			return fmt.Errorf("create query handler: %w", err)
		}
	}
	mux := http.NewServeMux()
	mux.Handle("/prom/api/v1/write", writeReceiver.HTTPHandler())
	if queryHandler != nil {
		mux.Handle("/prom/api/v1/", queryHandler.HTTPHandler())
	}
	mux.Handle("/loki/api/v1/push", pushReceiver.HTTPHandler())
	mux.Handle("/", receiver.HTTPHandler())
	stopReceiving := func() {
		receiver.Stop()
		writeReceiver.Stop()
		pushReceiver.Stop()
		if queryHandler != nil {
			queryHandler.Stop()
		}
	}
	drain := func(shutdown context.Context) error {
		var queryErr error
		if queryHandler != nil {
			queryErr = queryHandler.Close(context.WithoutCancel(shutdown))
		}
		return errors.Join(queryErr, pipeline.Close(shutdown))
	}
	//nolint:contextcheck // gRPC supplies per-RPC contexts; construction must not bind requests to daemon cancellation.
	grpcServer := receiver.NewGRPCServer(grpcOptions...)
	server, err := prismserver.New(prismserver.Options{Address: c.Server.HTTPListen, GRPCAddress: c.Server.GRPCListen, GRPCServer: grpcServer, ShutdownTimeout: c.Server.ShutdownTimeout.Std(), TLSCertFile: c.Server.TLSCertFile, TLSKeyFile: c.Server.TLSKeyFile, Gatherer: registry, Handler: mux, Logger: logger, StopReceiving: stopReceiving, Drain: drain})
	if err != nil {
		stopReceiving()
		grpcServer.Stop()
		shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.Server.ShutdownTimeout.Std())
		defer cancel()
		return errors.Join(fmt.Errorf("create ingest server: %w", err), drain(shutdown))
	}
	logger.InfoContext(ctx, "ingest servers starting", "component", "ingest", "http_address", c.Server.HTTPListen, "grpc_address", c.Server.GRPCListen, "mode", c.Server.Mode)
	result = server.Run(ctx)
	logger.InfoContext(ctx, "ingest servers stopped", "component", "ingest")
	return result
}
