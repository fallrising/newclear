package normalize

import (
	"context"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
)

func TestNormalizeLogsFullMapping(t *testing.T) {
	t.Parallel()

	normalizer := testNormalizer(t, Options{Tenant: "tenant-a"})
	logs := plog.NewLogs()
	resourceLogs := logs.ResourceLogs().AppendEmpty()
	resourceLogs.Resource().Attributes().PutStr("service.name", "checkout")
	resourceLogs.Resource().Attributes().PutStr("host.name", "node-a")
	scopeLogs := resourceLogs.ScopeLogs().AppendEmpty()

	input := scopeLogs.LogRecords().AppendEmpty()
	observedNano := utm.TimeToNano(fixedNow.Add(-time.Minute))
	observed := pcommon.NewTimestampFromTime(fixedNow.Add(-time.Minute))
	input.SetObservedTimestamp(observed)
	input.SetSeverityNumber(plog.SeverityNumberUnspecified)
	input.SetSeverityText("WARNING2")
	input.SetTraceID(testTraceID)
	input.SetSpanID(testSpanID)
	input.SetEventName("cart.updated")
	input.SetFlags(1)
	input.SetDroppedAttributesCount(2)
	input.Attributes().PutStr("service", "user-service")
	input.Attributes().PutStr("unit", "checkout.service")
	input.Attributes().PutStr("user_id", "high-cardinality")
	input.Attributes().PutInt("attempt", 2)
	body := input.Body().SetEmptyMap()
	body.PutStr("message", "updated")
	body.PutInt("code", 200)

	synthetic := scopeLogs.LogRecords().AppendEmpty()
	synthetic.Body().SetInt(42)
	synthetic.SetSeverityNumber(plog.SeverityNumberError)

	empty := scopeLogs.LogRecords().AppendEmpty()
	empty.SetTimestamp(observed)

	records, report, err := normalizer.NormalizeLogs(context.Background(), logs, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 {
		t.Fatalf("len(records) = %d, want 2", len(records))
	}
	record := records[0]
	if record.TS != observedNano || record.ObservedTS != observedNano {
		t.Fatalf("timestamps = %d/%d, want %d", record.TS, record.ObservedTS, observedNano)
	}
	if record.Severity != utm.SevWarn || record.SeverityText != "WARNING2" {
		t.Fatalf("severity = %v/%q", record.Severity, record.SeverityText)
	}
	if record.Body != `{"code":200,"message":"updated"}` {
		t.Fatalf("body = %q", record.Body)
	}
	if record.TraceID != "0102030405060708090a0b0c0d0e0f10" || record.SpanID != "0102030405060708" {
		t.Fatalf("trace context = %q/%q", record.TraceID, record.SpanID)
	}
	if record.Labels.Get("service") != "user-service" || record.Labels.Get("resource_service") != "checkout" || record.Labels.Get("job") != "checkout" || record.Labels.Get("host") != "node-a" || record.Labels.Get("unit") != "checkout.service" {
		t.Fatalf("labels = %s", record.Labels)
	}
	for key, want := range map[string]string{
		"attempt":      "2",
		"user_id":      "high-cardinality",
		"body.message": "updated",
		"body.code":    "200",
		"event.name":   "cart.updated",
	} {
		if record.Attrs[key] != want {
			t.Errorf("attrs[%q] = %q, want %q", key, record.Attrs[key], want)
		}
	}
	if report.UpstreamDropped != 2 || report.Rejected["empty_log"] != 1 {
		t.Fatalf("report = %#v", report)
	}

	if records[1].TS != utm.TimeToNano(fixedNow) || records[1].ObservedTS != utm.TimeToNano(fixedNow) || records[1].Attrs["prism.ts_synthesized"] != "true" || records[1].Body != "42" || records[1].Severity != utm.SevError {
		t.Fatalf("synthetic record = %#v", records[1])
	}
}

func TestDecodeOTLPLogsJSONPreservesEventNameAliases(t *testing.T) {
	t.Parallel()

	for _, payload := range []string{
		`{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"eventName":"camel","body":{"stringValue":"x"}}]}]}]}`,
		`{"resource_logs":[{"scope_logs":[{"log_records":[{"event_name":"snake","body":{"string_value":"x"}}]}]}]}`,
	} {
		logs, err := DecodeOTLPLogsJSON([]byte(payload))
		if err != nil {
			t.Fatal(err)
		}
		record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
		if record.EventName() != "camel" && record.EventName() != "snake" {
			t.Fatalf("EventName() = %q", record.EventName())
		}
	}
}

func TestNormalizeLogSeverityRanges(t *testing.T) {
	t.Parallel()

	tests := []struct {
		number plog.SeverityNumber
		want   utm.Severity
	}{
		{number: plog.SeverityNumberTrace, want: utm.SevTrace},
		{number: plog.SeverityNumberDebug4, want: utm.SevDebug},
		{number: plog.SeverityNumberInfo2, want: utm.SevInfo},
		{number: plog.SeverityNumberWarn4, want: utm.SevWarn},
		{number: plog.SeverityNumberError3, want: utm.SevError},
		{number: plog.SeverityNumberFatal4, want: utm.SevFatal},
	}
	for _, test := range tests {
		logs := plog.NewLogs()
		record := logs.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
		record.SetTimestamp(pcommon.NewTimestampFromTime(fixedNow))
		record.SetSeverityNumber(test.number)
		record.Body().SetStr("body")
		normalizer := testNormalizer(t, Options{})
		got, _, err := normalizer.NormalizeLogs(context.Background(), logs, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0].Severity != test.want {
			t.Fatalf("severity %d = %#v, want %v", test.number, got, test.want)
		}
	}
}

func TestNormalizeLogClockDrop(t *testing.T) {
	t.Parallel()

	logs := plog.NewLogs()
	record := logs.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.SetTimestamp(pcommon.NewTimestampFromTime(fixedNow.Add(-2 * time.Hour)))
	record.Body().SetStr("old")
	normalizer := testNormalizer(t, Options{ClockSkewPolicy: ClockSkewDrop})
	got, report, err := normalizer.NormalizeLogs(context.Background(), logs, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 || report.Rejected["clock_skew"] != 1 {
		t.Fatalf("records/report = %#v/%#v", got, report)
	}
}
