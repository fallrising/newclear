package clickhouse

import (
	"context"
	"errors"
	"maps"
	"math"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

type metricReadRow struct {
	fingerprint  uint64
	metric       string
	sampleMetric string
	labels       utm.Labels
	ts           int64
	value        float64
}

// Server-side equality predicates keep the common exact-series PromQL path
// selective. Regex remains client-checked with SPI's Go RE2 matcher semantics.
func metricMetadataFilter(matchers []spi.Matcher) (string, []any) {
	var sql strings.Builder
	var args []any
	for _, matcher := range matchers {
		if matcher.Type != spi.MatchEqual && matcher.Type != spi.MatchNotEqual {
			continue
		}
		if matcher.Name == utm.LabelName {
			if matcher.Type == spi.MatchEqual {
				sql.WriteString(" AND metric = ?")
			} else {
				sql.WriteString(" AND metric != ?")
			}
			args = append(args, matcher.Value)
			continue
		}
		if matcher.Name == utm.LabelTenant {
			continue
		}
		if matcher.Type == spi.MatchEqual {
			sql.WriteString(" AND labels[?] = ?")
		} else {
			sql.WriteString(" AND labels[?] != ?")
		}
		args = append(args, matcher.Name, matcher.Value)
	}
	return sql.String(), args
}

type metricSeriesSet struct {
	lease    *readLease
	matchers []spi.Matcher
	tenant   string
	pending  *metricReadRow
	current  spi.SeriesData
	previous utm.Labels
	err      error
	closed   atomic.Bool
}

func (s *metricSeriesSet) fetch() (*metricReadRow, bool) {
	for {
		var item metricReadRow
		var ts time.Time
		var valueBits uint64
		var values map[string]string
		var identities uint64
		ok := s.lease.Next(func(rows chdriver.Rows) (int, error) {
			if err := rows.Scan(&item.fingerprint, &item.metric, &ts, &valueBits, &values, &identities, &item.sampleMetric); err != nil {
				return 0, err
			}
			if !safeMap(values) {
				return 0, tooLarge("metrics.select")
			}
			return len(item.metric) + len(item.sampleMetric) + mapSize(values) + 32, nil
		})
		if !ok {
			s.err = s.lease.Err()
			return nil, false
		}
		if identities != 1 || item.sampleMetric != item.metric || values[utm.LabelName] != item.metric || values[utm.LabelTenant] != s.tenant {
			s.err = spi.Wrap(spi.ErrInternal, driverName, "metrics.select", errors.New("metric metadata identity mismatch"))
			_ = s.lease.Close()
			return nil, false
		}
		item.labels = labels.FromMap(values)
		item.value = math.Float64frombits(valueBits)
		if utm.Fingerprint(item.labels) != item.fingerprint {
			s.err = spi.Wrap(spi.ErrInternal, driverName, "metrics.select", errors.New("metric fingerprint mismatch"))
			_ = s.lease.Close()
			return nil, false
		}
		item.ts = utm.TimeToMilli(ts)
		if !matchesMap(values, s.matchers) {
			continue
		}
		return &item, true
	}
}

func (s *metricSeriesSet) Next() bool {
	if s.closed.Load() || s.err != nil {
		return false
	}
	first := s.pending
	s.pending = nil
	if first == nil {
		var ok bool
		first, ok = s.fetch()
		if !ok {
			return false
		}
	}
	s.current = spi.SeriesData{Labels: first.labels, Samples: []spi.Sample{{TS: first.ts, Value: first.value}}}
	for {
		row, ok := s.fetch()
		if !ok {
			break
		}
		if row.fingerprint != first.fingerprint {
			s.pending = row
			break
		}
		if !labels.Equal(row.labels, first.labels) {
			s.err = spi.Wrap(spi.ErrInternal, driverName, "metrics.select", errors.New("metric metadata collision"))
			_ = s.lease.Close()
			return false
		}
		last := s.current.Samples[len(s.current.Samples)-1].TS
		if row.ts < last {
			s.err = spi.Wrap(spi.ErrInternal, driverName, "metrics.select", errors.New("sample order mismatch"))
			_ = s.lease.Close()
			return false
		}
		if row.ts > last {
			s.current.Samples = append(s.current.Samples, spi.Sample{TS: row.ts, Value: row.value})
		}
	}
	if s.err != nil {
		return false
	}
	if s.previous != nil && labels.Compare(s.previous, s.current.Labels) >= 0 {
		s.err = spi.Wrap(spi.ErrInternal, driverName, "metrics.select", errors.New("series order mismatch"))
		_ = s.lease.Close()
		return false
	}
	s.previous = s.current.Labels
	return true
}

func (s *metricSeriesSet) At() spi.Series {
	if s.closed.Load() {
		return nil
	}
	return metricResultSeries{data: s.current}
}
func (s *metricSeriesSet) Err() error {
	if s.err != nil {
		return s.err
	}
	return s.lease.Err()
}
func (*metricSeriesSet) Warnings() []string { return nil }
func (s *metricSeriesSet) Close() error     { s.closed.Store(true); return s.lease.Close() }

type metricResultSeries struct{ data spi.SeriesData }

func (s metricResultSeries) Labels() utm.Labels { return s.data.Labels }
func (s metricResultSeries) Samples() spi.SampleIterator {
	return &metricSampleIterator{samples: s.data.Samples, index: -1}
}

type metricSampleIterator struct {
	samples []spi.Sample
	index   int
}

func (i *metricSampleIterator) Next() bool {
	if i.index+1 >= len(i.samples) {
		return false
	}
	i.index++
	return true
}
func (i *metricSampleIterator) At() (int64, float64) {
	if i.index < 0 || i.index >= len(i.samples) {
		return 0, 0
	}
	item := i.samples[i.index]
	return item.TS, item.Value
}
func (*metricSampleIterator) Err() error { return nil }

func (s *metricStore) Select(ctx context.Context, q spi.SeriesQuery) (spi.SeriesSet, error) {
	b, err := queryBackend(ctx, s.host, "metrics.select")
	if err != nil {
		return nil, err
	}
	if err := validateMatchers(q.Matchers, q.Tenant, "metrics.select"); err != nil {
		return nil, err
	}
	start, end, ok := metricRange(q.Start, q.End)
	if !ok {
		return spi.EmptySeriesSet(), nil
	}
	filter, filterArgs := metricMetadataFilter(q.Matchers)
	sql := "WITH selected AS (SELECT fingerprint FROM metric_series WHERE tenant = ?" + filter + " GROUP BY fingerprint), meta AS (SELECT fingerprint, any(metric) AS m_metric, any(labels) AS m_labels, uniqExact(tuple(metric, arraySort(arrayZip(mapKeys(labels),mapValues(labels))))) AS identities FROM metric_series WHERE tenant = ? AND fingerprint IN (SELECT fingerprint FROM selected) GROUP BY fingerprint) " +
		"SELECT s.fingerprint, m.m_metric, s.ts, s.value_bits, m.m_labels, m.identities, s.metric FROM metric_samples AS s INNER JOIN meta AS m ON s.fingerprint = m.fingerprint WHERE s.tenant = ? AND s.ts >= fromUnixTimestamp64Milli(?) AND s.ts <= fromUnixTimestamp64Milli(?) " +
		"ORDER BY arraySort(arrayZip(mapKeys(m.m_labels), mapValues(m.m_labels))), s.ts, s.fingerprint" + querySettings(b.opts)
	args := append([]any{q.Tenant}, filterArgs...)
	args = append(args, q.Tenant, q.Tenant, start, end)
	lease, err := b.queryRows(ctx, "metrics.select", sql, args...)
	if err != nil {
		return nil, err
	}
	return &metricSeriesSet{lease: lease, matchers: q.Matchers, tenant: q.Tenant}, nil
}

func (s *metricStore) liveLabels(ctx context.Context, q spi.LabelQuery, op string) ([]utm.Labels, error) {
	b, err := queryBackend(ctx, s.host, op)
	if err != nil {
		return nil, err
	}
	if err := validateMatchers(q.Matchers, q.Tenant, op); err != nil {
		return nil, err
	}
	start, end, ok := metricRange(q.Start, q.End)
	if !ok {
		return []utm.Labels{}, nil
	}
	filter, filterArgs := metricMetadataFilter(q.Matchers)
	sql := "WITH selected AS (SELECT fingerprint FROM metric_series WHERE tenant = ?" + filter + " GROUP BY fingerprint), live AS (SELECT DISTINCT fingerprint, metric FROM metric_samples WHERE tenant = ? AND ts >= fromUnixTimestamp64Milli(?) AND ts <= fromUnixTimestamp64Milli(?)) " +
		"SELECT m.fingerprint, m.metric, m.labels, live.metric FROM metric_series AS m INNER JOIN selected ON m.fingerprint = selected.fingerprint INNER JOIN live ON m.fingerprint = live.fingerprint WHERE m.tenant = ?" + querySettings(b.opts)
	args := append([]any{q.Tenant}, filterArgs...)
	args = append(args, q.Tenant, start, end, q.Tenant)
	identities := map[uint64]utm.Labels{}
	seen := map[uint64]utm.Labels{}
	err = b.read(ctx, op, sql, args, func(rows chdriver.Rows, budget *queryBudget) error {
		for rows.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			var fp uint64
			var metric string
			var sampleMetric string
			var values map[string]string
			if err := rows.Scan(&fp, &metric, &values, &sampleMetric); err != nil {
				return err
			}
			if !safeMap(values) {
				return tooLarge(op)
			}
			if err := budget.add(len(metric) + len(sampleMetric) + mapSize(values) + 16); err != nil {
				return err
			}
			if values[utm.LabelTenant] != q.Tenant || values[utm.LabelName] != metric || sampleMetric != metric {
				return spi.Wrap(spi.ErrInternal, driverName, op, errors.New("metric identity mismatch"))
			}
			ls := labels.FromMap(values)
			if utm.Fingerprint(ls) != fp {
				return spi.Wrap(spi.ErrInternal, driverName, op, errors.New("metric fingerprint mismatch"))
			}
			if previous, exists := seen[fp]; exists && !labels.Equal(previous, ls) {
				return spi.Wrap(spi.ErrInternal, driverName, op, errors.New("metric metadata collision"))
			}
			seen[fp] = ls
			if matchesMap(values, q.Matchers) {
				identities[fp] = ls
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	result := make([]utm.Labels, 0, len(identities))
	for _, item := range identities {
		result = append(result, item)
	}
	return result, nil
}

func (s *metricStore) LabelNames(ctx context.Context, q spi.LabelQuery) ([]string, error) {
	items, err := s.liveLabels(ctx, q, "metrics.label_names")
	if err != nil {
		return nil, err
	}
	names := map[string]struct{}{}
	for _, ls := range items {
		for _, label := range ls {
			if !utm.IsReserved(label.Name) {
				names[label.Name] = struct{}{}
			}
		}
	}
	result := slices.Sorted(maps.Keys(names))
	if q.Limit > 0 && len(result) > q.Limit {
		result = result[:q.Limit]
	}
	return result, nil
}
func (s *metricStore) LabelValues(ctx context.Context, name string, q spi.LabelQuery) ([]string, error) {
	if err := validateLabelName(name, "metrics.label_values"); err != nil {
		return nil, err
	}
	items, err := s.liveLabels(ctx, q, "metrics.label_values")
	if err != nil {
		return nil, err
	}
	values := map[string]struct{}{}
	for _, ls := range items {
		if ls.Has(name) {
			values[ls.Get(name)] = struct{}{}
		}
	}
	result := slices.Sorted(maps.Keys(values))
	if q.Limit > 0 && len(result) > q.Limit {
		result = result[:q.Limit]
	}
	return result, nil
}
