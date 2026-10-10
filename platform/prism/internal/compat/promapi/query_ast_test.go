package promapi

import (
	"strings"
	"testing"
	"time"

	"github.com/prometheus/prometheus/promql/parser"
)

func TestQueryASTSelectorPresence(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		expr string
		want bool
	}{
		{"1+1", false}, {"-((2*3))", false}, {`"up[5m]"`, false}, {"time()", false}, {"vector(time())", false}, {"sum(vector(2))", false},
		{"max_over_time(vector(2)[5m:1m])", false},
		{"up", true}, {"up[5m]", true}, {"scalar(up)", true}, {"rate(up[5m])", true}, {"max_over_time(up[5m:1m])", true},
		{"vector(1) or up", true}, {"up or vector(1)", true}, {"sum by (job) (up)", true},
	} {
		t.Run(tc.expr, func(t *testing.T) {
			parsed, err := parser.ParseExpr(tc.expr)
			if err != nil {
				t.Fatal(err)
			}
			got, err := inspectQueryAST(parsed, now, 30*24*time.Hour, 5*time.Minute)
			if err != nil || got != tc.want {
				t.Fatalf("selectors=%v want=%v err=%v", got, tc.want, err)
			}
		})
	}
}

func TestStorageFreeASTComplexityBounds(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	t.Run("depth", func(t *testing.T) {
		var expr parser.Expr = &parser.NumberLiteral{Val: 1}
		for range 129 {
			expr = &parser.ParenExpr{Expr: expr}
		}
		if _, err := inspectQueryAST(expr, now, 30*24*time.Hour, 5*time.Minute); err == nil || !strings.Contains(err.Error(), "too complex") {
			t.Fatalf("deep AST err=%v", err)
		}
	})
	t.Run("node count", func(t *testing.T) {
		var tree func(int) parser.Expr
		tree = func(depth int) parser.Expr {
			if depth == 0 {
				return &parser.NumberLiteral{Val: 1}
			}
			return &parser.BinaryExpr{Op: parser.ADD, LHS: tree(depth - 1), RHS: tree(depth - 1)}
		}
		if _, err := inspectQueryAST(tree(12), now, 30*24*time.Hour, 5*time.Minute); err == nil || !strings.Contains(err.Error(), "too complex") {
			t.Fatalf("wide AST err=%v", err)
		}
	})
}
