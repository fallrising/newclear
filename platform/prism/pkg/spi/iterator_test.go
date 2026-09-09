package spi

import (
	"errors"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func TestSeriesSetConstructors(t *testing.T) {
	t.Parallel()

	empty := EmptySeriesSet()
	if empty.Next() || empty.At() != nil || empty.Err() != nil || empty.Warnings() != nil {
		t.Fatalf("EmptySeriesSet() has unexpected state")
	}
	if err := empty.Close(); err != nil {
		t.Fatalf("EmptySeriesSet().Close() = %v", err)
	}

	wantErr := errors.New("select failed")
	failed := ErrSeriesSet(wantErr)
	if failed.Next() || failed.At() != nil || !errors.Is(failed.Err(), wantErr) {
		t.Fatalf("ErrSeriesSet() has unexpected state: err=%v", failed.Err())
	}
	if err := failed.Close(); err != nil {
		t.Fatalf("ErrSeriesSet().Close() = %v", err)
	}
}

func TestSliceSeriesSetSortsAndCopies(t *testing.T) {
	t.Parallel()

	input := []SeriesData{
		{
			Labels:  labels.FromStrings("job", "zeta"),
			Samples: []Sample{{TS: 20, Value: 2}, {TS: 10, Value: 1}, {TS: 10, Value: 99}},
		},
		{
			Labels:  labels.FromStrings("job", "alpha"),
			Samples: []Sample{{TS: 30, Value: 3}},
		},
	}
	set := SliceSeriesSet(input)
	input[1].Labels[0].Value = "mutated"
	input[1].Samples[0].Value = 999

	if !set.Next() {
		t.Fatal("first Next() = false")
	}
	first := set.At()
	if got := first.Labels().Get("job"); got != "alpha" {
		t.Fatalf("first series job = %q, want alpha", got)
	}
	firstSamples := collectSamples(t, first.Samples())
	if want := []Sample{{TS: 30, Value: 3}}; !reflect.DeepEqual(firstSamples, want) {
		t.Fatalf("first samples = %v, want %v", firstSamples, want)
	}

	if !set.Next() {
		t.Fatal("second Next() = false")
	}
	second := set.At()
	if got := second.Labels().Get("job"); got != "zeta" {
		t.Fatalf("second series job = %q, want zeta", got)
	}
	secondSamples := collectSamples(t, second.Samples())
	if want := []Sample{{TS: 10, Value: 1}, {TS: 20, Value: 2}}; !reflect.DeepEqual(secondSamples, want) {
		t.Fatalf("second samples = %v, want %v", secondSamples, want)
	}
	if set.Next() || set.Err() != nil {
		t.Fatalf("completed set has unexpected state: err=%v", set.Err())
	}
	if err := set.Close(); err != nil {
		t.Fatalf("Close() = %v", err)
	}
	if set.Next() {
		t.Fatal("Next() after Close() = true")
	}
}

func TestSliceLogIterator(t *testing.T) {
	t.Parallel()

	input := []utm.LogRecord{{Body: "first"}, {Body: "second"}}
	iterator := SliceLogIterator(input)
	input[0].Body = "mutated"
	if !iterator.Next() || iterator.At().Body != "first" {
		t.Fatalf("first log = %#v", iterator.At())
	}
	if !iterator.Next() || iterator.At().Body != "second" {
		t.Fatalf("second log = %#v", iterator.At())
	}
	if iterator.Next() || iterator.Err() != nil {
		t.Fatalf("completed iterator has unexpected state: err=%v", iterator.Err())
	}
	if err := iterator.Close(); err != nil {
		t.Fatalf("Close() = %v", err)
	}
	if iterator.Next() {
		t.Fatal("Next() after Close() = true")
	}

	empty := EmptyLogIterator()
	if empty.Next() || !reflect.DeepEqual(empty.At(), utm.LogRecord{}) || empty.Err() != nil {
		t.Fatal("EmptyLogIterator() has unexpected state")
	}
}

func TestSliceSpanIterator(t *testing.T) {
	t.Parallel()

	input := []utm.Span{{Name: "first"}, {Name: "second"}}
	iterator := SliceSpanIterator(input)
	input[0].Name = "mutated"
	if !iterator.Next() || iterator.At().Name != "first" {
		t.Fatalf("first span = %#v", iterator.At())
	}
	if !iterator.Next() || iterator.At().Name != "second" {
		t.Fatalf("second span = %#v", iterator.At())
	}
	if iterator.Next() || iterator.Err() != nil {
		t.Fatalf("completed iterator has unexpected state: err=%v", iterator.Err())
	}
	if err := iterator.Close(); err != nil {
		t.Fatalf("Close() = %v", err)
	}
	if iterator.Next() {
		t.Fatal("Next() after Close() = true")
	}

	empty := EmptySpanIterator()
	if empty.Next() || !reflect.DeepEqual(empty.At(), utm.Span{}) || empty.Err() != nil {
		t.Fatal("EmptySpanIterator() has unexpected state")
	}
}

func collectSamples(t *testing.T, iterator SampleIterator) []Sample {
	t.Helper()
	var samples []Sample
	for iterator.Next() {
		ts, value := iterator.At()
		samples = append(samples, Sample{TS: ts, Value: value})
	}
	if err := iterator.Err(); err != nil {
		t.Fatalf("sample iterator error = %v", err)
	}
	return samples
}
