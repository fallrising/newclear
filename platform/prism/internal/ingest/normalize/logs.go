package normalize

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
)

// DecodeOTLPLogsJSON unmarshals OTLP/JSON and preserves event_name on pdata
// versions whose generic JSON decoder omits that recently added field.
func DecodeOTLPLogsJSON(payload []byte) (plog.Logs, error) {
	logs, err := (&plog.JSONUnmarshaler{}).UnmarshalLogs(payload)
	if err != nil {
		return plog.Logs{}, fmt.Errorf("unmarshal OTLP logs JSON: %w", err)
	}
	var envelope logEventEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return plog.Logs{}, fmt.Errorf("unmarshal OTLP log event names: %w", err)
	}
	applyLogEventNames(logs, envelope.resources())
	return logs, nil
}

type logEventEnvelope struct {
	ResourceLogs      []logEventResource `json:"resourceLogs"`
	ResourceLogsSnake []logEventResource `json:"resource_logs"`
}

func (e logEventEnvelope) resources() []logEventResource {
	if e.ResourceLogs != nil {
		return e.ResourceLogs
	}
	return e.ResourceLogsSnake
}

type logEventResource struct {
	ScopeLogs      []logEventScope `json:"scopeLogs"`
	ScopeLogsSnake []logEventScope `json:"scope_logs"`
}

func (r logEventResource) scopes() []logEventScope {
	if r.ScopeLogs != nil {
		return r.ScopeLogs
	}
	return r.ScopeLogsSnake
}

type logEventScope struct {
	LogRecords      []logEventRecord `json:"logRecords"`
	LogRecordsSnake []logEventRecord `json:"log_records"`
}

func (s logEventScope) records() []logEventRecord {
	if s.LogRecords != nil {
		return s.LogRecords
	}
	return s.LogRecordsSnake
}

type logEventRecord struct {
	EventName      string `json:"eventName"`
	EventNameSnake string `json:"event_name"`
}

func (r logEventRecord) eventName() string {
	if r.EventName != "" {
		return r.EventName
	}
	return r.EventNameSnake
}

func applyLogEventNames(logs plog.Logs, resources []logEventResource) {
	resourceLogs := logs.ResourceLogs()
	for i := range min(resourceLogs.Len(), len(resources)) {
		scopeLogs := resourceLogs.At(i).ScopeLogs()
		scopes := resources[i].scopes()
		for j := range min(scopeLogs.Len(), len(scopes)) {
			records := scopeLogs.At(j).LogRecords()
			events := scopes[j].records()
			for k := range min(records.Len(), len(events)) {
				records.At(k).SetEventName(events[k].eventName())
			}
		}
	}
}

// NormalizeLogs maps OTLP logs to bounded UTM records.
func (n *Normalizer) NormalizeLogs(ctx context.Context, logs plog.Logs, receivedAt time.Time) ([]utm.LogRecord, Report, error) {
	report := newReport()
	records := make([]utm.LogRecord, 0, min(logs.LogRecordCount(), n.options.MaxRecords))
	receivedNano := utm.TimeToNano(receivedAt)
	resources := logs.ResourceLogs()
	for i := range resources.Len() {
		resourceLogs := resources.At(i)
		resource := n.normalizeResource(resourceLogs.Resource(), false, &report)
		scopes := resourceLogs.ScopeLogs()
		for j := range scopes.Len() {
			inputRecords := scopes.At(j).LogRecords()
			for k := range inputRecords.Len() {
				if err := ctx.Err(); err != nil {
					return nil, report, fmt.Errorf("normalize logs: %w", err)
				}
				if len(records) >= n.options.MaxRecords {
					report.normalized("drop")
					report.rejected("output_limit")
					continue
				}
				record, ok := n.normalizeLogRecord(inputRecords.At(k), resource, receivedNano, receivedAt, &report)
				if ok {
					records = append(records, record)
				}
			}
		}
	}
	return records, report, nil
}

func (n *Normalizer) normalizeLogRecord(input plog.LogRecord, resource *utm.Resource, receivedNano int64, receivedAt time.Time, report *Report) (utm.LogRecord, bool) {
	body := SerializeAnyValue(input.Body())
	if body == "" && input.Attributes().Len() == 0 && input.EventName() == "" {
		report.normalized("drop")
		report.rejected("empty_log")
		return utm.LogRecord{}, false
	}

	labels, attrs := n.logLabelsAndAttrs(input.Attributes(), resource, report)
	if attrs == nil {
		attrs = make(map[string]string)
	}
	if input.Body().Type() == pcommon.ValueTypeMap {
		input.Body().Map().Range(func(key string, value pcommon.Value) bool {
			flattenValue(attrs, "body."+escapeAttributeKey(key), value, 1)
			return true
		})
	}
	if input.EventName() != "" {
		attrs["event.name"] = validUTF8(input.EventName())
	}
	if input.DroppedAttributesCount() > 0 {
		report.UpstreamDropped += uint64(input.DroppedAttributesCount())
	}

	observed := otelTimestampNano(input.ObservedTimestamp())
	if observed == 0 {
		observed = receivedNano
	}
	timestamp := otelTimestampNano(input.Timestamp())
	protected := make(map[string]string, 2)
	if timestamp == 0 {
		timestamp = otelTimestampNano(input.ObservedTimestamp())
		if timestamp == 0 {
			timestamp = receivedNano
			protected["prism.ts_synthesized"] = "true"
		}
	}
	var ok bool
	timestamp, attrs, ok = n.normalizeNanoTimestamp(timestamp, attrs, receivedAt, report)
	if !ok {
		return utm.LogRecord{}, false
	}
	if adjusted, found := attrs["prism.clock_adjusted"]; found {
		protected["prism.clock_adjusted"] = adjusted
	}
	attrs, dropped := capAttributesPreserving(attrs, protected, n.options.MaxAttrsPerRecord)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}
	if len(attrs) == 0 {
		attrs = nil
	}

	severity := utm.SeverityFromOTel(int32(input.SeverityNumber()))
	if input.SeverityNumber() == plog.SeverityNumberUnspecified {
		severity = utm.ParseSeverity(input.SeverityText())
	}
	traceID := ""
	if !input.TraceID().IsEmpty() {
		traceID = traceIDString(input.TraceID())
	}
	spanID := ""
	if !input.SpanID().IsEmpty() {
		spanID = spanIDString(input.SpanID())
	}
	return utm.LogRecord{
		Resource:     resource,
		TS:           timestamp,
		ObservedTS:   observed,
		Severity:     severity,
		SeverityText: validUTF8(input.SeverityText()),
		Body:         body,
		TraceID:      traceID,
		SpanID:       spanID,
		Labels:       labels,
		Attrs:        attrs,
	}, true
}
