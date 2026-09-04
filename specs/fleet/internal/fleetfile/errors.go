package fleetfile

import (
	"fmt"
	"strings"
)

// FieldError is one validation failure at a JSON path.
type FieldError struct {
	Path string `json:"path"`
	Code string `json:"code"`
}

// Error is the validator/parse error. Code matches the API envelope.
type Error struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Fields  []FieldError `json:"fields,omitempty"`
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if len(e.Fields) == 0 {
		if e.Message != "" {
			return e.Message
		}
		return e.Code
	}
	parts := make([]string, 0, len(e.Fields))
	for _, f := range e.Fields {
		parts = append(parts, f.Path+": "+f.Code)
	}
	if e.Message != "" {
		return e.Message + " (" + strings.Join(parts, "; ") + ")"
	}
	return strings.Join(parts, "; ")
}

func (e *Error) HasCode(code string) bool {
	if e == nil {
		return false
	}
	if e.Code == code {
		return true
	}
	for _, f := range e.Fields {
		if f.Code == code {
			return true
		}
	}
	return false
}

func newError(code, msg string, fields ...FieldError) *Error {
	return &Error{Code: code, Message: msg, Fields: fields}
}

func fieldErr(path, code string) FieldError {
	return FieldError{Path: path, Code: code}
}

func (e *Error) add(path, code string) {
	e.Fields = append(e.Fields, fieldErr(path, code))
}

func (e *Error) empty() bool {
	return e == nil || (e.Code == "" && len(e.Fields) == 0)
}

func (e *Error) finish() error {
	if e.empty() {
		return nil
	}
	if e.Code == "" {
		if len(e.Fields) == 1 {
			e.Code = e.Fields[0].Code
			if e.Message == "" {
				e.Message = fmt.Sprintf("%s: %s", e.Fields[0].Path, e.Fields[0].Code)
			}
		} else {
			e.Code = "validation_failed"
			if e.Message == "" {
				e.Message = "fleet.yaml validation failed"
			}
		}
	}
	return e
}
