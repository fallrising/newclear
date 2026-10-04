package promapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"net/url"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/query/promqladapter"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/internal/telemetry"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/common/model"
	"github.com/prometheus/prometheus/promql"
	"github.com/prometheus/prometheus/promql/parser"
)

const (
	maxQueryInput    = 1 << 20
	maxExpression    = 64 << 10
	maxQueryResult   = 100000
	maxQueryMetadata = 64 << 20
	maxQueryResponse = 32 << 20
	maxQueryWarnings = 32
)

type QueryOptions struct {
	Tenant             string
	APIKey             secret.String
	AllowAnonymousRead bool
	Config             config.QueryConfig
	Telemetry          *telemetry.Registry
	Logger             *slog.Logger
	Clock              spi.Clock
}

type QueryHandler struct {
	backend    spi.Backend
	store      spi.MetricStore
	tenant     string
	key        [sha256.Size]byte
	anonymous  bool
	config     config.QueryConfig
	telemetry  *telemetry.Registry
	logger     *slog.Logger
	clock      spi.Clock
	gate       chan struct{}
	tenantGate chan struct{}
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex // Protects stopped and active; held through admission registration.
	stopped    bool
	active     int
	done       chan struct{}
}
type queryResponseWriter struct {
	http.ResponseWriter
	writing *atomic.Bool
}

func (w *queryResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *queryResponseWriter) WriteHeader(status int) {
	w.writing.Store(true)
	w.ResponseWriter.WriteHeader(status)
}
func (w *queryResponseWriter) Write(p []byte) (int, error) {
	w.writing.Store(true)
	return w.ResponseWriter.Write(p)
}

func NewQueryHandler(backend spi.Backend, options QueryOptions) (*QueryHandler, error) {
	c := options.Config
	if backend == nil || backend.Metrics() == nil || options.Tenant == "" || len(options.Tenant) > 2048 || strings.TrimSpace(options.Tenant) != options.Tenant || (!options.AllowAnonymousRead && (len(options.APIKey) < 32 || len(options.APIKey) > 4096)) || c.Timeout <= 0 || c.MaxLookback <= 0 || c.MaxRange <= 0 || c.MaxRange > c.MaxLookback || c.LookbackDelta < config.Duration(utm.MetricTimeUnit) || c.LookbackDelta > c.MaxLookback || c.MaxConcurrent <= 0 || c.MaxConcurrentPerTenant <= 0 || c.MaxConcurrentPerTenant > c.MaxConcurrent || c.MaxPoints <= 0 || c.MaxSamples <= 0 || c.MaxSamples > math.MaxInt || c.Fallback.MaxRange <= 0 || c.Fallback.MaxRange > c.MaxRange || c.Fallback.MaxRows <= 0 {
		return nil, fmt.Errorf("invalid query handler settings")
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.Clock == nil {
		options.Clock = spi.SystemClock
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &QueryHandler{backend: backend, store: backend.Metrics(), tenant: strings.Clone(options.Tenant), key: sha256.Sum256([]byte(options.APIKey)), anonymous: options.AllowAnonymousRead, config: c, telemetry: options.Telemetry, logger: options.Logger, clock: options.Clock, gate: make(chan struct{}, c.MaxConcurrent), tenantGate: make(chan struct{}, c.MaxConcurrentPerTenant), ctx: ctx, cancel: cancel, done: make(chan struct{})}, nil
}

func (h *QueryHandler) Stop() {
	h.mu.Lock()
	if !h.stopped {
		h.stopped = true
		h.cancel()
		if h.active == 0 {
			close(h.done)
		}
	}
	h.mu.Unlock()
}
func (h *QueryHandler) Close(ctx context.Context) error {
	h.Stop()
	select {
	case <-h.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *QueryHandler) HTTPHandler() http.Handler { return http.HandlerFunc(h.serveHTTP) }
func (h *QueryHandler) serveHTTP(w http.ResponseWriter, r *http.Request) {
	var writing atomic.Bool
	w = &queryResponseWriter{ResponseWriter: w, writing: &writing}
	path := r.URL.Path
	kind, methods := routeKind(path)
	started := time.Now()
	defer h.observeRequest(kind, started, w)
	if kind == "" {
		h.errorResponse(w, spi.ErrNotFound, "not found", false)
		return
	}
	if !slices.Contains(methods, r.Method) {
		w.Header().Set("Allow", strings.Join(methods, ", "))
		h.errorResponseStatus(w, http.StatusMethodNotAllowed, spi.ErrBadRequest, "method not allowed", false)
		return
	}
	if err := h.admit(); err != nil {
		h.errorResponse(w, spi.ErrUnavailable, "query service busy or stopped", true)
		return
	}
	defer h.release()
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(h.config.Timeout))
	callbackDone := make(chan struct{})
	// The handler context is intentionally independent of the request context:
	// Stop must cancel admitted requests even when clients remain connected.
	stop := context.AfterFunc(h.ctx, func() { cancel(); close(callbackDone) }) //nolint:contextcheck
	defer func() {
		if stop() {
			close(callbackDone)
		}
		<-callbackDone
		cancel()
	}()
	controller := http.NewResponseController(w)
	_ = controller.EnableFullDuplex()
	if deadline, ok := ctx.Deadline(); ok {
		_ = controller.SetReadDeadline(deadline)
		_ = controller.SetWriteDeadline(deadline.Add(time.Second))
	}
	originalBody := r.Body
	var bodyDone <-chan struct{}
	if originalBody != nil {
		finished := make(chan struct{})
		bodyDone = finished
		stopBody := context.AfterFunc(ctx, func() {
			if err := controller.SetReadDeadline(time.Now()); err != nil {
				_ = originalBody.Close()
			}
			if writing.Load() {
				_ = controller.SetWriteDeadline(time.Now())
			}
			close(finished)
		})
		defer func() {
			if stopBody() {
				close(finished)
			}
			<-finished
		}()
	}
	if status, message := h.authenticate(r); status != 0 {
		if status == http.StatusUnauthorized {
			w.Header().Set("WWW-Authenticate", "Bearer")
		}
		h.errorResponseStatus(w, status, spi.ErrBadRequest, message, false)
		return
	}
	if len(r.URL.RawQuery) > maxQueryInput {
		h.errorResponse(w, spi.ErrBadRequest, "request too large", false)
		return
	}
	values, err := readQueryValues(w, r)
	if err != nil {
		if ctx.Err() != nil {
			if bodyDone != nil {
				<-bodyDone
			}
			h.errorResponse(w, spi.ErrTimeout, "query canceled or timed out", false)
		} else {
			h.errorResponse(w, spi.ErrBadRequest, "invalid request parameters", false)
		}
		return
	}
	var data any
	var warnings []string
	switch kind {
	case "buildinfo":
		if err = onlyParameters(values); err == nil {
			data = map[string]string{"version": "2.53.0", "revision": "prism-dev", "branch": "", "buildUser": "prism", "buildDate": "", "goVersion": runtime.Version()}
		} else {
			err = qerr(spi.ErrBadRequest)
		}
	case "query", "query_range":
		data, warnings, err = h.query(ctx, kind, values)
	case "series", "labels", "values", "metadata":
		data, warnings, err = h.catalog(ctx, kind, path, values)
	}
	if err != nil {
		if _, ok := errors.AsType[*queryExecutionError](err); ok {
			h.executionResponse(w)
		} else {
			h.errorResponse(w, spi.Classify(err), "query rejected or failed", false)
		}
		return
	}
	if err := ctx.Err(); err != nil {
		h.errorResponse(w, spi.ErrTimeout, "query canceled or timed out", false)
		return
	}
	if len(warnings) > maxQueryWarnings {
		h.errorResponse(w, spi.ErrTooLarge, "too many warnings", false)
		return
	}
	if err := preflightResponse(data, warnings); err != nil {
		h.errorResponse(w, spi.ErrTooLarge, "response too large", false)
		return
	}
	envelope := struct {
		Status   string   `json:"status"`
		Data     any      `json:"data"`
		Warnings []string `json:"warnings,omitempty"`
	}{Status: "success", Data: data, Warnings: warnings}
	encoded, marshalErr := json.Marshal(envelope)
	if marshalErr != nil || len(encoded) > maxQueryResponse {
		h.errorResponse(w, spi.ErrTooLarge, "response too large", false)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if (kind == "query" || kind == "query_range") && len(warnings) > 0 && warnings[len(warnings)-1] == "results truncated to requested limit" {
		h.adjust("truncate_results")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(encoded)
}
func routeKind(path string) (string, []string) {
	prefix := "/prom/api/v1/"
	if !strings.HasPrefix(path, prefix) {
		return "", nil
	}
	tail := strings.TrimPrefix(path, prefix)
	switch tail {
	case "query", "query_range", "series":
		return tail, []string{"GET", "POST"}
	case "labels", "metadata", "status/buildinfo":
		if tail == "status/buildinfo" {
			return "buildinfo", []string{"GET"}
		}
		return tail, []string{"GET"}
	}
	if strings.HasPrefix(tail, "label/") && strings.HasSuffix(tail, "/values") && len(tail) > len("label//values") {
		return "values", []string{"GET"}
	}
	return "", nil
}
func (h *QueryHandler) admit() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopped {
		return errors.New("stopped")
	}
	select {
	case h.gate <- struct{}{}:
	default:
		return errors.New("busy")
	}
	select {
	case h.tenantGate <- struct{}{}:
	default:
		<-h.gate
		return errors.New("busy")
	}
	h.active++
	if m, ok := h.telemetry.Gauge("prism_query_concurrent"); ok {
		m.Inc()
	}
	return nil
}
func (h *QueryHandler) release() {
	<-h.tenantGate
	<-h.gate
	if m, ok := h.telemetry.Gauge("prism_query_concurrent"); ok {
		m.Dec()
	}
	h.mu.Lock()
	h.active--
	if h.stopped && h.active == 0 {
		close(h.done)
	}
	h.mu.Unlock()
}
func (h *QueryHandler) authenticate(r *http.Request) (int, string) {
	tenants := headerValues(r.Header, "X-Prism-Tenant")
	scopes := headerValues(r.Header, "X-Scope-OrgID")
	auth := headerValues(r.Header, "Authorization")
	if len(tenants) > 1 || len(scopes) > 1 || len(auth) > 1 {
		return http.StatusBadRequest, "ambiguous identity headers"
	}
	if len(tenants) == 1 && tenants[0] != "" && tenants[0] != h.tenant || len(scopes) == 1 && scopes[0] != "" && scopes[0] != h.tenant {
		return http.StatusForbidden, "tenant forbidden"
	}
	if len(auth) == 0 || auth[0] == "" {
		if h.anonymous {
			return 0, ""
		}
		return http.StatusUnauthorized, "authorization required"
	}
	scheme, token, ok := strings.Cut(auth[0], " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || len(token) < 32 || len(token) > 4096 {
		return http.StatusUnauthorized, "invalid authorization"
	}
	digest := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare(digest[:], h.key[:]) != 1 {
		return http.StatusUnauthorized, "invalid authorization"
	}
	return 0, ""
}
func readQueryValues(w http.ResponseWriter, r *http.Request) (url.Values, error) {
	if r.Method == http.MethodGet && (r.ContentLength != 0 || len(r.TransferEncoding) > 0) {
		return nil, errors.New("GET body is unsupported")
	}
	if r.Method == "POST" {
		ct, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || ct != "application/x-www-form-urlencoded" {
			return nil, errors.New("bad content type")
		}
		limited := http.MaxBytesReader(w, r.Body, maxQueryInput+1)
		// net/http owns the server request body. Closing an incomplete body here
		// can drain the unread bytes and delay the timeout response.
		body, err := io.ReadAll(limited)
		if err != nil || len(body)+len(r.URL.RawQuery) > maxQueryInput {
			return nil, errors.New("too large")
		}
		form, err := url.ParseQuery(string(body))
		if err != nil {
			return nil, err
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			return nil, err
		}
		for key, vals := range form {
			query[key] = append(query[key], vals...)
		}
		return query, nil
	}
	return url.ParseQuery(r.URL.RawQuery)
}
func onlyParameters(v url.Values, allowed ...string) error {
	for key := range v {
		if !slices.Contains(allowed, key) {
			return errors.New("unsupported parameter")
		}
	}
	return nil
}
func one(v url.Values, name string) (string, error) {
	values := v[name]
	if len(values) > 1 {
		return "", errors.New("duplicate parameter")
	}
	if len(values) == 0 {
		return "", nil
	}
	return values[0], nil
}
func parseTime(s string, defaultTime time.Time) (time.Time, error) {
	if s == "" {
		return defaultTime, nil
	}
	return utm.ParsePromTime(s)
}
func parseDuration(s string) (time.Duration, error) {
	if s == "" {
		return 0, errors.New("missing duration")
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		nanoseconds := f * float64(time.Second)
		if math.IsNaN(f) || math.IsInf(f, 0) || nanoseconds < 1 || nanoseconds >= float64(math.MaxInt64) {
			return 0, errors.New("invalid duration")
		}
		return time.Duration(nanoseconds), nil
	}
	duration, err := model.ParseDuration(s)
	d := time.Duration(duration)
	if err != nil || d <= 0 {
		return 0, errors.New("invalid duration")
	}
	return d, nil
}
func parseLimit(s string) (int, error) {
	if s == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 0, errors.New("invalid limit")
	}
	return n, nil
}
func qerr(class spi.ErrClass) error {
	return spi.Wrap(class, "query", "request", errors.New("rejected"))
}
func (h *QueryHandler) errorResponse(w http.ResponseWriter, class spi.ErrClass, message string, retry bool) {
	h.errorResponseStatus(w, spi.HTTPStatus(class), class, message, retry)
}
func (h *QueryHandler) errorResponseStatus(w http.ResponseWriter, status int, class spi.ErrClass, message string, retry bool) {
	if retry {
		status = http.StatusServiceUnavailable
		class = spi.ErrUnavailable
		w.Header().Set("Retry-After", "1")
	}
	if m, ok := h.telemetry.CounterVec("prism_query_rejected_total"); ok && (class == spi.ErrTooLarge || class == spi.ErrUnavailable || class == spi.ErrTimeout) {
		reason := "too_large"
		switch class {
		case spi.ErrUnavailable:
			reason = "concurrency"
		case spi.ErrTimeout:
			reason = "timeout"
		}
		m.WithLabelValues(reason).Inc()
	}
	body := struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
		Error     string `json:"error"`
	}{"error", spi.PromErrorType(class), message}
	encoded, _ := json.Marshal(body)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Prism-Error-Class", string(class))
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}
func (h *QueryHandler) executionResponse(w http.ResponseWriter) {
	encoded, _ := json.Marshal(struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
		Error     string `json:"error"`
	}{"error", "execution", "query execution failed"})
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Prism-Error-Class", string(spi.ErrBadRequest))
	w.WriteHeader(http.StatusUnprocessableEntity)
	_, _ = w.Write(encoded)
}
func (h *QueryHandler) observeRequest(kind string, started time.Time, w http.ResponseWriter) {
	typ := "labels"
	switch kind {
	case "query":
		typ = "instant"
	case "query_range":
		typ = "range"
	case "series":
		typ = "series"
	}
	status := "success"
	if w.Header().Get("X-Prism-Error-Class") != "" {
		status = "error"
	}
	if m, ok := h.telemetry.CounterVec("prism_query_requests_total"); ok {
		m.WithLabelValues("prom", typ, status).Inc()
	}
	if m, ok := h.telemetry.HistogramVec("prism_query_duration_seconds"); ok {
		m.WithLabelValues("prom", typ).Observe(time.Since(started).Seconds())
	}
}

func (h *QueryHandler) query(ctx context.Context, kind string, v url.Values) (any, []string, error) {
	if err := onlyParameters(v, "query", "time", "start", "end", "step", "timeout", "limit"); err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	expr, err := one(v, "query")
	if err != nil || expr == "" || len(expr) > maxExpression {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	parsed, err := parser.ParseExpr(expr)
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	if kind == "query_range" && parsed.Type() != parser.ValueTypeVector && parsed.Type() != parser.ValueTypeScalar {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	now := h.clock.Now()
	start, end := now, now
	var step time.Duration
	if kind == "query" {
		if v.Has("start") || v.Has("end") || v.Has("step") {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		s, e := one(v, "time")
		if e != nil {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		end, e = parseTime(s, now)
		if e != nil {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		start = end
	} else {
		if v.Has("time") || v.Has("limit") {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		a, e := one(v, "start")
		if e != nil || a == "" {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		start, e = parseTime(a, now)
		if e != nil {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		b, e := one(v, "end")
		if e != nil || b == "" {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		end, e = parseTime(b, now)
		if e != nil {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		c, e := one(v, "step")
		if e != nil {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		step, e = parseDuration(c)
		if e != nil {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
	}
	if end.Before(start) || end.After(now.Add(time.Duration(h.config.LookbackDelta))) {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	var warnings []string
	floor := now.Add(-time.Duration(h.config.MaxLookback))
	if start.Before(floor) {
		if end.Before(floor) {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		start = floor.Add(time.Duration(h.config.LookbackDelta))
		if start.After(end) {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		warnings = append(warnings, "start time clamped to max lookback")
		h.adjust("clamp_time")
	}
	if end.Sub(start) > time.Duration(h.config.MaxRange) {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	if kind == "query_range" && (step < utm.MetricTimeUnit || (utm.TimeToMilli(end)-utm.TimeToMilli(start))/int64(step/utm.MetricTimeUnit) >= int64(h.config.MaxPoints)) {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	timeout := time.Duration(h.config.Timeout)
	ts, e := one(v, "timeout")
	if e != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	if ts != "" {
		timeout, e = parseDuration(ts)
		if e != nil || timeout > time.Duration(h.config.Timeout) {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
	}
	ls, e := one(v, "limit")
	if e != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	limit, e := parseLimit(ls)
	if e != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	earliest, latest, err := validateQueryAST(parsed, start, end, now, time.Duration(h.config.MaxLookback), time.Duration(h.config.LookbackDelta))
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	if latest.Sub(earliest) > time.Duration(h.config.MaxRange) {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	caps := h.backend.Capabilities()
	native, ok := h.store.(spi.NativeMetricQuerier)
	useNative := caps.Metrics.NativePromQL && ok && !h.config.ForceFallback && parsed.Type() != parser.ValueTypeString
	if !useNative {
		if latest.Sub(earliest) > time.Duration(h.config.Fallback.MaxRange) {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
		reason := "no_native_support"
		if h.config.ForceFallback {
			reason = "forced"
		} else if caps.Metrics.NativePromQL && ok {
			reason = "partial_pushdown"
		}
		h.fallback(reason)
	}
	path := "fallback"
	if useNative {
		path = "pushdown"
	}
	dispatchStatus := "success"
	dispatchStarted := time.Now()
	defer func() { h.observeStorage(caps.Driver, path, dispatchStatus, time.Since(dispatchStarted)) }()
	child, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if useNative {
		var result *spi.PromResult
		if kind == "query" {
			result, err = native.QueryInstant(child, h.tenant, expr, end, timeout)
		} else {
			result, err = native.QueryRange(child, h.tenant, expr, start, end, step, timeout)
		}
		if err != nil {
			dispatchStatus = "error"
			return nil, nil, err
		}
		data, more, e := wireNative(result, limit)
		if e != nil {
			dispatchStatus = "error"
		}
		return data, append(warnings, more...), e
	}
	engine := promql.NewEngine(promql.EngineOpts{MaxSamples: int(h.config.MaxSamples), Timeout: timeout, LookbackDelta: time.Duration(h.config.LookbackDelta), EnableAtModifier: true, EnableNegativeOffset: true, NoStepSubqueryIntervalFn: func(int64) int64 { return int64(time.Duration(h.config.LookbackDelta) / time.Millisecond) }})
	queryable := promqladapter.New(h.store, h.tenant, promqladapter.Limits{MaxScanRows: h.config.Fallback.MaxRows})
	opts := promql.NewPrometheusQueryOpts(false, time.Duration(h.config.LookbackDelta))
	var q promql.Query
	if kind == "query" {
		q, err = engine.NewInstantQuery(child, queryable, opts, expr, end)
	} else {
		q, err = engine.NewRangeQuery(child, queryable, opts, expr, start, end, step)
	}
	if err != nil {
		dispatchStatus = "error"
		return nil, nil, err
	}
	defer q.Close()
	result := q.Exec(child)
	if result.Err != nil {
		dispatchStatus = "error"
		return nil, nil, classifyEngineError(result.Err)
	}
	data, more, e := wirePromQL(result.Value, limit)
	if e != nil {
		dispatchStatus = "error"
	}
	if len(result.Warnings) > 0 {
		more = append(more, "query completed with engine warnings")
	}
	return data, append(warnings, more...), e
}
func classifyEngineError(err error) error {
	if _, ok := errors.AsType[promql.ErrQueryTimeout](err); ok {
		return spi.Wrap(spi.ErrTimeout, "promql", "execute", err)
	}
	if _, ok := errors.AsType[promql.ErrQueryCanceled](err); ok {
		return spi.Wrap(spi.ErrTimeout, "promql", "execute", err)
	}
	if _, ok := errors.AsType[promql.ErrTooManySamples](err); ok {
		return spi.Wrap(spi.ErrTooLarge, "promql", "execute", err)
	}
	if storage, ok := errors.AsType[promql.ErrStorage](err); ok {
		return spi.Wrap(spi.Classify(storage.Err), "promql", "storage", err)
	}
	return &queryExecutionError{cause: err}
}

type queryExecutionError struct{ cause error }

func (e *queryExecutionError) Error() string { return "query execution failed" }
func (e *queryExecutionError) Unwrap() error { return e.cause }
func (h *QueryHandler) observeStorage(driver, path, status string, duration time.Duration) {
	if m, ok := h.telemetry.HistogramVec("prism_storage_query_duration_seconds"); ok {
		m.WithLabelValues(driver, "metrics", path, status).Observe(duration.Seconds())
	}
}
func (h *QueryHandler) fallback(reason string) {
	if m, ok := h.telemetry.CounterVec("prism_query_fallback_total"); ok {
		m.WithLabelValues("metrics", reason).Inc()
	}
}
func (h *QueryHandler) adjust(action string) {
	if m, ok := h.telemetry.CounterVec("prism_query_adjustments_total"); ok {
		m.WithLabelValues(action).Inc()
	}
}
