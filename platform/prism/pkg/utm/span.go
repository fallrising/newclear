package utm

import "strings"

// SpanKind identifies the relationship between a span and its caller.
type SpanKind uint8

const (
	// KindUnspecified indicates an unspecified span kind.
	KindUnspecified SpanKind = iota
	// KindInternal identifies an internal operation.
	KindInternal
	// KindServer identifies a server operation.
	KindServer
	// KindClient identifies a client operation.
	KindClient
	// KindProducer identifies a message producer.
	KindProducer
	// KindConsumer identifies a message consumer.
	KindConsumer
)

// String returns the canonical lowercase span-kind name.
func (k SpanKind) String() string {
	switch k {
	case KindInternal:
		return "internal"
	case KindServer:
		return "server"
	case KindClient:
		return "client"
	case KindProducer:
		return "producer"
	case KindConsumer:
		return "consumer"
	default:
		return "unspecified"
	}
}

// ParseSpanKind parses a case-insensitive span-kind name.
func ParseSpanKind(s string) SpanKind {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "internal":
		return KindInternal
	case "server":
		return KindServer
	case "client":
		return KindClient
	case "producer":
		return KindProducer
	case "consumer":
		return KindConsumer
	default:
		return KindUnspecified
	}
}

// StatusCode is the OpenTelemetry-compatible status of a span.
type StatusCode uint8

const (
	// StatusUnset indicates no explicit status.
	StatusUnset StatusCode = iota
	// StatusOK indicates successful completion.
	StatusOK
	// StatusError indicates failed completion.
	StatusError
)

// String returns the canonical lowercase status name.
func (c StatusCode) String() string {
	switch c {
	case StatusOK:
		return "ok"
	case StatusError:
		return "error"
	default:
		return "unset"
	}
}

// Span is a trace span in the unified telemetry model.
type Span struct {
	Resource     *Resource
	TraceID      string
	SpanID       string
	ParentSpanID string
	TraceState   string
	Name         string
	Kind         SpanKind
	StartNano    int64
	EndNano      int64
	StatusCode   StatusCode
	StatusMsg    string
	Attrs        map[string]string
	Events       []SpanEvent
	Links        []SpanLink
}

// DurationNano returns the span duration in nanoseconds.
func (s *Span) DurationNano() int64 { return s.EndNano - s.StartNano }

// IsRoot reports whether the span has no parent span ID.
func (s *Span) IsRoot() bool { return s.ParentSpanID == "" }

// SizeBytes estimates the span's in-memory payload size.
func (s *Span) SizeBytes() int {
	if s == nil {
		return 0
	}

	const scalarBytes = 8 + 8 + 1 + 1
	size := scalarBytes + resourceSizeBytes(s.Resource) + len(s.TraceID) + len(s.SpanID) +
		len(s.ParentSpanID) + len(s.TraceState) + len(s.Name) + len(s.StatusMsg) +
		stringMapSizeBytes(s.Attrs)
	for _, event := range s.Events {
		size += 8 + len(event.Name) + stringMapSizeBytes(event.Attrs)
	}
	for _, link := range s.Links {
		size += len(link.TraceID) + len(link.SpanID) + stringMapSizeBytes(link.Attrs)
	}
	return size
}

// SpanEvent is a timestamped event attached to a span.
type SpanEvent struct {
	TS    int64
	Name  string
	Attrs map[string]string
}

// SpanLink associates a span with another trace or span.
type SpanLink struct {
	TraceID string
	SpanID  string
	Attrs   map[string]string
}
