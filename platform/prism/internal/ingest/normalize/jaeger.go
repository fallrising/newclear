package normalize

import (
	"strconv"
	"strings"
)

// JaegerTag is the inferred JSON-compatible tag representation used by the
// Jaeger compatibility layer.
type JaegerTag struct {
	Type  string `json:"type"`
	Value any    `json:"value"`
}

// InferJaegerTag applies the required bool, int64, float64, string inference
// order. Attribute names ending in _str explicitly retain string values.
func InferJaegerTag(name, value string) JaegerTag {
	if strings.HasSuffix(name, "_str") {
		return JaegerTag{Type: "string", Value: value}
	}
	if value == "true" || value == "false" {
		parsed, _ := strconv.ParseBool(value)
		return JaegerTag{Type: "bool", Value: parsed}
	}
	if !strings.Contains(value, ".") {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil {
			return JaegerTag{Type: "int64", Value: parsed}
		}
	}
	if parsed, err := strconv.ParseFloat(value, 64); err == nil {
		return JaegerTag{Type: "float64", Value: parsed}
	}
	return JaegerTag{Type: "string", Value: value}
}
