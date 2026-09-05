package normalize

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"math"
	"os"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

var updateGolden = flag.Bool("update-golden", false, "update normalization golden files")

func TestGoldenOTLPMappings(t *testing.T) {
	t.Run("traces", func(t *testing.T) {
		input, err := (&ptrace.JSONUnmarshaler{}).UnmarshalTraces(readFixture(t, "traces_full.json"))
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{Tenant: "golden-tenant"})
		spans, _, err := normalizer.NormalizeTraces(context.Background(), input, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		assertGolden(t, "traces_full.golden", spans)
	})

	t.Run("logs", func(t *testing.T) {
		input, err := DecodeOTLPLogsJSON(readFixture(t, "logs_full.json"))
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{Tenant: "golden-tenant"})
		records, _, err := normalizer.NormalizeLogs(context.Background(), input, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		assertGolden(t, "logs_full.golden", records)
	})

	t.Run("metrics", func(t *testing.T) {
		input, err := (&pmetric.JSONUnmarshaler{}).UnmarshalMetrics(readFixture(t, "metrics_full.json"))
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{Tenant: "golden-tenant"})
		batch, _, err := normalizer.NormalizeMetrics(context.Background(), input, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		assertGolden(t, "metrics_full.golden", snapshotMetricBatch(batch))
	})

	t.Run("remote write", func(t *testing.T) {
		encoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(readFixture(t, "remote_write_full.pb"))))
		if err != nil {
			t.Fatal(err)
		}
		request, err := DecodeRemoteWrite(encoded, "snappy", "application/x-protobuf", "0.1.0")
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{})
		batch, _, err := normalizer.NormalizeRemoteWrite(context.Background(), request, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		assertGolden(t, "remote_write_full.golden", snapshotMetricBatch(batch))
	})

	t.Run("Loki push", func(t *testing.T) {
		normalizer := testNormalizer(t, Options{Tenant: "golden-tenant"})
		records, _, err := normalizer.NormalizeLokiJSON(context.Background(), readFixture(t, "loki_push_full.json"), fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		assertGolden(t, "loki_push_full.golden", records)
	})
}

func TestGoldenEdgeCases(t *testing.T) {
	t.Run("zero IDs", func(t *testing.T) {
		input, err := (&ptrace.JSONUnmarshaler{}).UnmarshalTraces(readFixture(t, "edge_cases/zero_ids.json"))
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{})
		spans, report, err := normalizer.NormalizeTraces(context.Background(), input, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		if len(spans) != 0 || report.Rejected["invalid_trace_id"] != 1 {
			t.Fatalf("spans/report = %#v/%#v", spans, report)
		}
	})

	t.Run("zero timestamp", func(t *testing.T) {
		input, err := DecodeOTLPLogsJSON(readFixture(t, "edge_cases/zero_timestamp.json"))
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{})
		records, _, err := normalizer.NormalizeLogs(context.Background(), input, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		if len(records) != 1 || records[0].Attrs["prism.ts_synthesized"] != "true" {
			t.Fatalf("records = %#v", records)
		}
	})

	t.Run("empty body", func(t *testing.T) {
		input, err := DecodeOTLPLogsJSON(readFixture(t, "edge_cases/empty_body.json"))
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{})
		records, report, err := normalizer.NormalizeLogs(context.Background(), input, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		if len(records) != 0 || report.Rejected["empty_log"] != 1 {
			t.Fatalf("records/report = %#v/%#v", records, report)
		}
	})

	t.Run("deep nesting", func(t *testing.T) {
		input, err := DecodeOTLPLogsJSON(readFixture(t, "edge_cases/deep_nesting.json"))
		if err != nil {
			t.Fatal(err)
		}
		normalizer := testNormalizer(t, Options{})
		records, _, err := normalizer.NormalizeLogs(context.Background(), input, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		if len(records) != 1 {
			t.Fatalf("records = %#v", records)
		}
		for key := range records[0].Attrs {
			if strings.HasSuffix(key, ".six") {
				t.Fatalf("key %q exceeded flattening depth", key)
			}
		}
	})

	t.Run("non UTF-8", func(t *testing.T) {
		encoded := strings.TrimSpace(string(readFixture(t, "edge_cases/non_utf8.base64")))
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if got := SerializeAnyValue(pcommon.NewValueStr(string(raw))); got != "bad�text" {
			t.Fatalf("SerializeAnyValue(non-UTF8) = %q", got)
		}
	})
}

func assertGolden(t *testing.T, name string, value any) {
	t.Helper()
	actual, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	path := fixturePath(name)
	if *updateGolden {
		if err := os.WriteFile(path, actual, 0o644); err != nil {
			t.Fatalf("update golden %s: %v", name, err)
		}
		return
	}
	want := readFixture(t, name)
	if !bytes.Equal(actual, want) {
		t.Fatalf("golden mismatch for %s\n--- want\n%s\n--- got\n%s", name, want, actual)
	}
}

type metricBatchSnapshot struct {
	Points   []metricPointSnapshot    `json:"points"`
	Metadata []metricMetadataSnapshot `json:"metadata"`
}

type metricPointSnapshot struct {
	Name      string            `json:"name"`
	Labels    map[string]string `json:"labels,omitempty"`
	TS        int64             `json:"ts"`
	Value     string            `json:"value"`
	Type      string            `json:"type"`
	Histogram *utm.Histogram    `json:"histogram,omitempty"`
	Exemplar  *exemplarSnapshot `json:"exemplar,omitempty"`
}

type exemplarSnapshot struct {
	Labels map[string]string `json:"labels,omitempty"`
	Value  string            `json:"value"`
	TS     int64             `json:"ts"`
}

type metricMetadataSnapshot struct {
	Metric string `json:"metric"`
	Type   string `json:"type"`
	Help   string `json:"help,omitempty"`
	Unit   string `json:"unit,omitempty"`
}

func snapshotMetricBatch(batch MetricBatch) metricBatchSnapshot {
	result := metricBatchSnapshot{
		Points:   make([]metricPointSnapshot, 0, len(batch.Points)),
		Metadata: make([]metricMetadataSnapshot, 0, len(batch.Metadata)),
	}
	for _, point := range batch.Points {
		snapshot := metricPointSnapshot{
			Name:      point.Name,
			Labels:    point.Labels.Map(),
			TS:        point.TS,
			Value:     formatGoldenFloat(point.Value),
			Type:      point.Type.String(),
			Histogram: point.Histogram,
		}
		if point.Exemplar != nil {
			snapshot.Exemplar = &exemplarSnapshot{
				Labels: point.Exemplar.Labels.Map(),
				Value:  formatGoldenFloat(point.Exemplar.Value),
				TS:     point.Exemplar.TS,
			}
		}
		result.Points = append(result.Points, snapshot)
	}
	for _, metadata := range batch.Metadata {
		result.Metadata = append(result.Metadata, metricMetadataSnapshot{
			Metric: metadata.Metric,
			Type:   metadata.Type.String(),
			Help:   metadata.Help,
			Unit:   metadata.Unit,
		})
	}
	return result
}

func formatGoldenFloat(value float64) string {
	if math.IsNaN(value) {
		return "NaN"
	}
	return utm.FormatPromValue(value)
}
