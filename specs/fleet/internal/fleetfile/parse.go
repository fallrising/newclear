package fleetfile

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// ParseYAML decodes a fleet document from YAML bytes.
func ParseYAML(b []byte) (*Document, error) {
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(false)
	var raw map[string]any
	if err := dec.Decode(&raw); err != nil {
		if err == io.EOF {
			return nil, newError("invalid_yaml", "empty document")
		}
		return nil, newError("invalid_yaml", err.Error())
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, newError("invalid_yaml", "expected exactly one YAML document")
	}
	return decodeRaw(raw)
}

// ParseJSON decodes a fleet document from JSON bytes.
func ParseJSON(b []byte) (*Document, error) {
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, newError("invalid_json", err.Error())
	}
	return decodeRaw(raw)
}

// Validate raw values before decoding: Go zero values otherwise erase explicit
// nulls and YAML's string coercions erase the input's schema types.
func decodeRaw(raw map[string]any) (*Document, error) {
	ve := &Error{}
	checkRaw(ve, "", raw, documentRule)
	if err := ve.finish(); err != nil {
		return nil, err
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil, newError("invalid_json", err.Error())
	}
	var doc Document
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, newError("invalid_json", err.Error())
	}
	return &doc, nil
}

type rawRule struct {
	kind     string
	fields   map[string]rawRule
	required []string
	items    *rawRule
	values   *rawRule
}

var stringRule = rawRule{kind: "string"}
var stringArrayRule = rawRule{kind: "array", items: &stringRule}
var stringMapRule = rawRule{kind: "object", values: &stringRule}
var volumeRule = rawRule{kind: "object", required: []string{"name", "mount"}, fields: map[string]rawRule{
	"name": stringRule, "mount": stringRule,
}}
var documentRule = rawRule{kind: "object", required: []string{"apiVersion", "kind", "metadata", "spec"}, fields: map[string]rawRule{
	"apiVersion": stringRule, "kind": stringRule,
	"metadata": {kind: "object", required: []string{"name"}, fields: map[string]rawRule{
		"name": stringRule, "description": stringRule, "labels": stringMapRule,
	}},
	"spec": {kind: "object", required: []string{"node", "expose"}, fields: map[string]rawRule{
		"node": stringRule, "image": stringRule, "desiredState": stringRule,
		"replicas": {kind: "integer"}, "command": stringArrayRule, "args": stringArrayRule,
		"workingDir": stringRule, "user": stringRule, "env": stringMapRule,
		"secrets": stringArrayRule, "volumes": {kind: "array", items: &volumeRule},
		"expose": {kind: "object", required: []string{"mode", "port"}, fields: map[string]rawRule{
			"mode": stringRule, "hostname": stringRule, "port": {kind: "integer"}, "healthPath": stringRule,
		}},
		"resources": {kind: "object", fields: map[string]rawRule{"memory": stringRule, "cpus": stringRule}},
	}},
}}

func checkRaw(ve *Error, path string, value any, rule rawRule) {
	badType := func() { ve.add(path, "invalid_type") }
	switch rule.kind {
	case "object":
		m, ok := value.(map[string]any)
		if !ok || m == nil {
			badType()
			return
		}
		for _, key := range rule.required {
			if _, exists := m[key]; !exists {
				ve.add(joinPath(path, key), "required")
			}
		}
		for key, v := range m {
			child, exists := rule.fields[key]
			if rule.values != nil {
				child, exists = *rule.values, true
			}
			if !exists {
				ve.add(joinPath(path, key), "additional_property")
				continue
			}
			checkRaw(ve, joinPath(path, key), v, child)
			// JSON Schema integers may be written as 8080.0. Normalize only
			// after the type check so the typed decoder can preserve them.
			if child.kind == "integer" {
				if n, ok := v.(float64); ok && math.Trunc(n) == n && n >= -2147483648 && n <= 2147483647 {
					m[key] = int(n)
				}
			}
		}
	case "array":
		items, ok := value.([]any)
		if !ok {
			badType()
			return
		}
		for i, item := range items {
			checkRaw(ve, fmt.Sprintf("%s[%d]", path, i), item, *rule.items)
		}
	case "integer":
		switch n := value.(type) {
		case int, int64, uint64:
		case float64:
			if math.Trunc(n) != n {
				badType()
			}
		default:
			badType()
		}
	case "string":
		s, ok := value.(string)
		if !ok {
			badType()
			return
		}
		if s == "" {
			switch path {
			case "spec.image", "spec.desiredState", "spec.expose.healthPath", "spec.resources.memory", "spec.resources.cpus":
				ve.add(path, "invalid_value")
			}
		}
	}
}

func joinPath(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return prefix + "." + key
}

// ParseFile reads YAML or JSON based on extension.
func ParseFile(path string) (*Document, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(strings.ToLower(path), ".json") {
		return ParseJSON(b)
	}
	return ParseYAML(b)
}
