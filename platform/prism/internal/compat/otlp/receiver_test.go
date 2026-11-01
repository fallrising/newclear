package otlp_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/compat/otlp"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/pmetric/pmetricotlp"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"
	"go.uber.org/goleak"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/hpack"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	rpcstatus "google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	grpcgzip "google.golang.org/grpc/encoding/gzip"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/stats"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const credential = "0123456789abcdef0123456789abcdef"
const metricsRPC = "/opentelemetry.proto.collector.metrics.v1.MetricsService/Export"

type submitter struct {
	calls   atomic.Int64
	observe func(string, any)
	run     func(context.Context, string, int, int64) (ingest.Result, error)
}

func (s *submitter) submit(ctx context.Context, signal string, count int, n int64) (ingest.Result, error) {
	s.calls.Add(1)
	if s.run != nil {
		return s.run(ctx, signal, count, n)
	}
	return ingest.Result{}, nil
}
func (s *submitter) SubmitOTLPMetrics(ctx context.Context, m pmetric.Metrics, n int64) (ingest.Result, error) {
	if s.observe != nil {
		s.observe("metrics", m)
	}
	return s.submit(ctx, "metrics", m.DataPointCount(), n)
}
func (s *submitter) SubmitOTLPLogs(ctx context.Context, l plog.Logs, n int64) (ingest.Result, error) {
	if s.observe != nil {
		s.observe("logs", l)
	}
	return s.submit(ctx, "logs", l.LogRecordCount(), n)
}
func (s *submitter) SubmitOTLPTraces(ctx context.Context, tr ptrace.Traces, n int64) (ingest.Result, error) {
	if s.observe != nil {
		s.observe("traces", tr)
	}
	return s.submit(ctx, "traces", tr.SpanCount(), n)
}
func options() otlp.Options {
	return otlp.Options{Tenant: "tenant", APIKey: secret.String(credential), MaxRequestBytes: 4096, MaxRecvMsgSize: 4096, MaxConcurrentRequests: 2}
}
func receiver(t *testing.T, s *submitter, o otlp.Options) *otlp.Receiver {
	t.Helper()
	r, err := otlp.New(s, o)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

type requestWire interface {
	MarshalJSON() ([]byte, error)
	MarshalProto() ([]byte, error)
}

func payload(t *testing.T, signal string, json, empty bool) []byte {
	t.Helper()
	var request requestWire
	switch signal {
	case "metrics":
		r := pmetricotlp.NewExportRequest()
		if !empty {
			m := r.Metrics().ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
			m.SetName("value")
			m.SetEmptyGauge().DataPoints().AppendEmpty().SetDoubleValue(1)
		}
		request = r
	case "logs":
		r := plogotlp.NewExportRequest()
		if !empty {
			r.Logs().ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("hello")
		}
		request = r
	case "traces":
		r := ptraceotlp.NewExportRequest()
		if !empty {
			r.Traces().ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty().SetName("span")
		}
		request = r
	}
	var data []byte
	var err error
	if json {
		data, err = request.MarshalJSON()
	} else {
		data, err = request.MarshalProto()
	}
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func zipped(t *testing.T, data []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	writer := gzipwriter(&b)
	if _, err := writer.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// Distinguish the compressor package from grpc's standard gzip name.
func gzipwriter(w io.Writer) *gzip.Writer { return gzip.NewWriter(w) }
func httpCall(r *otlp.Receiver, signal string, data []byte, json bool, modify func(*http.Request)) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/"+signal, bytes.NewReader(data))
	request.Header.Set("Authorization", "Bearer "+credential)
	if json {
		request.Header.Set("Content-Type", "application/json")
	} else {
		request.Header.Set("Content-Type", "application/x-protobuf")
	}
	if modify != nil {
		modify(request)
	}
	response := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(response, request)
	return response
}
func TestHTTPThreeSignalsEncodingsCompressionEmptyAndPartial(t *testing.T) {
	for _, signal := range []string{"metrics", "logs", "traces"} {
		for _, json := range []bool{false, true} {
			for _, compressed := range []bool{false, true} {
				for _, empty := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/json=%v/gzip=%v/empty=%v", signal, json, compressed, empty), func(t *testing.T) {
						data := payload(t, signal, json, empty)
						expectedBytes := len(data)
						s := &submitter{run: func(ctx context.Context, got string, count int, n int64) (ingest.Result, error) {
							if ingest.TenantFromContext(ctx) != "tenant" || got != signal || n != int64(expectedBytes) {
								t.Errorf("identity/signal/bytes: %q %q %d", ingest.TenantFromContext(ctx), got, n)
							}
							expected := 1
							if empty {
								expected = 0
							}
							if count != expected {
								t.Errorf("count=%d", count)
							}
							return ingest.Result{Accepted: 7, Rejected: 3, OTLPRejected: expected, MetadataUnsupported: 1}, nil
						}}
						r := receiver(t, s, options())
						if compressed {
							data = zipped(t, data)
						}
						response := httpCall(r, signal, data, json, func(request *http.Request) {
							if compressed {
								request.Header.Set("Content-Encoding", "gzip")
							}
							request.Header.Set("X-Scope-OrgID", "tenant")
							request.Header.Set("X-Prism-Tenant", "tenant")
						})
						if response.Code != 200 {
							t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
						}
						rejected := int64(-1)
						message := ""
						switch signal {
						case "metrics":
							rsp := pmetricotlp.NewExportResponse()
							var err error
							if json {
								err = rsp.UnmarshalJSON(response.Body.Bytes())
							} else {
								err = rsp.UnmarshalProto(response.Body.Bytes())
							}
							if err != nil {
								t.Fatal(err)
							}
							rejected = rsp.PartialSuccess().RejectedDataPoints()
							message = rsp.PartialSuccess().ErrorMessage()
						case "logs":
							rsp := plogotlp.NewExportResponse()
							var err error
							if json {
								err = rsp.UnmarshalJSON(response.Body.Bytes())
							} else {
								err = rsp.UnmarshalProto(response.Body.Bytes())
							}
							if err != nil {
								t.Fatal(err)
							}
							rejected = rsp.PartialSuccess().RejectedLogRecords()
							message = rsp.PartialSuccess().ErrorMessage()
						case "traces":
							rsp := ptraceotlp.NewExportResponse()
							var err error
							if json {
								err = rsp.UnmarshalJSON(response.Body.Bytes())
							} else {
								err = rsp.UnmarshalProto(response.Body.Bytes())
							}
							if err != nil {
								t.Fatal(err)
							}
							rejected = rsp.PartialSuccess().RejectedSpans()
							message = rsp.PartialSuccess().ErrorMessage()
						}
						expected := int64(1)
						if empty {
							expected = 0
						}
						if rejected != expected || !strings.Contains(message, "metric metadata unsupported") || s.calls.Load() != 1 {
							t.Fatalf("partial count=%d message=%s calls=%d", rejected, message, s.calls.Load())
						}
					})
				}
			}
		}
	}
}
func TestHTTPRejectsBeforeAdmission(t *testing.T) {
	tests := []struct {
		name   string
		body   []byte
		modify func(*http.Request)
		code   int
		class  string
	}{
		{"missing auth", nil, func(r *http.Request) { r.Header.Del("Authorization") }, 401, "bad_request"},
		{"wrong auth", nil, func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+credential+"wrong") }, 401, "bad_request"},
		{"repeated auth", nil, func(r *http.Request) { r.Header.Add("Authorization", "Bearer "+credential) }, 401, "bad_request"},
		{"tenant mismatch", nil, func(r *http.Request) { r.Header.Set("X-Scope-OrgID", "other") }, 400, "bad_request"},
		{"tenant repeats", nil, func(r *http.Request) {
			r.Header.Add("X-Prism-Tenant", "tenant")
			r.Header.Add("X-Prism-Tenant", "tenant")
		}, 400, "bad_request"},
		{"tenant conflicting", nil, func(r *http.Request) {
			r.Header.Set("X-Scope-OrgID", "tenant")
			r.Header.Set("X-Prism-Tenant", "other")
		}, 400, "bad_request"},
		{"media", nil, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }, 415, "unsupported"},
		{"media repeats", nil, func(r *http.Request) { r.Header.Add("Content-Type", "application/json") }, 415, "unsupported"},
		{"encoding", nil, func(r *http.Request) { r.Header.Set("Content-Encoding", "br") }, 415, "unsupported"},
		{"encoding repeats", nil, func(r *http.Request) {
			r.Header.Add("Content-Encoding", "gzip")
			r.Header.Add("Content-Encoding", "gzip")
		}, 415, "unsupported"},
		{"malformed", []byte{0xff}, nil, 400, "bad_request"},
		{"wire oversized", bytes.Repeat([]byte{0}, 4097), nil, 413, "too_large"},
		{"compression bomb", nil, func(r *http.Request) {
			r.Header.Set("Content-Encoding", "gzip")
			r.Body = io.NopCloser(bytes.NewReader(zipped(t, bytes.Repeat([]byte{0}, 8192))))
		}, 413, "too_large"},
		{"malformed gzip", []byte{0xff}, func(r *http.Request) { r.Header.Set("Content-Encoding", "gzip") }, 400, "bad_request"},
		{"canceled", nil, func(r *http.Request) {
			ctx, cancel := context.WithCancel(r.Context())
			cancel()
			*r = *r.WithContext(ctx)
		}, 503, "timeout"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			s := &submitter{}
			r := receiver(t, s, options())
			rsp := httpCall(r, "metrics", test.body, false, test.modify)
			if rsp.Code != test.code || rsp.Header().Get("X-Prism-Error-Class") != test.class || s.calls.Load() != 0 {
				t.Fatalf("code=%d class=%s calls=%d body=%s", rsp.Code, rsp.Header().Get("X-Prism-Error-Class"), s.calls.Load(), rsp.Body.String())
			}
			decoded := &rpcstatus.Status{}
			if err := proto.Unmarshal(rsp.Body.Bytes(), decoded); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(decoded.Message, credential) {
				t.Fatal("credential disclosed")
			}
		})
	}
}
func TestHTTPClassifiedFailureRetryAndSanitization(t *testing.T) {
	for _, json := range []bool{false, true} {
		for _, class := range []spi.ErrClass{spi.ErrBadRequest, spi.ErrTooLarge, spi.ErrThrottled, spi.ErrUnavailable, spi.ErrTimeout, spi.ErrInternal} {
			t.Run(fmt.Sprintf("%s/json=%v", class, json), func(t *testing.T) {
				s := &submitter{run: func(context.Context, string, int, int64) (ingest.Result, error) {
					return ingest.Result{RetryAfter: 2 * time.Second}, spi.Wrap(class, "private", "backend", fmt.Errorf("%s private payload", credential))
				}}
				r := receiver(t, s, options())
				rsp := httpCall(r, "logs", payload(t, "logs", json, true), json, nil)
				if rsp.Header().Get("X-Prism-Error-Class") != string(class) {
					t.Fatalf("class=%s", rsp.Header().Get("X-Prism-Error-Class"))
				}
				st := &rpcstatus.Status{}
				var err error
				if json {
					err = protojson.Unmarshal(rsp.Body.Bytes(), st)
				} else {
					err = proto.Unmarshal(rsp.Body.Bytes(), st)
				}
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(st.Message, credential) || strings.Contains(st.Message, "private") {
					t.Fatal("backend disclosure")
				}
				if (rsp.Header().Get("Retry-After") != "") != spi.Retryable(class) {
					t.Fatalf("retry header=%s", rsp.Header().Get("Retry-After"))
				}
			})
		}
	}
}

type beginStats struct{ begin chan struct{} }

func (s *beginStats) TagRPC(ctx context.Context, _ *stats.RPCTagInfo) context.Context { return ctx }
func (s *beginStats) HandleRPC(_ context.Context, event stats.RPCStats) {
	if _, ok := event.(*stats.Begin); ok {
		select {
		case s.begin <- struct{}{}:
		default:
		}
	}
}
func (s *beginStats) TagConn(ctx context.Context, _ *stats.ConnTagInfo) context.Context { return ctx }
func (s *beginStats) HandleConn(context.Context, stats.ConnStats)                       {}
func grpcClient(t *testing.T, r *otlp.Receiver, extra ...grpc.ServerOption) *grpc.ClientConn {
	t.Helper()
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := r.NewGRPCServer(extra...)
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		if err := <-done; err != nil {
			t.Error(err)
		}
	})
	conn, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := conn.Close(); err != nil {
			t.Error(err)
		}
	})
	return conn
}
func authorized(ctx context.Context) context.Context {
	return metadata.NewOutgoingContext(ctx, metadata.Pairs("authorization", "Bearer "+credential))
}
func deadline(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}
func TestGRPCThreeSignalsGzipAndAuth(t *testing.T) {
	s := &submitter{run: func(ctx context.Context, _ string, _ int, n int64) (ingest.Result, error) {
		if ingest.TenantFromContext(ctx) != "tenant" || n != 0 {
			t.Errorf("tenant=%s bytes=%d", ingest.TenantFromContext(ctx), n)
		}
		return ingest.Result{OTLPRejected: 2}, nil
	}}
	r := receiver(t, s, options())
	conn := grpcClient(t, r)
	for _, compress := range []bool{false, true} {
		var opts []grpc.CallOption
		if compress {
			opts = append(opts, grpc.UseCompressor(grpcgzip.Name))
		}
		ctx := authorized(deadline(t))
		mr, err := pmetricotlp.NewGRPCClient(conn).Export(ctx, pmetricotlp.NewExportRequest(), opts...)
		if err != nil || mr.PartialSuccess().RejectedDataPoints() != 2 {
			t.Fatalf("metrics=%v", err)
		}
		lr, err := plogotlp.NewGRPCClient(conn).Export(ctx, plogotlp.NewExportRequest(), opts...)
		if err != nil || lr.PartialSuccess().RejectedLogRecords() != 2 {
			t.Fatalf("logs=%v", err)
		}
		tr, err := ptraceotlp.NewGRPCClient(conn).Export(ctx, ptraceotlp.NewExportRequest(), opts...)
		if err != nil || tr.PartialSuccess().RejectedSpans() != 2 {
			t.Fatalf("traces=%v", err)
		}
	}
	tests := []metadata.MD{metadata.Pairs(), metadata.Pairs("authorization", "Bearer wrong"), metadata.Pairs("authorization", "Bearer "+credential, "authorization", "Bearer "+credential), metadata.Pairs("authorization", "Bearer "+credential, "x-prism-tenant", "other"), metadata.Pairs("authorization", "Bearer "+credential, "x-scope-orgid", "tenant", "x-scope-orgid", "tenant")}
	before := s.calls.Load()
	for i, md := range tests {
		ctx := metadata.NewOutgoingContext(deadline(t), md)
		_, err := pmetricotlp.NewGRPCClient(conn).Export(ctx, pmetricotlp.NewExportRequest())
		expected := codes.Unauthenticated
		if i >= 3 {
			expected = codes.InvalidArgument
		}
		if status.Code(err) != expected {
			t.Errorf("case=%d code=%s err=%v", i, status.Code(err), err)
		}
	}
	if s.calls.Load() != before {
		t.Fatal("rejected request reached pipeline")
	}
}

// A byte codec lets adversarial tests send valid unknown fields and malformed
// messages through a real grpc listener without passing the client pdata parser.
type rawCodec struct{}

func (rawCodec) Name() string                  { return "proto" }
func (rawCodec) Marshal(v any) ([]byte, error) { return v.([]byte), nil }
func (rawCodec) Unmarshal([]byte, any) error   { return nil }
func rawCall(ctx context.Context, conn *grpc.ClientConn, body []byte, extra ...grpc.CallOption) error {
	opts := append([]grpc.CallOption{grpc.ForceCodec(rawCodec{})}, extra...)
	var out []byte
	return conn.Invoke(ctx, metricsRPC, body, &out, opts...)
}
func TestGRPCActualDecompressedBytesAndReceiveLimit(t *testing.T) {
	body := protowire.AppendTag(nil, 123, protowire.BytesType)
	body = protowire.AppendBytes(body, bytes.Repeat([]byte("x"), 1024))
	s := &submitter{run: func(_ context.Context, _ string, count int, n int64) (ingest.Result, error) {
		if count != 0 || n != int64(len(body)) {
			t.Errorf("count=%d bytes=%d want=%d", count, n, len(body))
		}
		return ingest.Result{}, nil
	}}
	r := receiver(t, s, options())
	conn := grpcClient(t, r, grpc.MaxRecvMsgSize(1<<20))
	for _, gzipOpt := range [][]grpc.CallOption{nil, {grpc.UseCompressor(grpcgzip.Name)}} {
		if err := rawCall(authorized(deadline(t)), conn, body, gzipOpt...); err != nil {
			t.Fatal(err)
		}
	}
	before := s.calls.Load()
	large := protowire.AppendTag(nil, 123, protowire.BytesType)
	large = protowire.AppendBytes(large, bytes.Repeat([]byte("x"), 8192))
	for _, gzipOpt := range [][]grpc.CallOption{nil, {grpc.UseCompressor(grpcgzip.Name)}} {
		if err := rawCall(authorized(deadline(t)), conn, large, gzipOpt...); status.Code(err) != codes.ResourceExhausted {
			t.Fatalf("oversize=%v", err)
		}
	}
	if s.calls.Load() != before {
		t.Fatal("oversize admitted")
	}
	// Decode failure must release the tapped slot.
	if err := rawCall(authorized(deadline(t)), conn, []byte{0xff}); err == nil {
		t.Fatal("malformed accepted")
	}
	if err := rawCall(authorized(deadline(t)), conn, body); err != nil {
		t.Fatalf("permit leaked: %v", err)
	}
}
func TestSharedGateAcrossConnectionsTransportsAndCanceledHandler(t *testing.T) {
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	s := &submitter{run: func(ctx context.Context, _ string, _ int, _ int64) (ingest.Result, error) {
		entered <- struct{}{}
		<-release
		return ingest.Result{InternalFailures: 1}, nil
	}}
	o := options()
	o.MaxConcurrentRequests = 1
	r := receiver(t, s, o)
	conn := grpcClient(t, r)
	other := grpcClient(t, r)
	ctx, cancel := context.WithCancel(authorized(deadline(t)))
	done := make(chan error, 1)
	go func() {
		_, err := pmetricotlp.NewGRPCClient(conn).Export(ctx, pmetricotlp.NewExportRequest())
		done <- err
	}()
	select {
	case <-entered:
	case <-deadline(t).Done():
		t.Fatal("request did not enter")
	}
	rsp := httpCall(r, "metrics", nil, false, nil)
	if rsp.Code != 429 || rsp.Header().Get("Retry-After") == "" {
		t.Fatalf("HTTP gate=%d", rsp.Code)
	}
	_, err := pmetricotlp.NewGRPCClient(other).Export(authorized(deadline(t)), pmetricotlp.NewExportRequest())
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("grpc gate=%v", err)
	}
	cancel()
	if err := <-done; status.Code(err) != codes.Canceled {
		t.Fatalf("cancel=%v", err)
	}
	// Cancellation does not release the permit while committed handler CPU work remains.
	if rsp := httpCall(r, "metrics", nil, false, nil); rsp.Code != 429 {
		t.Fatalf("early permit release=%d", rsp.Code)
	}
	close(release)
	r.Stop()
	if rsp := httpCall(r, "metrics", nil, false, nil); rsp.Code != 503 {
		t.Fatalf("stopped=%d", rsp.Code)
	}
}
func TestGRPCStalledDecodeCancellationReleasesPermit(t *testing.T) {
	o := options()
	o.MaxConcurrentRequests = 1
	s := &submitter{}
	r := receiver(t, s, o)
	events := &beginStats{begin: make(chan struct{}, 1)}
	conn := grpcClient(t, r, grpc.StatsHandler(events))
	ctx, cancel := context.WithCancel(authorized(deadline(t)))
	stream, err := conn.NewStream(ctx, &grpc.StreamDesc{}, metricsRPC)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	_ = stream
	select {
	case <-events.begin:
	case <-deadline(t).Done():
		t.Fatal("stream did not enter decoding")
	}
	if rsp := httpCall(r, "metrics", nil, false, nil); rsp.Code != 429 {
		t.Fatalf("stalled stream unbounded status=%d", rsp.Code)
	}
	cancel()
	// A successful follow-up on the same connection proves cancellation finished
	// the recv loop and released the permit without a context-only early release.
	ctx2 := authorized(deadline(t))
	for {
		_, err := pmetricotlp.NewGRPCClient(conn).Export(ctx2, pmetricotlp.NewExportRequest())
		if err == nil {
			break
		}
		if status.Code(err) != codes.Unavailable {
			t.Fatal(err)
		}
		select {
		case <-ctx2.Done():
			t.Fatal("permit leak")
		case <-time.After(time.Millisecond):
		}
	}
	if s.calls.Load() != 1 {
		t.Fatalf("calls=%d", s.calls.Load())
	}
}
func TestReceiverOptionsValidation(t *testing.T) {
	for _, mutate := range []func(*otlp.Options){func(o *otlp.Options) { o.Tenant = "" }, func(o *otlp.Options) { o.APIKey = "short" }, func(o *otlp.Options) { o.MaxRequestBytes = 0 }, func(o *otlp.Options) { o.MaxRecvMsgSize = 0 }, func(o *otlp.Options) { o.MaxConcurrentRequests = 0 }, func(o *otlp.Options) { o.MaxConcurrentRequests = 1025 }} {
		o := options()
		mutate(&o)
		if _, err := otlp.New(&submitter{}, o); spi.Classify(err) != spi.ErrBadRequest {
			t.Fatalf("invalid accepted: %v", err)
		}
	}
	if _, err := otlp.New(nil, options()); err == nil {
		t.Fatal("nil submitter accepted")
	}
}

func message(field protowire.Number, body []byte) []byte {
	out := protowire.AppendTag(nil, field, protowire.BytesType)
	return protowire.AppendBytes(out, body)
}
func nestedAnyValue(depth int) []byte {
	body := []byte{}
	for range depth {
		body = message(5, message(1, body))
	}
	return body
}
func deepExport(signal string, depth int) []byte {
	value := nestedAnyValue(depth)
	switch signal {
	case "logs":
		return message(1, message(2, message(2, message(5, value))))
	case "metrics":
		point := message(7, message(2, value))
		gauge := message(1, point)
		return message(1, message(2, message(2, message(5, gauge))))
	case "traces":
		return message(1, message(2, message(2, message(9, message(2, value)))))
	}
	return nil
}
func TestPredecodeDepthValidationAcrossSignalsAndTransports(t *testing.T) {
	s := &submitter{}
	r := receiver(t, s, options())
	conn := grpcClient(t, r)
	methods := map[string]string{"metrics": metricsRPC, "logs": "/opentelemetry.proto.collector.logs.v1.LogsService/Export", "traces": "/opentelemetry.proto.collector.trace.v1.TraceService/Export"}
	for _, signal := range []string{"metrics", "logs", "traces"} {
		t.Run(signal, func(t *testing.T) {
			body := deepExport(signal, 80)
			rsp := httpCall(r, signal, body, false, nil)
			if rsp.Code != 413 {
				t.Fatalf("HTTP deep status=%d", rsp.Code)
			}
			var out []byte
			err := conn.Invoke(authorized(deadline(t)), methods[signal], body, &out, grpc.ForceCodec(rawCodec{}))
			if status.Code(err) != codes.ResourceExhausted {
				t.Fatalf("grpc deep status=%v", err)
			}
			details := status.Convert(err).Details()
			found := false
			for _, detail := range details {
				if info, ok := detail.(*errdetails.ErrorInfo); ok && info.Reason == "too_large" {
					found = true
				}
				if _, ok := detail.(*errdetails.RetryInfo); ok {
					t.Fatal("permanently oversized payload suggested retry")
				}
			}
			if !found {
				t.Fatal("depth rejection lacks classification")
			}
		})
	}
	if s.calls.Load() != 0 {
		t.Fatal("deep data reached pipeline")
	}
	// Unknown protobuf bytes and scalar strings are not interpreted as messages.
	body := message(123, nestedAnyValue(80))
	if err := rawCall(authorized(deadline(t)), conn, body); err != nil {
		t.Fatalf("unknown scalar falsely traversed: %v", err)
	}
	// A valid deeply nested JSON request is refused before pdata allocation.
	bodyJSON := []byte(`{"resourceLogs":` + strings.Repeat("[", 80) + strings.Repeat("]", 80) + `}`)
	if rsp := httpCall(r, "logs", bodyJSON, true, nil); rsp.Code != 413 {
		t.Fatalf("JSON depth=%d", rsp.Code)
	}
	harmless := []byte(`{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"body":{"stringValue":"` + strings.Repeat("{[", 100) + `"}}]}]}]}`)
	if rsp := httpCall(r, "logs", harmless, true, nil); rsp.Code != 200 {
		t.Fatalf("JSON string falsely traversed: %d", rsp.Code)
	}
	// Unknown group wire types can recurse inside generated skip functions;
	// rejecting them avoids that parser path, and OTLP declares no groups.
	group := protowire.AppendTag(nil, 123, protowire.StartGroupType)
	group = protowire.AppendTag(group, 123, protowire.EndGroupType)
	if rsp := httpCall(r, "metrics", group, false, nil); rsp.Code != 400 {
		t.Fatalf("group=%d", rsp.Code)
	}
}
func TestHTTPStalledBodyCancellationAndPostCommitDiagnostic(t *testing.T) {
	s := &submitter{}
	o := options()
	o.MaxConcurrentRequests = 1
	r := receiver(t, s, o)
	reader, writer := io.Pipe()
	defer func() { _ = writer.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/logs", reader)
	request.Header.Set("Content-Type", "application/x-protobuf")
	request.Header.Set("Authorization", "Bearer "+credential)
	started := make(chan struct{})
	request.Body = &observedBody{ReadCloser: reader, started: started}
	done := make(chan struct{})
	response := httptest.NewRecorder()
	go func() { r.HTTPHandler().ServeHTTP(response, request); close(done) }()
	select {
	case <-started:
	case <-deadline(t).Done():
		t.Fatal("body did not start")
	}
	if rsp := httpCall(r, "logs", nil, false, nil); rsp.Code != 429 {
		t.Fatalf("body gate=%d", rsp.Code)
	}
	cancel()
	select {
	case <-done:
	case <-deadline(t).Done():
		t.Fatal("body cancellation stalled")
	}
	if s.calls.Load() != 0 {
		t.Fatal("canceled body submitted")
	}
	s.run = func(context.Context, string, int, int64) (ingest.Result, error) {
		return ingest.Result{InternalFailures: 1}, nil
	}
	rsp := httpCall(r, "logs", nil, false, nil)
	decoded := plogotlp.NewExportResponse()
	if err := decoded.UnmarshalProto(rsp.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	if rsp.Code != 200 || !strings.Contains(decoded.PartialSuccess().ErrorMessage(), "internal admission failure") || rsp.Header().Get("Retry-After") != "" {
		t.Fatal("postcommit invariant became retryable")
	}
}

type observedBody struct {
	io.ReadCloser
	started chan struct{}
	once    atomic.Bool
}

func (b *observedBody) Read(p []byte) (int, error) {
	if b.once.CompareAndSwap(false, true) {
		close(b.started)
	}
	return b.ReadCloser.Read(p)
}
func TestGRPCUnknownMethodAndTwoMessageFrames(t *testing.T) {
	s := &submitter{}
	r := receiver(t, s, options())
	conn := grpcClient(t, r)
	var out []byte
	if err := conn.Invoke(authorized(deadline(t)), metricsRPC+"Unknown", []byte{}, &out, grpc.ForceCodec(rawCodec{})); status.Code(err) != codes.Unimplemented {
		t.Fatalf("unknown=%v", err)
	}
	stream, err := conn.NewStream(authorized(deadline(t)), &grpc.StreamDesc{ClientStreams: true}, metricsRPC, grpc.ForceCodec(rawCodec{}))
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.SendMsg([]byte{}); err != nil {
		t.Fatal(err)
	}
	// Matches grpc's unary path: only the first message is submitted. Extra frames
	// cannot turn accepted telemetry into a new retryable application response.
	_ = stream.SendMsg([]byte{})
	if err := stream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	if err := stream.RecvMsg(&out); err != nil {
		t.Fatal(err)
	}
	if err := stream.RecvMsg(&out); !errors.Is(err, io.EOF) {
		t.Fatalf("extra response=%v", err)
	}
	if s.calls.Load() != 1 {
		t.Fatalf("submitted=%d", s.calls.Load())
	}
}

func TestGRPCPipelineRetryInfoAndStandardUnaryContracts(t *testing.T) {
	var intercepted atomic.Int64
	interceptor := func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		intercepted.Add(1)
		if info.FullMethod != metricsRPC {
			t.Errorf("method=%s", info.FullMethod)
		}
		return handler(ctx, request)
	}
	s := &submitter{run: func(context.Context, string, int, int64) (ingest.Result, error) {
		return ingest.Result{RetryAfter: 2 * time.Second}, spi.Wrap(spi.ErrThrottled, "private", "test", fmt.Errorf("%s private payload", credential))
	}}
	r := receiver(t, s, options())
	server := r.NewGRPCServer(grpc.UnaryInterceptor(interceptor))
	for service, info := range server.GetServiceInfo() {
		if len(info.Methods) != 1 || info.Methods[0].Name != "Export" || info.Methods[0].IsClientStream || info.Methods[0].IsServerStream {
			t.Errorf("unexpected service contract: %s %+v", service, info)
		}
	}
	server.Stop()
	conn := grpcClient(t, r, grpc.UnaryInterceptor(interceptor))
	_, err := pmetricotlp.NewGRPCClient(conn).Export(authorized(deadline(t)), pmetricotlp.NewExportRequest())
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("pipeline throttle=%v", err)
	}
	retry := false
	class := false
	for _, d := range status.Convert(err).Details() {
		switch d := d.(type) {
		case *errdetails.RetryInfo:
			retry = d.RetryDelay.AsDuration() == 2*time.Second
		case *errdetails.ErrorInfo:
			class = d.Reason == "throttled"
		}
	}
	if !retry || !class || intercepted.Load() != 1 {
		t.Fatalf("retry=%v class=%v interceptors=%d", retry, class, intercepted.Load())
	}
	if strings.Contains(err.Error(), credential) || strings.Contains(err.Error(), "private") {
		t.Fatal("backend disclosure")
	}
}

func TestGRPCNativeUnsupportedEncodingIsBoundedAndReleasesPermit(t *testing.T) {
	s := &submitter{}
	r := receiver(t, s, options())
	conn := grpcClient(t, r)
	ctx := deadline(t)
	socket, err := (&net.Dialer{}).DialContext(ctx, "tcp", conn.Target())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = socket.Close() }()
	stop := context.AfterFunc(ctx, func() { _ = socket.Close() })
	defer stop()
	if _, err := io.WriteString(socket, http2.ClientPreface); err != nil {
		t.Fatal(err)
	}
	framer := http2.NewFramer(socket, socket)
	if err := framer.WriteSettings(); err != nil {
		t.Fatal(err)
	}
	var headers bytes.Buffer
	encoder := hpack.NewEncoder(&headers)
	for _, header := range []hpack.HeaderField{{Name: ":method", Value: "POST"}, {Name: ":scheme", Value: "http"}, {Name: ":path", Value: metricsRPC}, {Name: ":authority", Value: conn.Target()}, {Name: "content-type", Value: "application/grpc"}, {Name: "te", Value: "trailers"}, {Name: "authorization", Value: "Bearer " + credential}, {Name: "grpc-encoding", Value: "unsupported-fixture"}} {
		if err := encoder.WriteField(header); err != nil {
			t.Fatal(err)
		}
	}
	if err := framer.WriteHeaders(http2.HeadersFrameParam{StreamID: 1, BlockFragment: headers.Bytes(), EndHeaders: true, EndStream: true}); err != nil {
		t.Fatal(err)
	}
	decoder := hpack.NewDecoder(4096, nil)
	found := false
	for !found {
		frame, err := framer.ReadFrame()
		if err != nil {
			t.Fatal(err)
		}
		if settings, ok := frame.(*http2.SettingsFrame); ok && !settings.IsAck() {
			if err := framer.WriteSettingsAck(); err != nil {
				t.Fatal(err)
			}
		}
		if h, ok := frame.(*http2.HeadersFrame); ok {
			fields, err := decoder.DecodeFull(h.HeaderBlockFragment())
			if err != nil {
				t.Fatal(err)
			}
			for _, field := range fields {
				if field.Name == "grpc-status" {
					if field.Value != "12" {
						t.Fatalf("native code=%s", field.Value)
					}
					found = true
				}
				if field.Name == "grpc-message" {
					if len(field.Value) > 16<<10 || strings.Contains(field.Value, credential) {
						t.Fatal("native error leaked credential or exceeded header bound")
					}
				}
			}
		}
	}
	if s.calls.Load() != 0 {
		t.Fatal("unsupported encoding admitted")
	}
	if _, err := pmetricotlp.NewGRPCClient(conn).Export(authorized(deadline(t)), pmetricotlp.NewExportRequest()); err != nil {
		t.Fatalf("native-error permit leaked: %v", err)
	}
}

func TestHTTPFullSuccessOmitsPartialSuccessAndMethodsAreClassified(t *testing.T) {
	for _, signal := range []string{"metrics", "logs", "traces"} {
		for _, json := range []bool{false, true} {
			s := &submitter{}
			r := receiver(t, s, options())
			rsp := httpCall(r, signal, payload(t, signal, json, true), json, nil)
			expected := ""
			if json {
				expected = "{}"
			}
			if rsp.Code != 200 || rsp.Body.String() != expected {
				t.Fatalf("full response %s JSON=%v: %q", signal, json, rsp.Body.String())
			}
			rsp = httpCall(r, signal, nil, json, func(request *http.Request) { request.Method = http.MethodGet })
			if rsp.Code != 405 || rsp.Header().Get("Allow") != "POST" || rsp.Header().Get("X-Prism-Error-Class") != "bad_request" {
				t.Fatalf("method status=%d headers=%v", rsp.Code, rsp.Header())
			}
			st := &rpcstatus.Status{}
			var err error
			if json {
				err = protojson.Unmarshal(rsp.Body.Bytes(), st)
			} else {
				err = proto.Unmarshal(rsp.Body.Bytes(), st)
			}
			if err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestUnknownErrorClassCannotLeakBackendText(t *testing.T) {
	s := &submitter{run: func(context.Context, string, int, int64) (ingest.Result, error) {
		return ingest.Result{}, spi.Wrap(spi.ErrClass(credential), "", "", fmt.Errorf("private backend payload"))
	}}
	r := receiver(t, s, options())
	rsp := httpCall(r, "metrics", []byte("{}"), true, nil)
	if rsp.Code != 500 || rsp.Header().Get("X-Prism-Error-Class") != "internal" || strings.Contains(rsp.Body.String(), credential) {
		t.Fatalf("unsafe classification status=%d", rsp.Code)
	}
	conn := grpcClient(t, r)
	_, err := pmetricotlp.NewGRPCClient(conn).Export(authorized(deadline(t)), pmetricotlp.NewExportRequest())
	if status.Code(err) != codes.Internal || strings.Contains(err.Error(), credential) {
		t.Fatalf("unsafe grpc classification=%v", err)
	}
}

func TestDeprecatedScopeWireMigrationAndModernPrecedence(t *testing.T) {
	for _, signal := range []string{"metrics", "logs", "traces"} {
		for _, modern := range []string{"legacy", "modern", "modern-empty"} {
			t.Run(fmt.Sprintf("%s/modern=%v", signal, modern), func(t *testing.T) {
				current := payload(t, signal, false, false)
				resource, n := protowire.ConsumeBytes(current[1:])
				if n < 0 {
					t.Fatal("fixture resource malformed")
				}

				var scopeBody []byte
				for len(resource) > 0 {
					number, wire, tagLen := protowire.ConsumeTag(resource)
					resource = resource[tagLen:]
					fieldLen := protowire.ConsumeFieldValue(number, wire, resource)
					if number == 2 {
						scopeBody, _ = protowire.ConsumeBytes(resource[:fieldLen])
						break
					}
					resource = resource[fieldLen:]
				}
				if len(scopeBody) == 0 {
					t.Fatal("fixture scope absent")
				}

				legacyResource := message(1000, scopeBody)
				if modern == "modern" {
					legacyResource = append(legacyResource, message(2, distinctModernScope(t, signal))...)
				}
				if modern == "modern-empty" {
					legacyResource = append(legacyResource, message(2, nil)...)
				}
				body := message(1, legacyResource)
				expectedCount := 1
				if modern == "modern-empty" {
					expectedCount = 0
				}
				s := &submitter{run: func(_ context.Context, _ string, count int, n int64) (ingest.Result, error) {
					if count != expectedCount || n != int64(len(body)) {
						t.Errorf("count=%d bytes=%d expectedbytes=%d", count, n, len(body))
					}
					return ingest.Result{}, nil
				}}
				s.observe = func(got string, input any) {
					if modern == "modern-empty" {
						return
					}
					wantModern := modern == "modern"
					switch data := input.(type) {
					case pmetric.Metrics:
						point := data.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Gauge().DataPoints().At(0)
						want := 1.0
						if wantModern {
							want = 2
						}
						if point.DoubleValue() != want {
							t.Errorf("metric precedence value=%v want=%v", point.DoubleValue(), want)
						}
					case plog.Logs:
						body := data.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Body().Str()
						want := "hello"
						if wantModern {
							want = "modern"
						}
						if body != want {
							t.Errorf("log precedence body=%q want=%q", body, want)
						}
					case ptrace.Traces:
						name := data.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0).Name()
						want := "span"
						if wantModern {
							want = "modern"
						}
						if name != want {
							t.Errorf("trace precedence name=%q want=%q", name, want)
						}
					default:
						t.Errorf("unexpected input %s", got)
					}
				}
				r := receiver(t, s, options())
				if rsp := httpCall(r, signal, body, false, nil); rsp.Code != 200 {
					t.Fatalf("HTTP=%d", rsp.Code)
				}
				methods := map[string]string{"metrics": metricsRPC, "logs": "/opentelemetry.proto.collector.logs.v1.LogsService/Export", "traces": "/opentelemetry.proto.collector.trace.v1.TraceService/Export"}
				conn := grpcClient(t, r)
				var out []byte
				if err := conn.Invoke(authorized(deadline(t)), methods[signal], body, &out, grpc.ForceCodec(rawCodec{})); err != nil {
					t.Fatal(err)
				}
				if s.calls.Load() != 2 {
					t.Fatalf("calls=%d", s.calls.Load())
				}
			})
		}
	}
}

func TestUnsupportedServeHTTPDoesNotDecodeWithoutTapPermit(t *testing.T) {
	s := &submitter{}
	r := receiver(t, s, options())
	server := r.NewGRPCServer()
	defer server.Stop()
	payload := deepExport("metrics", 80)
	wire := make([]byte, 5, len(payload)+5)
	binary.BigEndian.PutUint32(wire[1:], uint32(len(payload))) // #nosec G115 -- Fixed 80-level fixture is below 4 KiB.
	wire = append(wire, payload...)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, metricsRPC, bytes.NewReader(wire))
	request.ProtoMajor = 2
	request.ProtoMinor = 0
	request.Header.Set("Content-Type", "application/grpc")
	request.Header.Set("Authorization", "Bearer "+credential)
	rsp := httptest.NewRecorder()
	server.ServeHTTP(rsp, request)
	response := rsp.Result()
	defer func() { _ = response.Body.Close() }()
	code := response.Trailer.Get("Grpc-Status")
	if code == "" {
		code = response.Header.Get("Grpc-Status")
	}
	if code != "16" || s.calls.Load() != 0 {
		t.Fatalf("ServeHTTP permit bypass code=%q HTTP=%d calls=%d", code, response.StatusCode, s.calls.Load())
	}
}

func distinctModernScope(t *testing.T, signal string) []byte {
	t.Helper()
	input := payload(t, signal, false, false)
	var request requestWire
	switch signal {
	case "metrics":
		r := pmetricotlp.NewExportRequest()
		if err := r.UnmarshalProto(input); err != nil {
			t.Fatal(err)
		}
		r.Metrics().ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Gauge().DataPoints().At(0).SetDoubleValue(2)
		request = r
	case "logs":
		r := plogotlp.NewExportRequest()
		if err := r.UnmarshalProto(input); err != nil {
			t.Fatal(err)
		}
		r.Logs().ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Body().SetStr("modern")
		request = r
	case "traces":
		r := ptraceotlp.NewExportRequest()
		if err := r.UnmarshalProto(input); err != nil {
			t.Fatal(err)
		}
		r.Traces().ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0).SetName("modern")
		request = r
	}
	output, err := request.MarshalProto()
	if err != nil {
		t.Fatal(err)
	}
	resource, _ := protowire.ConsumeBytes(output[1:])
	for len(resource) > 0 {
		number, wire, n := protowire.ConsumeTag(resource)
		resource = resource[n:]
		size := protowire.ConsumeFieldValue(number, wire, resource)
		if number == 2 {
			body, _ := protowire.ConsumeBytes(resource[:size])
			return body
		}
		resource = resource[size:]
	}
	t.Fatal("modern fixture scope absent")
	return nil
}
