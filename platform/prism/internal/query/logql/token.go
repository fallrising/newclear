// Package logql parses the bounded Prism LogQL subset into intermediate SPI IR.
// It is deliberately unwired: line/field regex compilation and execution belong
// to later milestones. Bounds are parser hard ceilings; future transport/config
// wiring must enforce its own request and tenant limits before calling Parse.
package logql

// Kind is a lexical token category. Diagnostics use categories, never input values.
type Kind string

const (
	EOF        Kind = "EOF"
	Identifier Kind = "IDENTIFIER"
	String     Kind = "STRING"
	Number     Kind = "NUMBER"
	Duration   Kind = "DURATION"
	Bytes      Kind = "BYTES"
	Invalid    Kind = "INVALID"
)

// Token contains a decoded literal and its one-based Unicode-rune position.
type Token struct {
	Kind      Kind
	Lit       string
	Line, Col int
}

const (
	MaxQueryBytes = 64 << 10
	MaxTokens     = 16384
	MaxTerms      = 1024
	MaxNesting    = 128
	MaxRegexBytes = 4096
)
