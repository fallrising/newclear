package promqladapter

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/prometheus/model/histogram"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/storage"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
	"github.com/prometheus/prometheus/util/annotations"
)

type ownedSet struct {
	set     spi.SeriesSet
	ctx     context.Context
	cleanup func()
	slot    int
	closed  bool
}

func (q *querier) retain(ctx context.Context, request spi.SeriesQuery) (*ownedSet, error) {
	if q.selects >= q.limits.MaxSeries {
		return nil, failure(spi.ErrTooLarge, "select call limit exceeded")
	}
	q.selects++
	slot := -1
	for i, set := range q.sets {
		if set == nil {
			slot = i
			break
		}
	}
	if slot < 0 && len(q.sets) >= q.limits.MaxRetainedSets {
		return nil, failure(spi.ErrTooLarge, "retained set limit exceeded")
	}
	if err := q.charge(256); err != nil {
		return nil, err
	}
	joined, cleanup, err := q.operation(ctx)
	if err != nil {
		return nil, err
	}
	set, err := q.store.Select(joined, request)
	if err != nil {
		cleanup()
		if set != nil {
			err = errors.Join(err, set.Close())
		}
		return nil, err
	}
	if set == nil {
		cleanup()
		return nil, failure(spi.ErrInternal, "backend returned nil series set")
	}
	owner := &ownedSet{set: set, ctx: joined, cleanup: cleanup, slot: slot}
	if slot < 0 {
		owner.slot = len(q.sets)
		q.sets = append(q.sets, owner)
	} else {
		q.sets[slot] = owner
	}
	if err = contextError(joined); err != nil {
		return nil, errors.Join(err, q.release(owner))
	}
	return owner, nil
}
func (q *querier) release(owner *ownedSet) error {
	if owner.closed {
		return nil
	}
	owner.closed = true
	owner.cleanup()
	q.sets[owner.slot] = nil
	err := owner.set.Close()
	owner.set = nil
	q.closeErr = errors.Join(q.closeErr, err)
	return err
}
func (q *querier) inspected() error {
	if q.series >= q.limits.MaxSeries {
		return failure(spi.ErrTooLarge, "series inspection limit exceeded")
	}
	q.series++
	return nil
}
func (q *querier) freeze(input labels.Labels) (labels.Labels, error) {
	if len(input) > q.limits.MaxLabelsPerSeries {
		return nil, failure(spi.ErrTooLarge, "series label count limit exceeded")
	}
	bytes := 0
	for _, label := range input {
		if !boundedBytes(&bytes, q.limits.MaxLabelBytes, label.Name) || !boundedBytes(&bytes, q.limits.MaxLabelBytes, label.Value) {
			return nil, failure(spi.ErrTooLarge, "series label bytes limit exceeded")
		}
	}
	if len(input) > q.limits.MaxMetadataBytes/64 {
		return nil, failure(spi.ErrTooLarge, "series label metadata budget exceeded")
	}
	if err := q.charge(len(input) * 64); err != nil {
		return nil, err
	}
	if err := q.charge(bytes); err != nil {
		return nil, err
	}
	if err := q.charge(128); err != nil {
		return nil, err
	}
	result := make(labels.Labels, len(input))
	for i, label := range input {
		result[i] = labels.Label{Name: strings.Clone(label.Name), Value: strings.Clone(label.Value)}
	}
	return result, nil
}

type seriesSet struct {
	q            *querier
	owner        *ownedSet
	request      spi.SeriesQuery
	sourceCtx    context.Context
	current      storage.Series
	err          error
	done         bool
	warnings     annotations.Annotations // Shared cumulative state; protected by q.mu.
	warningBytes int
}

func (s *seriesSet) collectWarnings() {
	warnings := s.owner.set.Warnings()
	if len(warnings) > s.q.limits.MaxLabelResults {
		s.err = errors.Join(s.err, failure(spi.ErrTooLarge, "warning count limit exceeded"))
		return
	}
	bytes := 0
	if s.warnings == nil {
		s.warnings = annotations.Annotations{}
	}
	for _, warning := range warnings {
		if !boundedBytes(&bytes, s.q.limits.MaxLabelBytes, warning) {
			s.err = errors.Join(s.err, failure(spi.ErrTooLarge, "warning bytes limit exceeded"))
			return
		}
		if s.warnings[warning] != nil {
			continue
		}
		if len(s.warnings) >= s.q.limits.MaxLabelResults || len(warning) > s.q.limits.MaxLabelBytes-s.warningBytes {
			s.err = errors.Join(s.err, failure(spi.ErrTooLarge, "cumulative warning limit exceeded"))
			return
		}
		if err := s.q.charge(len(warning)); err != nil {
			s.err = errors.Join(s.err, err)
			return
		}
		if err := s.q.charge(128); err != nil {
			s.err = errors.Join(s.err, err)
			return
		}
		s.warnings.Add(fmt.Errorf("%s", strings.Clone(warning)))
		s.warningBytes += len(warning)
	}
}
func (s *seriesSet) Next() bool {
	s.q.mu.Lock()
	defer s.q.mu.Unlock()
	if s.done {
		return false
	}
	if err := contextError(s.owner.ctx); err != nil {
		s.err = err
		s.done = true
		s.err = errors.Join(s.err, s.q.release(s.owner))
		return false
	}
	if !s.owner.set.Next() {
		s.err = s.owner.set.Err()
		s.collectWarnings()
		s.done = true
		s.err = errors.Join(s.err, s.q.release(s.owner))
		return false
	}
	if err := s.q.inspected(); err != nil {
		s.err = err
		s.done = true
		s.err = errors.Join(s.err, s.q.release(s.owner))
		return false
	}
	source := s.owner.set.At()
	if source == nil {
		s.err = failure(spi.ErrInternal, "backend returned nil series")
		s.done = true
		s.err = errors.Join(s.err, s.q.release(s.owner))
		return false
	}
	frozen, err := s.q.freeze(source.Labels())
	if err != nil {
		s.err = err
		s.done = true
		s.err = errors.Join(s.err, s.q.release(s.owner))
		return false
	}
	exposed := make(labels.Labels, 0, len(frozen))
	for _, label := range frozen {
		if !reserved(label.Name) {
			exposed = append(exposed, label)
		}
	}
	s.collectWarnings()
	s.current = &series{q: s.q, full: frozen, exposed: exposed, request: s.request, ctx: s.sourceCtx, known: s.warnings}
	if s.err != nil {
		s.done = true
		s.err = errors.Join(s.err, s.q.release(s.owner))
		return false
	}
	return true
}
func (s *seriesSet) At() storage.Series { s.q.mu.Lock(); defer s.q.mu.Unlock(); return s.current }
func (s *seriesSet) Err() error         { s.q.mu.Lock(); defer s.q.mu.Unlock(); return s.err }
func (s *seriesSet) Warnings() annotations.Annotations {
	s.q.mu.Lock()
	defer s.q.mu.Unlock()
	out := annotations.Annotations{}
	out.Merge(s.warnings)
	return out
}

type series struct {
	q             *querier
	full, exposed labels.Labels
	request       spi.SeriesQuery
	ctx           context.Context
	known         annotations.Annotations
}

func (s *series) Labels() labels.Labels { return s.exposed }
func (s *series) Iterator(reuse chunkenc.Iterator) chunkenc.Iterator {
	s.q.mu.Lock()
	defer s.q.mu.Unlock()
	iterator, ok := reuse.(*sampleIterator)
	if !ok || iterator.q != s.q {
		iterator = &sampleIterator{}
	}
	var closeErr error
	if iterator.owner != nil {
		closeErr = iterator.q.release(iterator.owner)
	}
	*iterator = sampleIterator{q: s.q, mint: s.request.Start, maxt: s.request.End, err: closeErr, known: s.known}
	if closeErr != nil {
		return iterator
	}
	if err := s.q.charge(128); err != nil {
		iterator.err = err
		return iterator
	}
	request := s.request
	if len(s.full) > s.q.limits.MaxMetadataBytes/64 {
		iterator.err = failure(spi.ErrTooLarge, "reopen matcher metadata budget exceeded")
		return iterator
	}
	if err := s.q.charge(len(s.full) * 64); err != nil {
		iterator.err = err
		return iterator
	}
	request.Matchers = make([]spi.Matcher, 0, len(s.full))
	for _, label := range s.full {
		if reserved(label.Name) {
			continue
		}
		matcher, err := spi.NewMatcher(spi.MatchEqual, label.Name, label.Value)
		if err != nil {
			iterator.err = err
			return iterator
		}
		request.Matchers = append(request.Matchers, matcher)
	}
	owner, err := s.q.retain(s.ctx, request)
	if err != nil {
		iterator.err = err
		return iterator
	}
	iterator.owner = owner
	for {
		if err = contextError(owner.ctx); err != nil {
			break
		}
		if !owner.set.Next() {
			err = owner.set.Err()
			break
		}
		if err = s.q.inspected(); err != nil {
			break
		}
		candidate := owner.set.At()
		if candidate == nil {
			err = failure(spi.ErrInternal, "backend returned nil series")
			break
		}
		candidateLabels := candidate.Labels()
		if len(candidateLabels) > s.q.limits.MaxLabelsPerSeries {
			err = failure(spi.ErrTooLarge, "reopen label count limit exceeded")
			break
		}
		bytes := 0
		for _, label := range candidateLabels {
			if !boundedBytes(&bytes, s.q.limits.MaxLabelBytes, label.Name) || !boundedBytes(&bytes, s.q.limits.MaxLabelBytes, label.Value) {
				err = failure(spi.ErrTooLarge, "reopen label bytes limit exceeded")
				break
			}
		}
		if err != nil {
			break
		}
		if labels.Equal(candidateLabels, s.full) {
			if err = s.q.reopenWarnings(owner, s.known); err != nil {
				break
			}
			iterator.source = candidate.Samples()
			if iterator.source == nil {
				err = failure(spi.ErrInternal, "backend returned nil sample iterator")
				break
			}
			return iterator
		}
	}
	iterator.err = errors.Join(err, s.q.reopenWarnings(owner, s.known), s.q.release(owner))
	iterator.done = true
	return iterator
}

func (q *querier) reopenWarnings(owner *ownedSet, known annotations.Annotations) error {
	if owner.closed {
		return nil
	}
	warnings := owner.set.Warnings()
	if len(warnings) > q.limits.MaxLabelResults {
		return failure(spi.ErrTooLarge, "reopen warning count limit exceeded")
	}
	bytes := 0
	for _, warning := range warnings {
		if !boundedBytes(&bytes, q.limits.MaxLabelBytes, warning) {
			return failure(spi.ErrTooLarge, "reopen warning bytes limit exceeded")
		}
		if known[warning] == nil {
			return failure(spi.ErrUnsupported, "new reopened storage warnings cannot be represented by sample iterator")
		}
	}
	return nil
}

// millisecondTimestamp is the SPI/Prometheus sample timestamp, whose exact
// underlying and alias identity remains int64. Naming its unit also distinguishes
// Prometheus Seek from io.Seeker for Go vet's lexical stdmethods heuristic.
type millisecondTimestamp = int64

var _ chunkenc.Iterator = (*sampleIterator)(nil)

type sampleIterator struct {
	known          annotations.Annotations
	q              *querier
	owner          *ownedSet
	source         spi.SampleIterator
	mint, maxt, ts millisecondTimestamp
	value          float64
	valid, done    bool
	err            error
}

func (i *sampleIterator) finish(err error) chunkenc.ValueType {
	i.done = true
	i.source = nil
	i.valid = false
	i.err = errors.Join(i.err, err)
	if i.owner != nil {
		i.err = errors.Join(i.err, i.q.reopenWarnings(i.owner, i.known))
		i.err = errors.Join(i.err, i.q.release(i.owner))
	}
	return chunkenc.ValNone
}
func (i *sampleIterator) next() chunkenc.ValueType {
	if i.done || i.err != nil || i.source == nil {
		return chunkenc.ValNone
	}
	for {
		if err := contextError(i.owner.ctx); err != nil {
			return i.finish(err)
		}
		if !i.source.Next() {
			return i.finish(i.source.Err())
		}
		if i.q.rows >= i.q.limits.MaxScanRows {
			return i.finish(failure(spi.ErrTooLarge, "sample scan limit exceeded"))
		}
		i.q.rows++
		i.ts, i.value = i.source.At()
		if i.ts < i.mint {
			continue
		}
		if i.ts > i.maxt {
			return i.finish(nil)
		}
		i.valid = true
		return chunkenc.ValFloat
	}
}
func (i *sampleIterator) Next() chunkenc.ValueType {
	i.q.mu.Lock()
	defer i.q.mu.Unlock()
	return i.next()
}

func (i *sampleIterator) Seek(ts millisecondTimestamp) chunkenc.ValueType {
	i.q.mu.Lock()
	defer i.q.mu.Unlock()
	if i.done || i.err != nil || i.source == nil {
		return chunkenc.ValNone
	}
	if i.owner != nil {
		if err := contextError(i.owner.ctx); err != nil {
			return i.finish(err)
		}
	}
	if i.valid && !i.done && i.ts >= ts {
		return chunkenc.ValFloat
	}
	for i.next() != chunkenc.ValNone {
		if i.ts >= ts {
			return chunkenc.ValFloat
		}
	}
	return chunkenc.ValNone
}
func (i *sampleIterator) At() (millisecondTimestamp, float64) {
	i.q.mu.Lock()
	defer i.q.mu.Unlock()
	return i.ts, i.value
}
func (i *sampleIterator) AtT() millisecondTimestamp {
	i.q.mu.Lock()
	defer i.q.mu.Unlock()
	return i.ts
}
func (i *sampleIterator) AtHistogram(*histogram.Histogram) (millisecondTimestamp, *histogram.Histogram) {
	return i.AtT(), nil
}
func (i *sampleIterator) AtFloatHistogram(*histogram.FloatHistogram) (millisecondTimestamp, *histogram.FloatHistogram) {
	return i.AtT(), nil
}
func (i *sampleIterator) Err() error { i.q.mu.Lock(); defer i.q.mu.Unlock(); return i.err }
