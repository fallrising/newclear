package lokiapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	json "encoding/json/v2"

	"github.com/prometheus/prometheus/model/labels"

	"github.com/fallrising/newclear/platform/prism/internal/query/logql"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

const (
	defaultLimit    = 100
	maxEntriesLimit = 5000
	defaultStep     = 15 * time.Second
	queryLookback   = time.Hour
	catalogLookback = 6 * time.Hour
)

var (
	errStep          = errors.New("step must be a Go duration or a number of seconds")
	errLimit         = errors.New("limit must be a positive integer")
	errDirection     = errors.New("direction must be forward or backward")
	errQueryRequired = errors.New("query is required")
	errInstantLog    = errors.New("instant queries are only supported for metric queries")
	errMatchRequired = errors.New("at least one match[] parameter is required")
)

// QueryOptions freezes the tenant, anonymous-read policy, and parse limits
// for the Loki query endpoints.
type QueryOptions struct {
	Tenant             string
	APIKey             secret.String
	AllowAnonymousRead bool
	MaxRange           time.Duration
	Timeout            time.Duration
	Clock              spi.Clock
}

// QueryHandler serves the Loki query routes used by Explore and health checks.
// It does not own the push receiver or any listener.
type QueryHandler struct {
	backend   spi.Backend
	logs      spi.LogStore
	tenant    string
	key       [sha256.Size]byte
	keyed     bool
	anonymous bool
	maxRange  time.Duration
	timeout   time.Duration
	clock     spi.Clock
}

// NewQueryHandler validates settings and starts no goroutines.
func NewQueryHandler(backend spi.Backend, options QueryOptions) (*QueryHandler, error) {
	if backend == nil || backend.Logs() == nil || options.Tenant == "" || len(options.Tenant) > 2048 || strings.TrimSpace(options.Tenant) != options.Tenant || options.MaxRange <= 0 {
		return nil, spi.Wrap(spi.ErrBadRequest, "lokiapi", "NewQueryHandler", errors.New("invalid query handler settings"))
	}
	if !options.AllowAnonymousRead && (len(options.APIKey) < 32 || len(options.APIKey) > 4096) {
		return nil, spi.Wrap(spi.ErrBadRequest, "lokiapi", "NewQueryHandler", errors.New("invalid query handler settings"))
	}
	if options.Clock == nil {
		options.Clock = spi.SystemClock
	}
	handler := &QueryHandler{
		backend:   backend,
		logs:      backend.Logs(),
		tenant:    strings.Clone(options.Tenant),
		anonymous: options.AllowAnonymousRead,
		maxRange:  options.MaxRange,
		timeout:   options.Timeout,
		clock:     options.Clock,
	}
	if len(options.APIKey) > 0 {
		handler.key = sha256.Sum256([]byte(options.APIKey))
		handler.keyed = true
	}
	return handler, nil
}

// Stop refuses nothing extra; admitted requests end with their own context.
func (h *QueryHandler) Stop() {}

// Close waits for nothing. The handler starts no goroutines.
func (h *QueryHandler) Close(context.Context) error { return nil }

// HTTPHandler serves the GET query routes. Push stays on its own receiver.
func (h *QueryHandler) HTTPHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /loki/api/v1/query", h.guard(h.queryInstant))
	mux.HandleFunc("GET /loki/api/v1/query_range", h.guard(h.queryRange))
	mux.HandleFunc("GET /loki/api/v1/labels", h.guard(h.labels))
	mux.HandleFunc("GET /loki/api/v1/label/{name}/values", h.guard(h.labelValues))
	mux.HandleFunc("GET /loki/api/v1/series", h.guard(h.series))
	mux.HandleFunc("GET /loki/api/v1/index/stats", h.guard(h.indexStats))
	return mux
}

func (h *QueryHandler) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if status, msg := h.authenticate(r); status != 0 {
			if status == http.StatusUnauthorized {
				w.Header().Set("WWW-Authenticate", "Bearer")
			}
			h.writePlain(w, status, spi.ErrBadRequest, msg)
			return
		}
		if h.timeout > 0 {
			ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
			defer cancel()
			r = r.WithContext(ctx)
		}
		next(w, r)
	}
}

func (h *QueryHandler) authenticate(r *http.Request) (int, string) {
	if len(r.Header.Values("X-Prism-Tenant")) > 1 || len(r.Header.Values("X-Scope-OrgID")) > 1 || len(r.Header.Values("Authorization")) > 1 {
		return http.StatusBadRequest, "ambiguous identity headers"
	}
	if tenant := r.Header.Get("X-Prism-Tenant"); tenant != "" && tenant != h.tenant {
		return http.StatusForbidden, "tenant forbidden"
	}
	if scope := r.Header.Get("X-Scope-OrgID"); scope != "" && scope != h.tenant {
		return http.StatusForbidden, "tenant forbidden"
	}
	auth := r.Header.Get("Authorization")
	if auth == "" {
		if h.anonymous {
			return 0, ""
		}
		return http.StatusUnauthorized, "authorization required"
	}
	scheme, token, ok := strings.Cut(auth, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || len(token) < 32 || len(token) > 4096 || !h.keyed {
		return http.StatusUnauthorized, "invalid authorization"
	}
	digest := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare(digest[:], h.key[:]) != 1 {
		return http.StatusUnauthorized, "invalid authorization"
	}
	return 0, ""
}

func (h *QueryHandler) queryRange(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	raw, ok := requiredQuery(values)
	if !ok {
		h.fail(w, errQueryRequired)
		return
	}
	q, err := h.parseQuery(r.Context(), raw)
	if err != nil {
		h.failErr(w, err)
		return
	}
	start, end, err := h.bounds(values, queryLookback)
	if err != nil {
		h.fail(w, err)
		return
	}
	q.Start, q.End = start, end
	if q.Agg != nil {
		step, stepErr := parseStep(values)
		if stepErr != nil {
			h.fail(w, stepErr)
			return
		}
		q.Agg.Step = step
	} else {
		limit, limitErr := parseLimit(values)
		if limitErr != nil {
			h.fail(w, limitErr)
			return
		}
		q.Limit = limit
	}
	direction, dirErr := parseDirection(values)
	if dirErr != nil {
		h.fail(w, dirErr)
		return
	}
	q.Direction = direction
	h.finishQuery(w, r, q)
}

func (h *QueryHandler) queryInstant(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	raw, ok := requiredQuery(values)
	if !ok {
		h.fail(w, errQueryRequired)
		return
	}
	q, err := h.parseQuery(r.Context(), raw)
	if err != nil {
		h.failErr(w, err)
		return
	}
	if q.Agg == nil {
		h.fail(w, errInstantLog)
		return
	}
	now := h.now()
	end := utm.TimeToNano(now)
	if values.Has("time") {
		end, err = parseBound("time", values.Get("time"), now)
		if err != nil {
			h.fail(w, err)
			return
		}
	}
	q.End = end
	q.Start = end - int64(q.Agg.Window)
	q.Agg.Step = 0
	h.finishQuery(w, r, q)
}

func (h *QueryHandler) finishQuery(w http.ResponseWriter, r *http.Request, q spi.LogQuery) {
	q.Tenant = h.tenant
	result, err := h.execute(r.Context(), q)
	if err != nil {
		h.failErr(w, err)
		return
	}
	stats, err := h.collectStats(r.Context(), q)
	if err != nil {
		h.failErr(w, err)
		return
	}
	if q.Agg == nil {
		h.writeJSON(w, streamsBody(result, stats))
		return
	}
	if q.Agg.Step == 0 {
		h.writeJSON(w, vectorBody(result, stats))
		return
	}
	h.writeJSON(w, matrixBody(result, stats))
}

func (h *QueryHandler) labels(w http.ResponseWriter, r *http.Request) {
	start, end, err := h.bounds(r.URL.Query(), catalogLookback)
	if err != nil {
		h.fail(w, err)
		return
	}
	names, err := h.logs.LabelNames(r.Context(), spi.LabelQuery{Tenant: h.tenant, Start: start, End: end})
	if err != nil {
		h.failErr(w, err)
		return
	}
	if names == nil {
		names = []string{}
	}
	h.writeJSON(w, statusList{Status: "success", Data: names})
}

func (h *QueryHandler) labelValues(w http.ResponseWriter, r *http.Request) {
	start, end, err := h.bounds(r.URL.Query(), catalogLookback)
	if err != nil {
		h.fail(w, err)
		return
	}
	values, err := h.logs.LabelValues(r.Context(), r.PathValue("name"), spi.LabelQuery{Tenant: h.tenant, Start: start, End: end})
	if err != nil {
		h.failErr(w, err)
		return
	}
	if values == nil {
		values = []string{}
	}
	h.writeJSON(w, statusList{Status: "success", Data: values})
}

func (h *QueryHandler) series(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	matches := values["match[]"]
	if len(matches) == 0 {
		h.fail(w, errMatchRequired)
		return
	}
	start, end, err := h.bounds(values, catalogLookback)
	if err != nil {
		h.fail(w, err)
		return
	}
	sets, err := h.collectSeries(r.Context(), matches, start, end)
	if err != nil {
		h.failErr(w, err)
		return
	}
	rows := make([]map[string]string, 0, len(sets))
	for _, set := range sets {
		rows = append(rows, labelMap(set))
	}
	h.writeJSON(w, statusSeries{Status: "success", Data: rows})
}

func (h *QueryHandler) indexStats(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	raw, ok := requiredQuery(values)
	if !ok {
		h.fail(w, errQueryRequired)
		return
	}
	q, err := h.parseQuery(r.Context(), raw)
	if err != nil {
		h.failErr(w, err)
		return
	}
	start, end, err := h.bounds(values, queryLookback)
	if err != nil {
		h.fail(w, err)
		return
	}
	q.Start, q.End = start, end
	q.Tenant = h.tenant
	stats, err := h.collectStats(r.Context(), q)
	if err != nil {
		h.failErr(w, err)
		return
	}
	h.writeJSON(w, indexStatsBody{
		Streams: stats.Streams,
		Chunks:  stats.Chunks,
		Entries: stats.TotalLinesProcessed,
		Bytes:   stats.TotalBytesProcessed,
	})
}

func (h *QueryHandler) execute(ctx context.Context, q spi.LogQuery) (spi.LogResult, error) {
	q.Tenant = h.tenant
	caps := h.backend.Capabilities().Logs
	plan := q.PushdownPlan(caps.Pushdown, caps.Aggregation)
	it, err := h.logs.Search(ctx, q)
	if err != nil {
		return spi.LogResult{}, err
	}
	return logql.Execute(ctx, it, q, plan)
}

func (h *QueryHandler) collectStats(ctx context.Context, q spi.LogQuery) (spi.LogStats, error) {
	stater, ok := h.logs.(spi.LogStatser)
	if !ok {
		return spi.LogStats{}, nil
	}
	return stater.Stats(ctx, q)
}

func (h *QueryHandler) collectSeries(ctx context.Context, matches []string, start, end int64) ([]utm.Labels, error) {
	seen := map[uint64][]utm.Labels{}
	sets := []utm.Labels{}
	for _, raw := range matches {
		q, err := h.parseQuery(ctx, raw)
		if err != nil {
			return nil, err
		}
		q.Start, q.End, q.Tenant = start, end, h.tenant
		q.Direction = spi.Forward
		it, err := h.logs.Search(ctx, q)
		if err != nil {
			return nil, err
		}
		err = func() error {
			defer func() { _ = it.Close() }()
			for it.Next() {
				ls := it.At().Labels
				hash := ls.Hash()
				found := false
				for _, existing := range seen[hash] {
					if labels.Equal(existing, ls) {
						found = true
						break
					}
				}
				if found {
					continue
				}
				seen[hash] = append(seen[hash], ls)
				sets = append(sets, ls)
			}
			return it.Err()
		}()
		if err != nil {
			return nil, err
		}
	}
	slices.SortFunc(sets, labels.Compare)
	return sets, nil
}

func (h *QueryHandler) parseQuery(ctx context.Context, raw string) (spi.LogQuery, error) {
	q, err := logql.Parse(ctx, raw, h.maxRange)
	if err != nil {
		return spi.LogQuery{}, err
	}
	return logql.Compile(ctx, q)
}

func (h *QueryHandler) bounds(values url.Values, lookback time.Duration) (int64, int64, error) {
	now := h.now()
	end := utm.TimeToNano(now)
	if values.Has("end") {
		parsed, err := parseBound("end", values.Get("end"), now)
		if err != nil {
			return 0, 0, err
		}
		end = parsed
	}
	start := end - int64(lookback)
	if values.Has("start") {
		parsed, err := parseBound("start", values.Get("start"), now)
		if err != nil {
			return 0, 0, err
		}
		start = parsed
	}
	return start, end, nil
}

func (h *QueryHandler) now() time.Time { return h.clock.Now() }

func (h *QueryHandler) fail(w http.ResponseWriter, err error) {
	h.writePlain(w, http.StatusBadRequest, spi.ErrBadRequest, err.Error())
}

func (h *QueryHandler) failErr(w http.ResponseWriter, err error) {
	status, class, msg := publicError(err)
	h.writePlain(w, status, class, msg)
}

func (h *QueryHandler) writePlain(w http.ResponseWriter, status int, class spi.ErrClass, msg string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Prism-Error-Class", string(class))
	w.WriteHeader(status)
	// #nosec G705 -- Loki error bodies are the contract text and the media type is text/plain.
	_, _ = io.WriteString(w, msg)
}

func (h *QueryHandler) writeJSON(w http.ResponseWriter, v any) {
	body, err := json.Marshal(v, json.Deterministic(true))
	if err != nil {
		h.writePlain(w, http.StatusInternalServerError, spi.ErrInternal, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func requiredQuery(values url.Values) (string, bool) {
	if !values.Has("query") || values.Get("query") == "" {
		return "", false
	}
	return values.Get("query"), true
}

func parseBound(name, raw string, now time.Time) (int64, error) {
	n, err := utm.ParseLokiTime(raw, now)
	if err != nil {
		return 0, fmt.Errorf("%s must be unix nanoseconds, RFC3339Nano, or a Go duration", name)
	}
	return n, nil
}

func parseStep(values url.Values) (time.Duration, error) {
	if !values.Has("step") {
		return defaultStep, nil
	}
	raw := values.Get("step")
	if d, err := time.ParseDuration(raw); err == nil {
		if d <= 0 {
			return 0, errStep
		}
		return d, nil
	}
	seconds, err := strconv.ParseFloat(raw, 64)
	if err != nil || seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, errStep
	}
	nanos := seconds * float64(time.Second)
	if nanos > float64(math.MaxInt64) {
		return 0, errStep
	}
	d := time.Duration(nanos)
	if d <= 0 {
		return 0, errStep
	}
	return d, nil
}

func parseLimit(values url.Values) (int, error) {
	if !values.Has("limit") {
		return defaultLimit, nil
	}
	n, err := strconv.Atoi(values.Get("limit"))
	if err != nil || n <= 0 {
		return 0, errLimit
	}
	if n > maxEntriesLimit {
		return 0, fmt.Errorf("max entries limit per query exceeded, limit > max_entries_limit_per_query (%d > 5000)", n)
	}
	return n, nil
}

func parseDirection(values url.Values) (spi.Direction, error) {
	if !values.Has("direction") {
		return spi.Backward, nil
	}
	switch values.Get("direction") {
	case "backward":
		return spi.Backward, nil
	case "forward":
		return spi.Forward, nil
	default:
		return 0, errDirection
	}
}

func publicError(err error) (int, spi.ErrClass, string) {
	class := spi.Classify(err)
	status := spi.HTTPStatus(class)
	if le, ok := errors.AsType[*logql.Error](err); ok {
		if le.Kind == logql.Syntax || le.Kind == logql.Semantic || le.Kind == logql.Unsupported {
			status = http.StatusBadRequest
		}
		return status, class, le.Error()
	}
	if se, ok := errors.AsType[*spi.Error](err); ok && se.Err != nil {
		return status, class, se.Err.Error()
	}
	return status, class, err.Error()
}

func labelMap(ls utm.Labels) map[string]string {
	out := make(map[string]string, len(ls))
	for _, label := range ls {
		out[label.Name] = label.Value
	}
	return out
}

func statsOf(st spi.LogStats) lokiStats {
	rate := 0.0
	if st.ExecTimeSeconds > 0 {
		rate = float64(st.TotalBytesProcessed) / st.ExecTimeSeconds
	}
	return lokiStats{Summary: lokiSummary{
		BytesProcessedPerSecond: rate,
		ExecTime:                st.ExecTimeSeconds,
		TotalBytesProcessed:     st.TotalBytesProcessed,
		TotalLinesProcessed:     st.TotalLinesProcessed,
	}}
}

func streamsBody(result spi.LogResult, stats spi.LogStats) streamsEnvelope {
	rows := make([]streamResult, 0, len(result.Streams))
	for _, stream := range result.Streams {
		values := make([][2]string, len(stream.Entries))
		for i, entry := range stream.Entries {
			values[i] = [2]string{strconv.FormatInt(entry.TS, 10), entry.Body}
		}
		rows = append(rows, streamResult{Stream: labelMap(stream.Labels), Values: values})
	}
	return streamsEnvelope{Status: "success", Data: streamsData{ResultType: "streams", Result: rows, Stats: statsOf(stats)}}
}

func matrixBody(result spi.LogResult, stats spi.LogStats) matrixEnvelope {
	rows := make([]matrixResult, 0, len(result.Matrix))
	for _, series := range result.Matrix {
		values := make([][2]any, len(series.Samples))
		for i, sample := range series.Samples {
			values[i] = [2]any{utm.MilliToSecFloat(sample.TS), utm.FormatPromValue(sample.Value)}
		}
		rows = append(rows, matrixResult{Metric: labelMap(series.Labels), Values: values})
	}
	return matrixEnvelope{Status: "success", Data: matrixData{ResultType: "matrix", Result: rows, Stats: statsOf(stats)}}
}

func vectorBody(result spi.LogResult, stats spi.LogStats) vectorEnvelope {
	rows := make([]vectorResult, 0, len(result.Matrix))
	for _, series := range result.Matrix {
		sample := spi.Sample{}
		if len(series.Samples) > 0 {
			sample = series.Samples[0]
		}
		rows = append(rows, vectorResult{
			Metric: labelMap(series.Labels),
			Value:  [2]any{utm.MilliToSecFloat(sample.TS), utm.FormatPromValue(sample.Value)},
		})
	}
	return vectorEnvelope{Status: "success", Data: vectorData{ResultType: "vector", Result: rows, Stats: statsOf(stats)}}
}

type streamsEnvelope struct {
	Status string      `json:"status"`
	Data   streamsData `json:"data"`
}

type streamsData struct {
	ResultType string         `json:"resultType"`
	Result     []streamResult `json:"result"`
	Stats      lokiStats      `json:"stats"`
}

type streamResult struct {
	Stream map[string]string `json:"stream"`
	Values [][2]string       `json:"values"`
}

type matrixEnvelope struct {
	Status string     `json:"status"`
	Data   matrixData `json:"data"`
}

type matrixData struct {
	ResultType string         `json:"resultType"`
	Result     []matrixResult `json:"result"`
	Stats      lokiStats      `json:"stats"`
}

type matrixResult struct {
	Metric map[string]string `json:"metric"`
	Values [][2]any          `json:"values"`
}

type vectorEnvelope struct {
	Status string     `json:"status"`
	Data   vectorData `json:"data"`
}

type vectorData struct {
	ResultType string         `json:"resultType"`
	Result     []vectorResult `json:"result"`
	Stats      lokiStats      `json:"stats"`
}

type vectorResult struct {
	Metric map[string]string `json:"metric"`
	Value  [2]any            `json:"value"`
}

type lokiStats struct {
	Summary  lokiSummary `json:"summary"`
	Ingester struct{}    `json:"ingester"`
	Store    struct{}    `json:"store"`
}

type lokiSummary struct {
	BytesProcessedPerSecond float64 `json:"bytesProcessedPerSecond"`
	ExecTime                float64 `json:"execTime"`
	TotalBytesProcessed     int64   `json:"totalBytesProcessed"`
	TotalLinesProcessed     int64   `json:"totalLinesProcessed"`
}

type statusList struct {
	Status string   `json:"status"`
	Data   []string `json:"data"`
}

type statusSeries struct {
	Status string              `json:"status"`
	Data   []map[string]string `json:"data"`
}

type indexStatsBody struct {
	Streams int64 `json:"streams"`
	Chunks  int64 `json:"chunks"`
	Entries int64 `json:"entries"`
	Bytes   int64 `json:"bytes"`
}
