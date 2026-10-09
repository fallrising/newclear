package logql

import (
	"context"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

type parser struct {
	scan        scanner
	tok         Token
	err         error
	maxRange    time.Duration
	depth       int
	unsupported string
	parens      bool
}

// Parse produces flat intermediate IR. Every failure returns the zero query.
func Parse(ctx context.Context, query string, maxRange time.Duration) (spi.LogQuery, error) {
	p := parser{scan: scanner{ctx: ctx, src: query, line: 1, col: 1}, maxRange: maxRange}
	if err := ctx.Err(); err != nil {
		return spi.LogQuery{}, cancelled(Token{Line: 1, Col: 1}, err)
	}
	if len(query) > MaxQueryBytes {
		return spi.LogQuery{}, failure(Resource, Token{Line: 1, Col: 1}, "query byte limit exceeded")
	}
	if maxRange <= 0 {
		return spi.LogQuery{}, failure(Semantic, Token{Line: 1, Col: 1}, "maxRange must be positive")
	}
	p.next()
	q := p.expression(0)
	if p.err == nil && p.tok.Kind != EOF {
		p.err = syntax(p.tok, "EOF")
	}
	if p.err == nil && q.Agg != nil && q.Agg.RangeFunc == "" && p.unsupported == "" {
		p.err = syntax(p.tok, "log or metric query")
	}
	if p.err == nil && p.parens && p.unsupported == "" {
		p.err = syntax(p.tok, "unparenthesized query")
	}
	if p.err == nil && p.unsupported != "" {
		p.err = failure(Unsupported, p.tok, p.unsupported)
	}
	if p.err == nil {
		p.err = p.scan.check()
	}
	if p.err != nil {
		return spi.LogQuery{}, p.err
	}
	return q, nil
}
func (p *parser) next() {
	if p.err == nil {
		p.tok, p.err = p.scan.next()
	}
}
func (p *parser) is(value string) bool { return p.tok.Lit == value && p.tok.Kind != String }
func (p *parser) accept(value string) bool {
	if p.is(value) {
		p.next()
		return true
	}
	return false
}
func (p *parser) expect(value string) {
	if !p.accept(value) && p.err == nil {
		p.err = syntax(p.tok, value)
	}
}
func (p *parser) take(kind Kind) Token {
	at := p.tok
	if p.err == nil {
		if at.Kind != kind {
			p.err = syntax(at, string(kind))
		} else {
			p.next()
		}
	}
	return at
}
func (p *parser) semantic(msg string) {
	if p.err == nil {
		p.err = failure(Semantic, p.tok, msg)
	}
}
func (p *parser) bound(n int) {
	if p.err == nil && n >= MaxTerms {
		p.err = failure(Resource, p.tok, "query collection limit exceeded")
	}
}
func (p *parser) label() string {
	at := p.take(Identifier)
	if p.err == nil && strings.HasPrefix(at.Lit, "__") {
		p.semantic("reserved label names are not allowed")
	}
	return at.Lit
}
func (p *parser) regex(value string) {
	if p.err == nil && len(value) > MaxRegexBytes {
		p.err = failure(Resource, p.tok, "regular expression byte limit exceeded")
	}
}
func (p *parser) mark(msg string) {
	if p.unsupported == "" {
		p.unsupported = msg
	}
}
func (p *parser) enter() bool {
	p.depth++
	if p.depth > MaxNesting && p.err == nil {
		p.err = failure(Resource, p.tok, "query nesting limit exceeded")
	}
	return p.err == nil
}
func (p *parser) expression(minPrec int) spi.LogQuery {
	if !p.enter() {
		return spi.LogQuery{}
	}
	defer func() { p.depth-- }()
	q := p.primary()
	for p.err == nil {
		prec := binaryPrecedence(p.tok)
		if prec <= minPrec {
			break
		}
		if q.Agg == nil {
			p.err = syntax(p.tok, "metric operand")
			break
		}
		p.next()
		p.mark("binary operations are not supported in this version")
		right := p.expression(prec)
		if p.err == nil && right.Agg == nil {
			p.err = syntax(p.tok, "metric operand")
		}
	}
	return q
}
func binaryPrecedence(tok Token) int {
	if tok.Kind == String {
		return 0
	}
	switch tok.Lit {
	case "or":
		return 1
	case "and":
		return 2
	case "+", "-":
		return 3
	case "*", "/":
		return 4
	}
	return 0
}
func (p *parser) primary() spi.LogQuery {
	if p.accept("(") {
		p.parens = true
		q := p.expression(0)
		p.expect(")")
		return q
	}
	if p.tok.Kind == Number || p.is("-") {
		at := p.literal()
		if at.Kind != Number && p.err == nil {
			p.err = syntax(at, "NUMBER")
		}
		if p.err == nil {
			p.numericValue(at)
		}
		return spi.LogQuery{Agg: &spi.LogAggregation{}}
	}
	if p.is("{") {
		return p.logs()
	}
	fn := p.take(Identifier).Lit
	switch fn {
	case "sum", "avg", "min", "max", "count", "topk", "bottomk":
		return p.vector(fn)
	case "count_over_time", "rate", "bytes_over_time", "bytes_rate":
		return p.rangeQuery(fn)
	case "rate_counter", "sum_over_time", "avg_over_time", "min_over_time", "max_over_time", "stdvar_over_time", "stddev_over_time", "first_over_time", "last_over_time", "quantile_over_time", "absent_over_time":
		msg := fn + " requires unwrap which is not supported in this version"
		if fn == "absent_over_time" {
			msg = fn + " is not supported in this version"
		}
		p.mark(msg)
		q := p.recognizeRange(fn)
		return q
	case "label_replace":
		p.mark("label_replace is not supported in this version")
		p.expect("(")
		q := p.expression(0)
		if q.Agg == nil && p.err == nil {
			p.err = syntax(p.tok, "metric expression")
		}
		for i := range 4 {
			p.expect(",")
			arg := p.take(String).Lit
			if i == 0 || i == 2 {
				p.decodedLabel(arg)
			}
			if i == 3 {
				p.regex(arg)
			}
		}
		p.expect(")")
		return q
	default:
		if p.err == nil {
			p.err = syntax(p.tok, "log or metric query")
		}
		return spi.LogQuery{}
	}
}
func (p *parser) logs() spi.LogQuery {
	q := spi.LogQuery{}
	p.expect("{")
	if !p.accept("}") {
		for p.err == nil {
			p.bound(len(q.Selectors))
			name := p.label()
			op := string(p.tok.Kind)
			t := spi.MatchEqual
			switch op {
			case "=":
			case "!=":
				t = spi.MatchNotEqual
			case "=~":
				t = spi.MatchRegexp
			case "!~":
				t = spi.MatchNotRegexp
			default:
				if p.err == nil {
					p.err = syntax(p.tok, "matcher operator")
				}
			}
			p.next()
			val := p.take(String).Lit
			if t == spi.MatchRegexp || t == spi.MatchNotRegexp {
				p.regex(val)
			}
			if p.err != nil {
				break
			}
			m, err := spi.NewMatcher(t, name, val)
			if err != nil {
				p.semantic("invalid selector regular expression")
				break
			}
			q.Selectors = append(q.Selectors, m)
			if !p.accept(",") {
				p.expect("}")
				break
			}
		}
	}
	positive := false
	for _, m := range q.Selectors {
		if (m.Type == spi.MatchEqual || m.Type == spi.MatchRegexp) && !m.Matches("") {
			positive = true
			break
		}
	}
	if !positive {
		p.semantic(nonEmptySelector)
	}
	pipeline := false
	unsupportedParser := false
	for p.err == nil {
		switch p.tok.Kind {
		case "|=", "!=", "|~", "!~":
			p.bound(len(q.Filters))
			op := map[string]spi.LineFilterOp{"|=": spi.LineContains, "!=": spi.LineNotContains, "|~": spi.LineMatch, "!~": spi.LineNotMatch}[p.tok.Lit]
			p.next()
			val := p.take(String).Lit
			if op == spi.LineMatch || op == spi.LineNotMatch {
				p.regex(val)
			}
			if pipeline {
				p.semantic("line filters must come before pipeline stages in this version")
			}
			if p.err == nil {
				q.Filters = append(q.Filters, spi.LineFilter{Op: op, Value: val})
			}
		case "|":
			pipeline = true
			p.next()
			stage := p.take(Identifier)
			if p.err != nil {
				break
			}
			if _, comparison := compare(string(p.tok.Kind)); !comparison {
				if stage.Lit == "json" || stage.Lit == "logfmt" {
					p.bound(len(q.Stages))
					kind := spi.ParseJSON
					if stage.Lit == "logfmt" {
						kind = spi.ParseLogfmt
					}
					if p.err == nil {
						q.Stages = append(q.Stages, spi.ParseStage{Kind: kind})
					}
					continue
				}
				if p.unsupportedStage(stage.Lit) {
					// Recognition state only: no executable ParseStage for these parsers.
					if p.err == nil && (stage.Lit == "pattern" || stage.Lit == "regexp") {
						unsupportedParser = true
					}
					continue
				}
			}
			p.bound(len(q.Fields))
			name := stage.Lit
			p.decodedLabel(name)
			op, ok := compare(string(p.tok.Kind))
			if !ok && p.err == nil {
				p.err = syntax(p.tok, "comparison operator")
			}
			p.next()
			field := spi.FieldFilter{Field: name, Op: op}
			if p.tok.Kind == String {
				field.Value = p.take(String).Lit
			} else {
				tok := p.literal()
				field.Value = tok.Lit
				if p.err == nil {
					n := p.numericValue(tok)
					if p.err == nil {
						field.Num = new(n)
					}
				}
			}
			if op == spi.CmpRe || op == spi.CmpNotRe {
				if field.Num != nil {
					p.semantic("regex comparisons require a string")
				}
				p.regex(field.Value)
			}
			hasLabel := false
			for _, m := range q.Selectors {
				if m.Name == name {
					hasLabel = true
					break
				}
			}
			if len(q.Stages) == 0 && !unsupportedParser && !hasLabel {
				p.semantic("label filter requires a parser stage before it")
			}
			if p.err == nil {
				q.Fields = append(q.Fields, field)
			}
		default:
			return q
		}
	}
	return q
}
func compare(op string) (spi.CompareOp, bool) {
	switch op {
	case "=":
		return spi.CmpEq, true
	case "!=":
		return spi.CmpNe, true
	case "=~":
		return spi.CmpRe, true
	case "!~":
		return spi.CmpNotRe, true
	case ">":
		return spi.CmpGt, true
	case ">=":
		return spi.CmpGte, true
	case "<":
		return spi.CmpLt, true
	case "<=":
		return spi.CmpLte, true
	}
	return 0, false
}
func (p *parser) literal() Token {
	sign := p.tok
	neg := p.accept("-")
	at := p.tok
	if neg && p.err == nil && (at.Line != sign.Line || at.Col != sign.Col+1) {
		p.err = syntax(at, "digit adjacent to sign")
	}
	if at.Kind != Number && at.Kind != Duration && at.Kind != Bytes {
		if p.err == nil {
			p.err = syntax(at, "numeric literal")
		}
		return at
	}
	p.next()
	if neg {
		at.Lit = "-" + at.Lit
	}
	return at
}
func (p *parser) rangeQuery(fn string) spi.LogQuery {
	p.expect("(")
	q := p.logs()
	p.expect("[")
	win := p.window()
	p.expect("]")
	p.modifiers()
	p.expect(")")
	q.Agg = &spi.LogAggregation{RangeFunc: fn, Window: win}
	return q
}
func (p *parser) grouping() (bool, []string) {
	without := p.is("without")
	p.next()
	p.expect("(")
	var names []string
	seen := map[string]bool{}
	for p.err == nil {
		p.bound(len(names))
		name := p.label()
		if seen[name] {
			p.semantic("grouping labels must be unique")
		}
		if p.err != nil {
			break
		}
		seen[name] = true
		names = append(names, name)
		if !p.accept(",") {
			p.expect(")")
			break
		}
	}
	return without, names
}
func (p *parser) vector(fn string) spi.LogQuery {
	grouped := false
	without := false
	var names []string
	if p.is("by") || p.is("without") {
		grouped = true
		without, names = p.grouping()
	}
	p.expect("(")
	k := 0
	if fn == "topk" || fn == "bottomk" {
		at := p.literal()
		if at.Kind != Number && p.err == nil {
			p.err = syntax(at, "NUMBER")
		}
		r := p.rational(at)
		if !r.IsInt() || r.Sign() < 0 || !r.Num().IsInt64() {
			p.semantic("topk/bottomk require a nonnegative integer K")
		} else {
			n := r.Num().Int64()
			k = int(n)
			if int64(k) != n {
				p.semantic("topk/bottomk K is out of range")
			}
		}
		p.expect(",")
	}
	name := p.take(Identifier).Lit
	switch name {
	case "count_over_time", "rate", "bytes_over_time", "bytes_rate", "rate_counter", "sum_over_time", "avg_over_time", "min_over_time", "max_over_time", "stdvar_over_time", "stddev_over_time", "first_over_time", "last_over_time", "quantile_over_time", "absent_over_time":
	default:
		if p.err == nil {
			p.err = syntax(p.tok, "range aggregation")
		}
	}
	var q spi.LogQuery
	switch name {
	case "count_over_time", "rate", "bytes_over_time", "bytes_rate":
		q = p.rangeQuery(name)
	default:
		msg := name + " requires unwrap which is not supported in this version"
		if name == "absent_over_time" {
			msg = name + " is not supported in this version"
		}
		p.mark(msg)
		q = p.recognizeRange(name)
	}
	p.expect(")")
	if p.is("by") || p.is("without") {
		if grouped {
			p.grouping()
			p.semantic("grouping may appear before or after aggregation, not both")
		} else {
			without, names = p.grouping()
		}
	}
	if q.Agg != nil {
		q.Agg.VectorOp = fn
		q.Agg.K = k
		if without {
			q.Agg.Without = names
		} else {
			q.Agg.By = names
		}
	}
	return q
}
