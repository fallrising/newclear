package normalize

import (
	"context"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

var (
	testTraceID = pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	testSpanID  = pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}
	linkTraceID = pcommon.TraceID{16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1}
	linkSpanID  = pcommon.SpanID{8, 7, 6, 5, 4, 3, 2, 1}
)

func TestNormalizeTracesFullMapping(t *testing.T) {
	t.Parallel()

	normalizer := testNormalizer(t, Options{Tenant: "tenant-a"})
	traces := ptrace.NewTraces()
	resourceSpans := traces.ResourceSpans().AppendEmpty()
	resourceAttrs := resourceSpans.Resource().Attributes()
	resourceAttrs.PutStr("service.name", "checkout")
	resourceAttrs.PutStr("host.id", "host-id")
	resourceAttrs.PutStr("service.version", "1.2.3")
	resourceAttrs.PutStr("service.namespace", "shop")
	resourceAttrs.PutStr("host.name", "node-a")
	resourceAttrs.PutStr("k8s.node.name", "fallback-node")
	resourceAttrs.PutStr("k8s.cluster.name", "cluster-a")
	resourceAttrs.PutStr("deployment.environment.name", "prod")
	resourceAttrs.PutStr("custom.resource", "kept")
	resourceSpans.Resource().SetDroppedAttributesCount(2)
	resourceSpans.SetSchemaUrl("ignored")

	scopeSpans := resourceSpans.ScopeSpans().AppendEmpty()
	scopeSpans.Scope().SetName("checkout-lib")
	scopeSpans.Scope().SetVersion("2.0")
	scopeSpans.Scope().Attributes().PutStr("library.attr", "scope-value")
	scopeSpans.Scope().SetDroppedAttributesCount(1)
	scopeSpans.SetSchemaUrl("ignored")

	input := scopeSpans.Spans().AppendEmpty()
	input.SetTraceID(testTraceID)
	input.SetSpanID(testSpanID)
	input.SetParentSpanID(pcommon.NewSpanIDEmpty())
	input.TraceState().FromRaw("vendor=value")
	input.SetKind(ptrace.SpanKindServer)
	startNano := utm.TimeToNano(fixedNow.Add(-time.Minute))
	start := pcommon.NewTimestampFromTime(fixedNow.Add(-time.Minute))
	input.SetStartTimestamp(start)
	input.SetEndTimestamp(0)
	input.Attributes().PutBool("error", false)
	input.Attributes().PutInt("http.response.status_code", 503)
	input.Attributes().PutStr("span.attr", "value")
	input.SetDroppedAttributesCount(4)
	input.SetDroppedEventsCount(2)
	input.SetDroppedLinksCount(3)
	input.SetFlags(1)
	input.Status().SetCode(ptrace.StatusCodeUnset)
	input.Status().SetMessage("status message")
	event := input.Events().AppendEmpty()
	event.SetTimestamp(start)
	event.SetName("cache miss")
	event.Attributes().PutInt("attempt", 2)
	event.SetDroppedAttributesCount(1)
	link := input.Links().AppendEmpty()
	link.SetTraceID(linkTraceID)
	link.SetSpanID(linkSpanID)
	link.Attributes().PutStr("link.attr", "linked")
	link.SetDroppedAttributesCount(1)

	invalidTrace := scopeSpans.Spans().AppendEmpty()
	invalidTrace.SetSpanID(testSpanID)
	invalidTrace.SetStartTimestamp(start)
	invalidSpan := scopeSpans.Spans().AppendEmpty()
	invalidSpan.SetTraceID(testTraceID)
	invalidSpan.SetStartTimestamp(start)
	zeroStart := scopeSpans.Spans().AppendEmpty()
	zeroStart.SetTraceID(testTraceID)
	zeroStart.SetSpanID(testSpanID)

	spans, report, err := normalizer.NormalizeTraces(context.Background(), traces, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(spans) != 1 {
		t.Fatalf("len(spans) = %d, want 1", len(spans))
	}
	span := spans[0]
	if span.TraceID != "0102030405060708090a0b0c0d0e0f10" || span.SpanID != "0102030405060708" || span.ParentSpanID != "" {
		t.Fatalf("IDs = %q/%q/%q", span.TraceID, span.SpanID, span.ParentSpanID)
	}
	if span.Name != "unknown" || span.Kind != utm.KindServer || span.TraceState != "vendor=value" {
		t.Fatalf("span identity mapping = %#v", span)
	}
	if span.StartNano != startNano || span.EndNano != startNano || span.StatusCode != utm.StatusUnset || span.StatusMsg != "status message" {
		t.Fatalf("span timing/status mapping = %#v", span)
	}
	if span.Resource.Tenant != "tenant-a" || span.Resource.Service != "checkout" || span.Resource.ServiceInstance != "host-id" || span.Resource.ServiceVersion != "1.2.3" || span.Resource.Namespace != "shop" || span.Resource.Host != "node-a" || span.Resource.Cluster != "cluster-a" || span.Resource.Env != "prod" {
		t.Fatalf("resource mapping = %#v", span.Resource)
	}
	if span.Resource.Attrs["custom.resource"] != "kept" {
		t.Fatalf("resource attrs = %#v", span.Resource.Attrs)
	}
	for key, want := range map[string]string{
		"otel.scope.name":               "checkout-lib",
		"otel.scope.version":            "2.0",
		"otel.scope.library.attr":       "scope-value",
		"otel.dropped_attributes_count": "4",
		"prism.duration_ns":             "0",
		"prism.is_root":                 "true",
		"prism.error":                   "true",
	} {
		if span.Attrs[key] != want {
			t.Errorf("Span.Attrs[%q] = %q, want %q", key, span.Attrs[key], want)
		}
	}
	if len(span.Events) != 1 || span.Events[0].TS != startNano || span.Events[0].Name != "cache miss" || span.Events[0].Attrs["attempt"] != "2" {
		t.Fatalf("events = %#v", span.Events)
	}
	if len(span.Links) != 1 || span.Links[0].TraceID != "100f0e0d0c0b0a090807060504030201" || span.Links[0].SpanID != "0807060504030201" || span.Links[0].Attrs["link.attr"] != "linked" {
		t.Fatalf("links = %#v", span.Links)
	}
	if report.UpstreamDropped != 10 {
		t.Fatalf("UpstreamDropped = %d, want 10", report.UpstreamDropped)
	}
	if report.Rejected["invalid_trace_id"] != 1 || report.Rejected["invalid_span_id"] != 1 || report.Rejected["zero_start_time"] != 1 {
		t.Fatalf("rejected = %#v", report.Rejected)
	}
	if report.Warnings["invalid_span_end"] != 1 {
		t.Fatalf("warnings = %#v", report.Warnings)
	}
}

func TestNormalizeTraceMissingServiceAndClockPolicy(t *testing.T) {
	t.Parallel()

	traces := ptrace.NewTraces()
	resourceSpans := traces.ResourceSpans().AppendEmpty()
	span := resourceSpans.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetTraceID(testTraceID)
	span.SetSpanID(testSpanID)
	future := pcommon.NewTimestampFromTime(fixedNow.Add(10 * time.Minute))
	span.SetStartTimestamp(future)
	span.SetEndTimestamp(future)

	clamp := testNormalizer(t, Options{})
	spans, report, err := clamp.NormalizeTraces(context.Background(), traces, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(spans) != 1 || spans[0].Resource.Service != "unknown_service" {
		t.Fatalf("spans = %#v", spans)
	}
	wantTime := utm.TimeToNano(fixedNow.Add(defaultMaxFuture))
	if spans[0].StartNano != wantTime || spans[0].Attrs["prism.clock_adjusted"] != "true" || report.Normalized["clamp"] != 2 {
		t.Fatalf("clamped span/report = %#v / %#v", spans[0], report)
	}

	drop := testNormalizer(t, Options{ClockSkewPolicy: ClockSkewDrop})
	spans, report, err = drop.NormalizeTraces(context.Background(), traces, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(spans) != 0 || report.Rejected["clock_skew"] != 1 {
		t.Fatalf("drop spans/report = %#v / %#v", spans, report)
	}
}

func TestSpanErrorSignals(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		status utm.StatusCode
		attrs  map[string]string
		want   bool
	}{
		{name: "status", status: utm.StatusError, want: true},
		{name: "error attr", attrs: map[string]string{"error": "TRUE"}, want: true},
		{name: "HTTP status", attrs: map[string]string{"http.response.status_code": "500"}, want: true},
		{name: "not error", attrs: map[string]string{"http.response.status_code": "499"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isSpanError(test.status, test.attrs); got != test.want {
				t.Fatalf("isSpanError() = %v, want %v", got, test.want)
			}
		})
	}
}
