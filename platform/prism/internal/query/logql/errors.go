package logql

import (
	"errors"
	"fmt"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// ErrorKind identifies a parser failure without exposing input text.
type ErrorKind string

const (
	Syntax       ErrorKind = "syntax"
	Semantic     ErrorKind = "semantic"
	Unsupported  ErrorKind = "unsupported"
	Resource     ErrorKind = "resource"
	Cancellation ErrorKind = "cancellation"
)

// Error retains public LogQL text and a classified, unwrap-compatible cause.
type Error struct {
	Kind      ErrorKind
	Line, Col int
	message   string
	cause     error
}

func (e *Error) Error() string { return e.message }
func (e *Error) Unwrap() error { return e.cause }
func failure(kind ErrorKind, at Token, msg string) error {
	class := spi.ErrBadRequest
	switch kind {
	case Unsupported:
		class = spi.ErrUnsupported
	case Resource:
		class = spi.ErrTooLarge
	case Cancellation:
		class = spi.ErrTimeout
	}
	return &Error{Kind: kind, Line: at.Line, Col: at.Col, message: msg, cause: spi.Wrap(class, "logql", "Parse", errors.New(msg))}
}
func syntax(at Token, expected string) error {
	return failure(Syntax, at, fmt.Sprintf("parse error at line %d, col %d: syntax error: unexpected %s, expecting %s", at.Line, at.Col, at.Kind, expected))
}
func cancelled(at Token, cause error) error {
	return &Error{Kind: Cancellation, Line: at.Line, Col: at.Col, message: "query parsing cancelled", cause: spi.Wrap(spi.ErrTimeout, "logql", "Parse", cause)}
}

const nonEmptySelector = "queries require at least one regexp or equality matcher that does not have an empty-compatible value"
