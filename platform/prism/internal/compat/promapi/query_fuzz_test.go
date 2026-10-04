package promapi

import (
	"testing"
	"time"

	"github.com/prometheus/prometheus/promql/parser"
)

func FuzzQueryAST(f *testing.F) {
	for _, seed := range []string{"up", "rate(up[5m])", "rate(up[1h] @ 0)", "sum by (__tenant__) (up)", "up[1h:1ms]", "label_replace(up,\"x\",\"y\",\"__tenant__\",\".*\")"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, expression string) {
		if len(expression) > 4096 {
			return
		}
		parsed, err := parser.ParseExpr(expression)
		if err != nil {
			return
		}
		now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
		_, _, _ = validateQueryAST(parsed, now.Add(-time.Hour), now, now, 30*24*time.Hour, 5*time.Minute)
	})
}
