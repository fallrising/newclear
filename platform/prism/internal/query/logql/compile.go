package logql

import (
	"context"
	"errors"
	"regexp"
	resyn "regexp/syntax"
	"slices"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

const (
	maxHintNodes = 8192
	maxHintDepth = 128
	minHintRunes = 3
)

// ExtractLiteralHint returns a substring that every match of pattern must
// contain, or "" when no safe hint of at least three runes exists.
// The procedure is SDD 16 §3.4: parse with regexp/syntax Perl mode, simplify,
// union required literals, and keep the longest. A visited node that still
// carries FoldCase clears the whole hint. regexp/syntax leaves that flag on
// (?i)123, so the hint is empty; abc(?i) keeps "abc".
// An empty result is always safe. A wrong non-empty result would drop log lines.
func ExtractLiteralHint(pattern string) string {
	if pattern == "" || len(pattern) > MaxRegexBytes {
		return ""
	}
	re, err := resyn.Parse(pattern, resyn.Perl)
	if err != nil {
		return ""
	}
	walk := hintWalk{}
	found := walk.collect(re.Simplify(), 0, true)
	// An unread (?i) flag is still a (?i) flag. Stopping early must not keep a hint.
	if walk.folded || walk.stop {
		return ""
	}
	return longestHint(found)
}

// Compile precompiles line and field regular expressions on a copy of q.
// Positive line matches also receive LiteralHint. Selector matchers are already
// compiled by Parse and are only shallow-copied. The input query is not mutated.
// Any failure returns the zero query.
func Compile(ctx context.Context, q spi.LogQuery) (spi.LogQuery, error) {
	if ctx == nil {
		return spi.LogQuery{}, spi.Wrap(spi.ErrBadRequest, "logql", "Compile", errors.New("context is required"))
	}
	if err := ctx.Err(); err != nil {
		return spi.LogQuery{}, spi.Wrap(spi.ErrTimeout, "logql", "Compile", err)
	}
	out := q
	out.Selectors = slices.Clone(q.Selectors)
	out.Filters = slices.Clone(q.Filters)
	out.Stages = slices.Clone(q.Stages)
	out.Fields = slices.Clone(q.Fields)
	if q.Agg != nil {
		agg := *q.Agg
		agg.By = slices.Clone(q.Agg.By)
		agg.Without = slices.Clone(q.Agg.Without)
		out.Agg = &agg
	}
	for i := range out.Filters {
		if err := ctx.Err(); err != nil {
			return spi.LogQuery{}, spi.Wrap(spi.ErrTimeout, "logql", "Compile", err)
		}
		filter := &out.Filters[i]
		if filter.Op != spi.LineMatch && filter.Op != spi.LineNotMatch {
			continue
		}
		compiled, err := compilePattern(filter.Value)
		if err != nil {
			return spi.LogQuery{}, err
		}
		filter.Compiled = compiled
		if filter.Op == spi.LineMatch {
			filter.LiteralHint = ExtractLiteralHint(filter.Value)
		}
	}
	for i := range out.Fields {
		if err := ctx.Err(); err != nil {
			return spi.LogQuery{}, spi.Wrap(spi.ErrTimeout, "logql", "Compile", err)
		}
		field := &out.Fields[i]
		if field.Op != spi.CmpRe && field.Op != spi.CmpNotRe {
			continue
		}
		compiled, err := compilePattern(field.Value)
		if err != nil {
			return spi.LogQuery{}, err
		}
		field.Compiled = compiled
	}
	return out, nil
}

func compilePattern(pattern string) (*regexp.Regexp, error) {
	if len(pattern) > MaxRegexBytes {
		return nil, spi.Wrap(spi.ErrTooLarge, "logql", "Compile", errors.New("regular expression byte limit exceeded"))
	}
	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return nil, spi.Wrap(spi.ErrBadRequest, "logql", "Compile", errors.New("invalid regular expression"))
	}
	return compiled, nil
}

// compileAnchoredField compiles a field matcher once, equivalent to ^(?:pattern)$.
// The raw pattern is compiled first: wrapping alone can turn an invalid pattern
// such as a)|(?:b into the legal, unanchored ^(?:a)|(?:b)$.
// Line filters stay unanchored in compilePattern.
func compileAnchoredField(pattern string) (*regexp.Regexp, error) {
	if len(pattern) > MaxRegexBytes {
		return nil, spi.Wrap(spi.ErrTooLarge, "logql", "Execute", errors.New("regular expression byte limit exceeded"))
	}
	if _, err := regexp.Compile(pattern); err != nil {
		return nil, spi.Wrap(spi.ErrBadRequest, "logql", "Execute", errors.New("invalid regular expression"))
	}
	compiled, err := regexp.Compile("^(?:" + pattern + ")$")
	if err != nil {
		return nil, spi.Wrap(spi.ErrBadRequest, "logql", "Execute", errors.New("invalid regular expression"))
	}
	return compiled, nil
}

// hintWalk records case-folding and a hard node budget. Exceeding the budget
// drops unread literals; that can only shorten a hint, never invent one.
type hintWalk struct {
	nodes  int
	folded bool
	stop   bool
}

func (w *hintWalk) collect(re *resyn.Regexp, depth int, keep bool) []string {
	if re == nil || w.folded || w.stop {
		return nil
	}
	w.nodes++
	if w.nodes > maxHintNodes || depth > maxHintDepth {
		w.stop = true
		return nil
	}
	if re.Flags&resyn.FoldCase != 0 {
		w.folded = true
		return nil
	}
	switch re.Op {
	case resyn.OpLiteral:
		// U+FFFD matches either that character or one illegal UTF-8 byte.
		// The character's UTF-8 encoding is not a substring of the raw byte,
		// so the literal is not a safe Contains hint.
		if !keep || len(re.Rune) == 0 || slices.Contains(re.Rune, utf8.RuneError) {
			return nil
		}
		return []string{string(re.Rune)}
	case resyn.OpConcat, resyn.OpCapture, resyn.OpPlus:
		return w.children(re, depth, keep)
	case resyn.OpRepeat:
		return w.children(re, depth, keep && re.Min >= 1)
	default:
		// Star, quest, alternate, char class, any-char, and anchors contribute
		// no required literal. Their children are still visited so a nested
		// case-insensitive flag rejects the whole hint.
		return w.children(re, depth, false)
	}
}

func (w *hintWalk) children(re *resyn.Regexp, depth int, keep bool) []string {
	var all []string
	for _, sub := range re.Sub {
		all = append(all, w.collect(sub, depth+1, keep)...)
		if w.folded || w.stop {
			return all
		}
	}
	return all
}

func longestHint(found []string) string {
	best := ""
	bestRunes := 0
	for _, literal := range found {
		n := utf8.RuneCountInString(literal)
		if n < minHintRunes {
			continue
		}
		if n > bestRunes || (n == bestRunes && literal < best) {
			best = literal
			bestRunes = n
		}
	}
	return best
}
