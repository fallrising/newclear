package promapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/golang/snappy"
	"github.com/prometheus/prometheus/prompb"
	"google.golang.org/protobuf/encoding/protowire"
)

const testKey = "01234567890123456789012345678901"

var testTime = time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)

type submitFunc func(context.Context, normalize.MetricBatch, int64) (ingest.Result, error)

func (f submitFunc) SubmitMetrics(ctx context.Context, b normalize.MetricBatch, n int64) (ingest.Result, error) {
	return f(ctx, b, n)
}
func options() WriteOptions {
	return WriteOptions{Tenant: "trusted", APIKey: secret.String(testKey), MaxRequestBytes: 1 << 20, Normalize: normalize.Options{Now: func() time.Time { return testTime }}}
}
func receiver(t *testing.T, f submitFunc, o WriteOptions) *WriteReceiver {
	t.Helper()
	r, err := NewWriteReceiver(f, o)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func sampleRequest() *prompb.WriteRequest {
	return &prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{Labels: []prompb.Label{{Name: "__name__", Value: "fixture_total"}, {Name: "__tenant__", Value: "untrusted"}}, Samples: []prompb.Sample{{Timestamp: utm.TimeToMilli(testTime), Value: 3}}}}}
}
func wire(t *testing.T, r *prompb.WriteRequest) []byte {
	t.Helper()
	b, err := r.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func request(body []byte) *http.Request {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/prom/api/v1/write", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+testKey)
	req.Header.Set("Content-Encoding", "snappy")
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")
	return req
}
func TestWriteSuccess(t *testing.T) {
	t.Parallel()
	payload := wire(t, sampleRequest())
	var called bool
	r := receiver(t, func(ctx context.Context, b normalize.MetricBatch, n int64) (ingest.Result, error) {
		called = true
		if ingest.TenantFromContext(ctx) != "trusted" || len(b.Points) != 1 || b.Points[0].Labels.Get("__tenant__") != "" || n != int64(len(payload)) {
			t.Errorf("incorrect submission: tenant=%q batch=%+v bytes=%d", ingest.TenantFromContext(ctx), b, n)
		}
		return ingest.Result{Accepted: len(b.Points)}, nil
	}, options())
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(snappy.Encode(nil, payload)))
	if w.Code != 204 || strings.TrimSpace(w.Body.String()) != "" || !called {
		t.Fatalf("response=%d %q called=%v; want 204 empty and submitted", w.Code, w.Body.String(), called)
	}
}

type countedBody struct{ reads int }

func (b *countedBody) Read(_ []byte) (int, error) { b.reads++; return 0, io.EOF }
func (b *countedBody) Close() error               { return nil }
func success(_ context.Context, b normalize.MetricBatch, _ int64) (ingest.Result, error) {
	return ingest.Result{Accepted: len(b.Points)}, nil
}

func TestWriteHeadersAndAuthenticationBeforeBody(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		change func(*http.Request)
		code   int
	}{
		{"missing auth", func(r *http.Request) { r.Header.Del("Authorization") }, 401},
		{"bad auth", func(r *http.Request) { r.Header.Set("Authorization", "Bearer private-invalid") }, 401},
		{"duplicate auth", func(r *http.Request) { r.Header.Add("Authorization", "Bearer "+testKey) }, 401},
		{"alternate case duplicate auth", func(r *http.Request) { r.Header["authorization"] = []string{"Bearer " + testKey} }, 401},
		{"other scope", func(r *http.Request) { r.Header.Set("X-Scope-OrgID", "other") }, 400},
		{"duplicate scope", func(r *http.Request) { r.Header["X-Scope-Orgid"] = []string{"trusted", "trusted"} }, 400},
		{"other tenant", func(r *http.Request) { r.Header.Set("X-Prism-Tenant", "other") }, 400},
		{"duplicate tenant", func(r *http.Request) { r.Header["X-Prism-Tenant"] = []string{"trusted", "trusted"} }, 400},
		{"missing encoding", func(r *http.Request) { r.Header.Del("Content-Encoding") }, 400},
		{"gzip", func(r *http.Request) { r.Header.Set("Content-Encoding", "gzip") }, 400},
		{"framed snappy selector", func(r *http.Request) { r.Header.Set("Content-Encoding", "snappy-framed") }, 400},
		{"duplicate encoding", func(r *http.Request) { r.Header.Add("Content-Encoding", "snappy") }, 400},
		{"missing media", func(r *http.Request) { r.Header.Del("Content-Type") }, 400},
		{"json", func(r *http.Request) { r.Header.Set("Content-Type", "application/json") }, 400},
		{"duplicate media", func(r *http.Request) { r.Header.Add("Content-Type", "application/x-protobuf") }, 400},
		{"v2 schema", func(r *http.Request) {
			r.Header.Set("Content-Type", "application/x-protobuf; proto=io.prometheus.write.v2.Request")
		}, 400},
		{"other schema", func(r *http.Request) { r.Header.Set("Content-Type", "application/x-protobuf; proto=other") }, 400},
		{"extra parameter", func(r *http.Request) { r.Header.Set("Content-Type", "application/x-protobuf; charset=utf-8") }, 400},
		{"duplicate parameter", func(r *http.Request) {
			r.Header.Set("Content-Type", "application/x-protobuf; proto=prometheus.WriteRequest; proto=prometheus.WriteRequest")
		}, 400},
		{"missing version", func(r *http.Request) { r.Header.Del("X-Prometheus-Remote-Write-Version") }, 400},
		{"v2", func(r *http.Request) { r.Header.Set("X-Prometheus-Remote-Write-Version", "2.0.0") }, 400},
		{"duplicate version", func(r *http.Request) { r.Header.Add("X-Prometheus-Remote-Write-Version", "0.1.0") }, 400},
		{"wrong method", func(r *http.Request) { r.Method = http.MethodGet }, 405},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			called := false
			r := receiver(t, func(context.Context, normalize.MetricBatch, int64) (ingest.Result, error) {
				called = true
				return ingest.Result{}, nil
			}, options())
			req := request(nil)
			tc.change(req)
			body := new(countedBody)
			req.Body = body
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, req)
			if w.Code != tc.code || body.reads != 0 || called {
				t.Fatalf("status=%d reads=%d called=%v", w.Code, body.reads, called)
			}
			if tc.code == 405 && w.Header().Get("Allow") != "POST" {
				t.Fatal("missing Allow")
			}
			if tc.code == 401 && w.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Fatal("missing challenge")
			}
			if strings.Contains(w.Body.String(), "private-invalid") || strings.Contains(w.Body.String(), testKey) {
				t.Fatal("credential echoed")
			}
			if tc.name == "v2" && !strings.Contains(w.Body.String(), "v1") {
				t.Fatal("missing v1-only diagnostic")
			}
		})
	}
}

func TestWriteValidHeadersAndEmpty(t *testing.T) {
	t.Parallel()
	r := receiver(t, success, options())
	for _, media := range []string{"application/x-protobuf", "application/x-protobuf; proto=prometheus.WriteRequest"} {
		req := request(snappy.Encode(nil, nil))
		req.Header.Set("Content-Type", media)
		req.Header.Set("X-Scope-OrgID", "trusted")
		req.Header.Set("X-Prism-Tenant", "trusted")
		w := httptest.NewRecorder()
		r.HTTPHandler().ServeHTTP(w, req)
		if w.Code != 204 || w.Body.Len() != 0 {
			t.Fatalf("empty=%d %s", w.Code, w.Body.String())
		}
	}
}

func TestWriteMalformedAndByteBounds(t *testing.T) {
	t.Parallel()
	hugePrefix := binary.AppendUvarint(nil, 1<<30)
	cases := []struct {
		name        string
		body        []byte
		limit, code int
	}{
		{"invalid snappy", []byte{1, 255}, 100, 400},
		{"truncated snappy", []byte{1}, 100, 400},
		{"invalid protobuf", snappy.Encode(nil, []byte{255}), 100, 400},
		{"compressed overflow", bytes.Repeat([]byte{1}, 101), 100, 413},
		{"compressed boundary valid", snappy.Encode(nil, nil), 1, 204},
		{"decompressed overflow", snappy.Encode(nil, bytes.Repeat([]byte{1}, 101)), 100, 413},
		{"decoded length before allocation", hugePrefix, 100, 413},
		{"framed snappy", []byte{255, 6, 0, 0, 's', 'N', 'a', 'P', 'p', 'Y'}, 1 << 20, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			o := options()
			o.MaxRequestBytes = tc.limit
			r := receiver(t, success, o)
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, request(tc.body))
			if w.Code != tc.code {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
}

func TestWriteLabelsOrderAndUTF8(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		change func(*prompb.WriteRequest)
	}{
		{"duplicate label", func(r *prompb.WriteRequest) {
			r.Timeseries[0].Labels = append(r.Timeseries[0].Labels, prompb.Label{Name: "__name__", Value: "fixture_total"})
		}},
		{"empty value", func(r *prompb.WriteRequest) { r.Timeseries[0].Labels[1].Value = "" }},
		{"empty label", func(r *prompb.WriteRequest) { r.Timeseries[0].Labels = append(r.Timeseries[0].Labels, prompb.Label{}) }},
		{"missing metric", func(r *prompb.WriteRequest) { r.Timeseries[0].Labels = r.Timeseries[0].Labels[1:] }},
		{"empty metric", func(r *prompb.WriteRequest) { r.Timeseries[0].Labels[0].Value = "" }},
		{"invalid metric", func(r *prompb.WriteRequest) { r.Timeseries[0].Labels[0].Value = "has spaces" }},
		{"invalid label utf8", func(r *prompb.WriteRequest) { r.Timeseries[0].Labels[1].Name = string([]byte{255}) }},
		{"invalid value utf8", func(r *prompb.WriteRequest) { r.Timeseries[0].Labels[1].Value = string([]byte{255}) }},
		{"out of order", func(r *prompb.WriteRequest) {
			r.Timeseries[0].Samples = append(r.Timeseries[0].Samples, prompb.Sample{Timestamp: 1})
		}},
		{"invalid exemplar", func(r *prompb.WriteRequest) {
			r.Timeseries[0].Exemplars = []prompb.Exemplar{{Labels: []prompb.Label{{Name: "trace_id"}, {Name: "trace_id"}}}}
		}},
		{"invalid metadata", func(r *prompb.WriteRequest) { r.Metadata = []prompb.MetricMetadata{{Help: string([]byte{255})}} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			called := false
			r := receiver(t, func(context.Context, normalize.MetricBatch, int64) (ingest.Result, error) {
				called = true
				return ingest.Result{}, nil
			}, options())
			input := sampleRequest()
			tc.change(input)
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, request(snappy.Encode(nil, wire(t, input))))
			if w.Code != 400 || called {
				t.Fatalf("status=%d called=%v", w.Code, called)
			}
		})
	}
}

func TestWritePreservesSampleBitsMappingAndOriginalBytes(t *testing.T) {
	t.Parallel()
	bits := []uint64{0x7ff0000000000002, 0x7ff8000000000042, 0x7ff0000000000000, 0xfff0000000000000}
	input := sampleRequest()
	input.Timeseries[0].Samples = nil
	for _, b := range bits {
		input.Timeseries[0].Samples = append(input.Timeseries[0].Samples, prompb.Sample{Value: math.Float64frombits(b), Timestamp: utm.TimeToMilli(testTime)})
	}
	input.Timeseries[0].Labels = append(input.Timeseries[0].Labels, prompb.Label{Name: "dotted.name", Value: "mapped"})
	input.Timeseries[0].Exemplars = []prompb.Exemplar{{Labels: []prompb.Label{{Name: "trace_id", Value: "abc"}}, Value: 1}, {Value: 2}}
	input.Timeseries[0].Histograms = []prompb.Histogram{{}}
	input.Metadata = []prompb.MetricMetadata{{MetricFamilyName: "fixture_total", Help: "help", Type: prompb.MetricMetadata_COUNTER}}
	payload := wire(t, input)
	payload = protowire.AppendTag(payload, 100, protowire.BytesType)
	payload = protowire.AppendBytes(payload, []byte("opaque unknown field"))
	r := receiver(t, func(_ context.Context, b normalize.MetricBatch, n int64) (ingest.Result, error) {
		if n != int64(len(payload)) || len(b.Points) != len(bits) || len(b.Metadata) != 1 {
			t.Fatalf("batch=%+v bytes=%d", b, n)
		}
		for i, p := range b.Points {
			if math.Float64bits(p.Value) != bits[i] || p.Labels.Get("dotted_name") != "mapped" || p.Type != utm.TypeCounter {
				t.Fatalf("point %d=%+v bits=%x", i, p, math.Float64bits(p.Value))
			}
		}
		if b.Points[0].Exemplar == nil || b.Points[0].Exemplar.Labels.Get("trace_id") != "abc" {
			t.Fatal("exemplar lost")
		}
		return ingest.Result{Accepted: len(b.Points), MetadataUnsupported: 1}, nil
	}, options())
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(snappy.Encode(nil, payload)))
	if w.Code != 204 {
		t.Fatalf("response=%d %s", w.Code, w.Body.String())
	}
}

func TestWriteSubmissionOutcomes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		result ingest.Result
		err    error
		code   int
		retry  string
	}{
		{"rate", ingest.Result{RetryAfter: 2 * time.Second}, writeFailure(spi.ErrThrottled), 429, "2"},
		{"retry bounded", ingest.Result{RetryAfter: time.Hour}, writeFailure(spi.ErrThrottled), 429, "60"},
		{"queue", ingest.Result{}, writeFailure(spi.ErrThrottled), 429, "1"},
		{"unavailable", ingest.Result{}, writeFailure(spi.ErrUnavailable), 503, "1"},
		{"unsupported", ingest.Result{}, writeFailure(spi.ErrUnsupported), 501, ""},
		{"cancel", ingest.Result{}, context.Canceled, 504, ""},
		{"deadline", ingest.Result{}, context.DeadlineExceeded, 504, ""},
		{"oversize", ingest.Result{}, writeFailure(spi.ErrTooLarge), 413, ""},
		{"malformed", ingest.Result{}, writeFailure(spi.ErrBadRequest), 400, ""},
		{"partial limiter", ingest.Result{Accepted: 1, Rejected: 1, RetryAfter: time.Second}, nil, 400, ""},
		{"all limiter rejected", ingest.Result{Rejected: 1}, nil, 400, ""},
		{"committed failure", ingest.Result{Accepted: 1, InternalFailures: 1}, nil, 500, ""},
		{"committed no acceptance", ingest.Result{InternalFailures: 1}, nil, 500, ""},
		{"err after acceptance", ingest.Result{Accepted: 1}, writeFailure(spi.ErrThrottled), 500, ""},
		{"err after metadata", ingest.Result{MetadataAccepted: 1}, writeFailure(spi.ErrUnavailable), 500, ""},
		{"opaque error", ingest.Result{}, fmt.Errorf("private-backend-secret"), 500, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var logs bytes.Buffer
			o := options()
			o.Logger = slog.New(slog.NewTextHandler(&logs, nil))
			r := receiver(t, func(context.Context, normalize.MetricBatch, int64) (ingest.Result, error) { return tc.result, tc.err }, o)
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, request(snappy.Encode(nil, wire(t, sampleRequest()))))
			if w.Code != tc.code || w.Header().Get("Retry-After") != tc.retry {
				t.Fatalf("status=%d retry=%q", w.Code, w.Header().Get("Retry-After"))
			}
			for _, s := range []string{testKey, "private-backend-secret", "fixture_total", "untrusted"} {
				if strings.Contains(w.Body.String()+logs.String(), s) {
					t.Fatal("unsafe diagnostic")
				}
			}
		})
	}
}

func TestWriteNormalizationPartial(t *testing.T) {
	t.Parallel()
	for _, policy := range []string{"clock", "capacity"} {
		t.Run(policy, func(t *testing.T) {
			t.Parallel()
			input := sampleRequest()
			input.Timeseries[0].Samples = append(input.Timeseries[0].Samples, prompb.Sample{Timestamp: utm.TimeToMilli(testTime) + 1, Value: 4})
			o := options()
			if policy == "clock" {
				o.Normalize.ClockSkewPolicy = normalize.ClockSkewDrop
				input.Timeseries[0].Samples[0].Timestamp = 1
			} else {
				o.Normalize.MaxRecords = 1
			}
			accepted := 0
			r := receiver(t, func(_ context.Context, b normalize.MetricBatch, _ int64) (ingest.Result, error) {
				accepted = len(b.Points)
				return ingest.Result{Accepted: accepted}, nil
			}, o)
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, request(snappy.Encode(nil, wire(t, input))))
			if w.Code != 400 || accepted != 1 || w.Header().Get("Retry-After") != "" {
				t.Fatalf("status=%d accepted=%d", w.Code, accepted)
			}
		})
	}
}
