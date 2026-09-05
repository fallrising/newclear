package memory

import (
	"context"
	"maps"
	"slices"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type metricStore struct {
	state *state
}

type metricSeries struct {
	labels  utm.Labels
	samples map[int64]float64
}

type metricWrite struct {
	key    string
	labels utm.Labels
	ts     int64
	value  float64
}

func (s *metricStore) Write(ctx context.Context, batch []utm.MetricPoint) error {
	prepared := make([]metricWrite, len(batch))
	for i, point := range batch {
		if err := contextError(ctx, "metrics.Write"); err != nil {
			return err
		}
		labels := cloneLabels(point.Labels)
		prepared[i] = metricWrite{
			key:    labels.String(),
			labels: labels,
			ts:     point.TS,
			value:  point.Value,
		}
	}

	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	if err := contextError(ctx, "metrics.Write"); err != nil {
		return err
	}
	if s.state.closed {
		return closedError("metrics.Write")
	}
	if len(batch) == 0 {
		return badRequestError("metrics.Write", "metric batch must not be empty")
	}
	for _, write := range prepared {
		series, found := s.state.metrics[write.key]
		if !found {
			series = &metricSeries{labels: write.labels, samples: make(map[int64]float64)}
			s.state.metrics[write.key] = series
		}
		series.samples[write.ts] = write.value
	}
	return nil
}

func (s *metricStore) Select(ctx context.Context, q spi.SeriesQuery) (spi.SeriesSet, error) {
	if err := contextError(ctx, "metrics.Select"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("metrics.Select")
	}

	series := make([]spi.SeriesData, 0)
	for _, stored := range s.state.metrics {
		if err := contextError(ctx, "metrics.Select"); err != nil {
			return nil, err
		}
		if stored.labels.Get(utm.LabelTenant) != q.Tenant || !labelsMatch(stored.labels, q.Matchers) {
			continue
		}
		samples, err := samplesInRange(ctx, stored.samples, q.Start, q.End, "metrics.Select")
		if err != nil {
			return nil, err
		}
		if len(samples) == 0 {
			continue
		}
		series = append(series, spi.SeriesData{Labels: cloneLabels(stored.labels), Samples: samples})
	}
	return spi.SliceSeriesSet(series), nil
}

func (s *metricStore) LabelNames(ctx context.Context, q spi.LabelQuery) ([]string, error) {
	if err := contextError(ctx, "metrics.LabelNames"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("metrics.LabelNames")
	}

	names := make(map[string]struct{})
	for _, stored := range s.state.metrics {
		if err := contextError(ctx, "metrics.LabelNames"); err != nil {
			return nil, err
		}
		if stored.labels.Get(utm.LabelTenant) != q.Tenant || !labelsMatch(stored.labels, q.Matchers) {
			continue
		}
		inRange, err := hasSampleInRange(ctx, stored.samples, q.Start, q.End, "metrics.LabelNames")
		if err != nil {
			return nil, err
		}
		if !inRange {
			continue
		}
		for _, label := range stored.labels {
			if !utm.IsReserved(label.Name) {
				names[label.Name] = struct{}{}
			}
		}
	}
	return applyLimit(slices.Sorted(maps.Keys(names)), q.Limit), nil
}

func (s *metricStore) LabelValues(ctx context.Context, name string, q spi.LabelQuery) ([]string, error) {
	if err := contextError(ctx, "metrics.LabelValues"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("metrics.LabelValues")
	}
	if name == "" {
		return nil, badRequestError("metrics.LabelValues", "label name must not be empty")
	}

	values := make(map[string]struct{})
	for _, stored := range s.state.metrics {
		if err := contextError(ctx, "metrics.LabelValues"); err != nil {
			return nil, err
		}
		if stored.labels.Get(utm.LabelTenant) != q.Tenant || !labelsMatch(stored.labels, q.Matchers) || !stored.labels.Has(name) {
			continue
		}
		inRange, err := hasSampleInRange(ctx, stored.samples, q.Start, q.End, "metrics.LabelValues")
		if err != nil {
			return nil, err
		}
		if !inRange {
			continue
		}
		values[stored.labels.Get(name)] = struct{}{}
	}
	return applyLimit(slices.Sorted(maps.Keys(values)), q.Limit), nil
}

func samplesInRange(
	ctx context.Context,
	samples map[int64]float64,
	start, end int64,
	op string,
) ([]spi.Sample, error) {
	result := make([]spi.Sample, 0)
	for ts, value := range samples {
		if err := contextError(ctx, op); err != nil {
			return nil, err
		}
		if ts >= start && ts <= end {
			result = append(result, spi.Sample{TS: ts, Value: value})
		}
	}
	return result, nil
}

func hasSampleInRange(
	ctx context.Context,
	samples map[int64]float64,
	start, end int64,
	op string,
) (bool, error) {
	for ts := range samples {
		if err := contextError(ctx, op); err != nil {
			return false, err
		}
		if ts >= start && ts <= end {
			return true, nil
		}
	}
	return false, nil
}

func applyLimit[T any](values []T, limit int) []T {
	if limit > 0 && len(values) > limit {
		return slices.Clip(values[:limit])
	}
	return slices.Clip(values)
}
