package otlp

import (
	"context"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"go.opentelemetry.io/collector/pdata/pmetric/pmetricotlp"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/encoding"
	_ "google.golang.org/grpc/encoding/gzip" // Registers standard OTLP gzip support.
	"google.golang.org/grpc/stats"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/tap"
)

const (
	metricsMethod = "/opentelemetry.proto.collector.metrics.v1.MetricsService/Export"
	logsMethod    = "/opentelemetry.proto.collector.logs.v1.LogsService/Export"
	tracesMethod  = "/opentelemetry.proto.collector.trace.v1.TraceService/Export"
)

type permitKey struct{}
type permit struct {
	receiver *Receiver
	bytes    int
}

// NewGRPCServer registers the three standard unary methods. Additional options
// may supply TLS credentials and ordinary unary interceptors. Receiver-owned
// guards cannot be replaced. Use Server.Serve; ServeHTTP does not run tap.
func (r *Receiver) NewGRPCServer(options ...grpc.ServerOption) *grpc.Server {
	// #nosec G115 -- New validates capacity in [1,1024].
	streams := uint32(cap(r.gate))
	options = append(options, grpc.MaxRecvMsgSize(r.maxRecvMsgSize), grpc.MaxHeaderListSize(16<<10), grpc.MaxConcurrentStreams(streams), grpc.InTapHandle(r.tap), grpc.StatsHandler(r), grpc.ForceServerCodecV2(boundedCodec{base: encoding.GetCodecV2("proto")}))
	server := grpc.NewServer(options...)
	for _, entry := range []struct{ service, signal, method string }{{"opentelemetry.proto.collector.metrics.v1.MetricsService", "metrics", metricsMethod}, {"opentelemetry.proto.collector.logs.v1.LogsService", "logs", logsMethod}, {"opentelemetry.proto.collector.trace.v1.TraceService", "traces", tracesMethod}} {
		server.RegisterService(&grpc.ServiceDesc{ServiceName: entry.service, HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{{MethodName: "Export", Handler: func(_ any, ctx context.Context, decode func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
			p, _ := ctx.Value(permitKey{}).(*permit)
			if p == nil || p.receiver != r {
				return nil, status.Error(codes.Unauthenticated, "OTLP authentication required")
			}
			// The public pdata request wrapper lets the bounded codec validate before
			// entering its recursive generated parser, while preserving standard unary
			// registration, interceptor invocation and service metadata.
			request, target := newDecodeTarget(entry.signal)
			if err := decode(target); err != nil {
				return nil, err
			}
			if target.err != nil {
				return nil, classifiedStatus(target.err, 0).Err()
			}
			handler := func(ctx context.Context, request any) (any, error) { return r.exportGRPC(ctx, request) }
			if interceptor != nil {
				return interceptor(ctx, request, &grpc.UnaryServerInfo{Server: r, FullMethod: entry.method}, handler)
			}
			return handler(ctx, request)
		}}}}, r)
	}
	return server
}
func (r *Receiver) tap(ctx context.Context, info *tap.Info) (context.Context, error) {
	authenticated, err := r.authenticate(info.Header.Get("authorization"), info.Header.Get("x-scope-orgid"), info.Header.Get("x-prism-tenant"))
	if !authenticated {
		return ctx, status.Error(codes.Unauthenticated, "OTLP authentication required")
	}
	if err != nil {
		return ctx, classifiedStatus(err, 0).Err()
	}
	switch info.FullMethodName {
	case metricsMethod, logsMethod, tracesMethod:
	default:
		return ctx, status.Error(codes.Unimplemented, "OTLP method unsupported")
	}
	if err := r.acquire(ctx); err != nil {
		// Pinned grpc v1.69 drops details on tap abort. Receiver decoding capacity
		// uses Unavailable for SDK retry/backoff; pipeline queue/rate throttling is
		// ResourceExhausted plus RetryInfo through the normal unary response path.
		if spi.Classify(err) == spi.ErrThrottled {
			return ctx, status.Error(codes.Unavailable, "OTLP receiver capacity unavailable")
		}
		return ctx, classifiedStatus(err, 0).Err()
	}
	// Successful taps always reach the registered unary method, even after reset.
	// End runs after receive/decode and the handler; never release on cancellation
	// alone, which could admit more decoding while committed CPU work continues.
	ctx = context.WithValue(ctx, permitKey{}, &permit{receiver: r})
	return ctx, nil
}
func (r *Receiver) TagRPC(ctx context.Context, _ *stats.RPCTagInfo) context.Context { return ctx }
func (r *Receiver) HandleRPC(ctx context.Context, event stats.RPCStats) {
	p, _ := ctx.Value(permitKey{}).(*permit)
	if p == nil || p.receiver != r {
		return
	}
	switch event := event.(type) {
	case *stats.InPayload:
		p.bytes = event.Length
	case *stats.End:
		r.release()
	}
}
func (r *Receiver) TagConn(ctx context.Context, _ *stats.ConnTagInfo) context.Context { return ctx }
func (r *Receiver) HandleConn(context.Context, stats.ConnStats)                       {}

func newDecodeTarget(signal string) (any, *decodeTarget) {
	switch signal {
	case "metrics":
		request := pmetricotlp.NewExportRequest()
		return request, &decodeTarget{kind: metricsExport, decode: request.UnmarshalProto}
	case "logs":
		request := plogotlp.NewExportRequest()
		return request, &decodeTarget{kind: logsExport, decode: request.UnmarshalProto}
	default:
		request := ptraceotlp.NewExportRequest()
		return request, &decodeTarget{kind: tracesExport, decode: request.UnmarshalProto}
	}
}
func (r *Receiver) exportGRPC(ctx context.Context, request any) (any, error) {
	p, _ := ctx.Value(permitKey{}).(*permit)
	if p == nil || p.receiver != r {
		return nil, status.Error(codes.Unauthenticated, "OTLP authentication required")
	}
	ctx = ingest.WithTenant(ctx, r.tenant)
	n := int64(p.bytes)
	switch request := request.(type) {
	case pmetricotlp.ExportRequest:
		result, err := r.pipeline.SubmitOTLPMetrics(ctx, request.Metrics(), n)
		if err != nil {
			return nil, classifiedStatus(err, result.RetryAfter).Err()
		}
		return metricResponse(result), nil
	case plogotlp.ExportRequest:
		result, err := r.pipeline.SubmitOTLPLogs(ctx, request.Logs(), n)
		if err != nil {
			return nil, classifiedStatus(err, result.RetryAfter).Err()
		}
		return logResponse(result), nil
	case ptraceotlp.ExportRequest:
		result, err := r.pipeline.SubmitOTLPTraces(ctx, request.Traces(), n)
		if err != nil {
			return nil, classifiedStatus(err, result.RetryAfter).Err()
		}
		return traceResponse(result), nil
	default:
		return nil, classifiedStatus(failure(spi.ErrUnsupported), 0).Err()
	}
}
