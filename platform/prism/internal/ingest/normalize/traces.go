package normalize

import (
	"context"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

// NormalizeTraces maps OTLP traces to bounded UTM spans.
func (n *Normalizer) NormalizeTraces(ctx context.Context, traces ptrace.Traces, receivedAt time.Time) ([]utm.Span, Report, error) {
	report := newReport()
	spans := make([]utm.Span, 0, min(traces.SpanCount(), n.options.MaxRecords))
	resources := traces.ResourceSpans()
	for i := range resources.Len() {
		resourceSpans := resources.At(i)
		resource := n.normalizeResource(resourceSpans.Resource(), true, &report)
		scopes := resourceSpans.ScopeSpans()
		for j := range scopes.Len() {
			scopeSpans := scopes.At(j)
			scopeAttributes := n.scopeAttributes(scopeSpans.Scope(), &report)
			otelSpans := scopeSpans.Spans()
			for k := range otelSpans.Len() {
				if err := ctx.Err(); err != nil {
					return nil, report, fmt.Errorf("normalize traces: %w", err)
				}
				if len(spans) >= n.options.MaxRecords {
					report.normalized("drop")
					report.rejected("output_limit")
					continue
				}
				span, ok := n.normalizeSpan(otelSpans.At(k), resource, scopeAttributes, receivedAt, &report)
				if ok {
					spans = append(spans, span)
				}
			}
		}
	}
	return spans, report, nil
}

func (n *Normalizer) normalizeSpan(input ptrace.Span, resource *utm.Resource, scopeAttributes map[string]string, receivedAt time.Time, report *Report) (utm.Span, bool) {
	if input.TraceID().IsEmpty() {
		report.normalized("drop")
		report.rejected("invalid_trace_id")
		return utm.Span{}, false
	}
	if input.SpanID().IsEmpty() {
		report.normalized("drop")
		report.rejected("invalid_span_id")
		return utm.Span{}, false
	}
	if input.StartTimestamp() == 0 {
		report.normalized("drop")
		report.rejected("zero_start_time")
		return utm.Span{}, false
	}

	attrs, dropped := flattenAttributes(input.Attributes(), n.options.MaxAttrsPerRecord)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}
	for key, value := range scopeAttributes {
		attrs[key] = value
	}
	if input.DroppedAttributesCount() > 0 {
		attrs["otel.dropped_attributes_count"] = strconv.FormatUint(uint64(input.DroppedAttributesCount()), 10)
	}

	start := int64(input.StartTimestamp())
	end := int64(input.EndTimestamp())
	if end == 0 || end < start {
		end = start
		report.normalized("clamp")
		report.warning("invalid_span_end")
	}
	var ok bool
	start, attrs, ok = n.normalizeNanoTimestamp(start, attrs, receivedAt, report)
	if !ok {
		return utm.Span{}, false
	}
	end, attrs, ok = n.normalizeNanoTimestamp(end, attrs, receivedAt, report)
	if !ok {
		return utm.Span{}, false
	}
	if end < start {
		end = start
		report.normalized("clamp")
		report.warning("invalid_span_end")
	}

	parentID := ""
	if !input.ParentSpanID().IsEmpty() {
		parentID = spanIDString(input.ParentSpanID())
	}
	statusCode := normalizeStatus(input.Status().Code())
	protected := map[string]string{
		"prism.duration_ns": strconv.FormatInt(end-start, 10),
		"prism.is_root":     strconv.FormatBool(parentID == ""),
		"prism.error":       strconv.FormatBool(isSpanError(statusCode, attrs)),
	}
	if adjusted, found := attrs["prism.clock_adjusted"]; found {
		protected["prism.clock_adjusted"] = adjusted
	}
	attrs, dropped = capAttributesPreserving(attrs, protected, n.options.MaxAttrsPerRecord)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}

	name := validUTF8(input.Name())
	if name == "" {
		name = "unknown"
	}
	if input.DroppedEventsCount() > 0 {
		report.UpstreamDropped += uint64(input.DroppedEventsCount())
	}
	if input.DroppedLinksCount() > 0 {
		report.UpstreamDropped += uint64(input.DroppedLinksCount())
	}
	return utm.Span{
		Resource:     resource,
		TraceID:      traceIDString(input.TraceID()),
		SpanID:       spanIDString(input.SpanID()),
		ParentSpanID: parentID,
		TraceState:   validUTF8(input.TraceState().AsRaw()),
		Name:         name,
		Kind:         normalizeSpanKind(input.Kind()),
		StartNano:    start,
		EndNano:      end,
		StatusCode:   statusCode,
		StatusMsg:    validUTF8(input.Status().Message()),
		Attrs:        attrs,
		Events:       n.normalizeSpanEvents(input.Events(), report),
		Links:        n.normalizeSpanLinks(input.Links(), report),
	}, true
}

func (n *Normalizer) scopeAttributes(scope pcommon.InstrumentationScope, report *Report) map[string]string {
	attrs := make(map[string]string, scope.Attributes().Len()+2)
	if scope.Name() != "" {
		attrs["otel.scope.name"] = validUTF8(scope.Name())
	}
	if scope.Version() != "" {
		attrs["otel.scope.version"] = validUTF8(scope.Version())
	}
	scopeAttrs, dropped := flattenAttributes(scope.Attributes(), n.options.MaxAttrsPerRecord)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}
	for key, value := range scopeAttrs {
		attrs["otel.scope."+key] = value
	}
	if scope.DroppedAttributesCount() > 0 {
		report.UpstreamDropped += uint64(scope.DroppedAttributesCount())
	}
	return attrs
}

func (n *Normalizer) normalizeSpanEvents(events ptrace.SpanEventSlice, report *Report) []utm.SpanEvent {
	result := make([]utm.SpanEvent, 0, min(events.Len(), n.options.MaxRecords))
	for i := range events.Len() {
		if len(result) >= n.options.MaxRecords {
			report.normalized("drop")
			report.rejected("output_limit")
			continue
		}
		event := events.At(i)
		attrs, dropped := flattenAttributes(event.Attributes(), n.options.MaxAttrsPerRecord)
		if dropped > 0 {
			report.normalized("truncate")
			report.warning("attributes_truncated")
		}
		if event.DroppedAttributesCount() > 0 {
			report.UpstreamDropped += uint64(event.DroppedAttributesCount())
		}
		result = append(result, utm.SpanEvent{
			TS:    int64(event.Timestamp()),
			Name:  validUTF8(event.Name()),
			Attrs: attrs,
		})
	}
	return result
}

func (n *Normalizer) normalizeSpanLinks(links ptrace.SpanLinkSlice, report *Report) []utm.SpanLink {
	result := make([]utm.SpanLink, 0, min(links.Len(), n.options.MaxRecords))
	for i := range links.Len() {
		if len(result) >= n.options.MaxRecords {
			report.normalized("drop")
			report.rejected("output_limit")
			continue
		}
		link := links.At(i)
		attrs, dropped := flattenAttributes(link.Attributes(), n.options.MaxAttrsPerRecord)
		if dropped > 0 {
			report.normalized("truncate")
			report.warning("attributes_truncated")
		}
		if link.DroppedAttributesCount() > 0 {
			report.UpstreamDropped += uint64(link.DroppedAttributesCount())
		}
		result = append(result, utm.SpanLink{
			TraceID: traceIDString(link.TraceID()),
			SpanID:  spanIDString(link.SpanID()),
			Attrs:   attrs,
		})
	}
	return result
}

func traceIDString(id pcommon.TraceID) string { return hex.EncodeToString(id[:]) }
func spanIDString(id pcommon.SpanID) string   { return hex.EncodeToString(id[:]) }

func normalizeSpanKind(kind ptrace.SpanKind) utm.SpanKind {
	switch kind {
	case ptrace.SpanKindInternal:
		return utm.KindInternal
	case ptrace.SpanKindServer:
		return utm.KindServer
	case ptrace.SpanKindClient:
		return utm.KindClient
	case ptrace.SpanKindProducer:
		return utm.KindProducer
	case ptrace.SpanKindConsumer:
		return utm.KindConsumer
	default:
		return utm.KindUnspecified
	}
}

func normalizeStatus(status ptrace.StatusCode) utm.StatusCode {
	switch status {
	case ptrace.StatusCodeOk:
		return utm.StatusOK
	case ptrace.StatusCodeError:
		return utm.StatusError
	default:
		return utm.StatusUnset
	}
}

func isSpanError(status utm.StatusCode, attrs map[string]string) bool {
	if status == utm.StatusError || strings.EqualFold(attrs["error"], "true") {
		return true
	}
	code, err := strconv.ParseInt(attrs["http.response.status_code"], 10, 64)
	return err == nil && code >= 500
}
