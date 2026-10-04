// Package promapi implements bounded Prometheus compatibility receivers.
package promapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/ingest/normalize"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// WriteSubmitter admits normalized metrics into the existing bounded pipeline.
type WriteSubmitter interface {
	SubmitMetrics(context.Context, normalize.MetricBatch, int64) (ingest.Result, error)
}

// WriteOptions freezes one authenticated identity and finite receive limits.
// Both compressed and decompressed bytes are capped at MaxRequestBytes.
type WriteOptions struct {
	Tenant          string
	APIKey          secret.String
	MaxRequestBytes int
	Normalize       normalize.Options
	Logger          *slog.Logger
}

// WriteReceiver borrows its submitter and owns neither listeners nor storage.
type WriteReceiver struct {
	submitter       WriteSubmitter
	tenant          string
	key             [sha256.Size]byte
	maxRequestBytes int
	normalize       normalize.Options
	logger          *slog.Logger
	gate            chan struct{}
	stopped         atomic.Bool
	logMu           sync.Mutex
	logTimes        [10]time.Time
	logNext         int
}

// NewWriteReceiver validates settings and starts no goroutines.
func NewWriteReceiver(submitter WriteSubmitter, options WriteOptions) (*WriteReceiver, error) {
	if submitter == nil || options.Tenant == "" || len(options.Tenant) > 2048 || strings.TrimSpace(options.Tenant) != options.Tenant || len(options.APIKey) < 32 || len(options.APIKey) > 4096 || options.MaxRequestBytes <= 0 || options.MaxRequestBytes > 1<<30 {
		return nil, writeFailure(spi.ErrBadRequest)
	}
	options.Normalize.Tenant = strings.Clone(options.Tenant)
	options.Normalize.LogLabelAllowlist = slices.Clone(options.Normalize.LogLabelAllowlist)
	options.Normalize.MaxRecords = min(maxProtocolElements, options.Normalize.MaxRecords)
	if options.Normalize.Now == nil {
		options.Normalize.Now = time.Now
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	return &WriteReceiver{submitter: submitter, tenant: strings.Clone(options.Tenant), key: sha256.Sum256([]byte(options.APIKey)), maxRequestBytes: options.MaxRequestBytes, normalize: options.Normalize, logger: options.Logger, gate: make(chan struct{}, 1)}, nil
}

// Stop refuses new admission. Admitted requests retain the slot until they exit.
func (r *WriteReceiver) Stop() { r.stopped.Store(true) }

// HTTPHandler serves only the v1 remote_write endpoint.
func (r *WriteReceiver) HTTPHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /prom/api/v1/write", r.writeHTTP)
	mux.HandleFunc("/prom/api/v1/write", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Allow", "POST")
		r.respond(w, req.Context(), http.StatusMethodNotAllowed, spi.ErrBadRequest, "remote_write requires POST", 0)
	})
	return mux
}

func (r *WriteReceiver) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return spi.Wrap(spi.ErrTimeout, "", "remote_write", err)
	}
	if r.stopped.Load() {
		return writeFailure(spi.ErrUnavailable)
	}
	select {
	case r.gate <- struct{}{}:
		if r.stopped.Load() {
			<-r.gate
			return writeFailure(spi.ErrUnavailable)
		}
		return nil
	default:
		return writeFailure(spi.ErrThrottled)
	}
}

// Collect case-insensitive values too: middleware/test constructed Header maps
// need not use canonical keys, and alternate casing cannot conceal duplicates.
func headerValues(h http.Header, name string) []string {
	var values []string
	for key, value := range h {
		if strings.EqualFold(key, name) {
			for _, entry := range value {
				values = append(values, entry)
				if len(values) == 2 {
					// The second value is sufficient to reject a duplicate; never allocate
					// proportional to an unauthenticated header's number of values.
					return values
				}
			}
		}
	}
	return values
}
func (r *WriteReceiver) authenticate(h http.Header) (bool, error) {
	authorization := headerValues(h, "Authorization")
	if len(authorization) != 1 || len(authorization[0]) > 4103 {
		return false, nil
	}
	scheme, key, ok := strings.Cut(authorization[0], " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return false, nil
	}
	hash := sha256.Sum256([]byte(key))
	if subtle.ConstantTimeCompare(hash[:], r.key[:]) != 1 {
		return false, nil
	}
	for _, name := range []string{"X-Scope-OrgID", "X-Prism-Tenant"} {
		values := headerValues(h, name)
		if len(values) > 1 || (len(values) == 1 && values[0] != r.tenant) {
			return true, writeFailure(spi.ErrBadRequest)
		}
	}
	return true, nil
}
func validateHeaders(h http.Header) error {
	encoding := headerValues(h, "Content-Encoding")
	contentType := headerValues(h, "Content-Type")
	version := headerValues(h, "X-Prometheus-Remote-Write-Version")
	if len(encoding) != 1 || !strings.EqualFold(strings.TrimSpace(encoding[0]), "snappy") || len(version) != 1 || version[0] != "0.1.0" || len(contentType) != 1 {
		return writeFailure(spi.ErrBadRequest)
	}
	media, params, err := mime.ParseMediaType(contentType[0])
	if err != nil || media != "application/x-protobuf" || len(params) > 1 || strings.Count(contentType[0], ";") > 1 {
		return writeFailure(spi.ErrBadRequest)
	}
	if len(params) == 1 && params["proto"] != "prometheus.WriteRequest" {
		return writeFailure(spi.ErrBadRequest)
	}
	return nil
}
func (r *WriteReceiver) writeHTTP(w http.ResponseWriter, req *http.Request) {
	authenticated, err := r.authenticate(req.Header)
	if !authenticated {
		w.Header().Set("WWW-Authenticate", "Bearer")
		r.respond(w, req.Context(), http.StatusUnauthorized, spi.ErrBadRequest, "remote_write authentication required", 0)
		return
	}
	if err != nil {
		r.respondError(w, req.Context(), err, 0)
		return
	}
	if err := validateHeaders(req.Header); err != nil {
		r.respond(w, req.Context(), http.StatusBadRequest, spi.ErrBadRequest, "remote_write supports only v1 (0.1.0) snappy protobuf", 0)
		return
	}
	if err := r.acquire(req.Context()); err != nil {
		r.respondError(w, req.Context(), err, 0)
		return
	}
	defer func() { <-r.gate }()
	closed := make(chan struct{})
	stop := context.AfterFunc(req.Context(), func() {
		defer close(closed)
		_ = req.Body.Close()
	})
	defer func() {
		if stop() {
			_ = req.Body.Close()
		} else {
			// A canceled body callback is still admitted work. Wait before releasing
			// the slot so repeated cancellations cannot accumulate close goroutines.
			<-closed
		}
	}()
	payload, err := readWriteBody(req.Context(), req.Body, r.maxRequestBytes)
	if err != nil {
		r.respondError(w, req.Context(), err, 0)
		return
	}
	decoded, wireBytes, err := decodeWrite(req.Context(), payload, r.maxRequestBytes)
	if err != nil {
		r.respondError(w, req.Context(), err, 0)
		return
	}
	ctx := ingest.WithTenant(req.Context(), r.tenant)
	normalizer := normalize.New(ctx, r.normalize)
	defer normalizer.Close()
	batch, report, err := normalizer.NormalizeRemoteWrite(ctx, decoded, r.normalize.Now())
	if err != nil {
		r.respondError(w, ctx, err, 0)
		return
	}
	result, err := r.submitter.SubmitMetrics(ctx, batch, wireBytes)
	if result.InternalFailures > 0 || (err != nil && (result.Accepted > 0 || result.MetadataAccepted > 0)) {
		r.respondError(w, ctx, writeFailure(spi.ErrInternal), 0)
		return
	}
	if err != nil {
		r.respondError(w, ctx, err, result.RetryAfter)
		return
	}
	if result.Rejected > 0 || len(report.Rejected) > 0 {
		r.respond(w, ctx, http.StatusBadRequest, spi.ErrBadRequest, "remote_write samples rejected; accepted samples may persist", 0)
		return
	}
	if len(report.Normalized) > 0 || len(report.Warnings) > 0 || len(result.Normalize.Normalized) > 0 || len(result.Normalize.Warnings) > 0 || len(result.Limits.Normalized) > 0 || len(result.Limits.Warnings) > 0 || result.MetadataUnsupported > 0 {
		r.log(ctx, "remote_write normalization diagnostics", "")
	}
	w.WriteHeader(http.StatusNoContent)
}
func readWriteBody(ctx context.Context, reader io.Reader, limit int) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, spi.Wrap(spi.ErrTimeout, "", "remote_write", err)
	}
	payload, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if cause := ctx.Err(); cause != nil {
		return nil, spi.Wrap(spi.ErrTimeout, "", "remote_write", cause)
	}
	if len(payload) > limit {
		return nil, writeFailure(spi.ErrTooLarge)
	}
	if err != nil {
		return nil, writeFailure(spi.ErrBadRequest)
	}
	return payload, nil
}
func writeFailure(class spi.ErrClass) error {
	return spi.Wrap(class, "", "remote_write", fmt.Errorf("remote_write %s", class))
}
func (r *WriteReceiver) respondError(w http.ResponseWriter, ctx context.Context, err error, retry time.Duration) {
	class := spi.Classify(err)
	code := spi.HTTPStatus(class)
	switch class {
	case spi.ErrTooLarge:
		code = http.StatusRequestEntityTooLarge
	case spi.ErrTimeout:
		code = http.StatusGatewayTimeout
	case spi.ErrUnsupported:
		code = http.StatusNotImplemented
	}
	// Unknown classifications have no externally controlled diagnostic text.
	switch class {
	case spi.ErrBadRequest, spi.ErrTooLarge, spi.ErrTimeout, spi.ErrUnsupported, spi.ErrThrottled, spi.ErrUnavailable, spi.ErrInternal:
	default:
		class = spi.ErrInternal
		code = http.StatusInternalServerError
	}
	r.respond(w, ctx, code, class, "remote_write "+string(class), retry)
}
func (r *WriteReceiver) respond(w http.ResponseWriter, ctx context.Context, code int, class spi.ErrClass, message string, retry time.Duration) {
	w.Header().Set("X-Prism-Error-Class", string(class))
	if code == http.StatusTooManyRequests || code == http.StatusServiceUnavailable {
		delay := max(time.Second, min(retry, time.Minute))
		w.Header().Set("Retry-After", strconv.FormatInt(int64((delay+time.Second-1)/time.Second), 10))
	}
	r.log(ctx, message, string(class))
	http.Error(w, message, code)
}

// A ten-slot timestamp ring enforces at most ten entries in every rolling
// minute, including errors refused before the request slot is acquired.
func (r *WriteReceiver) log(ctx context.Context, message, class string) {
	r.logMu.Lock()
	now := time.Now()
	if !r.logTimes[r.logNext].IsZero() && now.Sub(r.logTimes[r.logNext]) < time.Minute {
		r.logMu.Unlock()
		return
	}
	r.logTimes[r.logNext] = now
	r.logNext = (r.logNext + 1) % len(r.logTimes)
	r.logMu.Unlock()
	r.logger.WarnContext(ctx, message, "component", "ingest", "protocol", "remote_write", "error_class", class)
}
