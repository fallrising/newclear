package utm

import (
	"testing"

	"github.com/prometheus/prometheus/model/labels"
)

func TestSeverityString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		severity Severity
		want     string
	}{
		{severity: SevUnknown, want: "unknown"},
		{severity: SevTrace, want: "trace"},
		{severity: SevDebug, want: "debug"},
		{severity: SevInfo, want: "info"},
		{severity: SevWarn, want: "warn"},
		{severity: SevError, want: "error"},
		{severity: SevFatal, want: "fatal"},
		{severity: Severity(255), want: "unknown"},
	}
	for _, test := range tests {
		if got := test.severity.String(); got != test.want {
			t.Errorf("Severity(%d).String() = %q, want %q", test.severity, got, test.want)
		}
	}
}

func TestParseSeverity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input string
		want  Severity
	}{
		{input: "TRACE2", want: SevTrace},
		{input: "trc", want: SevTrace},
		{input: "T", want: SevTrace},
		{input: "debugging", want: SevDebug},
		{input: "DBG", want: SevDebug},
		{input: "d", want: SevDebug},
		{input: "information", want: SevInfo},
		{input: "notice", want: SevInfo},
		{input: " i ", want: SevInfo},
		{input: "warning", want: SevWarn},
		{input: "w", want: SevWarn},
		{input: "severe", want: SevError},
		{input: "ERR42", want: SevError},
		{input: "e", want: SevError},
		{input: "critical", want: SevFatal},
		{input: "panic", want: SevFatal},
		{input: "emergency", want: SevFatal},
		{input: "alert", want: SevFatal},
		{input: "f", want: SevFatal},
		{input: "taco", want: SevUnknown},
		{input: "", want: SevUnknown},
		{input: "verbose", want: SevUnknown},
	}
	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()
			if got := ParseSeverity(test.input); got != test.want {
				t.Fatalf("ParseSeverity(%q) = %v, want %v", test.input, got, test.want)
			}
		})
	}
}

func TestSeverityFromOTel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input int32
		want  Severity
	}{
		{input: -1, want: SevUnknown},
		{input: 0, want: SevUnknown},
		{input: 1, want: SevTrace},
		{input: 4, want: SevTrace},
		{input: 5, want: SevDebug},
		{input: 8, want: SevDebug},
		{input: 9, want: SevInfo},
		{input: 12, want: SevInfo},
		{input: 13, want: SevWarn},
		{input: 16, want: SevWarn},
		{input: 17, want: SevError},
		{input: 20, want: SevError},
		{input: 21, want: SevFatal},
		{input: 24, want: SevFatal},
		{input: 25, want: SevUnknown},
	}
	for _, test := range tests {
		if got := SeverityFromOTel(test.input); got != test.want {
			t.Errorf("SeverityFromOTel(%d) = %v, want %v", test.input, got, test.want)
		}
	}
}

func TestLogRecordSizeBytes(t *testing.T) {
	t.Parallel()

	var nilRecord *LogRecord
	if got := nilRecord.SizeBytes(); got != 0 {
		t.Fatalf("nil LogRecord.SizeBytes() = %d, want 0", got)
	}
	record := &LogRecord{
		Resource:     &Resource{Tenant: "acme", Service: "api", Attrs: map[string]string{"region": "eu"}},
		SeverityText: "INFO",
		Body:         "ready",
		TraceID:      "trace",
		SpanID:       "span",
		Labels:       labels.FromStrings("env", "prod"),
		Attrs:        map[string]string{"attempt": "1"},
	}
	const want = 17 + 4 + 3 + 6 + 2 + 4 + 5 + 5 + 4 + 3 + 4 + 7 + 1
	if got := record.SizeBytes(); got != want {
		t.Fatalf("LogRecord.SizeBytes() = %d, want %d", got, want)
	}
}
