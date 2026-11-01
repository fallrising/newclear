package promqladapter

import (
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
)

func FuzzMatcherValidation(f *testing.F) {
	f.Add(uint8(0), "job", "api")
	f.Add(uint8(2), "job", "[")
	f.Add(uint8(0), "__tenant__", "other")
	f.Add(uint8(255), "job", "")
	f.Fuzz(func(t *testing.T, typ uint8, name, value string) {
		store := &fakeStore{}
		q := testQuerier(t, store, Limits{MaxLabelBytes: 256, MaxRegexBytes: 128})
		set := q.Select(t.Context(), false, nil, &labels.Matcher{Type: labels.MatchType(typ), Name: name, Value: value})
		for set.Next() {
		}
		if set.Err() != nil && len(store.requests) != 0 {
			t.Fatal("invalid matcher accessed backend")
		}
	})
}

func FuzzForwardSeek(f *testing.F) {
	f.Add(int64(-20), int64(0))
	f.Add(int64(100), int64(-20))
	f.Add(int64(101), int64(-20))
	f.Fuzz(func(t *testing.T, first, second int64) {
		store := &fakeStore{data: []spi.SeriesData{sampleData("a", spi.Sample{TS: -20, Value: 1}, spi.Sample{TS: 0, Value: 2}, spi.Sample{TS: 100, Value: 3})}}
		q := testQuerier(t, store, Limits{})
		set := q.Select(t.Context(), false, nil)
		if !set.Next() {
			t.Fatal(set.Err())
		}
		it := set.At().Iterator(nil)
		times := []int64{-20, 0, 100}
		position := -1
		done := false
		for _, target := range []int64{first, second} {
			if !done {
				if position < 0 {
					position = 0
				}
				for position < len(times) && times[position] < target {
					position++
				}
				if position == len(times) {
					done = true
				}
			}
			got := it.Seek(target)
			if done {
				if got != chunkenc.ValNone {
					t.Fatal("exhausted iterator resumed")
				}
			} else if got != chunkenc.ValFloat || it.AtT() != times[position] {
				t.Fatal("seek diverged from forward model", got, it.AtT(), target)
			}
		}
		if it.Err() != nil {
			t.Fatal(it.Err())
		}
	})
}
