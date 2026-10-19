package logql

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"github.com/prometheus/prometheus/model/labels"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

const maxAggSeries = 10000

type bucket struct {
	labels utm.Labels
	count  []int
	bytes  []int
}

type rangeSeries struct {
	labels utm.Labels
	values []float64
}

func validateAgg(agg *spi.LogAggregation) error {
	switch agg.RangeFunc {
	case "count_over_time", "rate", "bytes_over_time", "bytes_rate":
	default:
		return badRequest("unsupported range aggregation")
	}
	switch agg.VectorOp {
	case "", "sum", "avg", "min", "max", "count", "topk", "bottomk":
	default:
		return badRequest("unsupported vector aggregation")
	}
	if (agg.VectorOp == "topk" || agg.VectorOp == "bottomk") && agg.K < 0 {
		return badRequest("topk/bottomk require a nonnegative integer K")
	}
	if agg.Window <= 0 {
		return badRequest("range window must be positive")
	}
	if agg.Step < 0 || (agg.Step > 0 && agg.Step < time.Millisecond) {
		return badRequest("step must be zero or at least 1ms")
	}
	return nil
}

func bucketTimes(start, end int64, step time.Duration) []int64 {
	if step <= 0 {
		return []int64{end}
	}
	stepNs := int64(step)
	if stepNs <= 0 {
		return []int64{end}
	}
	var times []int64
	for t := start; t < end; {
		times = append(times, t)
		if stepNs > end-t {
			break
		}
		t += stepNs
	}
	return times
}

func inWindow(ts, t, window int64) bool {
	if window <= 0 || ts > t {
		return false
	}
	return t-ts < window
}

func addBucket(groups map[uint64][]*bucket, rec utm.LogRecord, times []int64, window int64) {
	g := findBucket(groups, rec.Labels, len(times))
	for i, t := range times {
		if inWindow(rec.TS, t, window) {
			g.count[i]++
			g.bytes[i] += len(rec.Body)
		}
	}
}

func findBucket(groups map[uint64][]*bucket, ls utm.Labels, n int) *bucket {
	h := ls.Hash()
	for _, g := range groups[h] {
		if labels.Equal(g.labels, ls) {
			return g
		}
	}
	g := &bucket{labels: ls, count: make([]int, n), bytes: make([]int, n)}
	groups[h] = append(groups[h], g)
	return g
}

func aggregate(q spi.LogQuery, groups map[uint64][]*bucket, times []int64) ([]spi.SeriesData, error) {
	flat := make([]*bucket, 0)
	for _, list := range groups {
		flat = append(flat, list...)
	}
	series, err := evalRange(q.Agg, flat)
	if err != nil {
		return nil, err
	}
	switch q.Agg.VectorOp {
	case "":
		return plainSeries(series, times)
	case "sum", "avg", "min", "max", "count":
		return reduceSeries(q.Agg, series, times)
	case "topk", "bottomk":
		return rankSeries(q.Agg, series, times)
	default:
		return nil, badRequest("unsupported vector aggregation")
	}
}

func evalRange(agg *spi.LogAggregation, groups []*bucket) ([]rangeSeries, error) {
	seconds := agg.Window.Seconds()
	out := make([]rangeSeries, 0, len(groups))
	for _, g := range groups {
		values := make([]float64, len(g.count))
		for i := range g.count {
			value, err := rangeValue(agg.RangeFunc, g.count[i], g.bytes[i], seconds)
			if err != nil {
				return nil, err
			}
			values[i] = value
		}
		out = append(out, rangeSeries{labels: g.labels, values: values})
	}
	return out, nil
}

func rangeValue(fn string, count, nbytes int, seconds float64) (float64, error) {
	switch fn {
	case "count_over_time":
		return float64(count), nil
	case "rate":
		return float64(count) / seconds, nil
	case "bytes_over_time":
		return float64(nbytes), nil
	case "bytes_rate":
		return float64(nbytes) / seconds, nil
	default:
		return 0, badRequest("unsupported range aggregation")
	}
}

func plainSeries(series []rangeSeries, times []int64) ([]spi.SeriesData, error) {
	if len(series) > maxAggSeries {
		return nil, tooLarge(len(series), maxAggSeries)
	}
	slices.SortFunc(series, func(a, b rangeSeries) int {
		return labels.Compare(a.labels, b.labels)
	})
	if len(series) == 0 {
		return nil, nil
	}
	out := make([]spi.SeriesData, len(series))
	for i, s := range series {
		out[i] = spi.SeriesData{Labels: s.labels, Samples: samplesOf(times, s.values)}
	}
	return out, nil
}

func samplesOf(times []int64, values []float64) []spi.Sample {
	out := make([]spi.Sample, len(times))
	for i := range times {
		out[i] = spi.Sample{TS: utm.NanoToMilli(times[i]), Value: values[i]}
	}
	return out
}

// groupLabels applies by/without. A reducer with neither clause collapses
// every series into one unlabeled series.
func groupLabels(ls utm.Labels, agg *spi.LogAggregation) utm.Labels {
	if len(agg.By) > 0 {
		return keepLabels(ls, agg.By)
	}
	if len(agg.Without) > 0 {
		return dropLabels(ls, agg.Without)
	}
	return nil
}

func keepLabels(ls utm.Labels, names []string) utm.Labels {
	b := labels.NewBuilder(nil)
	for _, name := range names {
		if value, ok := labelValue(ls, name); ok {
			b.Set(name, value)
		}
	}
	return b.Labels()
}

func dropLabels(ls utm.Labels, names []string) utm.Labels {
	b := labels.NewBuilder(nil)
	for _, lb := range ls {
		if slices.Contains(names, lb.Name) {
			continue
		}
		b.Set(lb.Name, lb.Value)
	}
	return b.Labels()
}

type redGroup struct {
	labels utm.Labels
	sum    []float64
	min    []float64
	max    []float64
	n      int
	init   bool
}

func reduceSeries(agg *spi.LogAggregation, series []rangeSeries, times []int64) ([]spi.SeriesData, error) {
	groups := map[uint64][]*redGroup{}
	for _, s := range series {
		key := groupLabels(s.labels, agg)
		g := findRed(groups, key, len(s.values))
		if !g.init {
			g.init = true
			g.n = 1
			g.sum = slices.Clone(s.values)
			g.min = slices.Clone(s.values)
			g.max = slices.Clone(s.values)
			continue
		}
		g.n++
		for i, value := range s.values {
			g.sum[i] += value
			g.min[i] = min(g.min[i], value)
			g.max[i] = max(g.max[i], value)
		}
	}
	out := make([]rangeSeries, 0, len(groups))
	for _, list := range groups {
		for _, g := range list {
			values := make([]float64, len(times))
			for i := range times {
				values[i] = reducedValue(agg.VectorOp, g, i)
			}
			out = append(out, rangeSeries{labels: g.labels, values: values})
		}
	}
	return plainSeries(out, times)
}

func findRed(groups map[uint64][]*redGroup, ls utm.Labels, n int) *redGroup {
	h := ls.Hash()
	for _, g := range groups[h] {
		if labels.Equal(g.labels, ls) {
			return g
		}
	}
	g := &redGroup{labels: ls, sum: make([]float64, n), min: make([]float64, n), max: make([]float64, n)}
	groups[h] = append(groups[h], g)
	return g
}

func reducedValue(op string, g *redGroup, i int) float64 {
	switch op {
	case "sum":
		return g.sum[i]
	case "avg":
		return g.sum[i] / float64(g.n)
	case "min":
		return g.min[i]
	case "max":
		return g.max[i]
	default:
		return float64(g.n)
	}
}

type rankCand struct {
	labels utm.Labels
	group  utm.Labels
	values []float64
}

type rankGroup struct {
	key  utm.Labels
	idxs []int
}

func rankSeries(agg *spi.LogAggregation, series []rangeSeries, times []int64) ([]spi.SeriesData, error) {
	cands := make([]rankCand, len(series))
	buckets := map[uint64][]*rankGroup{}
	for i, s := range series {
		cands[i] = rankCand{labels: s.labels, group: groupLabels(s.labels, agg), values: s.values}
		h := cands[i].group.Hash()
		placed := false
		for _, g := range buckets[h] {
			if labels.Equal(g.key, cands[i].group) {
				g.idxs = append(g.idxs, i)
				placed = true
				break
			}
		}
		if !placed {
			buckets[h] = append(buckets[h], &rankGroup{key: cands[i].group, idxs: []int{i}})
		}
	}
	groups := make([]*rankGroup, 0, len(series))
	for _, list := range buckets {
		groups = append(groups, list...)
	}
	slices.SortFunc(groups, func(a, b *rankGroup) int {
		return labels.Compare(a.key, b.key)
	})
	top := agg.VectorOp == "topk"
	seen := make([]int, len(cands))
	for i := range seen {
		seen[i] = -1
	}
	var out []spi.SeriesData
	for _, g := range groups {
		for ti, t := range times {
			order := slices.Clone(g.idxs)
			slices.SortStableFunc(order, func(a, b int) int {
				left, right := cands[a].values[ti], cands[b].values[ti]
				if left != right {
					if top {
						return cmp.Compare(right, left)
					}
					return cmp.Compare(left, right)
				}
				return labels.Compare(cands[a].labels, cands[b].labels)
			})
			k := min(max(agg.K, 0), len(order))
			for _, ci := range order[:k] {
				sample := spi.Sample{TS: utm.NanoToMilli(t), Value: cands[ci].values[ti]}
				if seen[ci] >= 0 {
					out[seen[ci]].Samples = append(out[seen[ci]].Samples, sample)
					continue
				}
				seen[ci] = len(out)
				out = append(out, spi.SeriesData{Labels: cands[ci].labels, Samples: []spi.Sample{sample}})
			}
		}
	}
	if len(out) > maxAggSeries {
		return nil, tooLarge(len(out), maxAggSeries)
	}
	return out, nil
}

func tooLarge(n, m int) error {
	return spi.Wrap(spi.ErrTooLarge, "logql", "Execute", fmt.Errorf("query would produce %d series, exceeding the limit of %d; add a 'by' clause or reduce the time range", n, m))
}
