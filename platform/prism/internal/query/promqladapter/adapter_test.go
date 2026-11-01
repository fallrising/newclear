package promqladapter

import (
	"context"
	"errors"
	"math"
	"reflect"
	"sync"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/storage"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

type fakeStore struct {
	data          []spi.SeriesData
	requests      []spi.SeriesQuery
	labelRequests []spi.LabelQuery
	sets          []*recyclingSet
	selectErr     error
	warnings      []string
	closeErr      error
	names, values []string
	onSelect      func(context.Context)
}

func (*fakeStore) Write(context.Context, []utm.MetricPoint) error { return nil }
func (f *fakeStore) Select(ctx context.Context, q spi.SeriesQuery) (spi.SeriesSet, error) {
	if f.onSelect != nil {
		f.onSelect(ctx)
	}
	if f.selectErr != nil {
		return nil, f.selectErr
	}
	f.requests = append(f.requests, q)
	data := []spi.SeriesData{}
	for _, series := range f.data {
		matches := true
		for _, m := range q.Matchers {
			if !m.Matches(series.Labels.Get(m.Name)) {
				matches = false
				break
			}
		}
		if matches {
			data = append(data, series)
		}
	}
	set := &recyclingSet{data: data, index: -1, warnings: f.warnings, closeErr: f.closeErr}
	f.sets = append(f.sets, set)
	return set, nil
}
func (f *fakeStore) LabelNames(_ context.Context, q spi.LabelQuery) ([]string, error) {
	f.labelRequests = append(f.labelRequests, q)
	return f.names, nil
}
func (f *fakeStore) LabelValues(_ context.Context, _ string, q spi.LabelQuery) ([]string, error) {
	f.labelRequests = append(f.labelRequests, q)
	return f.values, nil
}

// recyclingSet deliberately invalidates its current Series and Samples storage
// on every Next and Close, as the SPI lifetime contract permits.
type recyclingSet struct {
	data     []spi.SeriesData
	index    int
	current  recyclingSeries
	closed   int
	warnings []string
	closeErr error
}

func (s *recyclingSet) Next() bool {
	s.current.data = spi.SeriesData{}
	s.index++
	if s.index >= len(s.data) {
		return false
	}
	s.current.data = s.data[s.index]
	return true
}
func (s *recyclingSet) At() spi.Series     { return &s.current }
func (*recyclingSet) Err() error           { return nil }
func (s *recyclingSet) Warnings() []string { return s.warnings }
func (s *recyclingSet) Close() error {
	s.closed++
	s.current.data = spi.SeriesData{}
	return s.closeErr
}

type recyclingSeries struct{ data spi.SeriesData }

func (s *recyclingSeries) Labels() utm.Labels { return s.data.Labels }
func (s *recyclingSeries) Samples() spi.SampleIterator {
	return &recyclingSamples{series: s, index: -1}
}

type recyclingSamples struct {
	series *recyclingSeries
	index  int
}

func (s *recyclingSamples) Next() bool { s.index++; return s.index < len(s.series.data.Samples) }
func (s *recyclingSamples) At() (int64, float64) {
	sample := s.series.data.Samples[s.index]
	return sample.TS, sample.Value
}
func (*recyclingSamples) Err() error { return nil }

func testQuerier(t *testing.T, f *fakeStore, l Limits) storage.Querier {
	t.Helper()
	q, err := New(f, "tenant-a", l).Querier(-20, 100)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := q.Close(); err != nil && f.closeErr == nil {
			t.Error(err)
		}
	})
	return q
}
func matcher(t *testing.T, typ labels.MatchType, name, value string) *labels.Matcher {
	t.Helper()
	m, err := labels.NewMatcher(typ, name, value)
	if err != nil {
		t.Fatal(err)
	}
	return m
}
func sampleData(name string, samples ...spi.Sample) spi.SeriesData {
	return spi.SeriesData{Labels: labels.FromStrings("__name__", name, "__tenant__", "tenant-a", "job", "api"), Samples: samples}
}
func assertClass(t *testing.T, err error, want spi.ErrClass) {
	t.Helper()
	if spi.Classify(err) != want {
		t.Fatalf("class %s, want %s; error %v", spi.Classify(err), want, err)
	}
}

func TestNewRejectsInvalidInputs(t *testing.T) {
	for _, test := range []struct {
		store      spi.MetricStore
		tenant     string
		limits     Limits
		start, end int64
	}{{nil, "a", Limits{}, 0, 10}, {&fakeStore{}, "", Limits{}, 0, 10}, {&fakeStore{}, "a", Limits{}, 10, 0}, {&fakeStore{}, "a", Limits{MaxScanRows: -1}, 0, 10}, {&fakeStore{}, "a", Limits{MaxMatchers: -1}, 0, 10}} {
		_, err := New(test.store, test.tenant, test.limits).Querier(test.start, test.end)
		assertClass(t, err, spi.ErrBadRequest)
	}
}

func TestSelectMappings(t *testing.T) {
	f := &fakeStore{}
	q := testQuerier(t, f, Limits{})
	hints := &storage.SelectHints{Start: -30, End: 200, Step: 7, Func: "rate", Grouping: []string{"job"}, By: true, Range: 15}
	matchers := []*labels.Matcher{matcher(t, labels.MatchEqual, "job", ""), matcher(t, labels.MatchNotEqual, "missing", "x"), matcher(t, labels.MatchRegexp, "job", "api|"), matcher(t, labels.MatchNotRegexp, "env", "test")}
	set := q.Select(t.Context(), true, hints, matchers...)
	if set.Err() != nil {
		t.Fatal(set.Err())
	}
	hints.Grouping[0] = "changed"
	matchers[0].Value = "changed"
	got := f.requests[0]
	if got.Tenant != "tenant-a" || got.Start != -20 || got.End != 100 || got.Hints.Step != 7 || got.Hints.Func != "rate" || got.Hints.Range != 15 || !got.Hints.By || !reflect.DeepEqual(got.Hints.Grouping, []string{"job"}) {
		t.Fatalf("mapping: %+v", got)
	}
	if got.Matchers[0].Value != "" || !got.Matchers[2].Matches("") || got.Matchers[3].Matches("test") {
		t.Fatalf("matcher mapping %+v", got.Matchers)
	}
	if set.Next() || set.Err() != nil {
		t.Fatalf("empty set: %v", set.Err())
	}
}

func TestSelectRejectsUnsafeInputsBeforeBackend(t *testing.T) {
	for _, test := range []struct {
		name     string
		hints    *storage.SelectHints
		matchers []*labels.Matcher
		class    spi.ErrClass
	}{{"tenant", nil, []*labels.Matcher{matcher(t, labels.MatchEqual, "__tenant__", "other")}, spi.ErrBadRequest}, {"nil", nil, []*labels.Matcher{nil}, spi.ErrBadRequest}, {"type", nil, []*labels.Matcher{{Type: 99, Name: "job"}}, spi.ErrBadRequest}, {"name", nil, []*labels.Matcher{{Name: "bad-name"}}, spi.ErrBadRequest}, {"regex", nil, []*labels.Matcher{{Type: labels.MatchRegexp, Name: "job", Value: "["}}, spi.ErrBadRequest}, {"shard", &storage.SelectHints{ShardCount: 1}, nil, spi.ErrUnsupported}, {"trim", &storage.SelectHints{DisableTrimming: true}, nil, spi.ErrUnsupported}, {"range", &storage.SelectHints{Start: 5, End: 4}, nil, spi.ErrBadRequest}, {"step", &storage.SelectHints{Step: -1}, nil, spi.ErrBadRequest}} {
		t.Run(test.name, func(t *testing.T) {
			f := &fakeStore{}
			q := testQuerier(t, f, Limits{})
			set := q.Select(t.Context(), false, test.hints, test.matchers...)
			assertClass(t, set.Err(), test.class)
			if len(f.requests) != 0 {
				t.Fatal("backend accessed")
			}
		})
	}
}

func TestSeriesSurviveRecyclingSeekAndReuse(t *testing.T) {
	stale := math.Float64frombits(0x7ff0000000000002)
	f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: -21, Value: 9}, spi.Sample{TS: -20, Value: math.Inf(-1)}, spi.Sample{TS: 0, Value: stale}, spi.Sample{TS: 100, Value: math.Inf(1)}, spi.Sample{TS: 101, Value: 99}), sampleData("b", spi.Sample{TS: 10, Value: 4})}}
	q := testQuerier(t, f, Limits{})
	set := q.Select(t.Context(), false, nil)
	var retained []storage.Series
	for set.Next() {
		retained = append(retained, set.At())
	}
	if set.Err() != nil {
		t.Fatal(set.Err())
	}
	if len(retained) != 2 {
		t.Fatal(len(retained))
	}
	if retained[0].Labels().Has("__tenant__") {
		t.Fatal("tenant exposed")
	}
	it := retained[0].Iterator(nil)
	if it.Seek(-20) != chunkenc.ValFloat || it.AtT() != -20 {
		t.Fatal("inclusive lower bound")
	}
	if it.Seek(-100) != chunkenc.ValFloat || it.AtT() != -20 {
		t.Fatal("seek moved backward")
	}
	if it.Next() != chunkenc.ValFloat {
		t.Fatal("missing stale")
	}
	_, value := it.At()
	if math.Float64bits(value) != math.Float64bits(stale) {
		t.Fatal("stale bits changed")
	}
	if it.Seek(100) != chunkenc.ValFloat {
		t.Fatal("inclusive upper bound")
	}
	_, value = it.At()
	if !math.IsInf(value, 1) {
		t.Fatal(value)
	}
	if it.Next() != chunkenc.ValNone || it.Err() != nil {
		t.Fatal(it.Err())
	}
	if it.Seek(-20) != chunkenc.ValNone {
		t.Fatal("exhaustion not terminal")
	}
	it = retained[1].Iterator(it)
	if it.Seek(0) != chunkenc.ValFloat || it.AtT() != 10 {
		t.Fatal("reuse did not reset")
	}
	if _, h := it.AtHistogram(nil); h != nil {
		t.Fatal("unexpected histogram")
	}
	if _, h := it.AtFloatHistogram(nil); h != nil {
		t.Fatal("unexpected float histogram")
	}
	if err := q.Close(); err != nil {
		t.Fatal(err)
	}
	if err := q.Close(); err != nil {
		t.Fatal(err)
	}
	for _, set := range f.sets {
		if set.closed != 1 {
			t.Fatalf("closed %d times", set.closed)
		}
	}
}

func TestExactLabelReopenRejectsSupersets(t *testing.T) {
	original := sampleData("a", spi.Sample{TS: 0, Value: 1})
	superset := sampleData("a", spi.Sample{TS: 0, Value: 99})
	superset.Labels = labels.FromStrings("__name__", "a", "__tenant__", "tenant-a", "extra", "x", "job", "api")
	f := &fakeStore{data: []spi.SeriesData{original}}
	q := testQuerier(t, f, Limits{})
	set := q.Select(t.Context(), false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	series := set.At()
	for set.Next() {
	}
	f.data = []spi.SeriesData{superset, original}
	it := series.Iterator(nil)
	if it.Next() != chunkenc.ValFloat {
		t.Fatal(it.Err())
	}
	_, value := it.At()
	if value != 1 {
		t.Fatalf("selected superset value %v", value)
	}
}

func TestBoundsAcrossSelectionsAndReuse(t *testing.T) {
	f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1}, spi.Sample{TS: 1, Value: 2})}}
	q := testQuerier(t, f, Limits{MaxScanRows: 2})
	set := q.Select(t.Context(), false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	series := set.At()
	it := series.Iterator(nil)
	for range 2 {
		if it.Next() != chunkenc.ValFloat {
			t.Fatal(it.Err())
		}
	}
	if it.Next() != chunkenc.ValNone || it.Err() != nil {
		t.Fatal(it.Err())
	}
	set = q.Select(t.Context(), false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	it = set.At().Iterator(it)
	if it.Next() != chunkenc.ValNone {
		t.Fatal("scan cap not shared")
	}
	assertClass(t, it.Err(), spi.ErrTooLarge)
}

func TestResourceBoundaries(t *testing.T) {
	t.Run("sets", func(t *testing.T) {
		f := &fakeStore{}
		q := testQuerier(t, f, Limits{MaxRetainedSets: 1})
		set := q.Select(t.Context(), false, nil)
		assertClass(t, q.Select(t.Context(), false, nil).Err(), spi.ErrTooLarge)
		if set.Next() {
			t.Fatal("empty")
		}
		if err := q.Select(t.Context(), false, nil).Err(); err != nil {
			t.Fatal("released slot not reusable", err)
		}
	})
	t.Run("series", func(t *testing.T) {
		f := &fakeStore{data: []spi.SeriesData{sampleData("a"), sampleData("b")}}
		q := testQuerier(t, f, Limits{MaxSeries: 1})
		set := q.Select(t.Context(), false, nil)
		if !set.Next() {
			t.Fatal(set.Err())
		}
		if set.Next() {
			t.Fatal("series cap")
		}
		assertClass(t, set.Err(), spi.ErrTooLarge)
	})
	t.Run("labels", func(t *testing.T) {
		f := &fakeStore{data: []spi.SeriesData{sampleData("a")}}
		q := testQuerier(t, f, Limits{MaxLabelsPerSeries: 2})
		set := q.Select(t.Context(), false, nil)
		if set.Next() {
			t.Fatal("labels cap")
		}
		assertClass(t, set.Err(), spi.ErrTooLarge)
	})
	t.Run("matchers", func(t *testing.T) {
		f := &fakeStore{}
		q := testQuerier(t, f, Limits{MaxMatchers: 1})
		set := q.Select(t.Context(), false, nil, matcher(t, labels.MatchEqual, "a", "x"), matcher(t, labels.MatchEqual, "b", "x"))
		assertClass(t, set.Err(), spi.ErrTooLarge)
	})
	t.Run("bytes", func(t *testing.T) {
		f := &fakeStore{data: []spi.SeriesData{sampleData("a")}}
		q := testQuerier(t, f, Limits{MaxLabelBytes: 8})
		set := q.Select(t.Context(), false, nil)
		if set.Next() {
			t.Fatal("bytes cap")
		}
		assertClass(t, set.Err(), spi.ErrTooLarge)
	})
}

func TestLabelsTenantAndBounds(t *testing.T) {
	f := &fakeStore{names: []string{"__name__", "__tenant__", "job"}, values: []string{"api"}}
	q := testQuerier(t, f, Limits{})
	names, _, err := q.LabelNames(t.Context())
	if err != nil || !reflect.DeepEqual(names, []string{"__name__", "job"}) {
		t.Fatal(names, err)
	}
	values, _, err := q.LabelValues(t.Context(), "job")
	if err != nil || !reflect.DeepEqual(values, []string{"api"}) {
		t.Fatal(values, err)
	}
	for _, request := range f.labelRequests {
		if request.Tenant != "tenant-a" || request.Start != -20 || request.End != 100 {
			t.Fatal(request)
		}
	}
	_, _, err = q.LabelValues(t.Context(), "__tenant__")
	assertClass(t, err, spi.ErrBadRequest)
	f.names = []string{"a", "b"}
	limited := testQuerier(t, f, Limits{MaxLabelResults: 1})
	_, _, err = limited.LabelNames(t.Context())
	assertClass(t, err, spi.ErrTooLarge)
}

func TestWarningsAndStorageErrors(t *testing.T) {
	underlying := errors.New("store unavailable")
	f := &fakeStore{selectErr: spi.Wrap(spi.ErrUnavailable, "fake", "select", underlying)}
	q := testQuerier(t, f, Limits{})
	err := q.Select(t.Context(), false, nil).Err()
	assertClass(t, err, spi.ErrUnavailable)
	if !errors.Is(err, underlying) {
		t.Fatal("cause lost")
	}
	f.selectErr = nil
	f.warnings = []string{"warning", "warning"}
	set := q.Select(t.Context(), false, nil)
	if set.Next() {
		t.Fatal("empty")
	}
	if len(set.Warnings()) != 1 {
		t.Fatal(set.Warnings())
	}
	f.warnings = []string{"a", "b"}
	bounded := testQuerier(t, f, Limits{MaxLabelResults: 1})
	set = bounded.Select(t.Context(), false, nil)
	if set.Next() {
		t.Fatal("empty")
	}
	assertClass(t, set.Err(), spi.ErrTooLarge)
}

func TestCancellationAndConcurrentClose(t *testing.T) {
	f := &fakeStore{}
	q := testQuerier(t, f, Limits{})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if !errors.Is(q.Select(ctx, false, nil).Err(), context.Canceled) {
		t.Fatal("cancellation lost")
	}
	entered := make(chan struct{})
	f.onSelect = func(ctx context.Context) { close(entered); <-ctx.Done() }
	var wg sync.WaitGroup
	wg.Go(func() {
		set := q.Select(t.Context(), false, nil)
		if !errors.Is(set.Err(), context.Canceled) {
			t.Error("blocked select not canceled", set.Err())
		}
	})
	<-entered
	wg.Go(func() {
		if err := q.Close(); err != nil {
			t.Error(err)
		}
	})
	wg.Go(func() {
		if err := q.Close(); err != nil {
			t.Error(err)
		}
	})
	wg.Wait()
	for _, set := range f.sets {
		if set.closed != 1 {
			t.Fatal("close ownership", set.closed)
		}
	}
}

func TestClosePreservesErrors(t *testing.T) {
	cause := errors.New("close failed")
	f := &fakeStore{closeErr: spi.Wrap(spi.ErrUnavailable, "fake", "close", cause)}
	q := testQuerier(t, f, Limits{})
	q.Select(t.Context(), false, nil)
	if err := q.Close(); !errors.Is(err, cause) {
		t.Fatal(err)
	}
	if err := q.Close(); !errors.Is(err, cause) {
		t.Fatal(err)
	}
}

func TestEmptySelectAttemptsBounded(t *testing.T) {
	f := &fakeStore{}
	q := testQuerier(t, f, Limits{MaxSeries: 1})
	set := q.Select(t.Context(), false, nil)
	if set.Next() {
		t.Fatal("empty set")
	}
	assertClass(t, q.Select(t.Context(), false, nil).Err(), spi.ErrTooLarge)
}

func TestHiddenLabelsDoNotConsumeVisibleResultLimit(t *testing.T) {
	f := &fakeStore{names: []string{"__tenant__", "job"}}
	q := testQuerier(t, f, Limits{MaxLabelResults: 1})
	names, _, err := q.LabelNames(t.Context())
	if err != nil || !reflect.DeepEqual(names, []string{"job"}) {
		t.Fatal(names, err)
	}
}

func TestIteratorReuseReportsCloseFailure(t *testing.T) {
	cause := errors.New("iterator close failed")
	f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1})}, closeErr: spi.Wrap(spi.ErrUnavailable, "fake", "close", cause)}
	q := testQuerier(t, f, Limits{})
	set := q.Select(t.Context(), false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	series := set.At()
	it := series.Iterator(nil)
	it = series.Iterator(it)
	if !errors.Is(it.Err(), cause) {
		t.Fatal("reuse lost close error", it.Err())
	}
}

func TestReopenedWarningsAreReported(t *testing.T) {
	f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1})}}
	q := testQuerier(t, f, Limits{})
	set := q.Select(t.Context(), false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	series := set.At()
	f.warnings = []string{"reopened backend degraded"}
	it := series.Iterator(nil)
	if it.Err() == nil {
		t.Fatal("reopened warnings lost")
	}
}

func TestConstructorOverflowAndMetadata(t *testing.T) {
	maxInt := int(^uint(0) >> 1)
	for _, limits := range []Limits{{MaxLabelResults: maxInt}, {MaxLabelsPerSeries: maxInt}, {MaxMetadataBytes: -1}, {MaxLabelBytes: 1}} {
		_, err := New(&fakeStore{}, "tenant-a", limits).Querier(0, 1)
		assertClass(t, err, spi.ErrBadRequest)
	}
	f := &fakeStore{}
	q := testQuerier(t, f, Limits{MaxMetadataBytes: 264})
	set := q.Select(t.Context(), false, nil)
	if set.Next() {
		t.Fatal("empty")
	}
	assertClass(t, q.Select(t.Context(), false, nil).Err(), spi.ErrTooLarge)
}

func TestLongRegexpAndHintsBounded(t *testing.T) {
	f := &fakeStore{}
	q := testQuerier(t, f, Limits{MaxRegexBytes: 1, MaxMatchers: 1})
	assertClass(t, q.Select(t.Context(), false, nil, matcher(t, labels.MatchRegexp, "job", "api")).Err(), spi.ErrTooLarge)
	assertClass(t, q.Select(t.Context(), false, &storage.SelectHints{Grouping: []string{"job", "instance"}}).Err(), spi.ErrTooLarge)
	assertClass(t, q.Select(t.Context(), false, &storage.SelectHints{Grouping: []string{"__tenant__"}}).Err(), spi.ErrBadRequest)
	if len(f.requests) != 0 {
		t.Fatal("backend accessed")
	}
}

func TestCanceledSamplesAndSeekAfterClose(t *testing.T) {
	f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1}, spi.Sample{TS: 1, Value: 2})}}
	q := testQuerier(t, f, Limits{})
	ctx, cancel := context.WithCancel(t.Context())
	set := q.Select(ctx, false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	it := set.At().Iterator(nil)
	if it.Next() != chunkenc.ValFloat {
		t.Fatal(it.Err())
	}
	cancel()
	if it.Seek(0) != chunkenc.ValNone || !errors.Is(it.Err(), context.Canceled) {
		t.Fatal("seek ignored cancellation", it.Err())
	}
}

func TestInitialWarningsRemainSuccessfulOnReopen(t *testing.T) {
	f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1})}, warnings: []string{"backend note"}}
	q := testQuerier(t, f, Limits{})
	set := q.Select(t.Context(), false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	series := set.At()
	if len(set.Warnings()) != 1 {
		t.Fatal("initial warning missing")
	}
	it := series.Iterator(nil)
	if it.Next() != chunkenc.ValFloat {
		t.Fatal(it.Err())
	}
	if it.Next() != chunkenc.ValNone || it.Err() != nil {
		t.Fatal(it.Err())
	}
}

func TestExhaustedSeekKeepsCleanError(t *testing.T) {
	for _, seekPastEnd := range []bool{false, true} {
		f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1})}}
		q := testQuerier(t, f, Limits{})
		set := q.Select(t.Context(), false, nil)
		if !set.Next() {
			t.Fatal(set.Err())
		}
		it := set.At().Iterator(nil)
		if seekPastEnd {
			if it.Seek(101) != chunkenc.ValNone {
				t.Fatal("past end")
			}
		} else {
			for it.Next() != chunkenc.ValNone {
			}
		}
		if it.Err() != nil {
			t.Fatal(it.Err())
		}
		for _, target := range []int64{-20, 101} {
			if it.Seek(target) != chunkenc.ValNone || it.Err() != nil {
				t.Fatal("terminal seek changed error", it.Err())
			}
		}
	}
}

func TestCancellationHasSPIErrorShape(t *testing.T) {
	f := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1})}}
	q := testQuerier(t, f, Limits{})
	ctx, cancel := context.WithCancel(t.Context())
	set := q.Select(ctx, false, nil)
	if !set.Next() {
		t.Fatal(set.Err())
	}
	it := set.At().Iterator(nil)
	cancel()
	if it.Next() != chunkenc.ValNone {
		t.Fatal("canceled sample returned")
	}
	err := it.Err()
	classified, ok := errors.AsType[*spi.Error](err)
	if !ok || classified.Class != spi.ErrTimeout || !errors.Is(err, context.Canceled) {
		t.Fatal("unclassified cancellation", err)
	}
}

type lateWarningStore struct {
	*fakeStore
	calls int
}
type lateWarningSet struct {
	spi.SeriesSet
	terminal, late bool
}

func (s *lateWarningSet) Next() bool {
	next := s.SeriesSet.Next()
	if !next {
		s.terminal = true
	}
	return next
}
func (s *lateWarningSet) Warnings() []string {
	if s.late && !s.terminal {
		return nil
	}
	return []string{"known final warning"}
}
func (s *lateWarningStore) Select(ctx context.Context, q spi.SeriesQuery) (spi.SeriesSet, error) {
	s.calls++
	set, err := s.fakeStore.Select(ctx, q)
	if err != nil {
		return set, err
	}
	return &lateWarningSet{SeriesSet: set, late: s.calls == 1}, nil
}

func TestFinalEnumerationWarningsRemainKnownOnReopen(t *testing.T) {
	store := &lateWarningStore{fakeStore: &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1})}}}
	q, err := New(store, "tenant-a", Limits{}).Querier(-20, 100)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := q.Close(); err != nil {
			t.Error(err)
		}
	})
	set := q.Select(t.Context(), false, nil)
	var series storage.Series
	for set.Next() {
		series = set.At()
	}
	if set.Err() != nil {
		t.Fatal(set.Err())
	}
	if len(set.Warnings()) != 1 {
		t.Fatal("missing final warning")
	}
	it := series.Iterator(nil)
	if it.Next() != chunkenc.ValFloat {
		t.Fatalf("already surfaced EOF warning rejected: %v", it.Err())
	}
	if it.Next() != chunkenc.ValNone || it.Err() != nil {
		t.Fatal(it.Err())
	}
}

type warningSequenceStore struct {
	*fakeStore
	calls    int
	sequence [][]string
	reopened []string
}
type warningSequenceSet struct {
	spi.SeriesSet
	step     int
	sequence [][]string
}

func (s *warningSequenceSet) Next() bool { next := s.SeriesSet.Next(); s.step++; return next }
func (s *warningSequenceSet) Warnings() []string {
	return s.sequence[min(max(s.step-1, 0), len(s.sequence)-1)]
}
func (s *warningSequenceStore) Select(ctx context.Context, q spi.SeriesQuery) (spi.SeriesSet, error) {
	s.calls++
	set, err := s.fakeStore.Select(ctx, q)
	if err != nil {
		return set, err
	}
	sequence := s.sequence
	if s.calls > 1 {
		sequence = [][]string{s.reopened}
	}
	return &warningSequenceSet{SeriesSet: set, sequence: sequence}, nil
}

func TestWarningsAccumulateAcrossNonCumulativeBackendLists(t *testing.T) {
	store := &warningSequenceStore{fakeStore: &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: 0, Value: 1}), sampleData("b", spi.Sample{TS: 0, Value: 2})}}, sequence: [][]string{{"first"}, {"second"}, {"final"}}, reopened: []string{"first", "second", "final"}}
	q, err := New(store, "tenant-a", Limits{}).Querier(-20, 100)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := q.Close(); err != nil {
			t.Error(err)
		}
	})
	set := q.Select(t.Context(), false, nil)
	var retained []storage.Series
	for set.Next() {
		retained = append(retained, set.At())
	}
	if set.Err() != nil {
		t.Fatal(set.Err())
	}
	warnings := set.Warnings()
	if len(warnings) != 3 {
		t.Fatal("warnings not accumulated", warnings)
	}
	delete(warnings, "first")
	for _, series := range retained {
		it := series.Iterator(nil)
		if it.Next() != chunkenc.ValFloat {
			t.Fatal("cumulative warning rejected", it.Err())
		}
		for it.Next() != chunkenc.ValNone {
		}
		if it.Err() != nil {
			t.Fatal(it.Err())
		}
	}
	store.reopened = []string{"genuinely new"}
	it := retained[0].Iterator(nil)
	assertClass(t, it.Err(), spi.ErrUnsupported)
}

func TestWarningMetadataLimitsAndDeduplication(t *testing.T) {
	t.Run("same text charged once", func(t *testing.T) {
		store := &fakeStore{data: []spi.SeriesData{sampleData("a")}, warnings: []string{"note"}}
		q := testQuerier(t, store, Limits{MaxMetadataBytes: 800})
		set := q.Select(t.Context(), false, nil)
		if !set.Next() {
			t.Fatal(set.Err())
		}
		if set.Next() || set.Err() != nil {
			t.Fatal("duplicate warning exhausted metadata", set.Err())
		}
		if len(set.Warnings()) != 1 {
			t.Fatal("missing warning")
		}
	})
	t.Run("warning copy budget", func(t *testing.T) {
		store := &fakeStore{data: []spi.SeriesData{sampleData("a")}, warnings: []string{"note"}}
		q := testQuerier(t, store, Limits{MaxMetadataBytes: 700})
		set := q.Select(t.Context(), false, nil)
		if set.Next() {
			t.Fatal("warning exceeded metadata budget")
		}
		assertClass(t, set.Err(), spi.ErrTooLarge)
	})
	t.Run("cumulative cardinality", func(t *testing.T) {
		store := &warningSequenceStore{fakeStore: &fakeStore{data: []spi.SeriesData{sampleData("a"), sampleData("b")}}, sequence: [][]string{{"first"}, {"second"}, {"final"}}}
		q, err := New(store, "tenant-a", Limits{MaxLabelResults: 1}).Querier(-20, 100)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := q.Close(); err != nil {
				t.Error(err)
			}
		})
		set := q.Select(t.Context(), false, nil)
		if !set.Next() {
			t.Fatal(set.Err())
		}
		if set.Next() {
			t.Fatal("cumulative warnings exceeded cap")
		}
		assertClass(t, set.Err(), spi.ErrTooLarge)
	})
}
