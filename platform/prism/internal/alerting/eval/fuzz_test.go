package eval

import (
	"context"
	"log/slog"
	"net/url"
	"testing"
	"time"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/alerting/rules"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

func FuzzRulesQuery(f *testing.F) {
	backend, err := spi.Open(context.Background(), "memory", spi.Config{})
	if err != nil {
		f.Fatal(err)
	}
	f.Cleanup(func() { _ = backend.Close() })
	eng, err := New(Options{Store: backend.Metrics(), Logger: slog.New(slog.DiscardHandler)})
	if err != nil {
		f.Fatal(err)
	}
	if err := eng.Apply([]FileGroup{{
		File: "a.yml",
		Group: rules.Group{
			Name:     "g",
			Interval: time.Second,
			Rules:    []rules.Rule{{Alert: "A", Expr: "vector(1)"}},
		},
	}}); err != nil {
		f.Fatal(err)
	}
	f.Add("type=alert")
	f.Add("type=record")
	f.Add("type=alerting")
	f.Add("type=ALERT")
	f.Add("exclude_alerts=true")
	f.Add("exclude_alerts=maybe")
	f.Add("rule_name[]=A&file[]=a.yml")
	f.Add("")
	f.Fuzz(func(t *testing.T, raw string) {
		if len(raw) > 4096 {
			t.Skip()
		}
		values, err := url.ParseQuery(raw)
		if err != nil {
			return
		}
		_, _ = eng.Rules(t.Context(), values)
		_, _ = eng.Alerts(t.Context())
	})
}
