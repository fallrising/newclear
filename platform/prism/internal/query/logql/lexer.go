package logql

import (
	"context"
	"strconv"
	"strings"
	"unicode/utf8"
)

type scanner struct {
	ctx                            context.Context
	src                            string
	off, line, col, count, nesting int
}

func (s *scanner) position() Token { return Token{Line: s.line, Col: s.col} }
func (s *scanner) check() error {
	if err := s.ctx.Err(); err != nil {
		return cancelled(s.position(), err)
	}
	return nil
}
func (s *scanner) rune() rune {
	if s.off == len(s.src) {
		return 0
	}
	r, _ := utf8.DecodeRuneInString(s.src[s.off:])
	return r
}
func (s *scanner) advance() {
	r, n := utf8.DecodeRuneInString(s.src[s.off:])
	s.off += n
	if r == '\n' {
		s.line++
		s.col = 1
	} else {
		s.col++
	}
}
func letter(r rune) bool { return r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' }
func digit(r rune) bool  { return r >= '0' && r <= '9' }
func (s *scanner) next() (Token, error) {
	if err := s.check(); err != nil {
		return Token{}, err
	}
	for r := s.rune(); r == ' ' || r == '\t' || r == '\n' || r == '\r'; r = s.rune() {
		s.advance()
		if err := s.check(); err != nil {
			return Token{}, err
		}
	}
	tok := s.position()
	start := s.off
	if s.off == len(s.src) {
		tok.Kind = EOF
		return tok, nil
	}
	s.count++
	if s.count > MaxTokens {
		return Token{}, failure(Resource, tok, "query token limit exceeded")
	}
	r := s.rune()
	if r == utf8.RuneError {
		_, n := utf8.DecodeRuneInString(s.src[s.off:])
		if n == 1 {
			tok.Kind = Invalid
			return Token{}, syntax(tok, "valid UTF-8")
		}
	}
	if r == '"' || r == '`' {
		return s.quoted(tok, r)
	}
	if letter(r) {
		for letter(s.rune()) || digit(s.rune()) {
			s.advance()
			if err := s.check(); err != nil {
				return Token{}, err
			}
		}
		tok.Kind = Identifier
		tok.Lit = s.src[start:s.off]
		return tok, nil
	}
	if digit(r) {
		return s.numeric(tok, start)
	}
	s.advance()
	switch r {
	case '{', '}', ',', '(', ')', '[', ']', '|', '=', '!', '<', '>', '+', '-', '*', '/', '@':
		tok.Kind = Kind(string(r))
		tok.Lit = string(r)
	default:
		tok.Kind = Invalid
		return tok, nil
	}
	switch r {
	case '(', '[', '{':
		s.nesting++
		if s.nesting > MaxNesting {
			return Token{}, failure(Resource, tok, "query nesting limit exceeded")
		}
	case ')', ']', '}':
		if s.nesting > 0 {
			s.nesting--
		}
	}
	if s.off < len(s.src) {
		pair := s.src[start : s.off+1]
		switch pair {
		case "|=", "|~", "!=", "!~", "=~", ">=", "<=", "==":
			s.advance()
			tok.Kind = Kind(pair)
			tok.Lit = pair
		}
	}
	return tok, nil
}
func (s *scanner) numeric(tok Token, start int) (Token, error) {
	for digit(s.rune()) {
		s.advance()
		if err := s.check(); err != nil {
			return Token{}, err
		}
	}
	if s.rune() == '.' {
		s.advance()
		if !digit(s.rune()) {
			tok.Kind = Invalid
			return Token{}, syntax(tok, "decimal digit")
		}
		for digit(s.rune()) {
			s.advance()
			if err := s.check(); err != nil {
				return Token{}, err
			}
		}
	}
	numEnd := s.off
	for letter(s.rune()) {
		s.advance()
		if err := s.check(); err != nil {
			return Token{}, err
		}
	}
	tok.Lit = s.src[start:s.off]
	tok.Kind = Number
	if s.off > numEnd {
		switch s.src[numEnd:s.off] {
		case "ns", "us", "ms", "s", "m", "h", "d", "w":
			tok.Kind = Duration
		case "b", "kb", "mb", "gb", "kib", "mib", "gib":
			tok.Kind = Bytes
		default:
			tok.Kind = Invalid
			return Token{}, syntax(tok, "supported numeric unit")
		}
	}
	return tok, nil
}
func (s *scanner) quoted(tok Token, quote rune) (Token, error) {
	s.advance()
	var value strings.Builder
	for s.off < len(s.src) {
		if err := s.check(); err != nil {
			return Token{}, err
		}
		r := s.rune()
		if r == quote {
			s.advance()
			tok.Kind = String
			tok.Lit = value.String()
			return tok, nil
		}
		if r == utf8.RuneError {
			_, n := utf8.DecodeRuneInString(s.src[s.off:])
			if n == 1 {
				at := s.position()
				at.Kind = Invalid
				return Token{}, syntax(at, "valid UTF-8")
			}
		}
		if quote == '`' || r != '\\' {
			value.WriteRune(r)
			s.advance()
			continue
		}
		s.advance()
		at := s.position()
		at.Kind = Invalid
		if s.off == len(s.src) {
			return Token{}, syntax(at, "escape")
		}
		r = s.rune()
		s.advance()
		switch r {
		case '"', '\\', '/':
			value.WriteRune(r)
		case 'n':
			value.WriteByte('\n')
		case 'r':
			value.WriteByte('\r')
		case 't':
			value.WriteByte('\t')
		case 'u', 'U':
			size := 4
			if r == 'U' {
				size = 8
			}
			start := s.off
			for range size {
				if s.off == len(s.src) {
					return Token{}, syntax(at, "Unicode scalar escape")
				}
				c := s.rune()
				if !digit(c) && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') {
					return Token{}, syntax(at, "Unicode scalar escape")
				}
				s.advance()
			}
			n, err := strconv.ParseUint(s.src[start:s.off], 16, 32)
			if err != nil || n > utf8.MaxRune || n >= 0xd800 && n <= 0xdfff {
				return Token{}, syntax(at, "Unicode scalar escape")
			}
			value.WriteRune(rune(n))
		default:
			return Token{}, syntax(at, "valid escape")
		}
	}
	at := s.position()
	at.Kind = EOF
	return Token{}, syntax(at, "closing string delimiter")
}
