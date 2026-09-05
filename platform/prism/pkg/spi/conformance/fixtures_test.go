package conformance

import (
	"reflect"
	"testing"
	"time"
)

func TestFixturesAreDeterministic(t *testing.T) {
	t.Parallel()

	first := NewFixtures()
	second := NewFixtures()
	if first.Seed != 20260905 || second.Seed != 20260905 {
		t.Fatalf("fixture seeds = %d, %d; want 20260905", first.Seed, second.Seed)
	}
	tests := []struct {
		name string
		got  any
		want any
	}{
		{name: "metrics", got: first.Metrics(3, 4, 1_000, time.Second), want: second.Metrics(3, 4, 1_000, time.Second)},
		{name: "logs", got: first.Logs(3, 4, 1_000, time.Second), want: second.Logs(3, 4, 1_000, time.Second)},
		{name: "traces", got: first.Trace(3, 4, 1_000), want: second.Trace(3, 4, 1_000)},
		{name: "high cardinality", got: first.HighCardinality(100, 1_000), want: second.HighCardinality(100, 1_000)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if !reflect.DeepEqual(test.got, test.want) {
				t.Fatal("fixture output differs for identical seeds")
			}
		})
	}
}

func TestFixturesSeedChangesOutput(t *testing.T) {
	t.Parallel()

	baseline := NewFixtures().Metrics(1, 1, 0, time.Second)
	changed := (&Fixtures{Seed: 1}).Metrics(1, 1, 0, time.Second)
	if reflect.DeepEqual(baseline, changed) {
		t.Fatal("different fixture seeds produced identical metrics")
	}
}

func TestFixturesShapeAndTimeUnits(t *testing.T) {
	t.Parallel()

	fixtures := NewFixtures()
	metrics := fixtures.Metrics(2, 3, 1_000, time.Second)
	if len(metrics) != 6 || metrics[1].TS-metrics[0].TS != 1_000 {
		t.Fatalf("Metrics() shape or millisecond step is wrong: %#v", metrics)
	}
	logs := fixtures.Logs(2, 3, 1_000, time.Second)
	if len(logs) != 6 || logs[1].TS-logs[0].TS != int64(time.Second) {
		t.Fatalf("Logs() shape or nanosecond step is wrong: %#v", logs)
	}
	spans := fixtures.Trace(2, 3, 1_000)
	if len(spans) != 6 || spans[0].ParentSpanID != "" || spans[1].ParentSpanID != spans[0].SpanID {
		t.Fatalf("Trace() shape or parent chain is wrong: %#v", spans)
	}
	if got := fixtures.HighCardinality(10, 1_000); len(got) != 10 {
		t.Fatalf("HighCardinality() returned %d points, want 10", len(got))
	}
}
