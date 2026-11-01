package promqltest

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/histogram"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql"
)

func TestFixture_RealEngineUsesSPI(t *testing.T) {
	fixture := newFixtureStorage(t)
	t.Cleanup(func() {
		if err := fixture.Close(); err != nil {
			t.Error(err)
		}
	})
	app := fixture.Appender(t.Context())
	metric := labels.FromStrings(utm.LabelName, "x", "job", "corpus")
	if _, err := app.Append(0, metric, 0, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Append(0, metric, 60_000, 5); err != nil {
		t.Fatal(err)
	}
	if err := app.Commit(); err != nil {
		t.Fatal(err)
	}
	engine := NewTestEngine(false, 0, DefaultMaxSamplesPerQuery)
	query, err := engine.NewInstantQuery(t.Context(), fixture, nil, "sum(x)", utm.MilliToTime(60_000))
	if err != nil {
		t.Fatal(err)
	}
	defer query.Close()
	result := query.Exec(t.Context())
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	vector, ok := result.Value.(promql.Vector)
	if !ok || len(vector) != 1 || vector[0].F != 5 {
		t.Fatalf("unexpected result %v", result.Value)
	}
	if fixture.selects == 0 || fixture.writes != 1 || fixture.rows != 2 {
		t.Fatalf("SPI not exercised: %+v", fixture)
	}
	t.Logf("actual SPI writes=%d rows=%d selects=%d", fixture.writes, fixture.rows, fixture.selects)
}

func TestFixture_NativeCancellationRollbackAndBounds(t *testing.T) {
	fixture := newFixtureStorage(t)
	t.Cleanup(func() {
		if err := fixture.Close(); err != nil {
			t.Error(err)
		}
	})
	metric := labels.FromStrings(utm.LabelName, "x")
	app := fixture.Appender(t.Context())
	if _, err := app.AppendHistogram(0, metric, 0, nil, &histogram.FloatHistogram{}); err == nil {
		t.Fatal("accepted native histogram")
	}
	if _, err := app.Append(0, metric, 0, math.Inf(1)); err != nil {
		t.Fatal(err)
	}
	if err := app.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := app.Commit(); err != nil {
		t.Fatal(err)
	}
	if fixture.rows != 0 {
		t.Fatal("rollback wrote samples")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := fixture.Appender(ctx).Append(0, metric, 0, 1); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	fixture.rows = fixtureMaxRows
	if _, err := app.Append(0, metric, 0, 1); err == nil {
		t.Fatal("accepted excess rows")
	}
	fixture.rows = 0
	giant := labels.FromStrings(utm.LabelName, "x", "label", strings.Repeat("x", fixtureMaxLabelBytes))
	if _, err := app.Append(0, giant, 0, 1); err == nil {
		t.Fatal("accepted excess label bytes")
	}
}
