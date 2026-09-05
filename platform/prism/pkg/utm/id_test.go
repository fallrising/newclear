package utm

import "testing"

func TestValidTraceID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "valid", input: "0123456789abcdef0123456789abcdef", want: true},
		{name: "all zero", input: "00000000000000000000000000000000", want: false},
		{name: "uppercase", input: "0123456789ABCDEF0123456789ABCDEF", want: false},
		{name: "non hex", input: "g123456789abcdef0123456789abcdef", want: false},
		{name: "short", input: "1234", want: false},
		{name: "empty", input: "", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := ValidTraceID(test.input); got != test.want {
				t.Fatalf("ValidTraceID(%q) = %v, want %v", test.input, got, test.want)
			}
		})
	}
}

func TestValidSpanID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{name: "valid", input: "0123456789abcdef", want: true},
		{name: "all zero", input: "0000000000000000", want: false},
		{name: "uppercase", input: "0123456789ABCDEF", want: false},
		{name: "non hex", input: "g123456789abcdef", want: false},
		{name: "long", input: "0123456789abcdef0", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := ValidSpanID(test.input); got != test.want {
				t.Fatalf("ValidSpanID(%q) = %v, want %v", test.input, got, test.want)
			}
		})
	}
}

func TestNormalizeID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input string
		want  string
	}{
		{input: "", want: ""},
		{input: "0x0123-ABCD", want: "0123abcd"},
		{input: "0XFFFF", want: "ffff"},
		{input: "AA-BB-CC", want: "aabbcc"},
		{input: "already-normal", want: "alreadynormal"},
	}
	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			t.Parallel()
			if got := NormalizeID(test.input); got != test.want {
				t.Fatalf("NormalizeID(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}
