package config

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"

	"gopkg.in/yaml.v3"
)

// yamlDocumentCount counts documents the same way gopkg.in/yaml.v3 v3.0.1 does.
// A file that is only "---" is one null document. A trailing "---" is a second document.
func yamlDocumentCount(content []byte) (int, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(content))
	count := 0
	for {
		var node yaml.Node
		err := decoder.Decode(&node)
		if errors.Is(err, io.EOF) {
			return count, nil
		}
		if err != nil {
			return 0, err
		}
		count++
	}
}

func validateRuleDocument(content []byte) error {
	count, err := yamlDocumentCount(content)
	if err != nil {
		return err
	}
	if count > 1 {
		return fmt.Errorf("more than one YAML document")
	}
	var raw any
	if err := yaml.Unmarshal(content, &raw); err != nil {
		return err
	}
	if raw == nil {
		return nil
	}
	root, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("rule document must be a mapping")
	}
	groups, exists := root["groups"]
	if !exists {
		return fmt.Errorf("rule document must contain a non-empty groups sequence")
	}
	if groups == nil {
		return nil
	}
	sequence, ok := groups.([]any)
	if !ok {
		return fmt.Errorf("rule document must contain a non-empty groups sequence")
	}
	if len(sequence) == 0 {
		return nil
	}
	for groupIndex, groupValue := range sequence {
		group, ok := groupValue.(map[string]any)
		if !ok || yamlString(group["name"]) == "" {
			return fmt.Errorf("groups[%d].name must not be empty", groupIndex)
		}
		rulesValue, ok := group["rules"]
		if !ok {
			return fmt.Errorf("groups[%d].rules must be a non-empty sequence", groupIndex)
		}
		if rulesValue == nil {
			continue
		}
		rules, ok := rulesValue.([]any)
		if !ok {
			return fmt.Errorf("groups[%d].rules must be a non-empty sequence", groupIndex)
		}
		if len(rules) == 0 {
			continue
		}
		for ruleIndex, ruleValue := range rules {
			rule, ok := ruleValue.(map[string]any)
			if !ok || yamlString(rule["expr"]) == "" {
				return fmt.Errorf("groups[%d].rules[%d].expr must not be empty", groupIndex, ruleIndex)
			}
			if yamlString(rule["alert"]) == "" && yamlString(rule["record"]) == "" {
				return fmt.Errorf("groups[%d].rules[%d] must define alert or record", groupIndex, ruleIndex)
			}
		}
	}
	return nil
}

func yamlString(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}
