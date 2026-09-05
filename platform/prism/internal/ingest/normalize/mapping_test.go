package normalize

import (
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func TestResourceFallbackPriority(t *testing.T) {
	t.Parallel()

	normalizer := testNormalizer(t, Options{})
	resource := pcommon.NewResource()
	attrs := resource.Attributes()
	attrs.PutStr("host.id", "host-id")
	attrs.PutStr("k8s.node.name", "k8s-node")
	attrs.PutStr("net.host.name", "network-node")
	attrs.PutStr("prism.cluster", "prism-cluster")
	attrs.PutStr("deployment.environment", "legacy-env")
	report := newReport()
	got := normalizer.normalizeResource(resource, false, &report)
	if got.ServiceInstance != "host-id" || got.Host != "k8s-node" || got.Cluster != "prism-cluster" || got.Env != "legacy-env" {
		t.Fatalf("fallback resource = %#v", got)
	}

	attrs.PutStr("service.instance.id", "service-instance")
	attrs.PutStr("host.name", "host-name")
	attrs.PutStr("k8s.cluster.name", "k8s-cluster")
	attrs.PutStr("deployment.environment.name", "current-env")
	got = normalizer.normalizeResource(resource, false, &report)
	if got.ServiceInstance != "service-instance" || got.Host != "host-name" || got.Cluster != "k8s-cluster" || got.Env != "current-env" {
		t.Fatalf("priority resource = %#v", got)
	}
}

func TestDefaultLogLabelPromotionAndDenylist(t *testing.T) {
	t.Parallel()

	normalizer := testNormalizer(t, Options{})
	attributes := pcommon.NewMap()
	for _, key := range defaultLogLabelAllowlist {
		attributes.PutStr(key, key+"-value")
	}
	attributes.PutStr("request_id", "not-a-label")
	attributes.PutStr("other", "attribute")
	report := newReport()
	labels, attrs := normalizer.logLabelsAndAttrs(attributes, &utm.Resource{}, &report)
	for _, key := range defaultLogLabelAllowlist {
		if labels.Get(key) != key+"-value" {
			t.Errorf("label %q = %q", key, labels.Get(key))
		}
	}
	if labels.Get("request_id") != "" || attrs["request_id"] != "not-a-label" || attrs["other"] != "attribute" {
		t.Fatalf("labels/attrs = %s / %#v", labels, attrs)
	}
}

func TestHighCardinalityAttributePattern(t *testing.T) {
	t.Parallel()

	for _, key := range []string{
		"trace_id", "span_id", "request_id", "session_id", "user_id", "uuid",
		"device_uuid", "customer.id", "url.full", "http.url", "http.target",
	} {
		if !highCardinalityAttribute.MatchString(key) {
			t.Errorf("%q did not match high-cardinality pattern", key)
		}
	}
	for _, key := range []string{"service", "host", "customer_id", "url_path"} {
		if highCardinalityAttribute.MatchString(key) {
			t.Errorf("%q unexpectedly matched high-cardinality pattern", key)
		}
	}
}

func TestSpanKindAndStatusMappings(t *testing.T) {
	t.Parallel()

	for input, want := range map[ptrace.SpanKind]utm.SpanKind{
		ptrace.SpanKindUnspecified: utm.KindUnspecified,
		ptrace.SpanKindInternal:    utm.KindInternal,
		ptrace.SpanKindServer:      utm.KindServer,
		ptrace.SpanKindClient:      utm.KindClient,
		ptrace.SpanKindProducer:    utm.KindProducer,
		ptrace.SpanKindConsumer:    utm.KindConsumer,
	} {
		if got := normalizeSpanKind(input); got != want {
			t.Errorf("normalizeSpanKind(%v) = %v, want %v", input, got, want)
		}
	}
	for input, want := range map[ptrace.StatusCode]utm.StatusCode{
		ptrace.StatusCodeUnset: utm.StatusUnset,
		ptrace.StatusCodeOk:    utm.StatusOK,
		ptrace.StatusCodeError: utm.StatusError,
	} {
		if got := normalizeStatus(input); got != want {
			t.Errorf("normalizeStatus(%v) = %v, want %v", input, got, want)
		}
	}
}
