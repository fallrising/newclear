package memory

import (
	"cmp"
	"context"
	"maps"
	"slices"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type traceStore struct {
	state *state
}

type spanKey struct {
	tenant  string
	traceID string
	spanID  string
}

type storedSpan struct {
	span utm.Span
	seq  uint64
}

type traceAggregate struct {
	traceID      string
	matchStart   int64
	matchEnd     int64
	rootDuration int64
	maxDuration  int64
	hasRoot      bool
	matched      bool
}

type operationKey struct {
	name string
	kind string
}

func (s *traceStore) Write(ctx context.Context, batch []utm.Span) error {
	prepared := make([]utm.Span, len(batch))
	for i, span := range batch {
		if err := contextError(ctx, "traces.Write"); err != nil {
			return err
		}
		prepared[i] = cloneSpan(span)
	}

	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	if err := contextError(ctx, "traces.Write"); err != nil {
		return err
	}
	if s.state.closed {
		return closedError("traces.Write")
	}
	if len(batch) == 0 {
		return badRequestError("traces.Write", "span batch must not be empty")
	}
	for _, span := range prepared {
		if span.Resource == nil {
			return badRequestError("traces.Write", "span resource must not be nil")
		}
	}
	for _, span := range prepared {
		s.state.nextSeq++
		key := spanKey{tenant: span.Resource.Tenant, traceID: span.TraceID, spanID: span.SpanID}
		s.state.spans[key] = storedSpan{span: span, seq: s.state.nextSeq}
	}
	return nil
}

func (s *traceStore) GetTrace(ctx context.Context, tenant, traceID string) (spi.SpanIterator, error) {
	if err := contextError(ctx, "traces.GetTrace"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("traces.GetTrace")
	}

	matches := make([]storedSpan, 0)
	for key, stored := range s.state.spans {
		if err := contextError(ctx, "traces.GetTrace"); err != nil {
			return nil, err
		}
		if key.tenant == tenant && key.traceID == traceID {
			matches = append(matches, stored)
		}
	}
	slices.SortStableFunc(matches, func(a, b storedSpan) int {
		if order := cmp.Compare(a.span.StartNano, b.span.StartNano); order != 0 {
			return order
		}
		return cmp.Compare(a.seq, b.seq)
	})
	spans := make([]utm.Span, len(matches))
	for i, stored := range matches {
		spans[i] = cloneSpan(stored.span)
	}
	return spi.SliceSpanIterator(spans), nil
}

func (s *traceStore) FindTraceIDs(ctx context.Context, q spi.TraceQuery) ([]spi.TraceIDWithTime, error) {
	if err := contextError(ctx, "traces.FindTraceIDs"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("traces.FindTraceIDs")
	}

	aggregates := make(map[string]*traceAggregate)
	for key, stored := range s.state.spans {
		if err := contextError(ctx, "traces.FindTraceIDs"); err != nil {
			return nil, err
		}
		if key.tenant != q.Tenant {
			continue
		}
		aggregate := aggregates[key.traceID]
		if aggregate == nil {
			aggregate = &traceAggregate{traceID: key.traceID}
			aggregates[key.traceID] = aggregate
		}
		aggregate.add(stored.span, traceSpanMatches(stored.span, q))
	}

	results := make([]spi.TraceIDWithTime, 0)
	for _, aggregate := range aggregates {
		if err := contextError(ctx, "traces.FindTraceIDs"); err != nil {
			return nil, err
		}
		if !aggregate.matched || !traceDurationMatches(aggregate.duration(), q.MinDuration, q.MaxDuration) {
			continue
		}
		results = append(results, spi.TraceIDWithTime{
			TraceID:   aggregate.traceID,
			StartNano: aggregate.matchStart,
			EndNano:   aggregate.matchEnd,
		})
	}
	slices.SortFunc(results, func(a, b spi.TraceIDWithTime) int {
		if order := cmp.Compare(b.StartNano, a.StartNano); order != 0 {
			return order
		}
		return cmp.Compare(a.TraceID, b.TraceID)
	})
	return applyLimit(results, q.Limit), nil
}

func (s *traceStore) Services(ctx context.Context, tenant string, tr spi.TimeRange) ([]string, error) {
	if err := contextError(ctx, "traces.Services"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("traces.Services")
	}

	services := make(map[string]struct{})
	for key, stored := range s.state.spans {
		if err := contextError(ctx, "traces.Services"); err != nil {
			return nil, err
		}
		if key.tenant != tenant || !spanInRange(stored.span, tr) || stored.span.Resource.Service == "" {
			continue
		}
		services[stored.span.Resource.Service] = struct{}{}
	}
	return slices.Sorted(maps.Keys(services)), nil
}

func (s *traceStore) Operations(
	ctx context.Context,
	tenant, service, spanKind string,
	tr spi.TimeRange,
) ([]spi.Operation, error) {
	if err := contextError(ctx, "traces.Operations"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("traces.Operations")
	}

	operations := make(map[operationKey]struct{})
	for key, stored := range s.state.spans {
		if err := contextError(ctx, "traces.Operations"); err != nil {
			return nil, err
		}
		span := stored.span
		if key.tenant != tenant || !spanInRange(span, tr) || span.Resource.Service != service ||
			spanKind != "" && span.Kind.String() != spanKind {
			continue
		}
		operations[operationKey{name: span.Name, kind: span.Kind.String()}] = struct{}{}
	}
	keys := slices.Collect(maps.Keys(operations))
	slices.SortFunc(keys, func(a, b operationKey) int {
		if order := cmp.Compare(a.name, b.name); order != 0 {
			return order
		}
		return cmp.Compare(a.kind, b.kind)
	})
	result := make([]spi.Operation, len(keys))
	for i, key := range keys {
		result[i] = spi.Operation{Name: key.name, SpanKind: key.kind}
	}
	return result, nil
}

func (a *traceAggregate) add(span utm.Span, matched bool) {
	duration := span.DurationNano()
	if matched {
		if !a.matched {
			a.matchStart = span.StartNano
			a.matchEnd = span.EndNano
		} else {
			a.matchStart = min(a.matchStart, span.StartNano)
			a.matchEnd = max(a.matchEnd, span.EndNano)
		}
		a.matched = true
	}
	a.maxDuration = max(a.maxDuration, duration)
	if span.IsRoot() {
		if !a.hasRoot {
			a.rootDuration = duration
			a.hasRoot = true
		} else {
			a.rootDuration = max(a.rootDuration, duration)
		}
	}
}

func (a *traceAggregate) duration() int64 {
	if a.hasRoot {
		return a.rootDuration
	}
	return a.maxDuration
}

func traceSpanMatches(span utm.Span, q spi.TraceQuery) bool {
	if span.Resource == nil || span.StartNano < q.Start || span.StartNano >= q.End ||
		span.Resource.Service != q.Service {
		return false
	}
	if q.Operation != "" && span.Name != q.Operation {
		return false
	}
	if q.SpanKind != "" && span.Kind.String() != q.SpanKind {
		return false
	}
	for key, value := range q.Tags {
		if span.Attrs[key] != value {
			return false
		}
	}
	return true
}

func traceDurationMatches(duration int64, minimum, maximum time.Duration) bool {
	if minimum > 0 && duration < int64(minimum) {
		return false
	}
	return maximum <= 0 || duration <= int64(maximum)
}

func spanInRange(span utm.Span, tr spi.TimeRange) bool {
	return span.StartNano >= tr.Start && span.StartNano < tr.End
}
