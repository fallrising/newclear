package spi

import (
	"cmp"
	"slices"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// SeriesSet streams metric series in ascending label order.
type SeriesSet interface {
	Next() bool
	At() Series
	Err() error
	Warnings() []string
	Close() error
}

// Series provides labels and a timestamp-ordered sample iterator.
type Series interface {
	Labels() utm.Labels
	Samples() SampleIterator
}

// SampleIterator streams samples with strictly increasing millisecond
// timestamps.
type SampleIterator interface {
	Next() bool
	At() (ts int64, v float64)
	Err() error
}

// LogIterator streams log records in the requested query direction.
type LogIterator interface {
	Next() bool
	At() utm.LogRecord
	Err() error
	Close() error
}

// SpanIterator streams trace spans.
type SpanIterator interface {
	Next() bool
	At() utm.Span
	Err() error
	Close() error
}

// LogStream streams live log records and closes its channel on Close.
type LogStream interface {
	Chan() <-chan utm.LogRecord
	Err() error
	Close() error
}

// EmptySeriesSet returns an empty, successful series set.
func EmptySeriesSet() SeriesSet {
	return SliceSeriesSet(nil)
}

// ErrSeriesSet returns a series set that immediately fails with err.
func ErrSeriesSet(err error) SeriesSet {
	return &sliceSeriesSet{index: -1, err: err}
}

// SliceSeriesSet constructs a series set from a slice, sorting series by
// labels and samples by timestamp without mutating the input.
func SliceSeriesSet(series []SeriesData) SeriesSet {
	normalized := make([]SeriesData, len(series))
	for i, data := range series {
		normalized[i] = data
		normalized[i].Labels = slices.Clone(data.Labels)
		normalized[i].Samples = slices.Clone(data.Samples)
		slices.SortStableFunc(normalized[i].Samples, func(a, b Sample) int {
			return cmp.Compare(a.TS, b.TS)
		})
		normalized[i].Samples = slices.CompactFunc(normalized[i].Samples, func(a, b Sample) bool {
			return a.TS == b.TS
		})
	}
	slices.SortFunc(normalized, func(a, b SeriesData) int {
		return compareLabels(a.Labels, b.Labels)
	})
	return &sliceSeriesSet{series: normalized, index: -1}
}

// EmptyLogIterator returns an empty, successful log iterator.
func EmptyLogIterator() LogIterator {
	return SliceLogIterator(nil)
}

// SliceLogIterator constructs a log iterator without mutating recs.
func SliceLogIterator(recs []utm.LogRecord) LogIterator {
	return &sliceLogIterator{records: slices.Clone(recs), index: -1}
}

// EmptySpanIterator returns an empty, successful span iterator.
func EmptySpanIterator() SpanIterator {
	return SliceSpanIterator(nil)
}

// SliceSpanIterator constructs a span iterator without mutating spans.
func SliceSpanIterator(spans []utm.Span) SpanIterator {
	return &sliceSpanIterator{spans: slices.Clone(spans), index: -1}
}

type sliceSeriesSet struct {
	series   []SeriesData
	index    int
	err      error
	warnings []string
	closed   bool
}

func (s *sliceSeriesSet) Next() bool {
	if s.closed || s.err != nil || s.index+1 >= len(s.series) {
		return false
	}
	s.index++
	return true
}

func (s *sliceSeriesSet) At() Series {
	if s.index < 0 || s.index >= len(s.series) {
		return nil
	}
	return sliceSeries{data: &s.series[s.index]}
}

func (s *sliceSeriesSet) Err() error { return s.err }

func (s *sliceSeriesSet) Warnings() []string { return slices.Clone(s.warnings) }

func (s *sliceSeriesSet) Close() error {
	s.closed = true
	return nil
}

type sliceSeries struct {
	data *SeriesData
}

func (s sliceSeries) Labels() utm.Labels { return s.data.Labels }

func (s sliceSeries) Samples() SampleIterator {
	return &sliceSampleIterator{samples: s.data.Samples, index: -1}
}

type sliceSampleIterator struct {
	samples []Sample
	index   int
}

func (i *sliceSampleIterator) Next() bool {
	if i.index+1 >= len(i.samples) {
		return false
	}
	i.index++
	return true
}

func (i *sliceSampleIterator) At() (int64, float64) {
	if i.index < 0 || i.index >= len(i.samples) {
		return 0, 0
	}
	sample := i.samples[i.index]
	return sample.TS, sample.Value
}

func (*sliceSampleIterator) Err() error { return nil }

type sliceLogIterator struct {
	records []utm.LogRecord
	index   int
	closed  bool
}

func (i *sliceLogIterator) Next() bool {
	if i.closed || i.index+1 >= len(i.records) {
		return false
	}
	i.index++
	return true
}

func (i *sliceLogIterator) At() utm.LogRecord {
	if i.index < 0 || i.index >= len(i.records) {
		return utm.LogRecord{}
	}
	return i.records[i.index]
}

func (*sliceLogIterator) Err() error { return nil }

func (i *sliceLogIterator) Close() error {
	i.closed = true
	return nil
}

type sliceSpanIterator struct {
	spans  []utm.Span
	index  int
	closed bool
}

func (i *sliceSpanIterator) Next() bool {
	if i.closed || i.index+1 >= len(i.spans) {
		return false
	}
	i.index++
	return true
}

func (i *sliceSpanIterator) At() utm.Span {
	if i.index < 0 || i.index >= len(i.spans) {
		return utm.Span{}
	}
	return i.spans[i.index]
}

func (*sliceSpanIterator) Err() error { return nil }

func (i *sliceSpanIterator) Close() error {
	i.closed = true
	return nil
}

func compareLabels(a, b utm.Labels) int {
	for i := range min(len(a), len(b)) {
		if order := cmp.Compare(a[i].Name, b[i].Name); order != 0 {
			return order
		}
		if order := cmp.Compare(a[i].Value, b[i].Value); order != 0 {
			return order
		}
	}
	return cmp.Compare(len(a), len(b))
}
