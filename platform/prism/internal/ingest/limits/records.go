package limits

import (
	"cmp"
	"context"
	"maps"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

const truncationMarker = "prism.truncated"

// Metrics applies label/cardinality limits. Partial rejections are reported;
// canceled or oversized batches return a classified error through SPI helpers.
// Metric identity and trusted system labels are never shortened.
func (l *Limiter) Metrics(ctx context.Context, input []utm.MetricPoint) ([]utm.MetricPoint, Report, error) {
	report := newReport(l.options.MaxReportEvents)
	if err := l.begin(ctx, len(input), &report); err != nil {
		return nil, report, err
	}
	if err := l.mu.Lock(ctx); err != nil {
		return nil, report, err
	}
	defer l.mu.Unlock()
	now := l.now()
	if err := l.expire(ctx, now); err != nil {
		return nil, report, err
	}
	output := make([]utm.MetricPoint, 0, len(input))
	for _, point := range input {
		if err := ctx.Err(); err != nil {
			return output, report, err
		}
		if len(point.Name) > l.settings.MaxLabelValueLength {
			report.reject("too_large")
			continue
		}
		if !l.metricSizeAllowed(point) {
			report.reject("too_large")
			continue
		}
		if point.Name == "" || (point.Labels.Has(utm.LabelName) && point.Labels.Get(utm.LabelName) != point.Name) {
			report.reject("decode_error")
			continue
		}
		if point.Labels.Has(utm.LabelTenant) && point.Labels.Get(utm.LabelTenant) != l.tenant {
			report.reject("auth")
			continue
		}
		builder := labels.NewBuilder(point.Labels)
		builder.Set(utm.LabelName, point.Name)
		builder.Set(utm.LabelTenant, l.tenant)
		original := builder.Labels()
		filtered := make(utm.Labels, 0, len(original))
		for _, label := range original {
			if !utm.IsReserved(label.Name) && l.denied.MatchString(label.Name) {
				report.normalized("drop_label", 1)
				report.warn("denied_label")
				continue
			}
			filtered = append(filtered, label)
		}
		if len(filtered) > l.settings.MaxLabelsPerSeries {
			report.reject("too_large")
			continue
		}
		limited, ok := l.limitLabels(filtered, &report)
		if !ok {
			report.reject("too_large")
			continue
		}
		canonical := make(utm.Labels, 0, len(limited))
		for _, label := range limited {
			if !utm.IsReserved(label.Name) && l.denied.MatchString(label.Name) {
				report.normalized("drop_label", 1)
				report.warn("denied_label")
				continue
			}
			canonical = append(canonical, label)
		}
		limited = canonical
		observations, capacity, err := l.prepareLabels(ctx, point.Name, limited)
		if err != nil {
			return output, report, err
		}
		if !capacity {
			report.reject("cardinality")
			report.warn("label_tracker_capacity")
			continue
		}
		drops := make(map[string]bool, len(observations))
		for _, observation := range observations {
			if observation.drop {
				drops[observation.key.label] = true
			}
		}
		final := make(utm.Labels, 0, len(limited))
		for _, label := range limited {
			if drops[label.Name] {
				report.normalized("drop_label", 1)
				report.warn("high_cardinality_label_dropped")
			} else {
				final = append(final, label)
			}
		}
		if err := ctx.Err(); err != nil {
			return output, report, err
		}
		if !l.admitSeries(point.Name, utm.Fingerprint(final), now, &report) {
			continue
		}
		l.commitLabels(observations, now, &report)
		point.Labels = final
		point = cloneMetric(point)
		output = append(output, point)
	}
	return output, report, nil
}

// Logs clamps bodies and attributes on detached records. Denied labels are
// demoted to attributes before the deterministic per-map attribute cap.
func (l *Limiter) Logs(ctx context.Context, input []utm.LogRecord) ([]utm.LogRecord, Report, error) {
	report := newReport(l.options.MaxReportEvents)
	if err := l.begin(ctx, len(input), &report); err != nil {
		return nil, report, err
	}
	output := make([]utm.LogRecord, 0, len(input))
	for _, record := range input {
		if err := ctx.Err(); err != nil {
			return output, report, err
		}
		if (record.Resource != nil && record.Resource.Tenant != "" && record.Resource.Tenant != l.tenant) || (record.Labels.Has(utm.LabelTenant) && record.Labels.Get(utm.LabelTenant) != l.tenant) {
			report.reject("auth")
			continue
		}
		if !l.logSizeAllowed(record) {
			report.reject("too_large")
			continue
		}
		record.Attrs = maps.Clone(record.Attrs)
		filtered := make(utm.Labels, 0, len(record.Labels))
		for _, label := range record.Labels {
			if !utm.IsReserved(label.Name) && l.denied.MatchString(label.Name) {
				if record.Attrs == nil {
					record.Attrs = map[string]string{}
				}
				if value, found := record.Attrs[label.Name]; found && value != label.Value {
					report.warn("demotion_collision")
				} else {
					record.Attrs[label.Name] = label.Value
				}
				report.normalized("drop_label", 1)
				continue
			}
			filtered = append(filtered, label)
		}
		limited, ok := l.limitLabels(filtered, &report)
		if !ok {
			report.reject("too_large")
			continue
		}
		canonical := make(utm.Labels, 0, len(limited))
		for _, label := range limited {
			if !utm.IsReserved(label.Name) && l.denied.MatchString(label.Name) {
				if record.Attrs == nil {
					record.Attrs = map[string]string{}
				}
				if value, found := record.Attrs[label.Name]; found && value != label.Value {
					report.warn("demotion_collision")
				} else {
					record.Attrs[label.Name] = label.Value
				}
				report.normalized("drop_label", 1)
				continue
			}
			canonical = append(canonical, label)
		}
		record.Labels = canonical
		if body, truncated := truncate(record.Body, l.settings.MaxLogLineBytes); truncated {
			record.Body = body
			if record.Attrs == nil {
				record.Attrs = map[string]string{}
			}
			record.Attrs[truncationMarker] = "true"
			report.normalized("truncate", 1)
		}
		var err error
		record.Attrs, err = l.limitAttrs(ctx, record.Attrs, &report)
		if err != nil {
			return output, report, err
		}
		record.Resource, err = l.limitResource(ctx, record.Resource, &report)
		if err != nil {
			return output, report, err
		}
		output = append(output, record)
	}
	return output, report, nil
}

// Spans deduplicates span identity for admission while preserving repeated
// accepted writes. Trace overflow marks spans returned in the same batch and
// reports trace IDs for downstream handling of prior persisted spans.
func (l *Limiter) Spans(ctx context.Context, input []utm.Span) ([]utm.Span, Report, error) {
	report := newReport(l.options.MaxReportEvents)
	if err := l.begin(ctx, len(input), &report); err != nil {
		return nil, report, err
	}
	if err := l.mu.Lock(ctx); err != nil {
		return nil, report, err
	}
	defer l.mu.Unlock()
	now := l.now()
	if err := l.expire(ctx, now); err != nil {
		return nil, report, err
	}
	output := make([]utm.Span, 0, len(input))
	// At most MaxRecords distinct IDs; marking uses trace state rather than the
	// bounded report list so report overflow cannot suppress data markers.
	for _, span := range input {
		if err := ctx.Err(); err != nil {
			return output, report, err
		}
		if !utm.ValidTraceID(span.TraceID) || !utm.ValidSpanID(span.SpanID) {
			report.reject("invalid_id")
			continue
		}
		if span.Resource != nil && span.Resource.Tenant != "" && span.Resource.Tenant != l.tenant {
			report.reject("auth")
			continue
		}
		allowed, err := l.spanSizeAllowed(ctx, span)
		if err != nil {
			return output, report, err
		}
		if !allowed {
			report.reject("too_large")
			continue
		}
		element := l.traces[span.TraceID]
		if element == nil && len(l.traces) >= l.options.MaxTraces {
			report.reject("cardinality")
			report.warn("trace_tracker_capacity")
			continue
		}
		var state *traceState
		knownSpan := false
		if element != nil {
			state = element.Value.(*traceState)
		}
		if state != nil {
			_, known := state.spans[span.SpanID]
			knownSpan = known
			if !known && len(state.spans) >= l.settings.MaxSpansPerTrace {
				state.truncated = true
				state.seen = now
				l.traceLRU.MoveToFront(element)
				report.reject("too_large")
				report.trace(span.TraceID)
				continue
			}
		}
		if !knownSpan && l.trackedSpans >= l.options.MaxTrackedSpans {
			report.reject("cardinality")
			report.warn("span_tracker_capacity")
			continue
		}
		copy, err := l.cloneSpan(ctx, span, &report)
		if err != nil {
			return output, report, err
		}
		if err := ctx.Err(); err != nil {
			return output, report, err
		}
		if state == nil {
			state = &traceState{id: strings.Clone(span.TraceID), spans: map[string]struct{}{}}
			element = l.traceLRU.PushFront(state)
			l.traces[state.id] = element
		}
		if !knownSpan {
			l.trackedSpans++
			state.spans[strings.Clone(span.SpanID)] = struct{}{}
		}
		state.seen = now
		l.traceLRU.MoveToFront(element)
		output = append(output, copy)
	}
	for index := range output {
		if err := ctx.Err(); err != nil {
			return output, report, err
		}
		if l.traces[output[index].TraceID].Value.(*traceState).truncated {
			attrs := output[index].Attrs
			if attrs == nil {
				attrs = map[string]string{}
			}
			if attrs[truncationMarker] != "true" {
				attrs[truncationMarker] = "true"
				report.normalized("truncate", 1)
			}
			var err error
			output[index].Attrs, err = l.limitAttrs(ctx, attrs, &report)
			if err != nil {
				return output, report, err
			}
			report.trace(output[index].TraceID)
		}
	}
	return output, report, nil
}

func (l *Limiter) limitLabels(input utm.Labels, report *Report) (utm.Labels, bool) {
	sorted := slices.Clone(input)
	slices.SortFunc(sorted, func(a, b labels.Label) int {
		if c := cmp.Compare(a.Name, b.Name); c != 0 {
			return c
		}
		return cmp.Compare(a.Value, b.Value)
	})
	values := make(map[string]string, len(input))
	for _, label := range sorted {
		if utm.IsReserved(label.Name) {
			// Trusted tenant/name identity is preserved. Arbitrary system fields
			// still have the built-in storage bounds.
			if len(label.Name) > defaultMaxLabelNameLength || len(label.Value) > defaultMaxLabelValueLength {
				return nil, false
			}
			if _, duplicate := values[label.Name]; duplicate {
				report.normalized("drop_label", 1)
				report.warn("label_collision")
				continue
			}
			values[label.Name] = label.Value
			continue
		}
		name, shortened := truncate(label.Name, l.settings.MaxLabelNameLength)
		if shortened {
			report.normalized("truncate", 1)
		}
		value, shortened := truncate(label.Value, l.settings.MaxLabelValueLength)
		if shortened {
			report.normalized("truncate", 1)
		}
		if name == "" || utm.IsReserved(name) {
			report.normalized("drop_label", 1)
			report.warn("reserved_label_collision")
			continue
		}
		if _, found := values[name]; found {
			report.normalized("drop_label", 1)
			report.warn("label_collision")
			continue
		}
		values[name] = value
	}
	return labels.FromMap(values), true
}
func truncate(input string, limit int) (string, bool) {
	if len(input) <= limit {
		return input, false
	}
	end := limit
	if utf8.ValidString(input) {
		for end > 0 && !utf8.RuneStart(input[end]) {
			end--
		}
	}
	return strings.Clone(input[:end]), true
}
func (l *Limiter) limitAttrs(ctx context.Context, input map[string]string, report *Report) (map[string]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if input == nil {
		return nil, nil
	}
	keys := make([]string, 0, len(input))
	marker := input[truncationMarker] == "true"
	for key := range maps.Keys(input) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if marker && key == truncationMarker {
			continue
		}
		keys = append(keys, key)
	}
	slices.Sort(keys)
	capacity := l.settings.MaxAttrsPerRecord
	result := make(map[string]string, min(len(input), capacity))
	if marker {
		result[truncationMarker] = "true"
		capacity--
	}
	if len(keys) > capacity {
		report.normalized("truncate", itemCount(len(keys)-capacity))
		report.warn("attributes_truncated")
		keys = keys[:capacity]
	}
	for _, key := range keys {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		result[key] = input[key]
	}
	return result, nil
}
func (l *Limiter) limitResource(ctx context.Context, input *utm.Resource, report *Report) (*utm.Resource, error) {
	if input == nil {
		return nil, nil
	}
	result := *input
	var err error
	result.Attrs, err = l.limitAttrs(ctx, input.Attrs, report)
	result.Tenant = l.tenant
	return &result, err
}
func cloneMetric(point utm.MetricPoint) utm.MetricPoint {
	point.Labels = slices.Clone(point.Labels)
	if point.Histogram != nil {
		histogram := *point.Histogram
		histogram.Bounds = slices.Clone(histogram.Bounds)
		histogram.Counts = slices.Clone(histogram.Counts)
		point.Histogram = &histogram
	}
	if point.Exemplar != nil {
		exemplar := *point.Exemplar
		exemplar.Labels = slices.Clone(exemplar.Labels)
		point.Exemplar = &exemplar
	}
	return point
}
func (l *Limiter) cloneSpan(ctx context.Context, input utm.Span, report *Report) (utm.Span, error) {
	var err error
	input.Attrs, err = l.limitAttrs(ctx, input.Attrs, report)
	if err != nil {
		return utm.Span{}, err
	}
	input.Resource, err = l.limitResource(ctx, input.Resource, report)
	if err != nil {
		return utm.Span{}, err
	}
	input.Events = slices.Clone(input.Events)
	for index := range input.Events {
		input.Events[index].Attrs, err = l.limitAttrs(ctx, input.Events[index].Attrs, report)
		if err != nil {
			return utm.Span{}, err
		}
	}
	input.Links = slices.Clone(input.Links)
	for index := range input.Links {
		input.Links[index].Attrs, err = l.limitAttrs(ctx, input.Links[index].Attrs, report)
		if err != nil {
			return utm.Span{}, err
		}
	}
	return input, nil
}

func consumeElements(remaining *int, counts ...int) bool {
	for _, count := range counts {
		if count > *remaining {
			return false
		}
		*remaining -= count
	}
	return true
}
func resourceElements(resource *utm.Resource) int {
	if resource == nil {
		return 0
	}
	return len(resource.Attrs)
}
func (l *Limiter) metricSizeAllowed(point utm.MetricPoint) bool {
	remaining := l.options.MaxRecordElements
	if !consumeElements(&remaining, len(point.Labels)) {
		return false
	}
	if point.Histogram != nil && !consumeElements(&remaining, len(point.Histogram.Bounds), len(point.Histogram.Counts)) {
		return false
	}
	return point.Exemplar == nil || consumeElements(&remaining, len(point.Exemplar.Labels))
}
func (l *Limiter) logSizeAllowed(record utm.LogRecord) bool {
	remaining := l.options.MaxRecordElements
	return consumeElements(&remaining, len(record.Labels), len(record.Attrs), resourceElements(record.Resource))
}
func (l *Limiter) spanSizeAllowed(ctx context.Context, span utm.Span) (bool, error) {
	remaining := l.options.MaxRecordElements
	if !consumeElements(&remaining, len(span.Attrs), len(span.Events), len(span.Links), resourceElements(span.Resource)) {
		return false, nil
	}
	for _, event := range span.Events {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		if !consumeElements(&remaining, len(event.Attrs)) {
			return false, nil
		}
	}
	for _, link := range span.Links {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		if !consumeElements(&remaining, len(link.Attrs)) {
			return false, nil
		}
	}
	return true, nil
}
