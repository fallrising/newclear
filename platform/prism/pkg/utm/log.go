package utm

import "strings"

// Severity is Prism's coarse OpenTelemetry-compatible log severity.
type Severity uint8

const (
	// SevUnknown indicates an unspecified severity.
	SevUnknown Severity = iota
	// SevTrace identifies trace logs.
	SevTrace
	// SevDebug identifies debug logs.
	SevDebug
	// SevInfo identifies informational logs.
	SevInfo
	// SevWarn identifies warning logs.
	SevWarn
	// SevError identifies error logs.
	SevError
	// SevFatal identifies fatal logs.
	SevFatal
)

// String returns the canonical lowercase severity name.
func (s Severity) String() string {
	switch s {
	case SevTrace:
		return "trace"
	case SevDebug:
		return "debug"
	case SevInfo:
		return "info"
	case SevWarn:
		return "warn"
	case SevError:
		return "error"
	case SevFatal:
		return "fatal"
	default:
		return "unknown"
	}
}

// ParseSeverity infers a severity from a case-insensitive textual prefix.
func ParseSeverity(text string) Severity {
	text = strings.ToLower(strings.TrimSpace(text))
	if len(text) == 1 {
		switch text {
		case "t":
			return SevTrace
		case "d":
			return SevDebug
		case "i":
			return SevInfo
		case "w":
			return SevWarn
		case "e":
			return SevError
		case "f":
			return SevFatal
		default:
			return SevUnknown
		}
	}

	switch {
	case hasAnyPrefix(text, "fatal", "crit", "critical", "panic", "emerg", "alert"):
		return SevFatal
	case hasAnyPrefix(text, "error", "err", "severe"):
		return SevError
	case hasAnyPrefix(text, "warn", "warning"):
		return SevWarn
	case hasAnyPrefix(text, "info", "information", "notice"):
		return SevInfo
	case hasAnyPrefix(text, "debug", "dbg"):
		return SevDebug
	case hasAnyPrefix(text, "trace", "trc"):
		return SevTrace
	default:
		return SevUnknown
	}
}

// SeverityFromOTel maps an OpenTelemetry SeverityNumber to Severity.
func SeverityFromOTel(n int32) Severity {
	switch {
	case n >= 1 && n <= 4:
		return SevTrace
	case n >= 5 && n <= 8:
		return SevDebug
	case n >= 9 && n <= 12:
		return SevInfo
	case n >= 13 && n <= 16:
		return SevWarn
	case n >= 17 && n <= 20:
		return SevError
	case n >= 21 && n <= 24:
		return SevFatal
	default:
		return SevUnknown
	}
}

// LogRecord is a log event in the unified telemetry model.
type LogRecord struct {
	Resource     *Resource
	TS           int64
	ObservedTS   int64
	Severity     Severity
	SeverityText string
	Body         string
	TraceID      string
	SpanID       string
	Labels       Labels
	Attrs        map[string]string
}

// SizeBytes estimates the record's in-memory payload size.
func (r *LogRecord) SizeBytes() int {
	if r == nil {
		return 0
	}

	const scalarBytes = 8 + 8 + 1
	return scalarBytes + resourceSizeBytes(r.Resource) + len(r.SeverityText) + len(r.Body) +
		len(r.TraceID) + len(r.SpanID) + labelsSizeBytes(r.Labels) + stringMapSizeBytes(r.Attrs)
}

func hasAnyPrefix(text string, prefixes ...string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(text, prefix) {
			return true
		}
	}
	return false
}

func resourceSizeBytes(resource *Resource) int {
	if resource == nil {
		return 0
	}
	return len(resource.Tenant) + len(resource.Service) + len(resource.ServiceInstance) +
		len(resource.ServiceVersion) + len(resource.Namespace) + len(resource.Host) +
		len(resource.Cluster) + len(resource.Env) + stringMapSizeBytes(resource.Attrs)
}

func labelsSizeBytes(ls Labels) int {
	size := 0
	for _, label := range ls {
		size += len(label.Name) + len(label.Value)
	}
	return size
}

func stringMapSizeBytes(values map[string]string) int {
	size := 0
	for key, value := range values {
		size += len(key) + len(value)
	}
	return size
}
