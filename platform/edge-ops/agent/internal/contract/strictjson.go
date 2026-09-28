// Package contract implements the Edge Ops v1 wire contracts for the host side.
// Every function mirrors a TypeScript twin in backend/src/domain/contract and is checked
// against the shared vectors in contracts/vectors; behaviour changes need a contract PR.
package contract

import (
	"bytes"
	"fmt"
	"strconv"
	"unicode/utf8"
)

// StrictJSONMaxDepth bounds container nesting.
const StrictJSONMaxDepth = 32

const maxSafeInteger = 1<<53 - 1

// Error is the single error type for contract validation; Code matches the TS twin.
type Error struct {
	Code  string
	Field string
	Msg   string
}

func (e *Error) Error() string {
	if e.Field == "" {
		return e.Code + ": " + e.Msg
	}
	return e.Field + ": " + e.Code + ": " + e.Msg
}

func errf(code, field, format string, args ...any) *Error {
	return &Error{Code: code, Field: field, Msg: fmt.Sprintf(format, args...)}
}

// ParseStrictJSON parses one value under the strict profile. Values are nil, bool, int64,
// string, []any or map[string]any.
func ParseStrictJSON(data []byte, maxBytes int) (any, error) {
	if len(data) > maxBytes {
		return nil, errf("too_large", "", "body exceeds %d bytes", maxBytes)
	}
	if !utf8.Valid(data) {
		return nil, errf("invalid_utf8", "", "body is not valid UTF-8")
	}
	if bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}) {
		return nil, errf("bom", "", "byte order mark is not allowed")
	}
	p := &parser{s: data}
	p.ws()
	v, err := p.value(0)
	if err != nil {
		return nil, err
	}
	p.ws()
	if p.i != len(p.s) {
		return nil, errf("trailing_data", "", "unexpected data after JSON value")
	}
	return v, nil
}

type parser struct {
	s []byte
	i int
}

func (p *parser) ws() {
	for p.i < len(p.s) {
		switch p.s[p.i] {
		case ' ', '\t', '\n', '\r':
			p.i++
		default:
			return
		}
	}
}

func (p *parser) peek() byte {
	if p.i < len(p.s) {
		return p.s[p.i]
	}
	return 0
}

func (p *parser) syntax(msg string) error {
	return errf("syntax", "", "%s at offset %d", msg, p.i)
}

func (p *parser) value(depth int) (any, error) {
	switch c := p.peek(); {
	case p.i >= len(p.s):
		return nil, p.syntax("unexpected end")
	case c == '{':
		return p.object(depth + 1)
	case c == '[':
		return p.array(depth + 1)
	case c == '"':
		return p.string()
	case c == 't':
		return p.literal("true", true)
	case c == 'f':
		return p.literal("false", false)
	case c == 'n':
		return p.literal("null", nil)
	case c == '-' || (c >= '0' && c <= '9'):
		return p.number()
	default:
		return nil, p.syntax("unexpected character")
	}
}

func (p *parser) literal(word string, v any) (any, error) {
	if bytes.HasPrefix(p.s[p.i:], []byte(word)) {
		p.i += len(word)
		return v, nil
	}
	return nil, p.syntax("invalid literal")
}

func (p *parser) object(depth int) (any, error) {
	if depth > StrictJSONMaxDepth {
		return nil, errf("depth", "", "nesting too deep")
	}
	p.i++
	out := map[string]any{}
	p.ws()
	if p.peek() == '}' {
		p.i++
		return out, nil
	}
	for {
		p.ws()
		if p.peek() != '"' {
			return nil, p.syntax("expected object key")
		}
		key, err := p.string()
		if err != nil {
			return nil, err
		}
		if _, dup := out[key]; dup {
			return nil, errf("duplicate_key", "", "duplicate key %q", key)
		}
		p.ws()
		if p.peek() != ':' {
			return nil, p.syntax("expected ':'")
		}
		p.i++
		p.ws()
		v, err := p.value(depth)
		if err != nil {
			return nil, err
		}
		out[key] = v
		p.ws()
		switch p.peek() {
		case ',':
			p.i++
		case '}':
			p.i++
			return out, nil
		default:
			return nil, p.syntax("expected ',' or '}'")
		}
	}
}

func (p *parser) array(depth int) (any, error) {
	if depth > StrictJSONMaxDepth {
		return nil, errf("depth", "", "nesting too deep")
	}
	p.i++
	out := []any{}
	p.ws()
	if p.peek() == ']' {
		p.i++
		return out, nil
	}
	for {
		p.ws()
		v, err := p.value(depth)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
		p.ws()
		switch p.peek() {
		case ',':
			p.i++
		case ']':
			p.i++
			return out, nil
		default:
			return nil, p.syntax("expected ',' or ']'")
		}
	}
}

func (p *parser) string() (string, error) {
	p.i++ // opening quote
	var out []byte
	for {
		if p.i >= len(p.s) {
			return "", p.syntax("unterminated string")
		}
		c := p.s[p.i]
		if c == '"' {
			p.i++
			return string(out), nil
		}
		if c < 0x20 {
			return "", p.syntax("control character in string")
		}
		if c != '\\' {
			out = append(out, c)
			p.i++
			continue
		}
		p.i++
		e := p.peek()
		p.i++
		switch e {
		case '"', '\\', '/':
			out = append(out, e)
		case 'b':
			out = append(out, '\b')
		case 'f':
			out = append(out, '\f')
		case 'n':
			out = append(out, '\n')
		case 'r':
			out = append(out, '\r')
		case 't':
			out = append(out, '\t')
		case 'u':
			u, err := p.hex4()
			if err != nil {
				return "", err
			}
			switch {
			case u >= 0xdc00 && u <= 0xdfff:
				return "", errf("lone_surrogate", "", "unpaired low surrogate")
			case u >= 0xd800 && u <= 0xdbff:
				if p.peek() != '\\' || p.i+1 >= len(p.s) || p.s[p.i+1] != 'u' {
					return "", errf("lone_surrogate", "", "unpaired high surrogate")
				}
				p.i += 2
				lo, err := p.hex4()
				if err != nil {
					return "", err
				}
				if lo < 0xdc00 || lo > 0xdfff {
					return "", errf("lone_surrogate", "", "unpaired high surrogate")
				}
				out = utf8.AppendRune(out, 0x10000+(rune(u)-0xd800)<<10+(rune(lo)-0xdc00))
			default:
				out = utf8.AppendRune(out, rune(u))
			}
		default:
			p.i--
			return "", p.syntax("invalid escape")
		}
	}
}

func (p *parser) hex4() (uint16, error) {
	if p.i+4 > len(p.s) {
		return 0, p.syntax("invalid \\u escape")
	}
	var v uint16
	for _, c := range p.s[p.i : p.i+4] {
		if !isHex(c) {
			return 0, p.syntax("invalid \\u escape")
		}
		d, _ := strconv.ParseUint(string(c), 16, 8)
		v = v<<4 | uint16(d)
	}
	p.i += 4
	return v, nil
}

func isHex(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func (p *parser) number() (any, error) {
	start := p.i
	if p.peek() == '-' {
		p.i++
	}
	digitsStart := p.i
	switch c := p.peek(); {
	case p.i < len(p.s) && c == '0':
		p.i++
	case p.i < len(p.s) && c >= '1' && c <= '9':
		for p.i < len(p.s) && isDigit(p.s[p.i]) {
			p.i++
		}
	default:
		return nil, p.syntax("invalid number")
	}
	digitsEnd := p.i
	fractional := false
	if p.peek() == '.' && p.i < len(p.s) {
		fractional = true
		p.i++
		if p.i >= len(p.s) || !isDigit(p.s[p.i]) {
			return nil, p.syntax("invalid fraction")
		}
		for p.i < len(p.s) && isDigit(p.s[p.i]) {
			p.i++
		}
	}
	if p.i < len(p.s) && (p.s[p.i] == 'e' || p.s[p.i] == 'E') {
		fractional = true
		p.i++
		if p.i < len(p.s) && (p.s[p.i] == '+' || p.s[p.i] == '-') {
			p.i++
		}
		if p.i >= len(p.s) || !isDigit(p.s[p.i]) {
			return nil, p.syntax("invalid exponent")
		}
		for p.i < len(p.s) && isDigit(p.s[p.i]) {
			p.i++
		}
	}
	if p.i < len(p.s) && isDigit(p.s[p.i]) {
		return nil, p.syntax("invalid number")
	}
	if fractional {
		return nil, errf("non_integer_number", "", "only integers are allowed")
	}
	lit := string(p.s[start:p.i])
	if lit == "-0" {
		return nil, errf("non_canonical_number", "", "-0 is not allowed")
	}
	if digitsEnd-digitsStart > 16 {
		return nil, errf("integer_out_of_range", "", "integer outside ±(2^53-1)")
	}
	n, err := strconv.ParseInt(lit, 10, 64)
	if err != nil || n > maxSafeInteger || n < -maxSafeInteger {
		return nil, errf("integer_out_of_range", "", "integer outside ±(2^53-1)")
	}
	return n, nil
}
