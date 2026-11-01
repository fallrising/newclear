package eval

import (
	"context"
	"slices"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/histogram"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/storage"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
	"github.com/prometheus/prometheus/util/annotations"
)

const maxSelectSeries = 100_000

// storeQueryable reads the metric store for one tenant. An empty tenant is the
// file-rule tenant; series then have no __tenant__ label.
type storeQueryable struct {
	store  spi.MetricStore
	tenant string
}

func (q storeQueryable) Querier(mint, maxt int64) (storage.Querier, error) {
	if q.store == nil || mint > maxt {
		return nil, errSeries("invalid querier range")
	}
	return &storeQuerier{store: q.store, tenant: q.tenant, mint: mint, maxt: maxt}, nil
}

type storeQuerier struct {
	store      spi.MetricStore
	tenant     string
	mint, maxt int64
}

func (q *storeQuerier) LabelValues(context.Context, string, ...*labels.Matcher) ([]string, annotations.Annotations, error) {
	return nil, nil, nil
}

func (q *storeQuerier) LabelNames(context.Context, ...*labels.Matcher) ([]string, annotations.Annotations, error) {
	return nil, nil, nil
}

func (q *storeQuerier) Close() error { return nil }

func (q *storeQuerier) Select(ctx context.Context, _ bool, _ *storage.SelectHints, matchers ...*labels.Matcher) storage.SeriesSet {
	if err := ctx.Err(); err != nil {
		return storage.ErrSeriesSet(err)
	}
	set, err := q.store.Select(ctx, spi.SeriesQuery{Tenant: q.tenant, Start: q.mint, End: q.maxt})
	if err != nil {
		return storage.ErrSeriesSet(err)
	}
	defer func() { _ = set.Close() }()
	var series []storage.Series
	for set.Next() {
		item := set.At()
		view := withoutTenant(item.Labels())
		if !matchAll(view, matchers) {
			continue
		}
		ts, vs, err := sampleColumns(item.Samples())
		if err != nil {
			return storage.ErrSeriesSet(err)
		}
		if len(ts) == 0 {
			continue
		}
		series = append(series, floatSeries{labels: view, ts: ts, vs: vs})
		if len(series) > maxSelectSeries {
			return &seriesSet{err: errSeries("select series limit exceeded")}
		}
	}
	if err := set.Err(); err != nil {
		return storage.ErrSeriesSet(err)
	}
	slices.SortFunc(series, func(a, b storage.Series) int {
		return labels.Compare(a.Labels(), b.Labels())
	})
	return &seriesSet{list: series, i: -1}
}

func withoutTenant(ls labels.Labels) labels.Labels {
	if !ls.Has(utm.LabelTenant) {
		return ls
	}
	b := labels.NewBuilder(ls)
	b.Del(utm.LabelTenant)
	return b.Labels()
}

func matchAll(ls labels.Labels, matchers []*labels.Matcher) bool {
	for _, m := range matchers {
		if m == nil || !m.Matches(ls.Get(m.Name)) {
			return false
		}
	}
	return true
}

func sampleColumns(samples spi.SampleIterator) ([]int64, []float64, error) {
	if samples == nil {
		return nil, nil, nil
	}
	var ts []int64
	var vs []float64
	for samples.Next() {
		t, v := samples.At()
		ts = append(ts, t)
		vs = append(vs, v)
		if len(ts) > maxSelectSeries {
			return nil, nil, errSeries("select series limit exceeded")
		}
	}
	if err := samples.Err(); err != nil {
		return nil, nil, err
	}
	return ts, vs, nil
}

type floatSeries struct {
	labels labels.Labels
	ts     []int64
	vs     []float64
}

func (s floatSeries) Labels() labels.Labels { return s.labels }

func (s floatSeries) Iterator(chunkenc.Iterator) chunkenc.Iterator {
	return &floatIterator{ts: s.ts, vs: s.vs, i: -1}
}

// millisecondTimestamp is the Prometheus sample timestamp. The alias stays
// int64, and its name keeps go vet from treating Seek as io.Seeker.
type millisecondTimestamp = int64

// floatIterator is a chunkenc.Iterator over one float series.
// chunkenc.MockSeriesIterator is not usable here: Seek always returns ValNone,
// and Next skips the first sample, so a one-point ALERTS series disappears.
type floatIterator struct {
	ts []int64
	vs []float64
	i  int
}

func (it *floatIterator) Next() chunkenc.ValueType {
	if it.i+1 >= len(it.ts) {
		return chunkenc.ValNone
	}
	it.i++
	return chunkenc.ValFloat
}

func (it *floatIterator) Seek(t millisecondTimestamp) chunkenc.ValueType {
	if it.i >= 0 && it.i < len(it.ts) && it.ts[it.i] >= t {
		return chunkenc.ValFloat
	}
	for it.Next() != chunkenc.ValNone {
		if it.ts[it.i] >= t {
			return chunkenc.ValFloat
		}
	}
	return chunkenc.ValNone
}

func (it *floatIterator) At() (int64, float64) { return it.ts[it.i], it.vs[it.i] }

func (it *floatIterator) AtT() int64 { return it.ts[it.i] }

func (it *floatIterator) AtHistogram(*histogram.Histogram) (int64, *histogram.Histogram) {
	return it.AtT(), nil
}

func (it *floatIterator) AtFloatHistogram(*histogram.FloatHistogram) (int64, *histogram.FloatHistogram) {
	return it.AtT(), nil
}

func (it *floatIterator) Err() error { return nil }

type seriesSet struct {
	list []storage.Series
	i    int
	err  error
}

func (s *seriesSet) Next() bool {
	if s.err != nil {
		return false
	}
	s.i++
	return s.i < len(s.list)
}

func (s *seriesSet) At() storage.Series { return s.list[s.i] }

func (s *seriesSet) Err() error { return s.err }

func (s *seriesSet) Warnings() annotations.Annotations { return nil }

type queryError struct{ msg string }

func errSeries(msg string) error { return queryError{msg: msg} }

func (e queryError) Error() string { return e.msg }
