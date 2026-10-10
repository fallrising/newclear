package logql

import (
	"strings"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// These recognizers validate argument productions, not just keyword occurrence
// or delimiter balance. They never execute templates, conversions or metrics.
func (p *parser) decodedLabel(name string) {
	if p.err != nil {
		return
	}
	if strings.HasPrefix(name, "__") {
		p.semantic("reserved label names are not allowed")
		return
	}
	if name == "" {
		p.err = syntax(p.tok, "label identifier")
		return
	}
	for i, r := range name {
		if !letter(r) && (i == 0 || !digit(r)) {
			p.err = syntax(p.tok, "label identifier")
			return
		}
	}
}
func (p *parser) unsupportedStage(name string) bool {
	switch name {
	case "unwrap":
		p.mark("unwrap is not supported in this version")
		value := p.label()
		if p.accept("(") {
			if value != "duration" && value != "duration_seconds" && value != "bytes" {
				if p.err == nil {
					p.err = syntax(p.tok, "unwrap conversion")
				}
			}
			p.label()
			p.expect(")")
		}
	case "pattern", "regexp", "line_format":
		msg := name + " is not supported in this version"
		if name == "pattern" || name == "regexp" {
			msg = name + " parser is not supported in this version"
		}
		p.mark(msg)
		value := p.take(String).Lit
		if name == "regexp" {
			p.regex(value)
		}
	case "label_format":
		p.mark("label_format is not supported in this version")
		seen := map[string]bool{}
		for n := 0; p.err == nil; n++ {
			p.bound(n)
			dst := p.label()
			if seen[dst] {
				p.semantic("label_format destinations must be unique")
			}
			if p.err != nil {
				break
			}
			seen[dst] = true
			p.expect("=")
			if p.tok.Kind == String {
				p.take(String)
			} else {
				p.label()
			}
			if !p.accept(",") {
				break
			}
		}
	case "drop", "keep":
		p.mark("drop/keep are not supported in this version")
		for n := 0; p.err == nil; n++ {
			p.bound(n)
			p.label()
			switch p.tok.Kind {
			case "=", "!=", "=~", "!~":
				regex := p.is("=~") || p.is("!~")
				p.next()
				value := p.take(String).Lit
				if regex {
					p.regex(value)
				}
			}
			if !p.accept(",") {
				break
			}
		}
	case "decolorize":
		p.mark("decolorize is not supported in this version")
	default:
		return false
	}
	return true
}
func (p *parser) modifiers() {
	offset, at := false, false
	for p.err == nil {
		if p.accept("offset") {
			if offset {
				p.err = syntax(p.tok, "single offset modifier")
				break
			}
			offset = true
			p.mark("offset is not supported in this version")
			p.interval()
			continue
		}
		if p.accept("@") {
			if at {
				p.err = syntax(p.tok, "single @ modifier")
				break
			}
			at = true
			p.mark("@ is not supported in this version")
			if p.is("start") || p.is("end") {
				p.next()
				p.expect("(")
				p.expect(")")
			} else {
				tok := p.literal()
				if tok.Kind != Number && p.err == nil {
					p.err = syntax(tok, "NUMBER")
				}
				if p.err == nil {
					p.numericValue(tok)
				}
			}
			continue
		}
		break
	}
}
func (p *parser) recognizeRange(fn string) spi.LogQuery {
	p.expect("(")
	if fn == "quantile_over_time" {
		tok := p.literal()
		if tok.Kind != Number && p.err == nil {
			p.err = syntax(tok, "NUMBER")
		}
		if p.err == nil {
			p.numericValue(tok)
		}
		p.expect(",")
	}
	q := p.logs()
	p.expect("[")
	window := p.window()
	p.expect("]")
	p.modifiers()
	p.expect(")")
	q.Agg = &spi.LogAggregation{RangeFunc: fn, Window: window}
	if fn != "sum_over_time" && fn != "rate_counter" && fn != "absent_over_time" && (p.is("by") || p.is("without")) {
		p.grouping()
	}
	return q
}
