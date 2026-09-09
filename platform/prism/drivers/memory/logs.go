package memory

import (
	"cmp"
	"context"
	"maps"
	"slices"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type logStore struct {
	state *state
}

type storedLog struct {
	record utm.LogRecord
	seq    uint64
}

func (s *logStore) Write(ctx context.Context, batch []utm.LogRecord) error {
	prepared := make([]utm.LogRecord, len(batch))
	for i, record := range batch {
		if err := contextError(ctx, "logs.Write"); err != nil {
			return err
		}
		prepared[i] = cloneLogRecord(record)
	}

	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	if err := contextError(ctx, "logs.Write"); err != nil {
		return err
	}
	if s.state.closed {
		return closedError("logs.Write")
	}
	if len(batch) == 0 {
		return badRequestError("logs.Write", "log batch must not be empty")
	}
	for _, record := range prepared {
		if record.Resource == nil {
			return badRequestError("logs.Write", "log resource must not be nil")
		}
	}
	for _, record := range prepared {
		s.state.nextSeq++
		s.state.logs = append(s.state.logs, storedLog{record: record, seq: s.state.nextSeq})
	}
	return nil
}

func (s *logStore) Search(ctx context.Context, q spi.LogQuery) (spi.LogIterator, error) {
	if err := contextError(ctx, "logs.Search"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("logs.Search")
	}

	matches := make([]storedLog, 0)
	for _, stored := range s.state.logs {
		if err := contextError(ctx, "logs.Search"); err != nil {
			return nil, err
		}
		if logMatches(stored.record, q.Tenant, q.Selectors, q.Start, q.End) {
			matches = append(matches, stored)
		}
	}
	slices.SortStableFunc(matches, func(a, b storedLog) int {
		if a.record.TS != b.record.TS {
			if q.Direction == spi.Forward {
				return cmp.Compare(a.record.TS, b.record.TS)
			}
			return cmp.Compare(b.record.TS, a.record.TS)
		}
		return cmp.Compare(a.seq, b.seq)
	})

	records := make([]utm.LogRecord, len(matches))
	for i, stored := range matches {
		records[i] = cloneLogRecord(stored.record)
	}
	return spi.SliceLogIterator(records), nil
}

func (s *logStore) LabelNames(ctx context.Context, q spi.LabelQuery) ([]string, error) {
	if err := contextError(ctx, "logs.LabelNames"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("logs.LabelNames")
	}

	names := make(map[string]struct{})
	for _, stored := range s.state.logs {
		if err := contextError(ctx, "logs.LabelNames"); err != nil {
			return nil, err
		}
		if !logMatches(stored.record, q.Tenant, q.Matchers, q.Start, q.End) {
			continue
		}
		for _, label := range stored.record.Labels {
			if !utm.IsReserved(label.Name) {
				names[label.Name] = struct{}{}
			}
		}
	}
	return applyLimit(slices.Sorted(maps.Keys(names)), q.Limit), nil
}

func (s *logStore) LabelValues(ctx context.Context, name string, q spi.LabelQuery) ([]string, error) {
	if err := contextError(ctx, "logs.LabelValues"); err != nil {
		return nil, err
	}
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	if s.state.closed {
		return nil, closedError("logs.LabelValues")
	}
	if name == "" {
		return nil, badRequestError("logs.LabelValues", "label name must not be empty")
	}

	values := make(map[string]struct{})
	for _, stored := range s.state.logs {
		if err := contextError(ctx, "logs.LabelValues"); err != nil {
			return nil, err
		}
		if !logMatches(stored.record, q.Tenant, q.Matchers, q.Start, q.End) || !stored.record.Labels.Has(name) {
			continue
		}
		values[stored.record.Labels.Get(name)] = struct{}{}
	}
	return applyLimit(slices.Sorted(maps.Keys(values)), q.Limit), nil
}

func logMatches(record utm.LogRecord, tenant string, matchers []spi.Matcher, start, end int64) bool {
	return record.Resource != nil && record.Resource.Tenant == tenant && record.TS >= start && record.TS < end &&
		labelsMatch(record.Labels, matchers)
}
