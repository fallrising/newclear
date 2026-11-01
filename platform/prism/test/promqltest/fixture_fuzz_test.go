package promqltest

import (
	"math"
	"testing"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/model/value"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
)

func FuzzFixtureFloatRoundTrip(f *testing.F) {
	for _, bits := range []uint64{0, 1, 1 << 63, math.Float64bits(math.Inf(1)), math.Float64bits(math.Inf(-1)), value.StaleNaN, math.Float64bits(math.NaN())} {
		f.Add(int64(0), bits)
	}
	f.Fuzz(func(t *testing.T, ts int64, bits uint64) {
		fixture := newFixtureStorage(t)
		t.Cleanup(func() {
			if err := fixture.Close(); err != nil {
				t.Error(err)
			}
		})
		app := fixture.Appender(t.Context())
		metric := labels.FromStrings(labels.MetricName, "fuzz_float")
		if _, err := app.Append(0, metric, ts, math.Float64frombits(bits)); err != nil {
			t.Fatal(err)
		}
		if err := app.Commit(); err != nil {
			t.Fatal(err)
		}
		querier, err := fixture.Querier(ts, ts)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := querier.Close(); err != nil {
				t.Error(err)
			}
		}()
		matcher, err := labels.NewMatcher(labels.MatchEqual, labels.MetricName, "fuzz_float")
		if err != nil {
			t.Fatal(err)
		}
		set := querier.Select(t.Context(), true, nil, matcher)
		if !set.Next() {
			t.Fatalf("missing series: %v", set.Err())
		}
		iterator := set.At().Iterator(nil)
		if iterator.Next() != chunkenc.ValFloat {
			t.Fatal("missing float sample")
		}
		gotTS, gotValue := iterator.At()
		if gotTS != ts || math.Float64bits(gotValue) != bits {
			t.Fatalf("round trip ts=%d bits=%x; got ts=%d bits=%x", ts, bits, gotTS, math.Float64bits(gotValue))
		}
		if iterator.Next() != chunkenc.ValNone || iterator.Err() != nil {
			t.Fatalf("iterator final: %v", iterator.Err())
		}
		if set.Next() || set.Err() != nil {
			t.Fatalf("series final: %v", set.Err())
		}
	})
}
