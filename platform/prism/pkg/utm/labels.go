package utm

import (
	"strings"

	"github.com/prometheus/prometheus/model/labels"
)

// Labels aliases the sorted Prometheus label set.
type Labels = labels.Labels

// LabelsBuilder aliases the Prometheus labels builder.
type LabelsBuilder = labels.Builder

const (
	// LabelTenant is the system-owned tenant label.
	LabelTenant = "__tenant__"
	// LabelName is the Prometheus metric-name label.
	LabelName = "__name__"
	// LabelSeverity is the system-owned log-severity label.
	LabelSeverity = "__severity__"

	// ReservedPrefix marks labels reserved for Prism internals.
	ReservedPrefix = "__"
)

// Fingerprint returns the stable Prometheus hash for a label set.
func Fingerprint(ls Labels) uint64 { return ls.Hash() }

// SanitizeMetricName replaces characters outside [a-zA-Z0-9_:] with an
// underscore and prefixes names that begin with a digit.
func SanitizeMetricName(s string) string {
	return sanitizeName(s, true)
}

// SanitizeLabelName replaces characters outside [a-zA-Z0-9_] with an
// underscore and prefixes names that begin with a digit.
func SanitizeLabelName(s string) string {
	return sanitizeName(s, false)
}

// IsReserved reports whether name is reserved for Prism internals.
func IsReserved(name string) bool {
	return strings.HasPrefix(name, ReservedPrefix)
}

func sanitizeName(s string, allowColon bool) string {
	if s == "" {
		return ""
	}

	var b strings.Builder
	b.Grow(len(s) + 1)
	if isASCIIDigit(s[0]) {
		b.WriteByte('_')
	}
	for _, r := range s {
		if isASCIIAlphaNumeric(r) || r == '_' || (allowColon && r == ':') {
			b.WriteRune(r)
			continue
		}
		b.WriteByte('_')
	}
	return b.String()
}

func isASCIIDigit(c byte) bool {
	return c >= '0' && c <= '9'
}

func isASCIIAlphaNumeric(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}
