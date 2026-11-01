package logql

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestParse_EmptyCompatibleSelector(t *testing.T) {
	for _, query := range []string{`{job=""}`, `{job=~".*"}`, `{job=~"a*"}`, `{job!="a"}`, `{job!~".+"}`, `{}`} {
		t.Run(query, func(t *testing.T) {
			got, err := Parse(t.Context(), query, time.Hour)
			if err == nil {
				t.Fatalf("empty-compatible selector accepted: %#v", got)
			}
			if spi.Classify(err) != spi.ErrBadRequest || err.Error() != nonEmptySelector {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, spi.LogQuery{}) {
				t.Fatalf("partial IR on error: %#v", got)
			}
		})
	}
}

func TestParse_SupportedIR(t *testing.T) {
	query := `{job="api",env!="dev",host=~"a.+",zone!~"x.*"} |= "error" != "debug" |~ "err.*" !~ "noise" | json | status >= 500 | logfmt | latency < 1.5s | size > 2kib | level = "warn" | detail =~ "x.*"`
	got, err := Parse(t.Context(), query, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tenant != "" || got.Start != 0 || got.End != 0 || got.Limit != 0 || got.Direction != 0 || got.Agg != nil {
		t.Fatalf("transport fields populated: %#v", got)
	}
	if len(got.Selectors) != 4 || len(got.Filters) != 4 || len(got.Stages) != 2 || len(got.Fields) != 5 {
		t.Fatalf("wrong IR shape: %#v", got)
	}
	for i, match := range got.Selectors {
		if match.Type != spi.MatchType(i) {
			t.Fatalf("matcher %d: %#v", i, match)
		}
	}
	if got.Selectors[2].Compiled == nil || !got.Selectors[2].Matches("abc") || got.Selectors[2].Matches("zabc") {
		t.Fatal("selector regexp not anchored")
	}
	for i, filter := range got.Filters {
		if filter.Op != spi.LineFilterOp(i) || filter.Compiled != nil || filter.LiteralHint != "" {
			t.Fatalf("filter %d: %#v", i, filter)
		}
	}
	if got.Stages[0].Kind != spi.ParseJSON || got.Stages[1].Kind != spi.ParseLogfmt {
		t.Fatalf("stages: %#v", got.Stages)
	}
	for i, want := range []float64{500, 1.5, 2048} {
		if got.Fields[i].Num == nil || *got.Fields[i].Num != want {
			t.Fatalf("field %d: %#v", i, got.Fields[i])
		}
	}
	if got.Fields[3].Value != "warn" || got.Fields[3].Num != nil || got.Fields[4].Compiled != nil {
		t.Fatalf("fields: %#v", got.Fields)
	}
}

func TestParse_RangeVectorMatrix(t *testing.T) {
	for _, rangeFn := range []string{"count_over_time", "rate", "bytes_over_time", "bytes_rate"} {
		base := rangeFn + `({job="api"}[5m])`
		for _, vectorFn := range []string{"", "sum", "avg", "min", "max", "count", "topk", "bottomk"} {
			for _, placement := range []string{"none", "before", "after"} {
				if vectorFn == "" && placement != "none" {
					continue
				}
				query := base
				if vectorFn != "" {
					prefix := ""
					suffix := ""
					if placement == "before" {
						prefix = " by (job,env)"
					}
					if placement == "after" {
						suffix = " without (job,env)"
					}
					arg := ""
					if vectorFn == "topk" || vectorFn == "bottomk" {
						arg = "3,"
					}
					query = vectorFn + prefix + "(" + arg + base + ")" + suffix
				}
				t.Run(query, func(t *testing.T) {
					got, err := Parse(t.Context(), query, time.Hour)
					if err != nil {
						t.Fatal(err)
					}
					agg := got.Agg
					if agg == nil || agg.RangeFunc != rangeFn || agg.Window != 5*time.Minute || agg.VectorOp != vectorFn || agg.Step != 0 {
						t.Fatalf("agg: %#v", agg)
					}
					if placement == "before" && !reflect.DeepEqual(agg.By, []string{"job", "env"}) {
						t.Fatalf("by: %#v", agg)
					}
					if placement == "after" && !reflect.DeepEqual(agg.Without, []string{"job", "env"}) {
						t.Fatalf("without: %#v", agg)
					}
					if (vectorFn == "topk" || vectorFn == "bottomk") && agg.K != 3 {
						t.Fatalf("K: %#v", agg)
					}
				})
			}
		}
	}
}

func requireError(t *testing.T, query string, class spi.ErrClass, kind ErrorKind, message string) {
	t.Helper()
	got, err := Parse(t.Context(), query, time.Hour)
	if err == nil {
		t.Fatalf("accepted malformed query %q: %#v", query, got)
	}
	if !reflect.DeepEqual(got, spi.LogQuery{}) {
		t.Fatalf("partial query on error: %#v", got)
	}
	if spi.Classify(err) != class {
		t.Fatalf("class %s, expected %s: %v", spi.Classify(err), class, err)
	}
	parsed, ok := errors.AsType[*Error](err)
	if !ok || parsed.Kind != kind {
		t.Fatalf("wrong typed error: %v", err)
	}
	if message != "" && err.Error() != message {
		t.Fatalf("message %q, expected %q", err.Error(), message)
	}
}

func TestParse_SemanticRules(t *testing.T) {
	for _, tc := range []struct{ query, message string }{
		{`{job="a"} | unknown = "x"`, "label filter requires a parser stage before it"},
		{`{job="a"} | json |= "x"`, "line filters must come before pipeline stages in this version"},
		{`sum by (job)(rate({job="a"}[1m])) by (env)`, "grouping may appear before or after aggregation, not both"},
		{`sum by (job,job)(rate({job="a"}[1m]))`, "grouping labels must be unique"},
		{`topk(-1,rate({job="a"}[1m]))`, "topk/bottomk require a nonnegative integer K"},
		{`bottomk(1.5,rate({job="a"}[1m]))`, "topk/bottomk require a nonnegative integer K"},
		{`topk(9223372036854775808,rate({job="a"}[1m]))`, "topk/bottomk require a nonnegative integer K"},
		{`rate({job="a"}[0s])`, "range window must be positive and within maxRange"},
		{`rate({job="a"}[-1s])`, "range window must be positive and within maxRange"},
		{`rate({job="a"}[2h])`, "range window must be positive and within maxRange"},
		{`rate({job="a"}[0.1ns])`, "duration cannot be represented in nanoseconds"},
		{`rate({job="a"}[9223372036854775808ns])`, "duration cannot be represented in nanoseconds"},
		{`{job=~"[SECRET"}`, "invalid selector regular expression"},
		{`{job="a"} | json | status =~ 1`, "regex comparisons require a string"},
	} {
		t.Run(tc.query, func(t *testing.T) { requireError(t, tc.query, spi.ErrBadRequest, Semantic, tc.message) })
	}
	for _, query := range []string{`{job="a"} | job = "b"`, `{job=~".+"}`, `{job="a",other=""}`, `topk(0,rate({job="a"}[1h]))`, `rate({job="a"}[3600000000000ns])`} {
		if _, err := Parse(t.Context(), query, time.Hour); err != nil {
			t.Fatalf("valid %q: %v", query, err)
		}
	}
}

func TestParse_UnsupportedAndNeighbors(t *testing.T) {
	prefix := `{job="a"}`
	metric := `rate({job="a"}[1m])`
	cases := []struct{ valid, broken, message string }{
		{prefix + ` | unwrap size`, prefix + ` | unwrap`, "unwrap is not supported in this version"},
		{prefix + ` | unwrap duration(size)`, prefix + ` | unwrap duration()`, "unwrap is not supported in this version"},
		{prefix + ` | unwrap duration_seconds(size)`, prefix + ` | unwrap duration_seconds(size`, "unwrap is not supported in this version"},
		{prefix + ` | unwrap bytes(size)`, prefix + ` | unwrap bytes(size,other)`, "unwrap is not supported in this version"},
		{prefix + ` | pattern "<x>"`, prefix + ` | pattern`, "pattern parser is not supported in this version"},
		{prefix + ` | regexp "(?P<x>.*)"`, prefix + ` | regexp 1`, "regexp parser is not supported in this version"},
		{prefix + ` | line_format "{{.x}}"`, prefix + ` | line_format`, "line_format is not supported in this version"},
		{prefix + ` | label_format a=b,c="{{.c}}"`, prefix + ` | label_format a=`, "label_format is not supported in this version"},
		{prefix + ` | drop a,b=~"x.*"`, prefix + ` | drop a,`, "drop/keep are not supported in this version"},
		{prefix + ` | keep a,b!="x"`, prefix + ` | keep a=`, "drop/keep are not supported in this version"},
		{prefix + ` | decolorize`, prefix + ` | decolorize unexpected`, "decolorize is not supported in this version"},
		{`absent_over_time({job="a"}[1m])`, `absent_over_time({job="a"}[1m]`, "absent_over_time is not supported in this version"},
		{`label_replace(` + metric + `,"dst","$1","src","(.*)")`, `label_replace(` + metric + `,"dst","$1","src")`, "label_replace is not supported in this version"},
		{`rate({job="a"}[1m] offset 1m)`, metric + ` offset 1m`, "offset is not supported in this version"},
		{`rate({job="a"}[1m] @ 1)`, `rate({job="a"}[1m] @ )`, "@ is not supported in this version"},
		{`rate({job="a"}[1m] @ start())`, `rate({job="a"}[1m] @ start(1))`, "@ is not supported in this version"},
	}
	for _, fn := range []string{"rate_counter", "sum_over_time", "avg_over_time", "min_over_time", "max_over_time", "stdvar_over_time", "stddev_over_time", "first_over_time", "last_over_time", "quantile_over_time"} {
		arg := ""
		if fn == "quantile_over_time" {
			arg = "0.9,"
		}
		base := fn + "(" + arg + prefix + ` | unwrap size[1m])`
		cases = append(cases, struct{ valid, broken, message string }{base, fn + "(" + arg + prefix + ` | unwrap size[1m]`, fn + " requires unwrap which is not supported in this version"})
	}
	for _, op := range []string{"+", "-", "*", "/", "and", "or"} {
		cases = append(cases, struct{ valid, broken, message string }{metric + " " + op + " " + metric, metric + " " + op, "binary operations are not supported in this version"})
	}
	for _, tc := range cases {
		t.Run(tc.valid, func(t *testing.T) {
			requireError(t, tc.valid, spi.ErrUnsupported, Unsupported, tc.message)
			requireError(t, tc.broken, spi.ErrBadRequest, Syntax, "")
		})
	}
	for _, query := range []string{prefix + ` | label_format a=b,a=c`, prefix + ` | unwrap unknown(x)`, `sum_over_time(` + prefix + ` | unwrap n[1m]) by (job)`, `rate_counter(` + prefix + ` | unwrap n[1m]) by (job)`, `absent_over_time(` + prefix + `[1m]) by (job)`, metric + ` + ()`, metric + ` * ( + 1 )`, `label_replace(` + prefix + `,"a","b","c","d")`} {
		got, err := Parse(t.Context(), query, time.Hour)
		if err == nil || spi.Classify(err) == spi.ErrUnsupported || !reflect.DeepEqual(got, spi.LogQuery{}) {
			t.Fatalf("invalid unsupported neighbor %q: %#v %v", query, got, err)
		}
	}
	for _, fn := range []string{"avg_over_time", "min_over_time", "max_over_time", "stdvar_over_time", "stddev_over_time", "first_over_time", "last_over_time", "quantile_over_time"} {
		arg := ""
		if fn == "quantile_over_time" {
			arg = "0.9,"
		}
		requireError(t, fn+"("+arg+prefix+` | unwrap n[1m]) by (job)`, spi.ErrUnsupported, Unsupported, fn+" requires unwrap which is not supported in this version")
	}
}

func TestParse_StringsAndPositions(t *testing.T) {
	got, err := Parse(t.Context(), "{job=\"a\\n\\r\\t\\/\\\\\\\"\\u03b1\\U0001f642\"} |= `unwrap\\n`", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if got.Selectors[0].Value != "a\n\r\t/\\\"α🙂" || got.Filters[0].Value != `unwrap\n` {
		t.Fatalf("decode: %#v", got)
	}
	for _, tc := range []struct {
		query     string
		line, col int
	}{
		{`{job="a"} |= "α🙂" | json | x = bare`, 1, 32},
		{"{job=\"a\"}\n| json\n| x = bare", 3, 7},
		{`{job="a"} |= ` + "`α\n🙂`" + ` | json | x = bare`, 2, 17},
	} {
		_, err := Parse(t.Context(), tc.query, time.Hour)
		parsed, ok := errors.AsType[*Error](err)
		if !ok || parsed.Kind != Syntax || parsed.Line != tc.line || parsed.Col != tc.col {
			t.Fatalf("position for %q: %#v %v", tc.query, parsed, err)
		}
	}
	for _, query := range []string{`{job="a\q"}`, `{job="a\x01"}`, `{job="\uD800"}`, `{job="\uDC00"}`, `{job="\U00110000"}`, `{job="\Uffffffff"}`, `{job="\u12"}`, `{job="unterminated}`, "{job=`unterminated}", "{job=\"\xff\"}", "\xff{job=\"a\"}", `{job="a"} # comment`} {
		requireError(t, query, spi.ErrBadRequest, Syntax, "")
	}
	for _, query := range []string{`{job="unwrap offset label_replace"}`, `{job="a"} |= "pattern regexp"`, `{job="a"} | json | x = "decolorize"`, `{job="a"} |= ` + "`| unwrap __tenant__`"} {
		if _, err := Parse(t.Context(), query, time.Hour); err != nil {
			t.Fatalf("keyword in string rejected: %v", err)
		}
	}
}

func TestParse_ReservedLabels(t *testing.T) {
	for _, query := range []string{`{__tenant__="b"}`, `{__name__="a"}`, `{job="a"} | json | __tenant__ = "b"`, `sum by (__tenant__)(rate({job="a"}[1m]))`, `sum(rate({job="a"}[1m])) without (__name__)`, `{job="a"} | unwrap __tenant__`, `{job="a"} | drop __tenant__`, `{job="a"} | label_format __tenant__=job`, `label_replace(rate({job="a"}[1m]),"\u005f\u005ftenant__","x","job",".*")`, `label_replace(rate({job="a"}[1m]),"ok","x","__tenant__",".*")`} {
		requireError(t, query, spi.ErrBadRequest, Semantic, "reserved label names are not allowed")
	}
}

func TestParse_Literals(t *testing.T) {
	for _, tc := range []struct {
		literal string
		want    float64
	}{
		{"-1.25", -1.25}, {"0.1", 0.1}, {"1ns", 1e-9}, {"2us", 2e-6}, {"3ms", 0.003}, {"4s", 4}, {"5m", 300}, {"1h", 3600}, {"1d", 86400}, {"1w", 604800}, {"1b", 1}, {"2kb", 2000}, {"3mb", 3000000}, {"4gb", 4000000000}, {"1kib", 1024}, {"1mib", 1048576}, {"1gib", 1073741824},
	} {
		t.Run(tc.literal, func(t *testing.T) {
			got, err := Parse(t.Context(), `{job="a"} | json | x >= `+tc.literal, time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			if got.Fields[0].Num == nil || *got.Fields[0].Num != tc.want || got.Fields[0].Value != tc.literal {
				t.Fatalf("literal: %#v", got.Fields[0])
			}
		})
	}
	for _, op := range []string{"=", "!=", "=~", "!~", ">", ">=", "<", "<="} {
		query := `{job="a"} | job ` + op + ` "x"`
		if _, err := Parse(t.Context(), query, time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	for _, lit := range []string{"1e3", "- 1", "-\n1", "1.25e2", "+1", ".5", "1.", "1H", "1TB", "1m2s", "NaN", "Inf"} {
		requireError(t, `{job="a"} | json | x > `+lit, spi.ErrBadRequest, Syntax, "")
	}
	for _, lit := range []string{strings.Repeat("9", 400), "0." + strings.Repeat("0", 400) + "1", "9223372036854775808ns", "0.1ns"} {
		requireError(t, `{job="a"} | json | x > `+lit, spi.ErrBadRequest, Semantic, "")
	}
	for _, query := range []string{`topk(rate({job="a"}[1m]))`, `bottomk(1kb,rate({job="a"}[1m]))`, `sum(2,rate({job="a"}[1m]))`, `sum by ()(rate({job="a"}[1m]))`, `sum by (job,)(rate({job="a"}[1m]))`, `{job="a",}`, `rate({job="a"}[1])`, `{job="a"} trailing`, `{job="a"} | json | x == 1`} {
		requireError(t, query, spi.ErrBadRequest, Syntax, "")
	}
}

func TestParse_Bounds(t *testing.T) {
	query := `{job="` + strings.Repeat("a", MaxQueryBytes-8) + `"}`
	if len(query) != MaxQueryBytes {
		t.Fatal(len(query))
	}
	if _, err := Parse(t.Context(), query, time.Hour); err != nil {
		t.Fatal(err)
	}
	requireError(t, query+" ", spi.ErrTooLarge, Resource, "query byte limit exceeded")
	for _, makeQuery := range []func(int) string{
		func(n int) string { return "{" + strings.Repeat(`job="a",`, n-1) + `job="a"}` },
		func(n int) string { return `{job="a"}` + strings.Repeat(` |= "a"`, n) },
		func(n int) string { return `{job="a"}` + strings.Repeat(` | json`, n) },
		func(n int) string { return `{job="a"} | json` + strings.Repeat(` | x=1`, n) },
		func(n int) string {
			var labels []string
			for i := range n {
				labels = append(labels, fmt.Sprintf("a%d", i))
			}
			return `sum by (` + strings.Join(labels, ",") + `)(rate({job="a"}[1m]))`
		},
	} {
		if _, err := Parse(t.Context(), makeQuery(MaxTerms), time.Hour); err != nil {
			t.Fatalf("at term limit: %v", err)
		}
		requireError(t, makeQuery(MaxTerms+1), spi.ErrTooLarge, Resource, "query collection limit exceeded")
	}
	for _, prefix := range []string{`{job=~"`, `{job="a"} |~ "`, `{job="a"} | json | x =~ "`, `{job="a"} | regexp "`, `{job="a"} | drop a=~"`} {
		tail := `"`
		if prefix == `{job=~"` {
			tail = `"}`
		}
		valid := prefix + strings.Repeat("a", MaxRegexBytes) + tail
		_, err := Parse(t.Context(), valid, time.Hour)
		if err != nil && spi.Classify(err) != spi.ErrUnsupported {
			t.Fatalf("at regex limit: %v", err)
		}
		requireError(t, prefix+strings.Repeat("a", MaxRegexBytes+1)+tail, spi.ErrTooLarge, Resource, "regular expression byte limit exceeded")
	}
	requireError(t, `{job="a"} |~ "`+strings.Repeat(`\u0061`, MaxRegexBytes+1)+`"`, spi.ErrTooLarge, Resource, "regular expression byte limit exceeded")
	metric := `rate({job="a"}[1m])`
	requireError(t, metric+"+"+strings.Repeat("(", MaxNesting)+metric+strings.Repeat(")", MaxNesting), spi.ErrTooLarge, Resource, "query nesting limit exceeded")
	requireError(t, strings.Repeat(metric+"+", 1500)+metric, spi.ErrTooLarge, Resource, "query token limit exceeded")
}

func TestParse_Cancellation(t *testing.T) {
	for _, cause := range []error{context.Canceled, context.DeadlineExceeded} {
		ctx := &countContext{Context: t.Context(), remaining: 100, cause: cause}
		got, err := Parse(ctx, `{job="`+strings.Repeat("a", 1000)+`"}`, time.Hour)
		if !errors.Is(err, cause) || spi.Classify(err) != spi.ErrTimeout || !reflect.DeepEqual(got, spi.LogQuery{}) {
			t.Fatalf("cancellation lost: %#v %v", got, err)
		}
	}
	for _, maxRange := range []time.Duration{0, -time.Second} {
		got, err := Parse(t.Context(), `{job="a"}`, maxRange)
		if spi.Classify(err) != spi.ErrBadRequest || !reflect.DeepEqual(got, spi.LogQuery{}) {
			t.Fatalf("maxRange: %v", err)
		}
	}
}

type countContext struct {
	context.Context
	remaining int
	cause     error
}

func (c *countContext) Err() error {
	c.remaining--
	if c.remaining <= 0 {
		return c.cause
	}
	return nil
}

func FuzzParse(f *testing.F) {
	for _, seed := range []string{`{job="a"}`, `{job=~".*"}`, `sum by (job)(rate({job="a"} |= "α" | json | n>2[1m]))`, `topk(3,bytes_rate({job="a"}[1m]))`, `label_replace(rate({job="a"}[1m]),"dst","$1","src","(.*)")`, `{job="a"} | unwrap bytes(size)`, `rate({job="a"}[1m]) + (rate({job="a"}[1m]) / 2)`, `{job="\uD800"}`, "\xff", strings.Repeat("(", 129), `{job="a"} | json | __tenant__="b"`, `quantile_over_time(0.9,{job="a"} | unwrap n[1m]) by (job)`} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		got, err := Parse(t.Context(), input, time.Hour)
		if err != nil {
			if !reflect.DeepEqual(got, spi.LogQuery{}) {
				t.Fatal("partial IR")
			}
			if spi.Classify(err) == spi.ErrInternal {
				t.Fatal("unclassified error")
			}
			if _, ok := errors.AsType[*Error](err); !ok {
				t.Fatal("untyped parser error")
			}
			return
		}
		if got.Tenant != "" || got.Start != 0 || got.End != 0 || got.Limit != 0 || got.Direction != 0 {
			t.Fatal("transport fields")
		}
		if len(got.Selectors) == 0 {
			t.Fatal("missing selector")
		}
	})
}

func TestParse_UnsupportedStructuralEdges(t *testing.T) {
	for _, query := range []string{`sum(sum_over_time({job="a"} | unwrap n[1m]))`, `topk(2,sum_over_time({job="a"} | unwrap n[1m]))`} {
		requireError(t, query, spi.ErrUnsupported, Unsupported, "sum_over_time requires unwrap which is not supported in this version")
	}
	for _, offset := range []string{"-1m", "0s", "2h"} {
		requireError(t, `rate({job="a"}[1m] offset `+offset+`)`, spi.ErrUnsupported, Unsupported, "offset is not supported in this version")
	}
	for _, query := range []string{`rate({job="a"}[1m] offset)`, `rate({job="a"}[1m] offset 1)`, `sum(sum_over_time({job="a"} | unwrap n[1m])`, `{job="a"} | unwrap n |=`, `sum by(job)(sum_over_time({job="a"} | unwrap n[1m])) by(`} {
		requireError(t, query, spi.ErrBadRequest, Syntax, "")
	}
	requireError(t, `rate({job="a"}[1m] offset 9223372036854775808ns)`, spi.ErrBadRequest, Semantic, "duration cannot be represented in nanoseconds")
	metric := `rate({job="a"}[1m])`
	requireError(t, metric+"+"+strings.Repeat("(", MaxNesting-2)+metric+strings.Repeat(")", MaxNesting-2), spi.ErrUnsupported, Unsupported, "binary operations are not supported in this version")
	for _, query := range []string{`{job="a"} |= "x" | json "|" json`, `{job "=" "a"}`, `{job="a"} "|=" "x"`, `{job="a"} | job "=" "a"`, `{job="a"} | drop job "=" "a"`, `rate({job="a"}[1m]) + 1s`, `rate({job="a"}[1m]) + 1e3`} {
		requireError(t, query, spi.ErrBadRequest, Syntax, "")
	}
	requireError(t, metric+" + "+strings.Repeat("9", 400), spi.ErrBadRequest, Semantic, "numeric literal is out of range")
}

func TestParse_ExactNumericAndDiagnostics(t *testing.T) {
	requireError(t, `topk(1.00000000000000000001,rate({job="a"}[1m]))`, spi.ErrBadRequest, Semantic, "topk/bottomk require a nonnegative integer K")
	requireError(t, `rate({job="a"}[0.0000000001s])`, spi.ErrBadRequest, Semantic, "duration cannot be represented in nanoseconds")
	got, err := Parse(t.Context(), `{job="a"} | json | x = 9007199254740993`, time.Hour)
	if err != nil || got.Fields[0].Num == nil || *got.Fields[0].Num != 9007199254740992 {
		t.Fatalf("IEEE rounding: %#v %v", got, err)
	}
	requireError(t, `{job=SECRET}`, spi.ErrBadRequest, Syntax, "parse error at line 1, col 6: syntax error: unexpected IDENTIFIER, expecting STRING")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	q, err := Parse(ctx, `{job="a"}`, time.Hour)
	if !errors.Is(err, context.Canceled) || spi.Classify(err) != spi.ErrTimeout || !reflect.DeepEqual(q, spi.LogQuery{}) {
		t.Fatalf("pre-cancel: %#v %v", q, err)
	}
}

func TestParse_ReviewR1UnknownRuneDiagnostics(t *testing.T) {
	for _, suffix := range []string{"密", "\x00", "\x01", "$", "🙂"} {
		query := `{job="api"}` + suffix
		got, err := Parse(t.Context(), query, time.Hour)
		if err == nil || spi.Classify(err) != spi.ErrBadRequest || !reflect.DeepEqual(got, spi.LogQuery{}) {
			t.Fatalf("query result: %#v %v", got, err)
		}
		parsed, ok := errors.AsType[*Error](err)
		if !ok || parsed.Kind != Syntax {
			t.Fatalf("wrong error: %v", err)
		}
		if strings.Contains(err.Error(), suffix) || err.Error() != "parse error at line 1, col 12: syntax error: unexpected INVALID, expecting EOF" {
			t.Fatalf("unknown rune escaped diagnostic category: %q", err.Error())
		}
	}
}

func TestParse_ReviewR2UnsupportedParserComposition(t *testing.T) {
	for _, tc := range []struct{ stage, message string }{
		{`pattern "<level>"`, "pattern parser is not supported in this version"},
		{`regexp "(?P<level>.*)"`, "regexp parser is not supported in this version"},
	} {
		t.Run(tc.stage, func(t *testing.T) {
			requireError(t, `{job="api"} | `+tc.stage+` | level="warn"`, spi.ErrUnsupported, Unsupported, tc.message)
		})
	}
}

func TestParse_ReviewR2NegativeNeighbors(t *testing.T) {
	for _, stage := range []string{`pattern "<level>"`, `regexp "(?P<level>.*)"`} {
		prefix := `{job="api"} | ` + stage
		requireError(t, prefix+` | level=`, spi.ErrBadRequest, Syntax, "")
		requireError(t, prefix+` | level "=" "warn"`, spi.ErrBadRequest, Syntax, "")
		requireError(t, prefix+` | __tenant__="other"`, spi.ErrBadRequest, Semantic, "reserved label names are not allowed")
		requireError(t, prefix+` | level=~"`+strings.Repeat("a", MaxRegexBytes+1)+`"`, spi.ErrTooLarge, Resource, "regular expression byte limit exceeded")
		requireError(t, prefix+strings.Repeat(` | level="warn"`, MaxTerms+1), spi.ErrTooLarge, Resource, "query collection limit exceeded")
		ctx := &countContext{Context: t.Context(), remaining: 25, cause: context.Canceled}
		got, err := Parse(ctx, prefix+` | level="warn"`, time.Hour)
		if !errors.Is(err, context.Canceled) || !reflect.DeepEqual(got, spi.LogQuery{}) {
			t.Fatalf("recognition cancellation: %#v %v", got, err)
		}
	}
}
