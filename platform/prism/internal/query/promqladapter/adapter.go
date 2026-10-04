// Package promqladapter adapts tenant-scoped SPI metric storage to Prometheus.
package promqladapter

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/common/model"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/storage"
	"github.com/prometheus/prometheus/util/annotations"
)

// Limits bounds the work and resources owned by a single querier. Zero uses
// defaults; negative values are invalid. See README.md for the precise bounds.
type Limits struct {
	MaxScanRows                                                                                                                  int64
	MaxSeries, MaxLabelResults, MaxLabelsPerSeries, MaxMatchers, MaxRetainedSets, MaxLabelBytes, MaxRegexBytes, MaxMetadataBytes int
}

type queryable struct {
	store  spi.MetricStore
	tenant string
	limits Limits
}

// New creates a queryable; invalid inputs are reported by Querier.
func New(store spi.MetricStore, tenant string, limits Limits) storage.Queryable {
	return &queryable{store: store, tenant: tenant, limits: limits}
}

func failure(class spi.ErrClass, message string) error {
	return spi.Wrap(class, "promqladapter", "query", fmt.Errorf("%s", message))
}

func (a *queryable) Querier(mint, maxt int64) (storage.Querier, error) {
	l := a.limits
	if a.store == nil || strings.TrimSpace(a.tenant) == "" || mint > maxt || l.MaxScanRows < 0 || l.MaxSeries < 0 || l.MaxLabelResults < 0 || l.MaxLabelsPerSeries < 0 || l.MaxMatchers < 0 || l.MaxRetainedSets < 0 || l.MaxLabelBytes < 0 || l.MaxRegexBytes < 0 || l.MaxMetadataBytes < 0 {
		return nil, failure(spi.ErrBadRequest, "invalid querier inputs")
	}
	if l.MaxScanRows == 0 {
		l.MaxScanRows = 5000000
	}
	if l.MaxSeries == 0 {
		l.MaxSeries = 100000
	}
	if l.MaxLabelResults == 0 {
		l.MaxLabelResults = 100000
	}
	if l.MaxLabelsPerSeries == 0 {
		l.MaxLabelsPerSeries = 128
	}
	if l.MaxMatchers == 0 {
		l.MaxMatchers = 128
	}
	if l.MaxRetainedSets == 0 {
		l.MaxRetainedSets = 1024
	}
	if l.MaxLabelBytes == 0 {
		l.MaxLabelBytes = 1048576
	}
	if l.MaxRegexBytes == 0 {
		l.MaxRegexBytes = 4096
	}
	if l.MaxMetadataBytes == 0 {
		l.MaxMetadataBytes = 64 << 20
	}
	maxInt := int(^uint(0) >> 1)
	if l.MaxLabelsPerSeries >= maxInt || l.MaxLabelResults > maxInt-l.MaxLabelsPerSeries-1 || len(a.tenant) > l.MaxLabelBytes || len(a.tenant) > l.MaxMetadataBytes {
		return nil, failure(spi.ErrBadRequest, "constructor resource limits overflow or tenant exceeds budget")
	}
	ctx, cancel := context.WithCancel(context.Background())
	detached := *a
	detached.tenant = strings.Clone(a.tenant)
	return &querier{queryable: detached, metadata: len(a.tenant), limits: l, mint: mint, maxt: maxt, ctx: ctx, cancel: cancel}, nil
}

type querier struct {
	queryable
	limits     Limits
	mint, maxt int64
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex // Protects backend operations, retained sets and budgets.
	closed     bool
	closeErr   error
	sets       []*ownedSet
	rows       int64
	series     int
	selects    int
	metadata   int
}

func (q *querier) operation(ctx context.Context) (context.Context, func(), error) {
	if q.closed {
		return nil, nil, failure(spi.ErrBadRequest, "querier closed")
	}
	joined, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(q.ctx, cancel)
	if q.ctx.Err() != nil {
		cancel()
	}
	if err := contextError(joined); err != nil {
		stop()
		cancel()
		return nil, nil, err
	}
	return joined, func() { stop(); cancel() }, nil
}

func (q *querier) charge(bytes int) error {
	if bytes < 0 || bytes > q.limits.MaxMetadataBytes-q.metadata {
		return failure(spi.ErrTooLarge, "querier metadata budget exceeded")
	}
	q.metadata += bytes
	return nil
}
func boundedBytes(total *int, limit int, value string) bool {
	if len(value) > limit-*total {
		return false
	}
	*total += len(value)
	return true
}

func contextError(ctx context.Context) error {
	return spi.Wrap(spi.ErrTimeout, "promqladapter", "context", ctx.Err())
}

func reserved(name string) bool { return strings.HasPrefix(name, "__") && name != "__name__" }

func (q *querier) matchers(input []*labels.Matcher) ([]spi.Matcher, error) {
	if len(input) > q.limits.MaxMatchers {
		return nil, failure(spi.ErrTooLarge, "matcher count limit exceeded")
	}
	if len(input) > q.limits.MaxMetadataBytes/64 {
		return nil, failure(spi.ErrTooLarge, "matcher metadata budget exceeded")
	}
	if err := q.charge(len(input) * 64); err != nil {
		return nil, err
	}
	out := make([]spi.Matcher, len(input))
	bytes := 0
	for i, m := range input {
		if m == nil || !model.LabelName(m.Name).IsValid() || reserved(m.Name) {
			return nil, failure(spi.ErrBadRequest, "invalid or reserved matcher")
		}
		if (m.Type == labels.MatchRegexp || m.Type == labels.MatchNotRegexp) && len(m.Value) > q.limits.MaxRegexBytes {
			return nil, failure(spi.ErrTooLarge, "regexp bytes limit exceeded")
		}
		if !boundedBytes(&bytes, q.limits.MaxLabelBytes, m.Name) || !boundedBytes(&bytes, q.limits.MaxLabelBytes, m.Value) {
			return nil, failure(spi.ErrTooLarge, "matcher bytes limit exceeded")
		}
		var typ spi.MatchType
		switch m.Type {
		case labels.MatchEqual:
			typ = spi.MatchEqual
		case labels.MatchNotEqual:
			typ = spi.MatchNotEqual
		case labels.MatchRegexp:
			typ = spi.MatchRegexp
		case labels.MatchNotRegexp:
			typ = spi.MatchNotRegexp
		default:
			return nil, failure(spi.ErrBadRequest, "invalid matcher type")
		}
		if err := q.charge(len(m.Name)); err != nil {
			return nil, err
		}
		if err := q.charge(len(m.Value)); err != nil {
			return nil, err
		}
		converted, err := spi.NewMatcher(typ, strings.Clone(m.Name), strings.Clone(m.Value))
		if err != nil {
			return nil, err
		}
		out[i] = converted
	}
	return out, nil
}

func (q *querier) LabelNames(ctx context.Context, matchers ...*labels.Matcher) ([]string, annotations.Annotations, error) {
	return q.labelQuery(ctx, "", matchers)
}
func (q *querier) LabelValues(ctx context.Context, name string, matchers ...*labels.Matcher) ([]string, annotations.Annotations, error) {
	if !model.LabelName(name).IsValid() || reserved(name) {
		return nil, nil, failure(spi.ErrBadRequest, "invalid or reserved label name")
	}
	return q.labelQuery(ctx, name, matchers)
}
func (q *querier) labelQuery(ctx context.Context, name string, matchers []*labels.Matcher) ([]string, annotations.Annotations, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	joined, cleanup, err := q.operation(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer cleanup()
	converted, err := q.matchers(matchers)
	if err != nil {
		return nil, nil, err
	}
	request := spi.LabelQuery{Tenant: q.tenant, Matchers: converted, Start: q.mint, End: q.maxt, Limit: q.limits.MaxLabelResults + 1}
	if name == "" {
		request.Limit += q.limits.MaxLabelsPerSeries
	}
	var values []string
	if name == "" {
		values, err = q.store.LabelNames(joined, request)
	} else {
		values, err = q.store.LabelValues(joined, name, request)
	}
	if err != nil {
		return nil, nil, err
	}
	if err = contextError(joined); err != nil {
		return nil, nil, err
	}
	if len(values) > request.Limit {
		return nil, nil, failure(spi.ErrTooLarge, "raw label result limit exceeded")
	}
	visible, hidden, bytes := 0, 0, 0
	for _, value := range values {
		if !boundedBytes(&bytes, q.limits.MaxLabelBytes, value) {
			return nil, nil, failure(spi.ErrTooLarge, "label bytes limit exceeded")
		}
		if name == "" && reserved(value) {
			hidden++
		} else {
			visible++
		}
	}
	if visible > q.limits.MaxLabelResults || hidden > q.limits.MaxLabelsPerSeries {
		return nil, nil, failure(spi.ErrTooLarge, "label result limit exceeded")
	}
	if visible > q.limits.MaxMetadataBytes/16 {
		return nil, nil, failure(spi.ErrTooLarge, "label metadata budget exceeded")
	}
	if err := q.charge(visible * 16); err != nil {
		return nil, nil, err
	}
	if err := q.charge(bytes); err != nil {
		return nil, nil, err
	}
	out := make([]string, 0, visible)
	for _, value := range values {
		if err := contextError(joined); err != nil {
			return nil, nil, err
		}
		if name == "" && reserved(value) {
			continue
		}
		out = append(out, strings.Clone(value))
	}
	return out, nil, nil
}

func (q *querier) Close() error {
	q.cancel()
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return q.closeErr
	}
	q.closed = true
	for _, set := range q.sets {
		if set != nil {
			_ = q.release(set)
		}
	}
	q.sets = nil
	return q.closeErr
}

func (q *querier) Select(ctx context.Context, _ bool, hints *storage.SelectHints, matchers ...*labels.Matcher) storage.SeriesSet {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, cleanup, err := q.operation(ctx)
	if err != nil {
		return storage.ErrSeriesSet(err)
	}
	defer cleanup()
	converted, err := q.matchers(matchers)
	if err != nil {
		return storage.ErrSeriesSet(err)
	}
	request := spi.SeriesQuery{Tenant: q.tenant, Matchers: converted, Start: q.mint, End: q.maxt}
	if hints != nil {
		if hints.ShardCount != 0 || hints.ShardIndex != 0 || hints.DisableTrimming {
			return storage.ErrSeriesSet(failure(spi.ErrUnsupported, "unsupported select flags"))
		}
		if hints.Start > hints.End || hints.Step < 0 || hints.Range < 0 {
			return storage.ErrSeriesSet(failure(spi.ErrBadRequest, "invalid select hints"))
		}
		if len(hints.Grouping) > q.limits.MaxMatchers {
			return storage.ErrSeriesSet(failure(spi.ErrTooLarge, "hint grouping count limit exceeded"))
		}
		bytes := 0
		if !boundedBytes(&bytes, q.limits.MaxLabelBytes, hints.Func) {
			return storage.ErrSeriesSet(failure(spi.ErrTooLarge, "hint bytes limit exceeded"))
		}
		for _, name := range hints.Grouping {
			if !boundedBytes(&bytes, q.limits.MaxLabelBytes, name) {
				return storage.ErrSeriesSet(failure(spi.ErrTooLarge, "hint bytes limit exceeded"))
			}
			if !model.LabelName(name).IsValid() || reserved(name) {
				return storage.ErrSeriesSet(failure(spi.ErrBadRequest, "invalid hint grouping"))
			}
		}
		if bytes > q.limits.MaxLabelBytes {
			return storage.ErrSeriesSet(failure(spi.ErrTooLarge, "hint bytes limit exceeded"))
		}
		if err := q.charge(bytes); err != nil {
			return storage.ErrSeriesSet(err)
		}
		if len(hints.Grouping) > q.limits.MaxMetadataBytes/16 {
			return storage.ErrSeriesSet(failure(spi.ErrTooLarge, "hint metadata budget exceeded"))
		}
		if err := q.charge(len(hints.Grouping) * 16); err != nil {
			return storage.ErrSeriesSet(err)
		}
		grouping := make([]string, len(hints.Grouping))
		for i, name := range hints.Grouping {
			grouping[i] = strings.Clone(name)
		}
		request.Start = max(request.Start, hints.Start)
		request.End = min(request.End, hints.End)
		request.Hints = spi.SelectHints{Start: request.Start, End: request.End, Step: hints.Step, Func: strings.Clone(hints.Func), Grouping: grouping, By: hints.By, Range: hints.Range}
	}
	if request.Start > request.End {
		return storage.EmptySeriesSet()
	}
	owner, err := q.retain(ctx, request)
	if err != nil {
		return storage.ErrSeriesSet(err)
	}
	return &seriesSet{q: q, owner: owner, request: request, sourceCtx: ctx}
}
