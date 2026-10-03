package limits

import (
	"context"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func intPtr(value int) *int { return &value }
func point(metric, value string) utm.MetricPoint {
	return utm.MetricPoint{Name: metric, Labels: labels.FromStrings("id", value)}
}
func TestMetrics_ExistingSeriesContinuesAtCapacity(t *testing.T) {
	limiter, err := New("tenant-a", Options{Tenant: Overrides{MaxActiveSeriesPerTenant: intPtr(2)}})
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"A", "B"} {
		got, _, err := limiter.Metrics(context.Background(), []utm.MetricPoint{point("requests", value)})
		if err != nil || len(got) != 1 {
			t.Fatalf("initial %s rejected: %v", value, err)
		}
	}
	got, report, err := limiter.Metrics(context.Background(), []utm.MetricPoint{point("requests", "C")})
	if err != nil || len(got) != 0 || report.Rejected["cardinality"] != 1 {
		t.Fatalf("new C must be rejected at capacity: len=%d report=%+v err=%v", len(got), report, err)
	}
	got, _, err = limiter.Metrics(context.Background(), []utm.MetricPoint{point("requests", "A")})
	if err != nil || len(got) != 1 {
		t.Fatalf("existing A must continue: len=%d err=%v", len(got), err)
	}
}
