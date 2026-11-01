package security_test

import (
	"context"
	"testing"
	"time"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql"

	"github.com/fallrising/newclear/platform/prism/internal/query/promqladapter"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func TestPromQLStorageTenantBoundary(t *testing.T) {
	ctx := t.Context()
	backend, err := spi.Open(ctx, "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Error(err)
		}
	})
	for tenant, value := range map[string]float64{"trusted": 7, "other": 991} {
		if err := backend.Metrics().Write(ctx, []utm.MetricPoint{{
			Labels: labels.FromStrings("__name__", "secure_metric", "__tenant__", tenant, "job", "api"),
			TS:     1000,
			Value:  value,
		}}); err != nil {
			t.Fatal(err)
		}
	}
	engine := promql.NewEngine(promql.EngineOpts{
		MaxSamples: 10000, Timeout: 10 * time.Second, LookbackDelta: 5 * time.Minute,
		EnableAtModifier: true, EnableNegativeOffset: true,
		NoStepSubqueryIntervalFn: func(int64) int64 { return 1000 },
	})
	for _, expr := range []string{
		"secure_metric",
		"sum(secure_metric)",
		"max_over_time(secure_metric[2s:1s])",
		`label_replace(secure_metric, "copy", "$1", "__tenant__", "(.*)")`,
	} {
		t.Run(expr, func(t *testing.T) {
			result := runSecurePromQL(t, ctx, engine, backend.Metrics(), "trusted", expr)
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			vector, err := result.Vector()
			if err != nil || len(vector) != 1 || vector[0].F != 7 {
				t.Fatalf("tenant-scoped result=%v, err=%v", vector, err)
			}
			if vector[0].Metric.Has(utm.LabelTenant) || vector[0].Metric.Get("copy") != "" {
				t.Fatal("internal tenant label exposed through engine evaluation")
			}
		})
	}
	t.Run("synthetic output label cannot select another tenant", func(t *testing.T) {
		result := runSecurePromQL(t, ctx, engine, backend.Metrics(), "trusted",
			`label_replace(secure_metric, "__tenant__", "other", "job", ".*")`)
		vector, err := result.Vector()
		if err != nil || len(vector) != 1 || vector[0].F != 7 || vector[0].Metric.Get(utm.LabelTenant) != "other" {
			t.Fatalf("synthetic label changed storage tenant: result=%v, err=%v", vector, err)
		}
	})
	for _, expr := range []string{
		`secure_metric{__tenant__="other"}`,
		`secure_metric{__tenant__!="trusted"}`,
		`secure_metric{__tenant__=~".*"}`,
		`max_over_time(secure_metric{__tenant__="other"}[2s:1s])`,
		`label_replace(secure_metric{__tenant__="other"}, "job", "changed", "job", ".*")`,
	} {
		t.Run(expr, func(t *testing.T) {
			result := runSecurePromQL(t, ctx, engine, backend.Metrics(), "trusted", expr)
			if result.Err == nil {
				t.Fatal("reserved selector was accepted")
			}
		})
	}
	result := runSecurePromQL(t, ctx, engine, backend.Metrics(), "unknown", "secure_metric")
	vector, err := result.Vector()
	if err != nil || len(vector) != 0 {
		t.Fatalf("unknown tenant result=%v, err=%v", vector, err)
	}
	querier, err := promqladapter.New(backend.Metrics(), "trusted", promqladapter.Limits{}).Querier(0, 2000)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := querier.Close(); err != nil {
			t.Error(err)
		}
	}()
	if _, _, err := querier.LabelValues(ctx, utm.LabelTenant); err == nil {
		t.Fatal("reserved label enumeration accepted")
	}
	names, _, err := querier.LabelNames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		if utm.IsReserved(name) && name != utm.LabelName {
			t.Fatalf("internal label name exposed: %s", name)
		}
	}
}

func runSecurePromQL(t *testing.T, ctx context.Context, engine *promql.Engine, store spi.MetricStore, tenant, expr string) *promql.Result {
	t.Helper()
	query, err := engine.NewInstantQuery(ctx, promqladapter.New(store, tenant, promqladapter.Limits{}),
		promql.NewPrometheusQueryOpts(false, 5*time.Minute), expr, utm.MilliToTime(2000))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(query.Close)
	return query.Exec(ctx)
}
