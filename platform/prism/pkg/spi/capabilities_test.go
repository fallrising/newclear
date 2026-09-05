package spi

import "testing"

func TestCapabilitiesHas(t *testing.T) {
	t.Parallel()

	caps := Capabilities{Signals: []Signal{SignalMetrics, SignalTraces}}
	if !caps.Has(SignalMetrics) || !caps.Has(SignalTraces) || caps.Has(SignalLogs) {
		t.Fatalf("unexpected Has results for %v", caps.Signals)
	}
}

func TestCapabilitiesValidate(t *testing.T) {
	t.Parallel()

	allPushdown := LogPushdown{
		Substring:         true,
		Regex:             true,
		ParsedFieldJSON:   true,
		ParsedFieldLogfmt: true,
		Limit:             true,
		Sort:              true,
	}
	tests := []struct {
		name    string
		caps    Capabilities
		wantErr bool
	}{
		{
			name: "signals only",
			caps: Capabilities{Signals: []Signal{SignalMetrics}},
		},
		{
			name: "all capabilities",
			caps: Capabilities{
				Signals: []Signal{SignalMetrics, SignalLogs, SignalTraces},
				Metrics: MetricCaps{NativePromQL: true, Exemplars: true, NativeHistograms: true, Downsampling: true, DeleteSeries: true, Metadata: true},
				Logs:    LogCaps{NativeLogQuery: true, Pushdown: allPushdown, Aggregation: true, LiveTail: true, Stats: true},
				Traces:  TraceCaps{TagFilter: true, DurationFilter: true, SpanKindFilter: true, Dependencies: true, RED: true},
			},
		},
		{name: "no signals", caps: Capabilities{}, wantErr: true},
		{
			name:    "metric feature without signal",
			caps:    Capabilities{Signals: []Signal{SignalLogs}, Metrics: MetricCaps{Metadata: true}},
			wantErr: true,
		},
		{
			name:    "log feature without signal",
			caps:    Capabilities{Signals: []Signal{SignalMetrics}, Logs: LogCaps{Stats: true}},
			wantErr: true,
		},
		{
			name:    "trace feature without signal",
			caps:    Capabilities{Signals: []Signal{SignalMetrics}, Traces: TraceCaps{TagFilter: true}},
			wantErr: true,
		},
		{
			name: "native log query needs every pushdown",
			caps: Capabilities{
				Signals: []Signal{SignalLogs},
				Logs:    LogCaps{NativeLogQuery: true, Pushdown: LogPushdown{Substring: true, Regex: true, ParsedFieldJSON: true, ParsedFieldLogfmt: true, Limit: true}},
			},
			wantErr: true,
		},
		{
			name: "limit needs every filter",
			caps: Capabilities{
				Signals: []Signal{SignalLogs},
				Logs:    LogCaps{Pushdown: LogPushdown{Substring: true, Regex: true, ParsedFieldJSON: true, Limit: true}},
			},
			wantErr: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := test.caps.Validate()
			if (err != nil) != test.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}
