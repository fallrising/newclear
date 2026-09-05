package conformance

import (
	"cmp"
	"context"
	"math"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

// RunMetrics executes the C-MET conformance tests.
func RunMetrics(t *testing.T, f Factory, opts Options) {
	t.Helper()
	validateOptions(t, opts)

	t.Run("C-MET-01 write and select round trip", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		points := NewFixtures().Metrics(2, 3, 1_000, time.Second)
		writeMetrics(t, store, points, opts)
		series := selectMetrics(t, store, spi.SeriesQuery{
			Tenant: fixtureTenant, Matchers: []spi.Matcher{newMatcher(t, spi.MatchEqual, utm.LabelName, "fixture_metric")},
			Start: 1_000, End: 3_000,
		})
		want := metricSeries(points)
		if !reflect.DeepEqual(series, want) {
			t.Fatalf("Select() = %#v, want %#v", series, want)
		}
	})

	t.Run("C-MET-02 series are label sorted", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		writeMetrics(t, store, NewFixtures().Metrics(8, 1, 1_000, time.Second), opts)
		series := selectMetrics(t, store, fixtureSeriesQuery(0, 2_000))
		for i := 1; i < len(series); i++ {
			if compareLabels(series[i-1].Labels, series[i].Labels) >= 0 {
				t.Fatalf("series %d labels %v are not before %v", i, series[i-1].Labels, series[i].Labels)
			}
		}
	})

	t.Run("C-MET-03 samples are strictly time sorted", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		points := NewFixtures().Metrics(1, 4, 1_000, time.Second)
		points[0], points[3] = points[3], points[0]
		writeMetrics(t, store, points, opts)
		series := selectMetrics(t, store, fixtureSeriesQuery(0, 5_000))
		if len(series) != 1 {
			t.Fatalf("Select() returned %d series, want 1", len(series))
		}
		assertSamplesStrict(t, series[0].Samples)
	})

	t.Run("C-MET-04 time range is inclusive", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		writeMetrics(t, store, NewFixtures().Metrics(1, 3, 1_000, time.Second), opts)
		series := selectMetrics(t, store, fixtureSeriesQuery(1_000, 3_000))
		if len(series) != 1 || len(series[0].Samples) != 3 || series[0].Samples[0].TS != 1_000 || series[0].Samples[2].TS != 3_000 {
			t.Fatalf("inclusive Select() = %#v", series)
		}
	})

	t.Run("C-MET-05 all matcher types including empty values", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		points := []utm.MetricPoint{
			{Labels: labels.FromStrings(utm.LabelName, "fixture_match", utm.LabelTenant, fixtureTenant, "foo", "alpha"), TS: 1, Value: 1},
			{Labels: labels.FromStrings(utm.LabelName, "fixture_match", utm.LabelTenant, fixtureTenant, "foo", "beta"), TS: 1, Value: 2},
			{Labels: labels.FromStrings(utm.LabelName, "fixture_match", utm.LabelTenant, fixtureTenant), TS: 1, Value: 3},
		}
		writeMetrics(t, store, points, opts)
		tests := []struct {
			name      string
			matchType spi.MatchType
			value     string
			want      int
		}{
			{name: "equal", matchType: spi.MatchEqual, value: "alpha", want: 1},
			{name: "not equal", matchType: spi.MatchNotEqual, value: "beta", want: 2},
			{name: "regexp", matchType: spi.MatchRegexp, value: "alpha|beta", want: 2},
			{name: "not regexp", matchType: spi.MatchNotRegexp, value: "beta", want: 2},
			{name: "empty matches missing", matchType: spi.MatchEqual, value: "", want: 1},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				matchers := []spi.Matcher{
					newMatcher(t, spi.MatchEqual, utm.LabelName, "fixture_match"),
					newMatcher(t, test.matchType, "foo", test.value),
				}
				if got := len(selectMetrics(t, store, spi.SeriesQuery{Tenant: fixtureTenant, Matchers: matchers, Start: 0, End: 2})); got != test.want {
					t.Fatalf("Select() returned %d series, want %d", got, test.want)
				}
			})
		}
	})

	t.Run("C-MET-06 labels respect matchers and time", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		points := []utm.MetricPoint{
			{Labels: labels.FromStrings(utm.LabelName, "fixture_labels", utm.LabelTenant, fixtureTenant, "region", "eu", "zone", "a"), TS: 10, Value: 1},
			{Labels: labels.FromStrings(utm.LabelName, "fixture_labels", utm.LabelTenant, fixtureTenant, "region", "apac", "zone", "b"), TS: 10, Value: 2},
			{Labels: labels.FromStrings(utm.LabelName, "fixture_labels", utm.LabelTenant, fixtureTenant, "region", "eu", "zone", "c"), TS: 10, Value: 3},
			{Labels: labels.FromStrings(utm.LabelName, "fixture_labels", utm.LabelTenant, fixtureTenant, "outside", "true", "region", "us"), TS: 20, Value: 4},
		}
		writeMetrics(t, store, points, opts)
		query := spi.LabelQuery{
			Tenant: fixtureTenant, Matchers: []spi.Matcher{newMatcher(t, spi.MatchEqual, utm.LabelName, "fixture_labels")},
			Start: 10, End: 10,
		}
		names, err := store.LabelNames(context.Background(), query)
		if err != nil {
			t.Fatalf("LabelNames() error = %v", err)
		}
		if want := []string{"region", "zone"}; !reflect.DeepEqual(names, want) {
			t.Fatalf("LabelNames() = %v, want %v", names, want)
		}
		values, err := store.LabelValues(context.Background(), "region", query)
		if err != nil {
			t.Fatalf("LabelValues() error = %v", err)
		}
		if want := []string{"apac", "eu"}; !reflect.DeepEqual(values, want) {
			t.Fatalf("LabelValues() = %v, want %v", values, want)
		}
	})

	t.Run("C-MET-07 duplicate timestamp is deduplicated", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		seriesLabels := labels.FromStrings(utm.LabelName, "fixture_duplicate", utm.LabelTenant, fixtureTenant)
		writeMetrics(t, store, []utm.MetricPoint{
			{Labels: seriesLabels, TS: 10, Value: 1},
			{Labels: seriesLabels, TS: 10, Value: 2},
		}, opts)
		series := selectMetrics(t, store, spi.SeriesQuery{
			Tenant: fixtureTenant, Matchers: []spi.Matcher{newMatcher(t, spi.MatchEqual, utm.LabelName, "fixture_duplicate")}, Start: 10, End: 10,
		})
		if len(series) != 1 || len(series[0].Samples) != 1 {
			t.Fatalf("duplicate Select() = %#v", series)
		}
	})

	t.Run("C-MET-08 out of order behavior matches capability", func(t *testing.T) {
		skipDeviation(t, opts, "C-MET-08")
		backend, store := openMetricStore(t, f, opts)
		window := backend.Capabilities().OutOfOrderWindow
		if window == 0 {
			assertOutOfOrderRejected(t, store, opts, "fixture_ooo_disabled", 20, 10)
			return
		}

		latest, older := int64(20), int64(10)
		if window > 0 {
			windowMillis := utm.NanoToMilli(int64(window))
			if windowMillis == 0 {
				t.Fatalf("positive OutOfOrderWindow %v is smaller than metric timestamp precision", window)
			}
			latest = windowMillis + 10_000
			older = latest - max(int64(1), windowMillis/2)
		}
		seriesLabels := labels.FromStrings(utm.LabelName, "fixture_ooo_accepted", utm.LabelTenant, fixtureTenant)
		if err := store.Write(context.Background(), []utm.MetricPoint{{Labels: seriesLabels, TS: latest, Value: 2}}); err != nil {
			t.Fatalf("initial Write() error = %v", err)
		}
		waitForVisibility(opts)
		if err := store.Write(context.Background(), []utm.MetricPoint{{Labels: seriesLabels, TS: older, Value: 1}}); err != nil {
			t.Fatalf("Write() rejected point inside declared out-of-order window %v: %v", window, err)
		}
		waitForVisibility(opts)
		series := selectMetrics(t, store, spi.SeriesQuery{
			Tenant: fixtureTenant, Matchers: []spi.Matcher{newMatcher(t, spi.MatchEqual, utm.LabelName, "fixture_ooo_accepted")},
			Start: older, End: latest,
		})
		if len(series) != 1 || len(series[0].Samples) != 2 {
			t.Fatalf("out-of-order Select() = %#v", series)
		}
		assertSamplesStrict(t, series[0].Samples)

		if window > 0 {
			windowMillis := utm.NanoToMilli(int64(window))
			assertOutOfOrderRejected(t, store, opts, "fixture_ooo_outside", latest, latest-windowMillis-1)
		}
	})

	t.Run("C-MET-09 special float values are preserved", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		seriesLabels := labels.FromStrings(utm.LabelName, "fixture_special", utm.LabelTenant, fixtureTenant)
		writeMetrics(t, store, []utm.MetricPoint{
			{Labels: seriesLabels, TS: 1, Value: math.NaN()},
			{Labels: seriesLabels, TS: 2, Value: math.Inf(1)},
			{Labels: seriesLabels, TS: 3, Value: math.Inf(-1)},
		}, opts)
		series := selectMetrics(t, store, spi.SeriesQuery{
			Tenant: fixtureTenant, Matchers: []spi.Matcher{newMatcher(t, spi.MatchEqual, utm.LabelName, "fixture_special")}, Start: 1, End: 3,
		})
		if len(series) != 1 || len(series[0].Samples) != 3 || !math.IsNaN(series[0].Samples[0].Value) ||
			!math.IsInf(series[0].Samples[1].Value, 1) || !math.IsInf(series[0].Samples[2].Value, -1) {
			t.Fatalf("special values = %#v", series)
		}
	})

	t.Run("C-MET-10 empty result is non-nil", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		set, err := store.Select(context.Background(), spi.SeriesQuery{
			Tenant: fixtureTenant, Matchers: []spi.Matcher{newMatcher(t, spi.MatchEqual, utm.LabelName, "missing")}, Start: 0, End: 1,
		})
		if err != nil || set == nil {
			t.Fatalf("Select() = %v, %v; want non-nil empty set", set, err)
		}
		defer func() { _ = set.Close() }()
		if set.Next() || set.Err() != nil {
			t.Fatalf("empty SeriesSet has unexpected state: err=%v", set.Err())
		}
	})

	t.Run("C-MET-11 high cardinality series remain queryable", func(t *testing.T) {
		_, store := openMetricStore(t, f, opts)
		writeMetrics(t, store, NewFixtures().HighCardinality(10_000, 1_000), opts)
		series := selectMetrics(t, store, fixtureSeriesQuery(1_000, 1_000))
		if len(series) != 10_000 {
			t.Fatalf("Select() returned %d high-cardinality series, want 10000", len(series))
		}
	})

	t.Run("C-MET-12 native PromQL matches tier one data", func(t *testing.T) {
		backend, store := openMetricStore(t, f, opts)
		if !backend.Capabilities().Metrics.NativePromQL {
			t.Skip("driver does not declare NativePromQL")
		}
		native, ok := store.(spi.NativeMetricQuerier)
		if !ok {
			t.Fatal("NativePromQL is true but NativeMetricQuerier is missing")
		}
		points := NewFixtures().Metrics(2, 3, 1_000, time.Second)
		writeMetrics(t, store, points, opts)
		want := selectMetrics(t, store, fixtureSeriesQuery(1_000, 3_000))
		got, err := native.QueryRange(
			context.Background(), fixtureTenant, "fixture_metric", utm.MilliToTime(1_000), utm.MilliToTime(3_000), time.Second, time.Second,
		)
		if err != nil {
			t.Fatalf("QueryRange() error = %v", err)
		}
		if got == nil || !reflect.DeepEqual(got.Matrix, want) {
			t.Fatalf("QueryRange().Matrix = %#v, want %#v", got, want)
		}
	})
}

func openMetricStore(t *testing.T, factory Factory, opts Options) (spi.Backend, spi.MetricStore) {
	t.Helper()
	backend := openBackend(t, factory)
	requireSignal(t, backend, opts, spi.SignalMetrics)
	store := backend.Metrics()
	if store == nil {
		t.Fatal("metrics signal declared with nil MetricStore")
	}
	return backend, store
}

func writeMetrics(t *testing.T, store spi.MetricStore, points []utm.MetricPoint, opts Options) {
	t.Helper()
	if err := store.Write(context.Background(), points); err != nil {
		t.Fatalf("MetricStore.Write() error = %v", err)
	}
	waitForVisibility(opts)
}

func selectMetrics(t *testing.T, store spi.MetricStore, query spi.SeriesQuery) []spi.SeriesData {
	t.Helper()
	set, err := store.Select(context.Background(), query)
	if err != nil {
		t.Fatalf("MetricStore.Select() error = %v", err)
	}
	if set == nil {
		t.Fatal("MetricStore.Select() returned a nil SeriesSet")
	}
	defer func() {
		if err := set.Close(); err != nil {
			t.Errorf("SeriesSet.Close() error = %v", err)
		}
	}()

	var result []spi.SeriesData
	for set.Next() {
		series := set.At()
		data := spi.SeriesData{Labels: series.Labels()}
		iterator := series.Samples()
		for iterator.Next() {
			ts, value := iterator.At()
			data.Samples = append(data.Samples, spi.Sample{TS: ts, Value: value})
		}
		if err := iterator.Err(); err != nil {
			t.Fatalf("SampleIterator.Err() = %v", err)
		}
		result = append(result, data)
	}
	if err := set.Err(); err != nil {
		t.Fatalf("SeriesSet.Err() = %v", err)
	}
	return result
}

func fixtureSeriesQuery(start, end int64) spi.SeriesQuery {
	matcher, err := spi.NewMatcher(spi.MatchEqual, utm.LabelName, "fixture_metric")
	if err != nil {
		panic(err)
	}
	return spi.SeriesQuery{Tenant: fixtureTenant, Matchers: []spi.Matcher{matcher}, Start: start, End: end}
}

func newMatcher(t *testing.T, matchType spi.MatchType, name, value string) spi.Matcher {
	t.Helper()
	matcher, err := spi.NewMatcher(matchType, name, value)
	if err != nil {
		t.Fatalf("NewMatcher() error = %v", err)
	}
	return matcher
}

func assertSamplesStrict(t *testing.T, samples []spi.Sample) {
	t.Helper()
	for i := 1; i < len(samples); i++ {
		if samples[i].TS <= samples[i-1].TS {
			t.Fatalf("sample timestamp %d is not greater than %d", samples[i].TS, samples[i-1].TS)
		}
	}
}

func assertOutOfOrderRejected(t *testing.T, store spi.MetricStore, opts Options, metric string, latest, older int64) {
	t.Helper()
	seriesLabels := labels.FromStrings(utm.LabelName, metric, utm.LabelTenant, fixtureTenant)
	if err := store.Write(context.Background(), []utm.MetricPoint{{Labels: seriesLabels, TS: latest, Value: 2}}); err != nil {
		t.Fatalf("initial Write() error = %v", err)
	}
	waitForVisibility(opts)
	if err := store.Write(context.Background(), []utm.MetricPoint{{Labels: seriesLabels, TS: older, Value: 1}}); err == nil {
		t.Fatalf("Write() accepted point outside declared out-of-order window")
	}
}

func compareLabels(a, b utm.Labels) int {
	for i := range min(len(a), len(b)) {
		if order := cmp.Compare(a[i].Name, b[i].Name); order != 0 {
			return order
		}
		if order := cmp.Compare(a[i].Value, b[i].Value); order != 0 {
			return order
		}
	}
	return cmp.Compare(len(a), len(b))
}

func metricSeries(points []utm.MetricPoint) []spi.SeriesData {
	byLabels := make(map[string]*spi.SeriesData)
	for _, point := range points {
		key := point.Labels.String()
		series := byLabels[key]
		if series == nil {
			series = &spi.SeriesData{Labels: slices.Clone(point.Labels)}
			byLabels[key] = series
		}
		series.Samples = append(series.Samples, spi.Sample{TS: point.TS, Value: point.Value})
	}
	result := make([]spi.SeriesData, 0, len(byLabels))
	for _, series := range byLabels {
		slices.SortFunc(series.Samples, func(a, b spi.Sample) int { return cmp.Compare(a.TS, b.TS) })
		result = append(result, *series)
	}
	slices.SortFunc(result, func(a, b spi.SeriesData) int { return compareLabels(a.Labels, b.Labels) })
	return result
}
