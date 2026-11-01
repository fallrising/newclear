package clickhouse

import (
	"container/list"
	"context"
	"math"
	"strconv"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type metricStore struct {
	host    writeHost
	gate    chan struct{}
	entries map[string]*list.Element
	byHash  map[uint64]string
	lru     list.List
	bytes   int
}

type cachedSeries struct {
	identity    string
	fingerprint uint64
	first, last int64
	size        int
}

type metricSeries struct {
	identity     string
	fingerprint  uint64
	tenant, name string
	labels       map[string]string
	first, last  int64
	size         int
}

func newMetricStore(host writeHost) spi.MetricStore {
	return &metricStore{host: host, gate: make(chan struct{}, 1), entries: make(map[string]*list.Element), byHash: make(map[uint64]string)}
}

func metricIdentity(ls utm.Labels) string {
	var result []byte
	for _, label := range ls {
		result = strconv.AppendInt(result, int64(len(label.Name)), 10)
		result = append(result, ':')
		result = append(result, label.Name...)
		result = strconv.AppendInt(result, int64(len(label.Value)), 10)
		result = append(result, ':')
		result = append(result, label.Value...)
	}
	return string(result)
}

func validMetricLabelUTF8(ls utm.Labels) bool {
	for _, label := range ls {
		if !utf8.ValidString(label.Name) || !utf8.ValidString(label.Value) {
			return false
		}
	}
	return true
}

func (s *metricStore) Write(ctx context.Context, points []utm.MetricPoint) error {
	return s.host.run(ctx, "metrics.write", func(ctx context.Context) error {
		if err := checkCount(len(points), "metrics.write"); err != nil {
			return err
		}
		budget := byteBudget{}
		series := make(map[string]*metricSeries)
		hashes := make(map[uint64]string)
		rows := make([][]any, 0, len(points))
		for _, point := range points {
			if err := checkContext(ctx); err != nil {
				return err
			}
			name := point.Name
			if name == "" {
				name = point.Labels.Get(utm.LabelName)
			}
			if point.Histogram != nil || point.Exemplar != nil {
				return writeInputError(spi.ErrUnsupported, "metrics.write")
			}
			if name == "" || !validMilli(point.TS) || !retentionSafe(timestampMilli(point.TS), s.host.retentionDays(spi.SignalMetrics)) || point.Type > utm.TypeSummary {
				return writeInputError(spi.ErrBadRequest, "metrics.write")
			}
			if point.Labels.Get(utm.LabelName) != name || point.Labels.Get(utm.LabelTenant) == "" {
				return writeInputError(spi.ErrBadRequest, "metrics.write")
			}
			tenant := point.Labels.Get(utm.LabelTenant)
			if !validLabels(point.Labels, tenant) {
				return writeInputError(spi.ErrBadRequest, "metrics.write")
			}
			if !budget.add(17) || !budget.labels(point.Labels, tenant) || !budget.strings(name) {
				return writeInputError(spi.ErrTooLarge, "metrics.write")
			}
			if !validMetricLabelUTF8(point.Labels) {
				return writeInputError(spi.ErrBadRequest, "metrics.write")
			}
			identity := metricIdentity(point.Labels)
			fingerprint := utm.Fingerprint(point.Labels)
			if previous, ok := hashes[fingerprint]; ok && previous != identity {
				return writeInputError(spi.ErrBadRequest, "metrics.write")
			}
			hashes[fingerprint] = identity
			if entry := series[identity]; entry != nil {
				entry.first = min(entry.first, point.TS)
				entry.last = max(entry.last, point.TS)
			} else {
				series[identity] = &metricSeries{identity: identity, fingerprint: fingerprint, tenant: tenant, name: name, labels: labelsMap(point.Labels), first: point.TS, last: point.TS, size: len(identity)}
			}
			rows = append(rows, []any{timestampMilli(point.TS), fingerprint, tenant, name, point.Value, math.Float64bits(point.Value)})
		}
		select {
		case s.gate <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
		defer func() { <-s.gate }()
		metadata := make([][]any, 0, len(series))
		for _, item := range series {
			if previous, ok := s.byHash[item.fingerprint]; ok && previous != item.identity {
				return writeInputError(spi.ErrBadRequest, "metrics.write")
			}
			if node := s.entries[item.identity]; node != nil {
				cached := node.Value.(*cachedSeries)
				if item.first >= cached.first && item.last <= cached.last {
					continue
				}
				item.first = min(item.first, cached.first)
				item.last = max(item.last, cached.last)
			}
			metadata = append(metadata, []any{item.fingerprint, item.tenant, item.name, item.labels, timestampMilli(item.first), timestampMilli(item.last)})
		}
		conn := s.host.connection()
		if err := sendRows(ctx, conn, "INSERT INTO metric_series (fingerprint,tenant,metric,labels,first_seen,last_seen)", metadata); err != nil {
			return err
		}
		if err := sendRows(ctx, conn, "INSERT INTO metric_samples (ts,fingerprint,tenant,metric,value,value_bits)", rows); err != nil {
			return err
		}
		for _, item := range series {
			s.admit(item)
		}
		return nil
	})
}

func (s *metricStore) admit(item *metricSeries) {
	if node := s.entries[item.identity]; node != nil {
		cached := node.Value.(*cachedSeries)
		cached.first = min(cached.first, item.first)
		cached.last = max(cached.last, item.last)
		s.lru.MoveToFront(node)
		return
	}
	if item.size > maxCacheBytes {
		return
	}
	for len(s.entries) >= maxCacheEntries || s.bytes > maxCacheBytes-item.size {
		old := s.lru.Back()
		if old == nil {
			break
		}
		cached := old.Value.(*cachedSeries)
		delete(s.entries, cached.identity)
		delete(s.byHash, cached.fingerprint)
		s.bytes -= cached.size
		s.lru.Remove(old)
	}
	s.entries[item.identity] = s.lru.PushFront(&cachedSeries{identity: item.identity, fingerprint: item.fingerprint, first: item.first, last: item.last, size: item.size})
	s.byHash[item.fingerprint] = item.identity
	s.bytes += item.size
}
