package promqladapter

import (
	"testing"
	"time"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql"
)

func TestUpstreamEngineThroughMemory(t *testing.T) {
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Error(err)
		}
	})
	for _, tenant := range []string{"tenant-a", "tenant-b"} {
		points := []utm.MetricPoint{}
		for index, instance := range []string{"first", "second"} {
			for sample := range 4 {
				points = append(points, utm.MetricPoint{Name: "requests_total", Labels: labels.FromStrings("__name__", "requests_total", "__tenant__", tenant, "instance", instance, "job", "api"), TS: int64(sample) * 1000, Value: float64(sample * (index + 1)), Type: utm.TypeCounter})
			}
		}
		if err := backend.Metrics().Write(t.Context(), points); err != nil {
			t.Fatal(err)
		}
	}
	engine := promql.NewEngine(promql.EngineOpts{MaxSamples: 10000, Timeout: time.Minute, LookbackDelta: 5 * time.Minute, EnableAtModifier: true, EnableNegativeOffset: true, NoStepSubqueryIntervalFn: func(int64) int64 { return 1000 }})
	queryable := New(backend.Metrics(), "tenant-a", Limits{})
	for _, test := range []struct {
		expression string
		want       float64
	}{{"sum(requests_total)", 9}, {"sum(rate(requests_total[3s]))", 3}, {"sum(requests_total @ 2)", 6}, {"sum(requests_total offset -1s)", 9}} {
		t.Run(test.expression, func(t *testing.T) {
			query, err := engine.NewInstantQuery(t.Context(), queryable, nil, test.expression, utm.MilliToTime(3000))
			if err != nil {
				t.Fatal(err)
			}
			defer query.Close()
			result := query.Exec(t.Context())
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			vector, err := result.Vector()
			if err != nil {
				t.Fatal(err)
			}
			if len(vector) != 1 || vector[0].F != test.want {
				t.Fatalf("got %v, want %v", vector, test.want)
			}
		})
	}
	query, err := engine.NewRangeQuery(t.Context(), queryable, nil, "sum(requests_total)", utm.MilliToTime(1000), utm.MilliToTime(3000), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer query.Close()
	result := query.Exec(t.Context())
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	matrix, err := result.Matrix()
	if err != nil {
		t.Fatal(err)
	}
	if len(matrix) != 1 || len(matrix[0].Floats) != 3 {
		t.Fatal(matrix)
	}
	for i, point := range matrix[0].Floats {
		if point.F != float64((i+1)*3) {
			t.Fatal(matrix)
		}
	}
	if err := backend.Ping(t.Context()); err != nil {
		t.Fatal("query closed shared backend", err)
	}
}
