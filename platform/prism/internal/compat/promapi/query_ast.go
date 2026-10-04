package promapi

import (
	"errors"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/promql"
	"github.com/prometheus/prometheus/promql/parser"
)

// validateQueryAST preflights arithmetic and names before using the pinned
// Prometheus engine's selector-reach calculation. It never clamps inner syntax.
func validateQueryAST(expr parser.Expr, start, end, now time.Time, maxLookback, lookback time.Duration) (time.Time, time.Time, error) {
	floor := now.Add(-maxLookback)
	ceiling := now.Add(lookback)
	nodes := 0
	var visit func(parser.Node, int, time.Duration, bool) error
	visit = func(node parser.Node, depth int, reach time.Duration, matrix bool) error {
		nodes++
		if depth > 128 || nodes > 4096 {
			return errors.New("query too complex")
		}
		switch n := node.(type) {
		case *parser.AggregateExpr:
			if slices.ContainsFunc(n.Grouping, reservedQueryLabel) {
				return errors.New("reserved grouping label")
			}
			if n.Op == parser.COUNT_VALUES {
				if dest, ok := stringLiteral(n.Param); ok && reservedQueryLabel(dest) {
					return errors.New("reserved aggregate destination")
				}
			}
		case *parser.BinaryExpr:
			if n.VectorMatching != nil {
				for _, group := range [][]string{n.VectorMatching.MatchingLabels, n.VectorMatching.Include} {
					if slices.ContainsFunc(group, reservedQueryLabel) {
						return errors.New("reserved matching label")
					}
				}
			}
		case *parser.Call:
			if (n.Func.Name == "label_replace" || n.Func.Name == "label_join") && len(n.Args) > 1 {
				if dest, ok := stringLiteral(n.Args[1]); ok && reservedQueryLabel(dest) {
					return errors.New("reserved destination")
				}
			}
			if (n.Func.Name == "label_replace" || n.Func.Name == "label_join") && len(n.Args) > 3 {
				sources := n.Args[3:]
				if n.Func.Name == "label_replace" {
					sources = n.Args[3:4]
				}
				for _, arg := range sources {
					if source, ok := stringLiteral(arg); ok && reservedQueryLabel(source) {
						return errors.New("reserved source")
					}
				}
			}
		case *parser.SubqueryExpr:
			if n.Range <= 0 || n.Range > maxLookback || absDuration(n.OriginalOffset) > maxLookback {
				return errors.New("subquery range or offset too large")
			}
			increment, ok := sumDuration(n.Range, absDuration(n.OriginalOffset))
			if !ok {
				return errors.New("subquery overflow")
			}
			reach, ok = sumDuration(reach, increment)
			if !ok || reach > maxLookback {
				return errors.New("subquery reach too large")
			}
			step := n.Step
			if step == 0 {
				step = lookback
			}
			stepMillis := int64(step / utm.MetricTimeUnit)
			if stepMillis <= 0 || int64(n.Range/utm.MetricTimeUnit)/stepMillis >= 100000 {
				return errors.New("subquery work too large")
			}
			if err := validateAt(n.Timestamp, n.StartOrEnd, floor, ceiling); err != nil {
				return err
			}
		case *parser.MatrixSelector:
			if n.Range <= 0 || n.Range > maxLookback {
				return errors.New("range too large")
			}
			var ok bool
			reach, ok = sumDuration(reach, n.Range)
			if !ok || reach > maxLookback {
				return errors.New("range reach too large")
			}
			matrix = true
		case *parser.VectorSelector:
			if absDuration(n.OriginalOffset) > maxLookback {
				return errors.New("offset too large")
			}
			increment := absDuration(n.OriginalOffset)
			if !matrix {
				var ok bool
				increment, ok = sumDuration(increment, lookback)
				if !ok {
					return errors.New("lookback overflow")
				}
			}
			total, ok := sumDuration(reach, increment)
			if !ok || total > maxLookback {
				return errors.New("selector reach too large")
			}
			if err := validateAt(n.Timestamp, n.StartOrEnd, floor, ceiling); err != nil {
				return err
			}
			for _, m := range n.LabelMatchers {
				if reservedQueryLabel(m.Name) {
					return errors.New("reserved matcher")
				}
				if len(m.Value) > 4096 && (m.Type.String() == "=~" || m.Type.String() == "!~") {
					return errors.New("regex too large")
				}
			}
		}
		for _, child := range parser.Children(node) {
			if child != nil {
				if err := visit(child, depth+1, reach, matrix); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := visit(expr, 0, 0, false); err != nil {
		return time.Time{}, time.Time{}, err
	}
	prepared := promql.PreprocessExpr(expr, start, end)
	lo, hi := promql.FindMinMaxTime(&parser.EvalStmt{Expr: prepared, Start: start, End: end, LookbackDelta: lookback})
	if lo == 0 && hi == 0 {
		return start, end, nil
	}
	earliest, latest := utm.MilliToTime(lo), utm.MilliToTime(hi)
	if earliest.Before(floor) || latest.After(ceiling) {
		return time.Time{}, time.Time{}, errors.New("selector outside allowed time")
	}
	return earliest, latest, nil
}
func validateAt(ts *int64, kind parser.ItemType, floor, ceiling time.Time) error {
	if ts == nil && kind != parser.START && kind != parser.END {
		return nil
	}
	if ts != nil {
		at := utm.MilliToTime(*ts)
		if at.Before(floor) || at.After(ceiling) {
			return errors.New("@ outside allowed time")
		}
	}
	return nil
}
func absDuration(d time.Duration) time.Duration {
	if d == math.MinInt64 {
		return math.MaxInt64
	}
	if d < 0 {
		return -d
	}
	return d
}
func sumDuration(a, b time.Duration) (time.Duration, bool) {
	if a < 0 || b < 0 || a > math.MaxInt64-b {
		return 0, false
	}
	return a + b, true
}
func reservedQueryLabel(name string) bool { return strings.HasPrefix(name, "__") && name != "__name__" }
func stringLiteral(expr parser.Expr) (string, bool) {
	for range 129 {
		switch n := expr.(type) {
		case *parser.StringLiteral:
			return n.Val, true
		case *parser.ParenExpr:
			expr = n.Expr
		default:
			return "", false
		}
	}
	return "", false // The AST depth guard rejects this expression before dispatch.
}
