package normalize

import (
	"context"
	"strconv"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func TestNormalizeLokiJSONFullMapping(t *testing.T) {
	t.Parallel()

	timestamp := utm.TimeToNano(fixedNow)
	payload := []byte(`{
  "streams": [{
    "stream": {
      "service": "checkout",
      "job": "checkout-job",
      "host": "node-a",
      "instance": "fallback-host",
      "cluster": "cluster-a",
      "env": "prod",
      "level": "ERROR2",
      "request_id": "high-cardinality",
      "__reserved": "drop"
    },
    "values": [
      ["` + strconv.FormatInt(timestamp, 10) + `", "failed", {
        "traceID": "0102030405060708090A0B0C0D0E0F10",
        "span_id": "0102030405060708",
        "attempt": 2
      }],
      ["not-a-time", "bad"]
    ]
  }]
}`)
	normalizer := testNormalizer(t, Options{Tenant: "tenant-a"})
	records, report, err := normalizer.NormalizeLokiJSON(context.Background(), payload, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("records = %#v", records)
	}
	record := records[0]
	if record.TS != timestamp || record.ObservedTS != timestamp || record.Body != "failed" || record.Severity != utm.SevError || record.SeverityText != "ERROR2" {
		t.Fatalf("record = %#v", record)
	}
	if record.TraceID != "0102030405060708090a0b0c0d0e0f10" || record.SpanID != "0102030405060708" || record.Attrs["attempt"] != "2" || record.Attrs["request_id"] != "high-cardinality" {
		t.Fatalf("trace/attrs = %#v", record)
	}
	if record.Labels.Get("service") != "checkout" || record.Labels.Get("host") != "node-a" || record.Labels.Get("__reserved") != "" {
		t.Fatalf("labels = %s", record.Labels)
	}
	if record.Resource.Tenant != "tenant-a" || record.Resource.Service != "checkout" || record.Resource.Host != "node-a" || record.Resource.Cluster != "cluster-a" || record.Resource.Env != "prod" {
		t.Fatalf("resource = %#v", record.Resource)
	}
	if report.Rejected["invalid_timestamp"] != 1 || report.Warnings["reserved_label_dropped"] != 1 {
		t.Fatalf("report = %#v", report)
	}
}

func TestNormalizeLokiJSONRejectsMalformedInput(t *testing.T) {
	t.Parallel()

	normalizer := testNormalizer(t, Options{})
	if _, _, err := normalizer.NormalizeLokiJSON(context.Background(), []byte(`{"streams":`), fixedNow); err == nil {
		t.Fatal("malformed JSON accepted")
	}
	payload := []byte(`{"streams":[{"stream":{},"values":[["1"],["1","x",[]]]}]}`)
	got, report, err := normalizer.NormalizeLokiJSON(context.Background(), payload, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 || report.Rejected["invalid_loki_entry"] != 1 || report.Rejected["invalid_structured_metadata"] != 1 {
		t.Fatalf("records/report = %#v/%#v", got, report)
	}
}

func TestNormalizeLokiJSONCanceledEmptyStreams(t *testing.T) {
	t.Parallel()
	n := testNormalizer(t, Options{})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, err := n.NormalizeLokiJSON(ctx, []byte(`{"streams":[{"stream":{},"values":[]}]}`), fixedNow); err == nil {
		t.Fatal("canceled empty-stream request accepted")
	}
}

// Cancellation begins after decode and the first empty stream, exercising the
// outer stream loop independently from the entry loop and the initial check.
type lokiCancelContext struct {
	context.Context
	calls int
}

func (c *lokiCancelContext) Err() error {
	c.calls++
	if c.calls >= 3 {
		return context.Canceled
	}
	return nil
}
func TestNormalizeLokiJSONCancellationBetweenEmptyStreams(t *testing.T) {
	t.Parallel()
	n := testNormalizer(t, Options{})
	ctx := &lokiCancelContext{Context: t.Context()}
	if _, _, err := n.NormalizeLokiJSON(ctx, []byte(`{"streams":[{"stream":{},"values":[]},{"stream":{},"values":[]}]}`), fixedNow); err == nil {
		t.Fatal("cancellation between empty streams ignored")
	}
}
func TestNormalizeLokiJSONSharedAttributesCapPreservesMetadata(t *testing.T) {
	t.Parallel()
	n := testNormalizer(t, Options{MaxAttrsPerRecord: 2})
	wire := []byte(`{"streams":[{"stream":{"a_uuid":"stream-a","b_uuid":"stream-b","c_uuid":"stream-c"},"values":[["1","one",{"a_uuid":"override","aa":"metadata"}],["1","two"]]}]}`)
	records, report, err := n.NormalizeLokiJSON(t.Context(), wire, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 || len(records[0].Attrs) != 2 || records[0].Attrs["a_uuid"] != "override" || records[0].Attrs["aa"] != "metadata" || records[1].Attrs["a_uuid"] != "stream-a" || records[1].Attrs["b_uuid"] != "stream-b" {
		t.Fatalf("capped metadata mapping=%#v", records)
	}
	if report.Warnings["attributes_truncated"] != 2 {
		t.Fatalf("truncation diagnostics=%#v", report)
	}
	records[0].Attrs["a_uuid"] = "mutated"
	if records[1].Attrs["a_uuid"] != "stream-a" {
		t.Fatal("shared attrs alias records")
	}
}
