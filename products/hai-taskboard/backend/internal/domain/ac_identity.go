package domain

import (
	"unicode"
	"unicode/utf8"
)

// ValidACID checks the accepted specification identity profile without changing
// its bytes. It does not establish that the AC is accepted or has a policy rule.
func ValidACID(value string) bool {
	if len(value) == 0 || len(value) > 120 || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) || unicode.IsSpace(r) || r == '/' || r == '\\' {
			return false
		}
	}
	return true
}
