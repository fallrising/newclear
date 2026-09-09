package normalize

import (
	"context"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/golang/snappy"
	"github.com/prometheus/prometheus/prompb"
)

func TestDecodeAndNormalizeRemoteWrite(t *testing.T) {
	t.Parallel()

	timestamp := utm.TimeToMilli(fixedNow)
	request := &prompb.WriteRequest{
		Metadata: []prompb.MetricMetadata{{
			Type:             prompb.MetricMetadata_GAUGE,
			MetricFamilyName: "requests",
			Help:             "request count override",
			Unit:             "requests",
		}},
		Timeseries: []prompb.TimeSeries{
			{
				Labels: []prompb.Label{
					{Name: "__name__", Value: "requests_total"},
					{Name: "method", Value: "GET"},
					{Name: "__reserved", Value: "drop"},
				},
				Samples: []prompb.Sample{{Value: 3, Timestamp: timestamp}},
				Exemplars: []prompb.Exemplar{{
					Labels:    []prompb.Label{{Name: "trace_id", Value: "0102030405060708090a0b0c0d0e0f10"}},
					Value:     3,
					Timestamp: timestamp,
				}},
				Histograms: []prompb.Histogram{{Timestamp: timestamp}},
			},
			{
				Labels:  []prompb.Label{{Name: "__name__", Value: "latency_sum"}},
				Samples: []prompb.Sample{{Value: 9, Timestamp: timestamp}},
			},
		},
	}
	protobuf, err := request.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	encoded := snappy.Encode(nil, protobuf)
	decoded, err := DecodeRemoteWrite(encoded, "snappy", "application/x-protobuf; proto=prometheus.WriteRequest", "0.1.0")
	if err != nil {
		t.Fatal(err)
	}

	normalizer := testNormalizer(t, Options{})
	batch, report, err := normalizer.NormalizeRemoteWrite(context.Background(), decoded, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Metadata) != 1 || batch.Metadata[0].Metric != "requests" || batch.Metadata[0].Type != utm.TypeGauge || batch.Metadata[0].Help != "request count override" || batch.Metadata[0].Unit != "requests" {
		t.Fatalf("metadata = %#v", batch.Metadata)
	}
	if len(batch.Points) != 2 {
		t.Fatalf("points = %#v", batch.Points)
	}
	if batch.Points[0].Name != "requests_total" || batch.Points[0].Type != utm.TypeGauge || batch.Points[0].Value != 3 || batch.Points[0].TS != timestamp || batch.Points[0].Labels.Get("method") != "GET" || batch.Points[0].Labels.Get("__reserved") != "" || batch.Points[0].Exemplar == nil || batch.Points[0].Exemplar.Labels.Get("trace_id") == "" {
		t.Fatalf("first point = %#v", batch.Points[0])
	}
	if batch.Points[1].Type != utm.TypeCounter {
		t.Fatalf("inferred type = %v, want counter", batch.Points[1].Type)
	}
	if report.Warnings["remote_native_histogram_dropped"] != 1 || report.Warnings["reserved_label_dropped"] != 1 {
		t.Fatalf("report = %#v", report)
	}
}

func TestDecodeRemoteWriteHeaderAndPayloadErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		body        []byte
		encoding    string
		contentType string
		version     string
		contains    string
	}{
		{name: "version", encoding: "snappy", contentType: "application/x-protobuf", version: "2.0.0", contains: "only 0.1.0"},
		{name: "encoding", encoding: "gzip", contentType: "application/x-protobuf", version: "0.1.0", contains: "want snappy"},
		{name: "content type", encoding: "snappy", contentType: "application/json", version: "0.1.0", contains: "want application/x-protobuf"},
		{name: "snappy", body: []byte("not-snappy"), encoding: "snappy", contentType: "application/x-protobuf", version: "0.1.0", contains: "snappy payload"},
		{name: "protobuf", body: snappy.Encode(nil, []byte{0xff}), encoding: "snappy", contentType: "application/x-protobuf", version: "0.1.0", contains: "protobuf"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := DecodeRemoteWrite(test.body, test.encoding, test.contentType, test.version)
			if err == nil || !strings.Contains(err.Error(), test.contains) {
				t.Fatalf("DecodeRemoteWrite() error = %v, want containing %q", err, test.contains)
			}
		})
	}
}

func TestInferRemoteMetricType(t *testing.T) {
	t.Parallel()

	for name, want := range map[string]utm.MetricType{
		"requests_total":  utm.TypeCounter,
		"duration_count":  utm.TypeCounter,
		"duration_sum":    utm.TypeCounter,
		"duration_bucket": utm.TypeHistogram,
		"temperature":     utm.TypeGauge,
	} {
		if got := inferRemoteMetricType(name); got != want {
			t.Errorf("inferRemoteMetricType(%q) = %v, want %v", name, got, want)
		}
	}
}
