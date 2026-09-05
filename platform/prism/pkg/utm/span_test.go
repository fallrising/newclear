package utm

import "testing"

func TestSpanKind(t *testing.T) {
	t.Parallel()

	tests := []struct {
		kind SpanKind
		name string
	}{
		{kind: KindUnspecified, name: "unspecified"},
		{kind: KindInternal, name: "internal"},
		{kind: KindServer, name: "server"},
		{kind: KindClient, name: "client"},
		{kind: KindProducer, name: "producer"},
		{kind: KindConsumer, name: "consumer"},
		{kind: SpanKind(255), name: "unspecified"},
	}
	for _, test := range tests {
		if got := test.kind.String(); got != test.name {
			t.Errorf("SpanKind(%d).String() = %q, want %q", test.kind, got, test.name)
		}
		if test.kind <= KindConsumer {
			if got := ParseSpanKind("  " + test.name + "  "); got != test.kind {
				t.Errorf("ParseSpanKind(%q) = %v, want %v", test.name, got, test.kind)
			}
		}
	}
	if got := ParseSpanKind("SERVER"); got != KindServer {
		t.Fatalf("ParseSpanKind(SERVER) = %v, want server", got)
	}
	if got := ParseSpanKind("invalid"); got != KindUnspecified {
		t.Fatalf("ParseSpanKind(invalid) = %v, want unspecified", got)
	}
}

func TestStatusCodeString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		code StatusCode
		want string
	}{
		{code: StatusUnset, want: "unset"},
		{code: StatusOK, want: "ok"},
		{code: StatusError, want: "error"},
		{code: StatusCode(255), want: "unset"},
	}
	for _, test := range tests {
		if got := test.code.String(); got != test.want {
			t.Errorf("StatusCode(%d).String() = %q, want %q", test.code, got, test.want)
		}
	}
}

func TestSpanHelpers(t *testing.T) {
	t.Parallel()

	span := &Span{StartNano: 100, EndNano: 175}
	if got := span.DurationNano(); got != 75 {
		t.Fatalf("DurationNano() = %d, want 75", got)
	}
	if !span.IsRoot() {
		t.Fatal("span without ParentSpanID should be root")
	}
	span.ParentSpanID = "parent"
	if span.IsRoot() {
		t.Fatal("span with ParentSpanID should not be root")
	}
}

func TestSpanSizeBytes(t *testing.T) {
	t.Parallel()

	var nilSpan *Span
	if got := nilSpan.SizeBytes(); got != 0 {
		t.Fatalf("nil Span.SizeBytes() = %d, want 0", got)
	}
	span := &Span{
		Resource:     &Resource{Service: "api"},
		TraceID:      "trace",
		SpanID:       "span",
		ParentSpanID: "parent",
		TraceState:   "state",
		Name:         "request",
		StatusMsg:    "ok",
		Attrs:        map[string]string{"method": "GET"},
		Events:       []SpanEvent{{Name: "event", Attrs: map[string]string{"key": "value"}}},
		Links:        []SpanLink{{TraceID: "linked-trace", SpanID: "linked-span", Attrs: map[string]string{"type": "follows"}}},
	}
	const want = 18 + 3 + 5 + 4 + 6 + 5 + 7 + 2 + 6 + 3 + 8 + 5 + 3 + 5 + 12 + 11 + 4 + 7
	if got := span.SizeBytes(); got != want {
		t.Fatalf("Span.SizeBytes() = %d, want %d", got, want)
	}
}
