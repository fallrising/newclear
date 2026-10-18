package logql

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestExtractLiteralHintSeeds(t *testing.T) {
	// SDD 16 §3.4 keeps the longest necessary literal. error.*timeout therefore
	// yields "timeout", not the shorter "error" used as an illustration in 06 §3.3.
	cases := []struct {
		pattern string
		want    string
	}{
		{pattern: `error.*timeout`, want: "timeout"},
		{pattern: `(a|b)cd`, want: ""},
		{pattern: `^prefix`, want: "prefix"},
		{pattern: `suffix$`, want: "suffix"},
		{pattern: `a{2,5}b`, want: ""},
		{pattern: `(?i)Error`, want: ""},
		{pattern: `\d+ERROR\d+`, want: "ERROR"},
		{pattern: `[a-z]+fatal`, want: "fatal"},
	}
	for _, tc := range cases {
		t.Run(tc.pattern, func(t *testing.T) {
			if got := ExtractLiteralHint(tc.pattern); got != tc.want {
				t.Fatalf("ExtractLiteralHint(%q) = %q, want %q", tc.pattern, got, tc.want)
			}
		})
	}
}

func TestExtractLiteralHintConservative(t *testing.T) {
	cases := []struct {
		pattern string
		want    string
	}{
		{pattern: `ab`, want: ""},
		{pattern: `abc`, want: "abc"},
		{pattern: `abcd.*wxyz`, want: "abcd"},
		{pattern: `foo(?i:x)bar`, want: ""},
		{pattern: `error|errorfoo`, want: "error"},
		{pattern: `[`, want: ""},
		{pattern: "", want: ""},
		{pattern: strings.Repeat("a", MaxRegexBytes+1), want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.pattern, func(t *testing.T) {
			if got := ExtractLiteralHint(tc.pattern); got != tc.want {
				t.Fatalf("ExtractLiteralHint = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestExtractLiteralHintUnreadCaseFlag(t *testing.T) {
	pattern := "hello" + strings.Repeat("(", 140) + "(?i)z" + strings.Repeat(")", 140)
	if len(pattern) > MaxRegexBytes {
		t.Fatalf("fixture is outside the regex ceiling: %d", len(pattern))
	}
	if _, err := regexp.Compile(pattern); err != nil {
		t.Fatal(err)
	}
	if got := ExtractLiteralHint(pattern); got != "" {
		t.Fatalf("hint %q kept although a nested case-insensitive flag was not read", got)
	}
}

func FuzzLiteralHint(f *testing.F) {
	for _, pattern := range []string{
		`error.*timeout`,
		`(a|b)cd`,
		`^prefix`,
		`suffix$`,
		`a{2,5}b`,
		`(?i)Error`,
		`\d+ERROR\d+`,
		`[a-z]+fatal`,
	} {
		f.Add(pattern, "error then timeout")
	}
	f.Fuzz(func(t *testing.T, pattern, input string) {
		re, err := regexp.Compile(pattern)
		if err != nil {
			t.Skip()
		}
		hint := ExtractLiteralHint(pattern)
		if hint == "" {
			return
		}
		if re.MatchString(input) && !strings.Contains(input, hint) {
			t.Fatalf("hint %q not present in matching input %q (pattern %q)", hint, input, pattern)
		}
	})
}

func TestCompileLineAndFieldRegex(t *testing.T) {
	query := `{host=~"a.+",job="api"} |= "keep" |~ "error.*timeout" !~ "noise.*" | json | level =~ "fatal.*" | code !~ "5.."`
	parsed, err := Parse(t.Context(), query, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Compile(t.Context(), parsed)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Filters[1].Compiled != nil || parsed.Filters[1].LiteralHint != "" || parsed.Fields[0].Compiled != nil {
		t.Fatal("Compile mutated the parsed query")
	}
	if got.Selectors[0].Compiled == nil || !got.Selectors[0].Matches("abc") {
		t.Fatal("selector compilation was dropped")
	}
	if got.Filters[0].Op != spi.LineContains || got.Filters[0].Compiled != nil || got.Filters[0].LiteralHint != "" {
		t.Fatalf("literal filter changed: %#v", got.Filters[0])
	}
	positive := got.Filters[1]
	if positive.LiteralHint != "timeout" || positive.Compiled == nil || !positive.Compiled.MatchString("errorZZZtimeout") {
		t.Fatalf("positive regex: hint %q compiled %v", positive.LiteralHint, positive.Compiled)
	}
	negative := got.Filters[2]
	if negative.LiteralHint != "" || negative.Compiled == nil || !negative.Matches("ok") || negative.Matches("noise-1") {
		t.Fatalf("negative regex: %#v", negative)
	}
	if got.Fields[0].Compiled == nil || !got.Fields[0].Compiled.MatchString("fatal-now") || got.Fields[1].Compiled == nil {
		t.Fatalf("field regexes: %#v", got.Fields)
	}
}

func TestCompileRejectsInvalidRegex(t *testing.T) {
	parsed, err := Parse(t.Context(), `{job="api"} |~ "zzunique[" | json | level =~ "ok"`, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Compile(t.Context(), parsed)
	if err == nil || spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), "zzunique") {
		t.Fatalf("diagnostic leaked the pattern: %v", err)
	}
	if got.Tenant != "" || len(got.Filters) != 0 || len(got.Fields) != 0 {
		t.Fatalf("partial query on error: %#v", got)
	}

	tooLong := spi.LogQuery{Filters: []spi.LineFilter{{Op: spi.LineMatch, Value: strings.Repeat("a", MaxRegexBytes+1)}}}
	got, err = Compile(t.Context(), tooLong)
	if err == nil || spi.Classify(err) != spi.ErrTooLarge || len(got.Filters) != 0 {
		t.Fatalf("too long: query %#v err %v", got, err)
	}
}

func TestCompileCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	got, err := Compile(ctx, spi.LogQuery{Filters: []spi.LineFilter{{Op: spi.LineMatch, Value: "error"}}})
	if err == nil || spi.Classify(err) != spi.ErrTimeout || len(got.Filters) != 0 {
		t.Fatalf("query %#v err %v", got, err)
	}
	if _, err := Compile(nil, spi.LogQuery{}); err == nil || spi.Classify(err) != spi.ErrBadRequest { //nolint:staticcheck // nil context is an explicit contract
		t.Fatal(err)
	}
}
