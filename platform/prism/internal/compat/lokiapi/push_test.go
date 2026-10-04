package lokiapi

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

type submitFunc func(context.Context, []utm.LogRecord, int64) (ingest.Result, error)

func (f submitFunc) SubmitLogs(c context.Context, r []utm.LogRecord, n int64) (ingest.Result, error) {
	return f(c, r, n)
}
func success(_ context.Context, records []utm.LogRecord, _ int64) (ingest.Result, error) {
	return ingest.Result{Accepted: len(records)}, nil
}

var now = time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)

func options() PushOptions {
	return PushOptions{Tenant: "trusted", APIKey: secret.String(strings.Repeat("k", 32)), MaxRequestBytes: 1 << 20, Normalize: normalize.Options{Now: func() time.Time { return now }}, Logger: slog.New(slog.DiscardHandler)}
}
func receiver(t *testing.T, f submitFunc, o PushOptions) *PushReceiver {
	t.Helper()
	r, err := NewPushReceiver(f, o)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func request(payload []byte) *http.Request {
	r := httptest.NewRequestWithContext(context.Background(), "POST", "/loki/api/v1/push", bytes.NewReader(payload))
	r.Header.Set("Authorization", "Bearer "+strings.Repeat("k", 32))
	r.Header.Set("Content-Type", "application/json")
	return r
}
func payload() []byte {
	return []byte(` { "streams" : [{"stream":{"service":"api","level":"ERROR","__tenant__":"evil","request_id":"id"},"values":[["` + strconv.FormatInt(utm.TimeToNano(now), 10) + `","hello",{"attempt":"2","traceID":"0102030405060708090A0B0C0D0E0F10","spanID":"0102030405060708"}]]}] } `)
}
func gzipPayload(t *testing.T, p []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	if _, err := w.Write(p); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestPushJSONAndGzipMappingOriginalBytes(t *testing.T) {
	t.Parallel()
	for _, compressed := range []bool{false, true} {
		t.Run(strconv.FormatBool(compressed), func(t *testing.T) {
			wire := payload()
			called := false
			r := receiver(t, func(ctx context.Context, records []utm.LogRecord, n int64) (ingest.Result, error) {
				called = true
				if ingest.TenantFromContext(ctx) != "trusted" || n != int64(len(wire)) || len(records) != 1 {
					t.Fatalf("tenant/charge/records=%q/%d/%d", ingest.TenantFromContext(ctx), n, len(records))
				}
				log := records[0]
				if log.Resource.Tenant != "trusted" || log.Resource.Service != "api" || log.Body != "hello" || log.Severity != utm.SevError || log.Labels.Get("__tenant__") != "" || log.Attrs["attempt"] != "2" || log.Attrs["request_id"] != "id" || log.TraceID != "0102030405060708090a0b0c0d0e0f10" || log.SpanID != "0102030405060708" {
					t.Fatalf("mapping=%#v", log)
				}
				return success(ctx, records, n)
			}, options())
			body := wire
			if compressed {
				body = gzipPayload(t, wire)
			}
			req := request(body)
			req.Header.Set("X-Scope-OrgID", "trusted")
			req.Header.Set("X-Prism-Tenant", "trusted")
			if compressed {
				req.Header.Set("Content-Encoding", "gzip")
			}
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, req)
			if w.Code != 204 || w.Body.Len() != 0 || !called {
				t.Fatalf("status=%d body=%q called=%v", w.Code, w.Body.String(), called)
			}
		})
	}
}

type countedBody struct{ reads int }

func (b *countedBody) Read([]byte) (int, error) { b.reads++; return 0, io.EOF }
func (b *countedBody) Close() error             { return nil }
func TestPushHeadersAuthenticateBeforeBody(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		change func(*http.Request)
		code   int
	}{
		{"missing auth", func(r *http.Request) { r.Header.Del("Authorization") }, 401}, {"wrong auth", func(r *http.Request) { r.Header.Set("Authorization", "Bearer secret") }, 401}, {"duplicate auth", func(r *http.Request) { r.Header["authorization"] = []string{r.Header.Get("Authorization")} }, 401},
		{"long auth", func(r *http.Request) { r.Header.Set("Authorization", strings.Repeat("k", 5000)) }, 401},
		{"wrong tenant", func(r *http.Request) { r.Header.Set("X-Scope-OrgID", "evil") }, 400}, {"duplicate tenant", func(r *http.Request) { r.Header["x-prism-tenant"] = []string{"trusted", "trusted"} }, 400},
		{"missing type", func(r *http.Request) { r.Header.Del("Content-Type") }, 415}, {"other type", func(r *http.Request) { r.Header.Set("Content-Type", "application/x-protobuf") }, 415}, {"duplicate type", func(r *http.Request) { r.Header.Add("Content-Type", "application/json") }, 400}, {"invalid type", func(r *http.Request) { r.Header.Set("Content-Type", "application/json;") }, 400}, {"charset", func(r *http.Request) { r.Header.Set("Content-Type", "application/json; charset=latin1") }, 415}, {"duplicate charset", func(r *http.Request) { r.Header.Set("Content-Type", "application/json;charset=utf-8;charset=utf-8") }, 400},
		{"other encoding", func(r *http.Request) { r.Header.Set("Content-Encoding", "snappy") }, 415}, {"encoding list", func(r *http.Request) { r.Header.Set("Content-Encoding", "gzip, identity") }, 400}, {"duplicate encoding", func(r *http.Request) { r.Header["Content-Encoding"] = []string{"gzip", "gzip"} }, 400}, {"method", func(r *http.Request) { r.Method = "GET" }, 405},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			called := false
			r := receiver(t, func(context.Context, []utm.LogRecord, int64) (ingest.Result, error) {
				called = true
				return ingest.Result{}, nil
			}, options())
			req := request(nil)
			b := new(countedBody)
			req.Body = b
			tt.change(req)
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, req)
			if w.Code != tt.code || b.reads != 0 || called {
				t.Fatalf("status=%d reads=%d submit=%v", w.Code, b.reads, called)
			}
			if tt.code == 405 && w.Header().Get("Allow") != "POST" {
				t.Fatal("missing Allow")
			}
			if tt.code == 401 && w.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Fatal("missing auth challenge")
			}
		})
	}
}
func TestPushStatusesAndPartialCommit(t *testing.T) {
	t.Parallel()
	tests := []struct {
		class  spi.ErrClass
		result ingest.Result
		code   int
	}{
		{spi.ErrBadRequest, ingest.Result{}, 400}, {spi.ErrTooLarge, ingest.Result{}, 413}, {spi.ErrThrottled, ingest.Result{RetryAfter: 2 * time.Minute}, 429}, {spi.ErrUnavailable, ingest.Result{}, 503}, {spi.ErrTimeout, ingest.Result{}, 504}, {spi.ErrUnsupported, ingest.Result{}, 501}, {spi.ErrInternal, ingest.Result{}, 500},
		{spi.ErrThrottled, ingest.Result{Accepted: 1}, 500}, {spi.ErrUnavailable, ingest.Result{InternalFailures: 1}, 500}, {"", ingest.Result{Accepted: 1, Rejected: 1}, 400}, {"", ingest.Result{InternalFailures: 1}, 500},
	}
	for _, tt := range tests {
		t.Run(string(tt.class)+strconv.Itoa(tt.code), func(t *testing.T) {
			r := receiver(t, func(context.Context, []utm.LogRecord, int64) (ingest.Result, error) {
				var err error
				if tt.class != "" {
					err = spi.Wrap(tt.class, "", "test", errors.New("private backend secret"))
				}
				return tt.result, err
			}, options())
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, request(payload()))
			if w.Code != tt.code || strings.Contains(w.Body.String(), "secret") {
				t.Fatalf("status/body=%d/%q", w.Code, w.Body.String())
			}
			if tt.code == 429 || tt.code == 503 {
				delay, err := strconv.Atoi(w.Header().Get("Retry-After"))
				if err != nil || delay < 1 || delay > 60 {
					t.Fatal("invalid retry")
				}
			} else if w.Header().Get("Retry-After") != "" {
				t.Fatal("retry after committed/nonretryable result")
			}
			if tt.code == 400 && tt.result.Accepted > 0 && !strings.Contains(w.Body.String(), "accepted records may persist") {
				t.Fatal("missing partial warning")
			}
		})
	}
}
func TestPushEmptyAndSemanticRejections(t *testing.T) {
	t.Parallel()
	for _, wire := range []string{`{"streams":[]}`, `{"streams":[{"stream":{},"values":[]}]}`} {
		r := receiver(t, func(context.Context, []utm.LogRecord, int64) (ingest.Result, error) {
			t.Fatal("empty request submitted")
			return ingest.Result{}, nil
		}, options())
		w := httptest.NewRecorder()
		r.HTTPHandler().ServeHTTP(w, request([]byte(wire)))
		if w.Code != 204 {
			t.Fatalf("empty=%d", w.Code)
		}
	}
	wire := []byte(`{"streams":[{"stream":{},"values":[["bad","reject"],["` + strconv.FormatInt(utm.TimeToNano(now), 10) + `","accept"]]}]}`)
	r := receiver(t, func(ctx context.Context, records []utm.LogRecord, n int64) (ingest.Result, error) {
		if len(records) != 1 || records[0].Body != "accept" {
			t.Fatal("semantic partial mapping")
		}
		return success(ctx, records, n)
	}, options())
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(wire))
	if w.Code != 400 || !strings.Contains(w.Body.String(), "accepted records may persist") {
		t.Fatalf("partial=%d %s", w.Code, w.Body.String())
	}
	o := options()
	o.Normalize.MaxRecords = 1
	r = receiver(t, success, o)
	wire = []byte(strings.ReplaceAll(string(wire), "bad", strconv.FormatInt(utm.TimeToNano(now), 10)))
	w = httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(wire))
	if w.Code != 400 {
		t.Fatalf("output limit=%d", w.Code)
	}
}
