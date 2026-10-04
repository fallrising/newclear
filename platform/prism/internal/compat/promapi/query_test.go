package promapi

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/internal/telemetry"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql/parser"
)

type queryBackend struct {
	spi.Backend
	store spi.MetricStore
	caps  spi.Capabilities
}

func (b queryBackend) Metrics() spi.MetricStore       { return b.store }
func (b queryBackend) Capabilities() spi.Capabilities { return b.caps }

func TestQueryHandlerWireAndSafety(t *testing.T) {
	backend := queryBackend{store: queryStore{}, caps: spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}}}
	h, err := NewQueryHandler(backend, QueryOptions{Tenant: "default", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	for _, tc := range []struct {
		path     string
		code     int
		fragment string
	}{
		{"/prom/api/v1/status/buildinfo", 200, `"version":"2.53.0"`},
		{"/prom/api/v1/query?query=up%7B__tenant__%3D%22other%22%7D", 400, `"errorType":"bad_data"`},
		{"/prom/api/v1/query?query=up%20offset%2031d", 400, `"errorType":"bad_data"`},
		{"/prom/api/v1/query?query=up%20%40%200", 400, `"errorType":"bad_data"`},
		{"/prom/api/v1/query?query=1", 200, `"resultType":"scalar"`},
		{"/prom/api/v1/query?query=%22hello%22", 200, `"resultType":"string"`},
		{"/prom/api/v1/query?query=label_replace(up%2C%22safe%22%2C%22x%22%2C%22__tenant__%22%2C%22.*%22)", 400, `"errorType":"bad_data"`},
		{"/prom/api/v1/query?query=label_join(up%2C%22safe%22%2C%22%2C%22%2C%22__tenant__%22)", 400, `"errorType":"bad_data"`},
		{"/prom/api/v1/unknown", 404, `"errorType":"not_found"`},
	} {
		r := httptest.NewRecorder()
		h.HTTPHandler().ServeHTTP(r, httptest.NewRequestWithContext(t.Context(), http.MethodGet, tc.path, nil))
		if r.Code != tc.code || !strings.Contains(r.Body.String(), tc.fragment) {
			t.Errorf("%s: got %d %s", tc.path, r.Code, r.Body.String())
		}
	}
}

type queryStore struct{ spi.MetricStore }

func (queryStore) Select(ctx context.Context, q spi.SeriesQuery) (spi.SeriesSet, error) {
	return spi.SliceSeriesSet([]spi.SeriesData{{Labels: labels.FromStrings("__name__", "up", "job", "api"), Samples: []spi.Sample{{TS: 0, Value: 7}}}}), nil
}
func (queryStore) LabelNames(context.Context, spi.LabelQuery) ([]string, error) {
	return []string{"job"}, nil
}
func (queryStore) LabelValues(context.Context, string, spi.LabelQuery) ([]string, error) {
	return []string{"api"}, nil
}

func TestQueryHandlerAuthCatalogAndFallback(t *testing.T) {
	backend := queryBackend{store: queryStore{}, caps: spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}}}
	key := secret.String(strings.Repeat("k", 32))
	h, err := NewQueryHandler(backend, QueryOptions{Tenant: "default", APIKey: key, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	run := func(path, auth, tenant string, code int, fragment string) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		if auth != "" {
			r.Header.Set("Authorization", auth)
		}
		if tenant != "" {
			r.Header.Set("X-Prism-Tenant", tenant)
		}
		w := httptest.NewRecorder()
		h.HTTPHandler().ServeHTTP(w, r)
		if w.Code != code || !strings.Contains(w.Body.String(), fragment) {
			t.Errorf("%s: %d %s", path, w.Code, w.Body.String())
		}
	}
	run("/prom/api/v1/labels", "", "", 401, `"status":"error"`)
	run("/prom/api/v1/labels", "Bearer "+strings.Repeat("x", 32), "", 401, `"status":"error"`)
	run("/prom/api/v1/labels", "Bearer "+string(key), "other", 403, `"status":"error"`)
	run("/prom/api/v1/labels", "Bearer "+string(key), "", 200, `"__name__"`)
	run("/prom/api/v1/query?query=vector(1)", "Bearer "+string(key), "", 200, `"resultType":"vector"`)
	run("/prom/api/v1/series?match[]=up", "Bearer "+string(key), "", 200, `"job":"api"`)
}

func TestQueryASTTimeReach(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	floor := now.Add(-30 * 24 * time.Hour)
	for _, tc := range []struct {
		expr       string
		start, end time.Time
		want       bool
	}{
		{fmt.Sprintf("rate(up[1h] @ %d)", floor.Add(30*time.Minute).Unix()), now, now, false},
		{"rate(up[1h] @ end())", now.Add(-2 * time.Hour), now, true},
		{"rate(up[1h] @ start())", now.Add(-2 * time.Hour), now, true},
		{"up[1h:1ms]", now, now, false},
		{"up offset 31d", now, now, false},
		{"sum by (__tenant__) (up)", now, now, false},
		{"count_values(\"__tenant__\", up)", now, now, false},
		{"count_values((\"__tenant__\"), up)", now, now, false},
		{"label_replace(up,(\"__tenant__\"),\"x\",\"job\",\".*\")", now, now, false},
		{"label_replace(up,\"safe\",\"x\",(\"__tenant__\"),\".*\")", now, now, false},
		{"label_join(up,\"safe\",\",\",(\"__tenant__\"))", now, now, false},
		{"label_replace(up,\"safe\",\"x\",\"job\",\"__.*\")", now, now, true},
	} {
		parsed, err := parser.ParseExpr(tc.expr)
		if err != nil {
			t.Fatalf("parse %q: %v", tc.expr, err)
		}
		_, _, err = validateQueryAST(parsed, tc.start, tc.end, now, 30*24*time.Hour, 5*time.Minute)
		if (err == nil) != tc.want {
			t.Errorf("%q: err=%v want acceptance=%v", tc.expr, err, tc.want)
		}
	}
}

type nativeQueryStore struct {
	queryStore
	calls  int
	result *spi.PromResult
	err    error
}

func (s *nativeQueryStore) QueryInstant(context.Context, string, string, time.Time, time.Duration) (*spi.PromResult, error) {
	s.calls++
	return s.result, s.err
}
func (s *nativeQueryStore) QueryRange(context.Context, string, string, time.Time, time.Time, time.Duration, time.Duration) (*spi.PromResult, error) {
	s.calls++
	return s.result, s.err
}
func TestNativeResultOutputAndCap(t *testing.T) {
	store := &nativeQueryStore{result: &spi.PromResult{ResultType: "vector", Vector: []spi.VectorSample{{Labels: labels.FromStrings("__name__", "up", "__tenant__", "trusted", "job", "api"), TS: 1000, Value: 7}}}}
	backend := queryBackend{store: store, caps: spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}, Metrics: spi.MetricCaps{NativePromQL: true}}}
	h, err := NewQueryHandler(backend, QueryOptions{Tenant: "trusted", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	w := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/query?query=up", nil))
	if w.Code != 200 || store.calls != 1 || strings.Contains(w.Body.String(), "__tenant__") {
		t.Fatalf("native output: %d calls=%d body=%s", w.Code, store.calls, w.Body.String())
	}
	store.result.Vector = make([]spi.VectorSample, maxQueryResult+1)
	w = httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/query?query=up&limit=1", nil))
	if w.Code != 422 || store.calls != 2 {
		t.Fatalf("native hard cap: %d calls=%d", w.Code, store.calls)
	}
}

func TestCloseRepeatedAndStop(t *testing.T) {
	h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	for range 16 {
		if err := h.Close(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	w := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/labels", nil))
	if w.Code != 503 {
		t.Fatalf("stopped status=%d", w.Code)
	}
}

func TestResponseEscapingPreflight(t *testing.T) {
	if err := preflightResponse(map[string]string{"x": strings.Repeat("\x00", 6<<20)}, nil); err == nil {
		t.Fatal("accepted response whose JSON escaping exceeds 32 MiB")
	}
}
func TestNativeMatrixExtremeValueBudget(t *testing.T) {
	samples := make([]spi.Sample, 100000)
	for i := range samples {
		samples[i] = spi.Sample{TS: int64(i), Value: math.SmallestNonzeroFloat64}
	}
	_, _, err := wireNative(&spi.PromResult{ResultType: "matrix", Matrix: []spi.SeriesData{{Labels: labels.FromStrings("__name__", "up"), Samples: samples}}}, 0)
	if spi.Classify(err) != spi.ErrTooLarge {
		t.Fatalf("extreme sample values escaped cap: %v", err)
	}
}
func TestQueryHandlerRejectsSubmillisecondLookback(t *testing.T) {
	cfg := config.Default().Query
	cfg.LookbackDelta = config.Duration(500 * time.Microsecond)
	if _, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: cfg}); err == nil {
		t.Fatal("accepted lookback that would give an implicit subquery zero millisecond step")
	}
}

func TestSlowPOSTTimeout(t *testing.T) {
	cfg := config.Default().Query
	cfg.Timeout = config.Duration(25 * time.Millisecond)
	h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(h.HTTPHandler())
	defer server.Close()
	conn, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	_, err = io.WriteString(conn, "POST /prom/api/v1/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 1000\r\n\r\nq")
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	_ = conn.SetReadDeadline(started.Add(500 * time.Millisecond))
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatalf("slow POST stayed blocked: %v", err)
	}
	if time.Since(started) > 250*time.Millisecond {
		t.Fatalf("slow POST response took %s", time.Since(started))
	}
	if !strings.Contains(line, "503") {
		t.Fatalf("slow POST response=%q", line)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if err := h.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

type fixedQueryClock struct{ now time.Time }

func (c fixedQueryClock) Now() time.Time { return c.now }
func TestQueryRangeLookbackClamp(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	reg, err := telemetry.Register(prometheus.NewRegistry())
	if err != nil {
		t.Fatal(err)
	}
	h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: config.Default().Query, Clock: fixedQueryClock{now}, Telemetry: reg})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	floor := now.Add(-30 * 24 * time.Hour)
	path := fmt.Sprintf("/prom/api/v1/query_range?query=up&start=%d&end=%d&step=1m", floor.Add(-time.Hour).Unix(), floor.Add(6*time.Hour).Unix())
	w := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "start time clamped to max lookback") {
		t.Fatalf("clamp status=%d body=%s", w.Code, w.Body.String())
	}
	metric, ok := reg.CounterVec("prism_query_adjustments_total")
	value := new(dto.Metric)
	if ok {
		_ = metric.WithLabelValues("clamp_time").Write(value)
	}
	if !ok || value.GetCounter().GetValue() != 1 {
		t.Fatal("clamp adjustment not counted exactly once")
	}
}

func TestQueryGETBodyRejected(t *testing.T) {
	h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/status/buildinfo", strings.NewReader("unexpected body"))
	w := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, r)
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"errorType":"bad_data"`) {
		t.Fatalf("GET body accepted: %d %s", w.Code, w.Body.String())
	}
}
func TestNativeInnerRangeBound(t *testing.T) {
	store := &nativeQueryStore{result: &spi.PromResult{ResultType: "vector"}}
	backend := queryBackend{store: store, caps: spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}, Metrics: spi.MetricCaps{NativePromQL: true}}}
	h, err := NewQueryHandler(backend, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	w := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/query?query=rate(up%5B29d%5D)", nil))
	if w.Code != 400 || store.calls != 0 {
		t.Fatalf("native inner range bypass: %d calls=%d body=%s", w.Code, store.calls, w.Body.String())
	}
}

func TestQueryEngineUserErrorClasses(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: config.Default().Query, Clock: fixedQueryClock{now}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	cases := []struct {
		path string
		code int
		kind string
	}{
		{"/prom/api/v1/query?query=count_values(%22bad-name%22%2Cvector(1))", 422, `"errorType":"execution"`},
		{fmt.Sprintf("/prom/api/v1/query_range?query=up%%5B5m%%5D&start=%d&end=%d&step=1m", now.Add(-time.Minute).Unix(), now.Unix()), 400, `"errorType":"bad_data"`},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, tc.path, nil))
		if w.Code != tc.code || !strings.Contains(w.Body.String(), tc.kind) {
			t.Errorf("%s: %d %s", tc.path, w.Code, w.Body.String())
		}
	}
}

func TestFractionalMillisecondStepPointCap(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	cfg := config.Default().Query
	cfg.MaxPoints = 2
	h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: cfg, Clock: fixedQueryClock{now}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	path := fmt.Sprintf("/prom/api/v1/query_range?query=vector(1)&start=%.3f&end=%.3f&step=0.0011", utm.MilliToSecFloat(utm.TimeToMilli(now.Add(-2*time.Millisecond))), utm.MilliToSecFloat(utm.TimeToMilli(now)))
	w := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
	if w.Code != 400 {
		t.Fatalf("engine-rounded step bypassed point cap: %d %s", w.Code, w.Body.String())
	}
}
func TestNumericDurationBoundaries(t *testing.T) {
	for _, input := range []string{"1e-12", "9223372036.854776", "NaN", "+Inf"} {
		if d, err := parseDuration(input); err == nil {
			t.Errorf("%q accepted as %s", input, d)
		}
	}
	if d, err := parseDuration("0.0011"); err != nil || d != 1100*time.Microsecond {
		t.Fatalf("valid fractional seconds: %s %v", d, err)
	}
}

func TestQueryMalformedParameters(t *testing.T) {
	h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "t", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	requests := []*http.Request{
		httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/status/buildinfo?unexpected=1", nil),
		httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/prom/api/v1/query?timeout=%ZZ", strings.NewReader("query=vector(1)")),
	}
	requests[1].Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, r := range requests {
		w := httptest.NewRecorder()
		h.HTTPHandler().ServeHTTP(w, r)
		if w.Code != 400 || !strings.Contains(w.Body.String(), `"errorType":"bad_data"`) {
			t.Errorf("%s: %d %s", r.URL.String(), w.Code, w.Body.String())
		}
	}
}
