package clickhouse

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func metricPoint(tenant string, ts int64) utm.MetricPoint {
	return utm.MetricPoint{Name: "cpu", Labels: labels.FromStrings("__name__", "cpu", "__tenant__", tenant), TS: ts, Value: 2, Type: utm.TypeGauge}
}

func TestMetricWriteCacheExtentAndFailure(t *testing.T) {
	conn := &writeTestConn{}
	store := newMetricStore(&writeTestHost{conn}).(*metricStore)
	ctx := t.Context()
	if err := store.Write(ctx, []utm.MetricPoint{metricPoint("a", 1000), metricPoint("a", 2000)}); err != nil {
		t.Fatal(err)
	}
	if got := len(writeTestRows(conn, "metric_series")); got != 1 {
		t.Fatalf("metadata rows=%d", got)
	}
	if got := len(writeTestRows(conn, "metric_samples")); got != 2 {
		t.Fatalf("sample rows=%d", got)
	}
	if err := store.Write(ctx, []utm.MetricPoint{metricPoint("a", 3000)}); err != nil {
		t.Fatal(err)
	}
	if got := len(writeTestRows(conn, "metric_series")); got != 2 {
		t.Fatalf("extension metadata rows=%d", got)
	}
	if err := store.Write(ctx, []utm.MetricPoint{metricPoint("b", 3000)}); err != nil {
		t.Fatal(err)
	}
	if got := len(writeTestRows(conn, "metric_series")); got != 3 {
		t.Fatalf("tenant metadata rows=%d", got)
	}
	conn.failSend = "metric_samples"
	if err := store.Write(ctx, []utm.MetricPoint{metricPoint("a", 4000)}); err == nil {
		t.Fatal("expected failed send")
	}
	conn.failSend = ""
	if err := store.Write(ctx, []utm.MetricPoint{metricPoint("a", 4000)}); err != nil {
		t.Fatal(err)
	}
	if got := len(writeTestRows(conn, "metric_series")); got != 5 {
		t.Fatalf("failed write advanced cache; rows=%d", got)
	}
	if conn.closed != len(conn.queries) {
		t.Fatalf("batch close count=%d prepare=%d", conn.closed, len(conn.queries))
	}
}

func TestMetricRejectsWholeBatchBeforePrepare(t *testing.T) {
	conn := &writeTestConn{}
	store := newMetricStore(&writeTestHost{conn})
	bad := metricPoint("a", 1000)
	bad.Histogram = &utm.Histogram{}
	requireClass(t, store.Write(t.Context(), []utm.MetricPoint{metricPoint("a", 1000), bad}), spi.ErrUnsupported)
	if len(conn.queries) != 0 {
		t.Fatal("prepared batch before validation")
	}
	bad = metricPoint("a", 1000)
	bad.Labels = labels.FromStrings("__name__", "different", "__tenant__", "a")
	requireClass(t, store.Write(t.Context(), []utm.MetricPoint{bad}), spi.ErrBadRequest)
	bad = metricPoint("a", -1)
	requireClass(t, store.Write(t.Context(), []utm.MetricPoint{bad}), spi.ErrBadRequest)
}

func TestMetricUnsupportedContextPrecedence(t *testing.T) {
	store := newMetricStore(&writeTestHost{&writeTestConn{}})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := store.Select(ctx, spi.SeriesQuery{})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestMetricRejectsInvalidUTF8IdentityBeforePrepare(t *testing.T) {
	for _, test := range []struct {
		name   string
		labels utm.Labels
		want   spi.ErrClass
	}{
		{"label name", labels.FromStrings("__name__", "cpu", "__tenant__", "a", "\xff", "x"), spi.ErrBadRequest},
		{"label value", labels.FromStrings("__name__", "cpu", "__tenant__", "a", "a", "x\xffb\xffy"), spi.ErrBadRequest},
		{"oversized invalid value", labels.FromStrings("__name__", "cpu", "__tenant__", "a", "a", strings.Repeat("x", maxBatchBytes)+"\xff"), spi.ErrTooLarge},
	} {
		t.Run(test.name, func(t *testing.T) {
			conn := &writeTestConn{}
			store := newMetricStore(&writeTestHost{conn})
			bad := metricPoint("a", 1000)
			bad.Labels = test.labels
			requireClass(t, store.Write(t.Context(), []utm.MetricPoint{metricPoint("a", 1000), bad}), test.want)
			if len(conn.queries) != 0 {
				t.Fatalf("invalid identity prepared %d batches", len(conn.queries))
			}
		})
	}
}

func TestMetricAcceptsDistinctSpecialUTF8Identities(t *testing.T) {
	conn := &writeTestConn{}
	store := newMetricStore(&writeTestHost{conn})
	first := metricPoint("a", 1000)
	first.Labels = labels.FromStrings("__name__", "cpu", "__tenant__", "a", "a", "xÿbÿy")
	second := metricPoint("a", 2000)
	second.Labels = labels.FromStrings("__name__", "cpu", "__tenant__", "a", "a", "x", "b", "y")
	if err := store.Write(t.Context(), []utm.MetricPoint{first, second}); err != nil {
		t.Fatal(err)
	}
	if got := len(writeTestRows(conn, "metric_series")); got != 2 {
		t.Fatalf("metadata rows=%d, want two distinct identities", got)
	}
}

func TestMetricTTLSourceBoundary(t *testing.T) {
	for _, days := range []int{30, 36500} {
		t.Run(strconv.Itoa(days), func(t *testing.T) {
			conn := &writeTestConn{}
			host := &retentionWriteTestHost{writeTestHost: &writeTestHost{conn}, days: map[spi.Signal]int{spi.SignalMetrics: days}}
			store := newMetricStore(host)
			boundary := ttlSourceBoundary(days)
			unsafe := metricPoint("a", utm.TimeToMilli(boundary))
			requireClass(t, store.Write(t.Context(), []utm.MetricPoint{metricPoint("a", 1000), unsafe}), spi.ErrBadRequest)
			if len(conn.queries) != 0 {
				t.Fatalf("TTL-unsafe metric prepared %d batches", len(conn.queries))
			}
			safe := metricPoint("a", utm.TimeToMilli(boundary.Add(-time.Millisecond)))
			if err := store.Write(t.Context(), []utm.MetricPoint{safe}); err != nil {
				t.Fatal(err)
			}
			if got := len(writeTestRows(conn, "metric_samples")); got != 1 {
				t.Fatalf("safe metric rows=%d", got)
			}
		})
	}
}
