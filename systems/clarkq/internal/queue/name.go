package queue

import (
	"regexp"
	"unicode/utf8"
)

const maxNameLen = 64

var namePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func ValidName(name string) bool {
	if name == "" || utf8.RuneCountInString(name) > maxNameLen {
		return false
	}
	return namePattern.MatchString(name)
}