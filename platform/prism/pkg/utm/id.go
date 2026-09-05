package utm

import "strings"

// ValidTraceID reports whether s is 32 lowercase hexadecimal characters and
// is not the all-zero trace ID.
func ValidTraceID(s string) bool {
	return validID(s, 32)
}

// ValidSpanID reports whether s is 16 lowercase hexadecimal characters and is
// not the all-zero span ID.
func ValidSpanID(s string) bool {
	return validID(s, 16)
}

// NormalizeID lowercases a hexadecimal ID and removes a 0x prefix and hyphens.
func NormalizeID(s string) string {
	s = strings.ToLower(s)
	s = strings.TrimPrefix(s, "0x")
	return strings.ReplaceAll(s, "-", "")
}

func validID(s string, length int) bool {
	if len(s) != length {
		return false
	}
	nonzero := false
	for i := range len(s) {
		c := s[i]
		if c < '0' || c > '9' {
			if c < 'a' || c > 'f' {
				return false
			}
		}
		if c != '0' {
			nonzero = true
		}
	}
	return nonzero
}
