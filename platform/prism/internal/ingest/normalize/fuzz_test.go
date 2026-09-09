package normalize

import (
	"context"
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func FuzzOTLPTraceJSON(f *testing.F) {
	f.Add([]byte(`{"resourceSpans":[]}`))
	f.Fuzz(func(t *testing.T, payload []byte) {
		traces, err := (&ptrace.JSONUnmarshaler{}).UnmarshalTraces(payload)
		if err != nil {
			return
		}
		normalizer := New(context.Background(), fuzzOptions())
		defer normalizer.Close()
		_, _, _ = normalizer.NormalizeTraces(context.Background(), traces, fixedNow)
	})
}

func FuzzOTLPLogJSON(f *testing.F) {
	f.Add([]byte(`{"resourceLogs":[]}`))
	f.Fuzz(func(t *testing.T, payload []byte) {
		logs, err := DecodeOTLPLogsJSON(payload)
		if err != nil {
			return
		}
		normalizer := New(context.Background(), fuzzOptions())
		defer normalizer.Close()
		_, _, _ = normalizer.NormalizeLogs(context.Background(), logs, fixedNow)
	})
}

func FuzzOTLPMetricJSON(f *testing.F) {
	f.Add([]byte(`{"resourceMetrics":[]}`))
	f.Fuzz(func(t *testing.T, payload []byte) {
		metrics, err := (&pmetric.JSONUnmarshaler{}).UnmarshalMetrics(payload)
		if err != nil {
			return
		}
		normalizer := New(context.Background(), fuzzOptions())
		defer normalizer.Close()
		_, _, _ = normalizer.NormalizeMetrics(context.Background(), metrics, fixedNow)
	})
}

func FuzzRemoteWrite(f *testing.F) {
	fixture, err := os.ReadFile(fixturePath("remote_write_full.pb"))
	if err != nil {
		f.Fatal(err)
	}
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(fixture)))
	if err != nil {
		f.Fatal(err)
	}
	f.Add(seed)
	f.Fuzz(func(t *testing.T, payload []byte) {
		request, err := DecodeRemoteWrite(payload, "snappy", "application/x-protobuf", "0.1.0")
		if err != nil {
			return
		}
		normalizer := New(context.Background(), fuzzOptions())
		defer normalizer.Close()
		_, _, _ = normalizer.NormalizeRemoteWrite(context.Background(), request, fixedNow)
	})
}

func FuzzLokiPushJSON(f *testing.F) {
	f.Add([]byte(`{"streams":[]}`))
	f.Fuzz(func(t *testing.T, payload []byte) {
		normalizer := New(context.Background(), fuzzOptions())
		defer normalizer.Close()
		_, _, _ = normalizer.NormalizeLokiJSON(context.Background(), payload, fixedNow)
	})
}

func fuzzOptions() Options {
	return Options{
		Now:               func() time.Time { return fixedNow },
		MaxAttrsPerRecord: 16,
		MaxRecords:        100,
		MaxDeltaSeries:    100,
	}
}
