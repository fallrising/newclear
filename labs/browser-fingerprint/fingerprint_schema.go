package main

import (
	"encoding/json"
	"fmt"
)

// This schema mirrors the browser collector, including nested objects and arrays.
// Unknown keys are discarded before logging AND hashing. Types prevent an object
// carrying arbitrary fields from hiding inside an otherwise permitted leaf.
var mimeSchema = map[string]any{"type": "string", "suffixes": "string", "description": "string"}
var brandSchema = map[string]any{"brand": "string", "version": "string"}
var fingerprintSchema = map[string]any{
	"browser": map[string]any{
		"userAgent": "string", "appVersion": "string", "vendor": "string", "platform": "string",
		"webdriver": "bool", "pdfViewerEnabled": "bool",
		"userAgentData": map[string]any{"brands": []any{brandSchema}, "mobile": "bool", "platform": "string"},
		"highEntropy": map[string]any{
			"available": "bool", "error": "string", "architecture": "string", "bitness": "string", "model": "string",
			"platformVersion": "string", "uaFullVersion": "string", "fullVersionList": []any{brandSchema},
			"brands": []any{brandSchema}, "mobile": "bool", "platform": "string", "wow64": "bool",
		},
		"plugins":    []any{map[string]any{"name": "string", "description": "string", "filename": "string", "version": "null", "mimeTypes": []any{mimeSchema}}},
		"mimeTypes":  []any{mimeSchema},
		"extensions": map[string]any{"enumerationAvailable": "bool", "versionsAvailable": "bool", "installed": "null"},
	},
	"device":       map[string]any{"hardwareConcurrency": "number", "deviceMemoryGiB": "number", "maxTouchPoints": "number"},
	"screen":       map[string]any{"width": "number", "height": "number", "availWidth": "number", "availHeight": "number", "colorDepth": "number", "pixelDepth": "number", "devicePixelRatio": "number", "orientationType": "string"},
	"viewport":     map[string]any{"innerWidth": "number", "innerHeight": "number", "outerWidth": "number", "outerHeight": "number", "visualWidth": "number", "visualHeight": "number", "visualScale": "number"},
	"locale":       map[string]any{"language": "string", "languages": []any{"string"}, "timezone": "string", "timezoneOffsetMinutes": "number"},
	"capabilities": map[string]any{"cookieEnabled": "bool", "localStorage": "bool", "sessionStorage": "bool", "secureContext": "bool", "doNotTrack": "string", "globalPrivacyControl": "bool", "touchEvent": "bool", "webGPU": "bool", "reducedMotion": "bool", "colorScheme": "string"},
	"rendering": map[string]any{
		"webgl":  map[string]any{"available": "bool", "error": "string", "vendor": "string", "renderer": "string", "version": "string", "shadingLanguageVersion": "string", "maxTextureSize": "number", "unmaskedVendor": "string", "unmaskedRenderer": "string"},
		"canvas": map[string]any{"available": "bool", "error": "string", "algorithm": "string", "hash": "string", "sampleVersion": "number"},
	},
	"limitations": map[string]any{"plugins": "string", "pluginVersions": "string", "extensions": "string", "osVersion": "string", "identity": "string", "clientClaims": "string", "notCollected": []any{"string"}},
	"context":     map[string]any{"collectedAt": "string", "route": "string", "protocol": "string", "sampleLabel": "string", "visibilityState": "string"},
}

func filterFingerprintValue(value, schema any) (any, error) {
	// Unavailable browser APIs intentionally report null.
	if value == nil {
		return nil, nil
	}
	switch shape := schema.(type) {
	case map[string]any:
		object, ok := value.(map[string]any)
		if ok {
			result := make(map[string]any)
			for key, childSchema := range shape {
				if child, present := object[key]; present {
					filtered, err := filterFingerprintValue(child, childSchema)
					if err != nil {
						return nil, err
					}
					result[key] = filtered
				}
			}
			return result, nil
		}
	case []any:
		items, ok := value.([]any)
		if ok {
			result := make([]any, len(items))
			for i, item := range items {
				filtered, err := filterFingerprintValue(item, shape[0])
				if err != nil {
					return nil, err
				}
				result[i] = filtered
			}
			return result, nil
		}
	case string:
		switch shape {
		case "string":
			if _, ok := value.(string); ok {
				return value, nil
			}
		case "bool":
			if _, ok := value.(bool); ok {
				return value, nil
			}
		case "number":
			if _, ok := value.(float64); ok {
				return value, nil
			}
		}
	}
	return nil, fmt.Errorf("invalid observation field type")
}

func filterFingerprintSection(name string, raw json.RawMessage) (json.RawMessage, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	filtered, err := filterFingerprintValue(value, fingerprintSchema[name])
	if err != nil {
		return nil, err
	}
	return json.Marshal(filtered)
}
