package normalize

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

type lokiPushRequest struct {
	Streams []lokiStream `json:"streams"`
}

type lokiStream struct {
	Stream map[string]string   `json:"stream"`
	Values [][]json.RawMessage `json:"values"`
}

// NormalizeLokiJSON maps a Loki JSON push payload to bounded UTM log records.
func (n *Normalizer) NormalizeLokiJSON(ctx context.Context, payload []byte, receivedAt time.Time) ([]utm.LogRecord, Report, error) {
	report := newReport()
	var request lokiPushRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		return nil, report, fmt.Errorf("unmarshal Loki push JSON: %w", err)
	}
	records := make([]utm.LogRecord, 0)
	for _, stream := range request.Streams {
		streamLabels, streamAttrs := lokiLabels(stream.Stream, &report)
		resource := &utm.Resource{
			Tenant:  n.options.Tenant,
			Service: cmp.Or(stream.Stream["service"], stream.Stream["job"]),
			Host:    cmp.Or(stream.Stream["host"], stream.Stream["instance"]),
			Cluster: stream.Stream["cluster"],
			Env:     stream.Stream["env"],
		}
		severityText := cmp.Or(stream.Stream["level"], stream.Stream["severity"])
		for _, entry := range stream.Values {
			if err := ctx.Err(); err != nil {
				return nil, report, fmt.Errorf("normalize Loki push: %w", err)
			}
			if len(records) >= n.options.MaxRecords {
				report.normalized("drop")
				report.rejected("output_limit")
				continue
			}
			if len(entry) < 2 || len(entry) > 3 {
				report.normalized("drop")
				report.rejected("invalid_loki_entry")
				continue
			}
			var timestampText, body string
			if err := json.Unmarshal(entry[0], &timestampText); err != nil {
				report.normalized("drop")
				report.rejected("invalid_timestamp")
				continue
			}
			if err := json.Unmarshal(entry[1], &body); err != nil {
				report.normalized("drop")
				report.rejected("invalid_loki_entry")
				continue
			}
			timestamp, err := utm.ParseLokiTime(timestampText, receivedAt)
			if err != nil {
				report.normalized("drop")
				report.rejected("invalid_timestamp")
				continue
			}
			attrs := maps.Clone(streamAttrs)
			if attrs == nil {
				attrs = make(map[string]string)
			}
			if len(entry) == 3 {
				metadata, err := decodeStructuredMetadata(entry[2])
				if err != nil {
					report.normalized("drop")
					report.rejected("invalid_structured_metadata")
					continue
				}
				maps.Copy(attrs, metadata)
			}
			timestamp, attrs, ok := n.normalizeNanoTimestamp(timestamp, attrs, receivedAt, &report)
			if !ok {
				continue
			}
			attrs, dropped := capAttributes(attrs, n.options.MaxAttrsPerRecord)
			if dropped > 0 {
				report.normalized("truncate")
				report.warning("attributes_truncated")
			}
			traceID := firstValidTraceID(attrs["trace_id"], attrs["traceID"])
			spanID := firstValidSpanID(attrs["span_id"], attrs["spanID"])
			if len(attrs) == 0 {
				attrs = nil
			}
			records = append(records, utm.LogRecord{
				Resource:     resource,
				TS:           timestamp,
				ObservedTS:   timestamp,
				Severity:     utm.ParseSeverity(severityText),
				SeverityText: validUTF8(severityText),
				Body:         validUTF8(body),
				TraceID:      traceID,
				SpanID:       spanID,
				Labels:       streamLabels,
				Attrs:        attrs,
			})
		}
	}
	return records, report, nil
}

func lokiLabels(input map[string]string, report *Report) (utm.Labels, map[string]string) {
	labelValues := make(map[string]string, len(input))
	attrs := make(map[string]string)
	for _, key := range slices.Sorted(maps.Keys(input)) {
		if highCardinalityAttribute.MatchString(key) {
			attrs[key] = validUTF8(input[key])
			report.normalized("drop")
			report.warning("high_cardinality_label_dropped")
			continue
		}
		name := utm.SanitizeLabelName(key)
		if name != key {
			report.normalized("rename")
		}
		if name == "" || utm.IsReserved(name) {
			report.normalized("drop")
			report.warning("reserved_label_dropped")
			continue
		}
		labelValues[name] = validUTF8(input[key])
	}
	if len(attrs) == 0 {
		attrs = nil
	}
	return labels.FromMap(labelValues), attrs
}

func decodeStructuredMetadata(input json.RawMessage) (map[string]string, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(input, &raw); err != nil {
		return nil, fmt.Errorf("decode structured metadata: %w", err)
	}
	result := make(map[string]string, len(raw))
	for key, value := range raw {
		var text string
		if err := json.Unmarshal(value, &text); err == nil {
			result[validUTF8(key)] = validUTF8(text)
			continue
		}
		var compact any
		if err := json.Unmarshal(value, &compact); err != nil {
			return nil, fmt.Errorf("decode structured metadata value %q: %w", key, err)
		}
		encoded, err := json.Marshal(compact)
		if err != nil {
			return nil, fmt.Errorf("encode structured metadata value %q: %w", key, err)
		}
		result[validUTF8(key)] = string(encoded)
	}
	return result, nil
}

func firstValidTraceID(values ...string) string {
	for _, value := range values {
		normalized := utm.NormalizeID(value)
		if utm.ValidTraceID(normalized) {
			return normalized
		}
	}
	return ""
}

func firstValidSpanID(values ...string) string {
	for _, value := range values {
		normalized := utm.NormalizeID(value)
		if utm.ValidSpanID(normalized) {
			return normalized
		}
	}
	return ""
}
