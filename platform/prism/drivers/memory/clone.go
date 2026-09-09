package memory

import (
	"maps"
	"slices"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func cloneLabels(labels utm.Labels) utm.Labels {
	return slices.Clone(labels)
}

func cloneLogRecord(record utm.LogRecord) utm.LogRecord {
	record.Resource = record.Resource.Clone()
	record.Labels = cloneLabels(record.Labels)
	record.Attrs = maps.Clone(record.Attrs)
	return record
}

func cloneSpan(span utm.Span) utm.Span {
	span.Resource = span.Resource.Clone()
	span.Attrs = maps.Clone(span.Attrs)
	span.Events = slices.Clone(span.Events)
	for i := range span.Events {
		span.Events[i].Attrs = maps.Clone(span.Events[i].Attrs)
	}
	span.Links = slices.Clone(span.Links)
	for i := range span.Links {
		span.Links[i].Attrs = maps.Clone(span.Links[i].Attrs)
	}
	return span
}

func labelsMatch(labels utm.Labels, matchers []spi.Matcher) bool {
	for _, matcher := range matchers {
		if !matcher.Matches(labels.Get(matcher.Name)) {
			return false
		}
	}
	return true
}
