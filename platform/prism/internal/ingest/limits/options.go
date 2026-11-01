package limits

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

const (
	defaultMaxLabelNameLength         = 128
	defaultMaxLabelValueLength        = 2048
	defaultMaxLabelsPerSeries         = 40
	defaultMaxActiveSeries            = 500_000
	defaultMaxSeriesPerMetric         = 50_000
	defaultMaxLogLineBytes            = 256 << 10
	defaultMaxAttrs                   = 128
	defaultMaxSpans                   = 20_000
	defaultCardinalityThreshold       = 10_000
	defaultMaxTraces                  = 1024
	defaultMaxTrackedSpans            = 100_000
	maxExactByteLimit           int64 = 1 << 53
	defaultMaxCardinalityLabels       = 4096
	defaultMaxCardinalityValues       = 100_000
	defaultMaxReportEvents            = 128
	defaultMaxRecords                 = 100_000
	defaultMaxPatternBytes            = 4096
	activeWindow                      = time.Hour
	cardinalityWindow                 = 5 * time.Minute
	defaultDeniedLabels               = `^(trace_id|span_id|request_id|session_id|user_id|uuid|.*_uuid|.*\.id|url\.full|http\.url|http\.target|url_full|http_url|http_target)$`
)

// Settings contains effective package limits. A zero byte rate is unlimited.
// The byte burst is the maximum single byte admission and starts full.
type Settings struct {
	MaxLabelNameLength        int
	MaxLabelValueLength       int
	MaxLabelsPerSeries        int
	MaxActiveSeriesPerTenant  int
	MaxSeriesPerMetricName    int
	MaxLogLineBytes           int
	MaxAttrsPerRecord         int
	MaxSpansPerTrace          int
	IngestRateBytesPerSec     int64
	IngestBurstBytes          int64
	CardinalityAlarmThreshold int
	AutoDropHighCardinality   bool
	DeniedLabelPattern        string
}

// Overrides distinguishes absent values from explicit zero and false values.
// Resolve applies tenant overrides after global configuration values.
type Overrides struct {
	MaxLabelNameLength        *int
	MaxLabelValueLength       *int
	MaxLabelsPerSeries        *int
	MaxActiveSeriesPerTenant  *int
	MaxSeriesPerMetricName    *int
	MaxLogLineBytes           *int
	MaxAttrsPerRecord         *int
	MaxSpansPerTrace          *int
	IngestRateBytesPerSec     *int64
	IngestBurstBytes          *int64
	CardinalityAlarmThreshold *int
	AutoDropHighCardinality   *bool
	DeniedLabelPattern        *string
}

// Options bounds supporting state independently from tenant data limits.
// Zero supporting capacities select defaults; negatives are invalid.
// TraceTTL defaults to one hour of inactivity. No live tracker is evicted.
type Options struct {
	Global               Overrides
	Tenant               Overrides
	Now                  func() time.Time
	MaxTraces            int
	MaxTrackedSpans      int
	MaxCardinalityLabels int
	MaxCardinalityValues int
	MaxReportEvents      int
	MaxRecords           int
	MaxRecordElements    int
	TraceTTL             time.Duration
}

// Defaults returns the SDD data limits. Rate is tenant-defined, hence unlimited
// until explicitly supplied; burst defaults to one second of configured rate.
func Defaults() Settings {
	return Settings{MaxLabelNameLength: defaultMaxLabelNameLength, MaxLabelValueLength: defaultMaxLabelValueLength,
		MaxLabelsPerSeries: defaultMaxLabelsPerSeries, MaxActiveSeriesPerTenant: defaultMaxActiveSeries,
		MaxSeriesPerMetricName: defaultMaxSeriesPerMetric, MaxLogLineBytes: defaultMaxLogLineBytes,
		MaxAttrsPerRecord: defaultMaxAttrs, MaxSpansPerTrace: defaultMaxSpans,
		CardinalityAlarmThreshold: defaultCardinalityThreshold, DeniedLabelPattern: defaultDeniedLabels}
}

// Resolve validates effective global and tenant values without changing inputs.
func Resolve(global, tenant Overrides) (Settings, error) {
	settings := Defaults()
	for _, override := range []Overrides{global, tenant} {
		for _, pair := range []struct {
			target *int
			source *int
		}{
			{&settings.MaxLabelNameLength, override.MaxLabelNameLength}, {&settings.MaxLabelValueLength, override.MaxLabelValueLength},
			{&settings.MaxLabelsPerSeries, override.MaxLabelsPerSeries}, {&settings.MaxActiveSeriesPerTenant, override.MaxActiveSeriesPerTenant},
			{&settings.MaxSeriesPerMetricName, override.MaxSeriesPerMetricName}, {&settings.MaxLogLineBytes, override.MaxLogLineBytes},
			{&settings.MaxAttrsPerRecord, override.MaxAttrsPerRecord}, {&settings.MaxSpansPerTrace, override.MaxSpansPerTrace},
			{&settings.CardinalityAlarmThreshold, override.CardinalityAlarmThreshold},
		} {
			if pair.source != nil {
				*pair.target = *pair.source
			}
		}
		if override.IngestRateBytesPerSec != nil {
			settings.IngestRateBytesPerSec = *override.IngestRateBytesPerSec
		}
		if override.IngestBurstBytes != nil {
			settings.IngestBurstBytes = *override.IngestBurstBytes
		}
		if override.AutoDropHighCardinality != nil {
			settings.AutoDropHighCardinality = *override.AutoDropHighCardinality
		}
		if override.DeniedLabelPattern != nil {
			settings.DeniedLabelPattern = *override.DeniedLabelPattern
		}
	}
	for _, value := range []int{settings.MaxLabelNameLength, settings.MaxLabelValueLength, settings.MaxLabelsPerSeries,
		settings.MaxActiveSeriesPerTenant, settings.MaxSeriesPerMetricName, settings.MaxLogLineBytes,
		settings.MaxAttrsPerRecord, settings.MaxSpansPerTrace, settings.CardinalityAlarmThreshold} {
		if value <= 0 {
			return Settings{}, badRequest("limits must be positive")
		}
	}
	if settings.IngestRateBytesPerSec < 0 || settings.IngestBurstBytes < 0 {
		return Settings{}, badRequest("byte rate and burst must be nonnegative")
	}
	if settings.IngestRateBytesPerSec > maxExactByteLimit || settings.IngestBurstBytes > maxExactByteLimit {
		return Settings{}, badRequest("byte rate and burst exceed exact numeric capacity")
	}
	if settings.IngestRateBytesPerSec > 0 && settings.IngestBurstBytes == 0 {
		settings.IngestBurstBytes = settings.IngestRateBytesPerSec
	}
	if len(settings.DeniedLabelPattern) > defaultMaxPatternBytes {
		return Settings{}, badRequest("denied-label pattern exceeds regex capacity")
	}
	settings.DeniedLabelPattern = strings.Clone(settings.DeniedLabelPattern)
	if _, err := regexp.Compile(settings.DeniedLabelPattern); err != nil {
		return Settings{}, badRequest("invalid denied-label pattern")
	}
	return settings, nil
}
func badRequest(message string) error {
	return spi.Wrap(spi.ErrBadRequest, "", "limits", fmt.Errorf("%s", message))
}
