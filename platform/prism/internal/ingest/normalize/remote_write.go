package normalize

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/golang/snappy"
	"github.com/prometheus/prometheus/prompb"
)

const remoteWriteVersion = "0.1.0"

// DecodeRemoteWrite validates the v1 wire headers, decodes snappy, and
// unmarshals a Prometheus remote_write request.
func DecodeRemoteWrite(body []byte, contentEncoding, contentType, version string) (*prompb.WriteRequest, error) {
	if version != remoteWriteVersion {
		return nil, fmt.Errorf("unsupported Prometheus remote_write version %q: only %s is supported", version, remoteWriteVersion)
	}
	if !strings.EqualFold(strings.TrimSpace(contentEncoding), "snappy") {
		return nil, fmt.Errorf("unsupported remote_write content encoding %q: want snappy", contentEncoding)
	}
	mediaType, _, _ := strings.Cut(contentType, ";")
	if !strings.EqualFold(strings.TrimSpace(mediaType), "application/x-protobuf") {
		return nil, fmt.Errorf("unsupported remote_write content type %q: want application/x-protobuf", contentType)
	}
	decoded, err := snappy.Decode(nil, body)
	if err != nil {
		return nil, fmt.Errorf("decode remote_write snappy payload: %w", err)
	}
	request := new(prompb.WriteRequest)
	if err := request.Unmarshal(decoded); err != nil {
		return nil, fmt.Errorf("unmarshal remote_write protobuf: %w", err)
	}
	return request, nil
}

// NormalizeRemoteWrite maps a Prometheus v1 write request to UTM points and
// metadata.
func (n *Normalizer) NormalizeRemoteWrite(ctx context.Context, request *prompb.WriteRequest, receivedAt time.Time) (MetricBatch, Report, error) {
	report := newReport()
	batch := MetricBatch{
		Points:   make([]utm.MetricPoint, 0),
		Metadata: make([]utm.MetricMetadata, 0),
	}
	if request == nil {
		return batch, report, nil
	}

	metadataTypes := make(map[string]utm.MetricType, len(request.Metadata))
	for _, input := range request.Metadata {
		name := utm.SanitizeMetricName(validUTF8(input.MetricFamilyName))
		if name != input.MetricFamilyName {
			report.normalized("rename")
		}
		if name == "" {
			continue
		}
		metricType := remoteMetadataType(input.Type)
		metadataTypes[name] = metricType
		if len(batch.Metadata) >= n.options.MaxRecords {
			report.normalized("drop")
			report.rejected("output_limit")
			continue
		}
		batch.Metadata = append(batch.Metadata, utm.MetricMetadata{
			Metric: name,
			Type:   metricType,
			Help:   validUTF8(input.Help),
			Unit:   validUTF8(input.Unit),
		})
	}

	for _, series := range request.Timeseries {
		if err := ctx.Err(); err != nil {
			return MetricBatch{}, report, fmt.Errorf("normalize remote_write: %w", err)
		}
		name, pointLabels := promLabels(series.Labels, &report)
		inputName := name
		name = utm.SanitizeMetricName(validUTF8(inputName))
		if name != inputName {
			report.normalized("rename")
		}
		if name == "" {
			report.normalized("drop")
			report.rejected("empty_metric_name")
			continue
		}
		metricType := inferRemoteMetricType(name)
		if metadataType, found := findRemoteMetadataType(name, metadataTypes); found {
			metricType = metadataType
		}
		for sampleIndex, sample := range series.Samples {
			timestamp, ok := n.normalizeMetricTimestamp(sample.Timestamp, receivedAt, &report)
			if !ok {
				continue
			}
			var exemplar *utm.Exemplar
			if sampleIndex == 0 && len(series.Exemplars) > 0 {
				exemplar = remoteExemplar(series.Exemplars[0], &report)
				if len(series.Exemplars) > 1 {
					report.warning("extra_exemplars_dropped")
					for range len(series.Exemplars) - 1 {
						report.normalized("drop")
					}
				}
			}
			n.appendPoint(&batch, utm.MetricPoint{
				Name:     name,
				Labels:   pointLabels,
				TS:       timestamp,
				Value:    sample.Value,
				Type:     metricType,
				Exemplar: exemplar,
			}, &report)
		}
		if len(series.Samples) == 0 && len(series.Exemplars) > 0 {
			report.warning("orphan_exemplars_dropped")
			for range len(series.Exemplars) {
				report.normalized("drop")
			}
		}
		if len(series.Histograms) > 0 {
			report.warning("remote_native_histogram_dropped")
			for range len(series.Histograms) {
				report.normalized("drop")
			}
		}
	}
	return batch, report, nil
}

func remoteExemplar(input prompb.Exemplar, report *Report) *utm.Exemplar {
	_, exemplarLabels := promLabels(input.Labels, report)
	return &utm.Exemplar{
		Labels: exemplarLabels,
		Value:  input.Value,
		TS:     input.Timestamp,
	}
}

func remoteMetadataType(input prompb.MetricMetadata_MetricType) utm.MetricType {
	switch input {
	case prompb.MetricMetadata_COUNTER:
		return utm.TypeCounter
	case prompb.MetricMetadata_HISTOGRAM, prompb.MetricMetadata_GAUGEHISTOGRAM:
		return utm.TypeHistogram
	case prompb.MetricMetadata_SUMMARY:
		return utm.TypeSummary
	case prompb.MetricMetadata_GAUGE, prompb.MetricMetadata_INFO, prompb.MetricMetadata_STATESET:
		return utm.TypeGauge
	default:
		return utm.TypeUnknown
	}
}

func inferRemoteMetricType(name string) utm.MetricType {
	switch {
	case strings.HasSuffix(name, "_bucket"):
		return utm.TypeHistogram
	case strings.HasSuffix(name, "_total"), strings.HasSuffix(name, "_count"), strings.HasSuffix(name, "_sum"):
		return utm.TypeCounter
	default:
		return utm.TypeGauge
	}
}

func findRemoteMetadataType(name string, types map[string]utm.MetricType) (utm.MetricType, bool) {
	if metricType, found := types[name]; found {
		return metricType, true
	}
	for _, suffix := range []string{"_total", "_bucket", "_count", "_sum"} {
		base, found := strings.CutSuffix(name, suffix)
		if !found {
			continue
		}
		metricType, exists := types[base]
		return metricType, exists
	}
	return utm.TypeUnknown, false
}
