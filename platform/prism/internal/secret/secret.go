// Package secret provides values that redact themselves when formatted or
// serialized.
package secret

import (
	"fmt"
	"io"
	"strconv"
)

// Redacted is the only externally visible representation of a String.
const Redacted = "<secret>"

// String holds a sensitive string value.
//
// Code that deliberately needs the underlying credential can use an explicit
// string conversion. Formatting and serialization always redact the value.
type String string

// Mask returns the redacted representation of a sensitive string.
func Mask(_ string) string {
	return Redacted
}

// String implements fmt.Stringer without exposing the underlying value.
func (s String) String() string {
	return Mask(string(s))
}

// Format implements fmt.Formatter so flags and verbs such as %+v and %#v
// cannot bypass String.
func (s String) Format(state fmt.State, _ rune) {
	_, _ = io.WriteString(state, Mask(string(s)))
}

// MarshalJSON implements json.Marshaler without exposing the underlying value.
func (s String) MarshalJSON() ([]byte, error) {
	return strconv.AppendQuote(nil, Mask(string(s))), nil
}

// MarshalYAML returns a redacted YAML scalar.
func (s String) MarshalYAML() (any, error) {
	return Mask(string(s)), nil
}
