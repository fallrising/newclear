package fleetfile

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
	if err := checkUnknownTree("", raw, allowedRoot); err != nil {
		return nil, err
	}
	var doc Document
	if err := yaml.Unmarshal(b, &doc); err != nil {
		return nil, newError("invalid_yaml", err.Error())
	}
	return &doc, nil
}

// ParseJSON decodes a fleet document from JSON bytes.
func ParseJSON(b []byte) (*Document, error) {
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, newError("invalid_json", err.Error())
	}
	if err := checkUnknownTree("", raw, allowedRoot); err != nil {
		return nil, err
	}
	var doc Document
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, newError("invalid_json", err.Error())
	}
	return &doc, nil
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

type allowed map[string]any // nested allowed keys; nil value = leaf object handled specially

var allowedRoot = map[string]map[string]any{
	"apiVersion": nil,
	"kind":       nil,
	"metadata": {
		"name":        nil,
		"description": nil,
		"labels":      nil,
	},
	"spec": {
		"node":         nil,
		"image":        nil,
		"desiredState": nil,
		"replicas":     nil,
		"command":      nil,
		"args":         nil,
		"workingDir":   nil,
		"user":         nil,
		"expose": map[string]any{
			"mode":       nil,
			"hostname":   nil,
			"port":       nil,
			"healthPath": nil,
		},
		"env":     nil,
		"secrets": nil,
		"volumes": nil,
		"resources": map[string]any{
			"memory": nil,
			"cpus":   nil,
		},
	},
}

func checkUnknownTree(prefix string, raw map[string]any, schema map[string]map[string]any) error {
	ve := &Error{}
	checkMap(ve, prefix, raw, flatten(schema))
	return ve.finish()
}

func flatten(schema map[string]map[string]any) map[string]any {
	out := make(map[string]any, len(schema))
	for k, v := range schema {
		if v == nil {
			out[k] = nil
		} else {
			out[k] = v
		}
	}
	return out
}

func checkMap(ve *Error, prefix string, raw map[string]any, allowedKeys map[string]any) {
	if raw == nil {
		return
	}
	for k, v := range raw {
		path := k
		if prefix != "" {
			path = prefix + "." + k
		}
		child, ok := allowedKeys[k]
		if !ok {
			ve.add(path, "additional_property")
			continue
		}
		if nested, ok := child.(map[string]any); ok {
			if m, ok := v.(map[string]any); ok {
				checkMap(ve, path, m, nested)
			}
		}
	}
	if prefix == "spec" {
		if vols, ok := raw["volumes"].([]any); ok {
			for i, item := range vols {
				m, ok := item.(map[string]any)
				if !ok {
					continue
				}
				volPath := fmt.Sprintf("spec.volumes[%d]", i)
				for k := range m {
					if k != "name" && k != "mount" {
						ve.add(volPath+"."+k, "additional_property")
					}
				}
			}
		}
	}
}
