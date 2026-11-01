// Package limits enforces tenant ingest quotas on normalized UTM batches.
package limits

import (
	"container/list"
	"context"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// Limiter owns one tenant's bounded state. It does not start goroutines.
// mu protects every state map, list, sketch and byte bucket.
type Limiter struct {
	mu                contextMutex
	tenant            string
	settings          Settings
	options           Options
	denied            *regexp.Regexp
	series            map[uint64]*list.Element
	seriesLRU         *list.List
	metricCounts      map[string]int
	sketch            hll
	trackers          map[labelKey]*labelTracker
	valuesLRU         *list.List
	traces            map[string]*list.Element
	traceLRU          *list.List
	trackedSpans      int
	bucketInitialized bool
	tokens            float64
	bucketTime        time.Time
	lastNow           time.Time
}

// New validates limits and constructs an instance. Owners must bound the number
// of tenant instances and discard them when tenants are no longer active.
func New(tenant string, options Options) (*Limiter, error) {
	if tenant == "" || len(tenant) > defaultMaxLabelValueLength {
		return nil, badRequest("tenant is required")
	}
	settings, err := Resolve(options.Global, options.Tenant)
	if err != nil {
		return nil, err
	}
	if int64(settings.MaxActiveSeriesPerTenant) > math.MaxUint32 {
		return nil, badRequest("active series exceeds HLL counter capacity")
	}
	for _, pair := range []struct {
		value    *int
		fallback int
	}{
		{&options.MaxTraces, defaultMaxTraces}, {&options.MaxTrackedSpans, defaultMaxTrackedSpans}, {&options.MaxCardinalityLabels, defaultMaxCardinalityLabels},
		{&options.MaxCardinalityValues, defaultMaxCardinalityValues}, {&options.MaxReportEvents, defaultMaxReportEvents},
		{&options.MaxRecords, defaultMaxRecords}, {&options.MaxRecordElements, defaultMaxRecords},
	} {
		if *pair.value < 0 {
			return nil, badRequest("supporting capacities must be nonnegative")
		}
		if *pair.value == 0 {
			*pair.value = pair.fallback
		}
	}
	if options.TraceTTL < 0 {
		return nil, badRequest("trace TTL must be positive")
	}
	if options.TraceTTL == 0 {
		options.TraceTTL = activeWindow
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	options.Global = Overrides{}
	options.Tenant = Overrides{}
	denied, _ := regexp.Compile(settings.DeniedLabelPattern)
	limiter := &Limiter{mu: contextMutex{token: make(chan struct{}, 1)}, tenant: strings.Clone(tenant), settings: settings, options: options, denied: denied,
		series: make(map[uint64]*list.Element), seriesLRU: list.New(), metricCounts: make(map[string]int),
		trackers: make(map[labelKey]*labelTracker), valuesLRU: list.New(), traces: make(map[string]*list.Element), traceLRU: list.New(), tokens: float64(settings.IngestBurstBytes)}
	return limiter, nil
}

// Settings returns a detached effective configuration.
func (l *Limiter) Settings() Settings { return l.settings }

func (l *Limiter) now() time.Time {
	now := l.options.Now()
	if now.Before(l.lastNow) {
		return l.lastNow
	}
	l.lastNow = now
	return now
}
func (l *Limiter) begin(ctx context.Context, count int, report *Report) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if count > l.options.MaxRecords {
		report.Rejected["too_large"] = itemCount(count)
		return spi.Wrap(spi.ErrTooLarge, "", "limits", fmt.Errorf("batch exceeds record capacity"))
	}
	return nil
}

// AllowBytes immediately admits the caller's actual decompressed byte count.
// A throttled rejection includes a retry delay; oversized bursts cannot be
// admitted without reducing the request size (delay is zero in that case).
func (l *Limiter) AllowBytes(ctx context.Context, n int64) (Report, time.Duration, error) {
	report := newReport(l.options.MaxReportEvents)
	if err := ctx.Err(); err != nil {
		return report, 0, err
	}
	if n < 0 {
		return report, 0, badRequest("byte count must be nonnegative")
	}
	if err := l.mu.Lock(ctx); err != nil {
		return report, 0, err
	}
	defer l.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return report, 0, err
	}
	if l.settings.IngestRateBytesPerSec == 0 {
		return report, 0, nil
	}
	now := l.now()
	if !l.bucketInitialized {
		l.bucketInitialized = true
		l.bucketTime = now
	}
	elapsed := now.Sub(l.bucketTime).Seconds()
	l.tokens = math.Min(float64(l.settings.IngestBurstBytes), l.tokens+elapsed*float64(l.settings.IngestRateBytesPerSec))
	l.bucketTime = now
	if n > l.settings.IngestBurstBytes || float64(n) > l.tokens {
		report.reject("rate_limit")
		delay := time.Duration(0)
		if n <= l.settings.IngestBurstBytes {
			seconds := (float64(n) - l.tokens) / float64(l.settings.IngestRateBytesPerSec)
			if seconds >= float64(math.MaxInt64)/float64(time.Second) {
				delay = time.Duration(math.MaxInt64)
			} else {
				delay = time.Duration(math.Ceil(seconds * float64(time.Second)))
			}
		}
		return report, delay, spi.Wrap(spi.ErrThrottled, "", "limits.AllowBytes", fmt.Errorf("tenant byte rate exceeded"))
	}
	l.tokens -= float64(n)
	return report, 0, nil
}

// Snapshot is a bounded view; exact admission counts and HLL estimate use the
// same hour-long inactivity window. Expiry is lazy on processing or snapshots.
type Snapshot struct {
	ActiveSeries, MetricNames, Traces, TrackedSpans, TrackedLabels, TrackedValues int
	EstimatedActiveSeries                                                         float64
}

func (l *Limiter) Snapshot(ctx context.Context) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	if err := l.mu.Lock(ctx); err != nil {
		return Snapshot{}, err
	}
	defer l.mu.Unlock()
	if err := l.expire(ctx, l.now()); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{ActiveSeries: len(l.series), MetricNames: len(l.metricCounts), Traces: len(l.traces), TrackedSpans: l.trackedSpans, TrackedLabels: len(l.trackers), TrackedValues: l.valuesLRU.Len(), EstimatedActiveSeries: l.sketch.estimate()}, nil
}

// A one-token lock allows canceled contenders to return without waiting for a
// different batch's bounded work to complete. No goroutine is created.
type contextMutex struct{ token chan struct{} }

func (m *contextMutex) Lock(ctx context.Context) error {
	select {
	case m.token <- struct{}{}:
		if err := ctx.Err(); err != nil {
			m.Unlock()
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (m *contextMutex) Unlock() { <-m.token }

func itemCount(count int) uint64 {
	if count < 0 {
		return 0
	}
	return uint64(count)
}
