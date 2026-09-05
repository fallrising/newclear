package config

import (
	"encoding"
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

type yamlScalar struct {
	value string
	line  int
}

type yamlLine struct {
	indent int
	text   string
	number int
}

const maxYAMLIndent = 200

func unmarshalYAMLStrict(content []byte, output any) error {
	parsed, err := parseYAMLDocument(content)
	if err != nil {
		return err
	}
	if parsed == nil {
		return nil
	}
	value := reflect.ValueOf(output)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return fmt.Errorf("YAML output must be a non-nil pointer")
	}
	return decodeYAMLValue(parsed, value.Elem(), "configuration")
}

func parseYAMLDocument(content []byte) (any, error) {
	lines, err := scanYAMLLines(string(content))
	if err != nil {
		return nil, err
	}
	if len(lines) == 0 {
		return nil, nil
	}
	if lines[0].indent != 0 {
		return nil, fmt.Errorf("line %d: top-level value must not be indented", lines[0].number)
	}
	parsed, next, err := parseYAMLBlock(lines, 0, 0)
	if err != nil {
		return nil, err
	}
	if next != len(lines) {
		return nil, fmt.Errorf("line %d: unexpected indentation", lines[next].number)
	}
	return parsed, nil
}

func scanYAMLLines(document string) ([]yamlLine, error) {
	result := make([]yamlLine, 0)
	for index, original := range strings.Split(document, "\n") {
		lineNumber := index + 1
		if strings.ContainsRune(original, '\t') {
			return nil, fmt.Errorf("line %d: tabs are not allowed in indentation", lineNumber)
		}
		withoutComment, err := stripYAMLComment(strings.TrimSuffix(original, "\r"))
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", lineNumber, err)
		}
		trimmed := strings.TrimSpace(withoutComment)
		if trimmed == "" || trimmed == "---" || trimmed == "..." {
			continue
		}
		indent := len(withoutComment) - len(strings.TrimLeft(withoutComment, " "))
		if indent > maxYAMLIndent {
			return nil, fmt.Errorf("line %d: YAML nesting exceeds the supported limit", lineNumber)
		}
		result = append(result, yamlLine{indent: indent, text: strings.TrimSpace(withoutComment), number: lineNumber})
	}
	return result, nil
}

func stripYAMLComment(line string) (string, error) {
	var quote rune
	escaped := false
	for index, current := range line {
		if escaped {
			escaped = false
			continue
		}
		if quote == '"' && current == '\\' {
			escaped = true
			continue
		}
		if current == '\'' || current == '"' {
			switch quote {
			case 0:
				quote = current
			default:
				if quote == current {
					quote = 0
				}
			}
			continue
		}
		if current == '#' && quote == 0 && (index == 0 || line[index-1] == ' ') {
			return strings.TrimRight(line[:index], " "), nil
		}
	}
	if quote != 0 {
		return "", fmt.Errorf("unterminated quoted scalar")
	}
	return line, nil
}

func parseYAMLBlock(lines []yamlLine, start, indent int) (any, int, error) {
	if start >= len(lines) || lines[start].indent != indent {
		return nil, start, fmt.Errorf("line %d: invalid indentation", lines[start].number)
	}
	if strings.HasPrefix(lines[start].text, "-") {
		return parseYAMLSequence(lines, start, indent)
	}
	return parseYAMLMapping(lines, start, indent)
}

func parseYAMLMapping(lines []yamlLine, start, indent int) (map[string]any, int, error) {
	result := make(map[string]any)
	index := start
	for index < len(lines) && lines[index].indent == indent {
		line := lines[index]
		if strings.HasPrefix(line.text, "-") {
			return nil, index, fmt.Errorf("line %d: sequence item in mapping", line.number)
		}
		key, raw, found := splitYAMLPair(line.text)
		if !found || key == "" {
			return nil, index, fmt.Errorf("line %d: expected key: value", line.number)
		}
		if _, duplicate := result[key]; duplicate {
			return nil, index, fmt.Errorf("line %d: duplicate key %q", line.number, key)
		}
		index++
		value, next, err := parseYAMLPairValue(lines, index, indent, raw, line.number)
		if err != nil {
			return nil, index, err
		}
		result[key] = value
		index = next
	}
	return result, index, nil
}

func parseYAMLSequence(lines []yamlLine, start, indent int) ([]any, int, error) {
	result := make([]any, 0)
	index := start
	for index < len(lines) && lines[index].indent == indent {
		line := lines[index]
		if line.text != "-" && !strings.HasPrefix(line.text, "- ") {
			return nil, index, fmt.Errorf("line %d: mapping entry in sequence", line.number)
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line.text, "-"))
		index++
		if key, initial, found := splitYAMLPair(raw); found {
			item := map[string]any{}
			value, next, err := parseYAMLPairValue(lines, index, indent, initial, line.number)
			if err != nil {
				return nil, index, err
			}
			item[key] = value
			index = next
			if index < len(lines) && lines[index].indent > indent {
				continuationIndent := lines[index].indent
				continuation, after, err := parseYAMLMapping(lines, index, continuationIndent)
				if err != nil {
					return nil, index, err
				}
				for continuationKey, continuationValue := range continuation {
					if _, duplicate := item[continuationKey]; duplicate {
						return nil, index, fmt.Errorf("line %d: duplicate key %q", line.number, continuationKey)
					}
					item[continuationKey] = continuationValue
				}
				index = after
			}
			result = append(result, item)
			continue
		}
		if raw != "" {
			value, err := parseYAMLScalar(raw, line.number)
			if err != nil {
				return nil, index, err
			}
			result = append(result, value)
			continue
		}
		if index >= len(lines) || lines[index].indent <= indent {
			return nil, index, fmt.Errorf("line %d: empty sequence item", line.number)
		}
		value, next, err := parseYAMLBlock(lines, index, lines[index].indent)
		if err != nil {
			return nil, index, err
		}
		result = append(result, value)
		index = next
	}
	return result, index, nil
}

func parseYAMLPairValue(lines []yamlLine, next, parentIndent int, raw string, lineNumber int) (any, int, error) {
	if raw != "" {
		value, err := parseYAMLScalar(raw, lineNumber)
		return value, next, err
	}
	if next >= len(lines) || lines[next].indent <= parentIndent {
		return map[string]any{}, next, nil
	}
	value, after, err := parseYAMLBlock(lines, next, lines[next].indent)
	return value, after, err
}

func splitYAMLPair(text string) (string, string, bool) {
	var quote rune
	escaped := false
	for index, current := range text {
		if escaped {
			escaped = false
			continue
		}
		if quote == '"' && current == '\\' {
			escaped = true
			continue
		}
		if current == '\'' || current == '"' {
			switch quote {
			case 0:
				quote = current
			default:
				if quote == current {
					quote = 0
				}
			}
			continue
		}
		if current == ':' && quote == 0 && (index+1 == len(text) || text[index+1] == ' ') {
			key := strings.TrimSpace(text[:index])
			return key, strings.TrimSpace(text[index+1:]), true
		}
	}
	return "", "", false
}

func parseYAMLScalar(raw string, line int) (any, error) {
	if raw == "{}" {
		return map[string]any{}, nil
	}
	if strings.HasPrefix(raw, "{") && strings.HasSuffix(raw, "}") {
		return parseYAMLInlineMapping(strings.TrimSpace(raw[1:len(raw)-1]), line)
	}
	if raw == "[]" {
		return []any{}, nil
	}
	if strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]") {
		return parseYAMLInlineSequence(strings.TrimSpace(raw[1:len(raw)-1]), line)
	}
	if strings.HasPrefix(raw, "&") || strings.HasPrefix(raw, "*") || raw == "|" || raw == ">" {
		return nil, fmt.Errorf("line %d: YAML anchors, aliases, and block scalars are not supported", line)
	}
	value, err := unquoteYAMLScalar(raw)
	if err != nil {
		return nil, fmt.Errorf("line %d: %w", line, err)
	}
	return yamlScalar{value: value, line: line}, nil
}

func parseYAMLInlineMapping(raw string, line int) (map[string]any, error) {
	result := make(map[string]any)
	for _, part := range splitYAMLCommaList(raw) {
		key, value, found := splitYAMLPair(strings.TrimSpace(part))
		if !found || key == "" || value == "" {
			return nil, fmt.Errorf("line %d: invalid inline mapping entry", line)
		}
		if _, duplicate := result[key]; duplicate {
			return nil, fmt.Errorf("line %d: duplicate key %q", line, key)
		}
		parsed, err := parseYAMLScalar(value, line)
		if err != nil {
			return nil, err
		}
		result[key] = parsed
	}
	return result, nil
}

func parseYAMLInlineSequence(raw string, line int) ([]any, error) {
	if raw == "" {
		return []any{}, nil
	}
	parts := splitYAMLCommaList(raw)
	result := make([]any, 0, len(parts))
	for _, part := range parts {
		value, err := parseYAMLScalar(strings.TrimSpace(part), line)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, nil
}

func splitYAMLCommaList(value string) []string {
	var quote rune
	escaped, start := false, 0
	result := make([]string, 0)
	for index, current := range value {
		if escaped {
			escaped = false
			continue
		}
		if quote == '"' && current == '\\' {
			escaped = true
			continue
		}
		if current == '\'' || current == '"' {
			switch quote {
			case 0:
				quote = current
			default:
				if quote == current {
					quote = 0
				}
			}
			continue
		}
		if current == ',' && quote == 0 {
			result = append(result, value[start:index])
			start = index + 1
		}
	}
	return append(result, value[start:])
}

func unquoteYAMLScalar(value string) (string, error) {
	if len(value) < 2 {
		return value, nil
	}
	if value[0] == '"' && value[len(value)-1] == '"' {
		unquoted, err := strconv.Unquote(value)
		if err != nil {
			return "", fmt.Errorf("invalid quoted scalar: %w", err)
		}
		return unquoted, nil
	}
	if value[0] == '\'' && value[len(value)-1] == '\'' {
		return strings.ReplaceAll(value[1:len(value)-1], "''", "'"), nil
	}
	return value, nil
}

func decodeYAMLValue(input any, output reflect.Value, path string) error {
	if output.Kind() == reflect.Pointer {
		if output.IsNil() {
			output.Set(reflect.New(output.Type().Elem()))
		}
		return decodeYAMLValue(input, output.Elem(), path)
	}
	if scalar, ok := input.(yamlScalar); ok {
		return decodeYAMLScalar(scalar, output, path)
	}

	switch output.Kind() {
	case reflect.Struct:
		mapping, ok := input.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be a mapping", path)
		}
		return decodeYAMLStruct(mapping, output, path)
	case reflect.Map:
		mapping, ok := input.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be a mapping", path)
		}
		return decodeYAMLMap(mapping, output, path)
	case reflect.Slice:
		sequence, ok := input.([]any)
		if !ok {
			return fmt.Errorf("%s must be a sequence", path)
		}
		result := reflect.MakeSlice(output.Type(), len(sequence), len(sequence))
		for index, item := range sequence {
			if err := decodeYAMLValue(item, result.Index(index), fmt.Sprintf("%s[%d]", path, index)); err != nil {
				return err
			}
		}
		output.Set(result)
		return nil
	case reflect.Interface:
		output.Set(reflect.ValueOf(yamlToPlain(input)))
		return nil
	default:
		return fmt.Errorf("%s has unsupported YAML type %s", path, output.Type())
	}
}

func decodeYAMLStruct(mapping map[string]any, output reflect.Value, path string) error {
	typeOfOutput := output.Type()
	fields := make(map[string]int, typeOfOutput.NumField())
	for index := range typeOfOutput.NumField() {
		field := typeOfOutput.Field(index)
		if field.PkgPath != "" {
			continue
		}
		name := strings.Split(field.Tag.Get("yaml"), ",")[0]
		if name != "" && name != "-" {
			fields[name] = index
		}
	}
	for name, input := range mapping {
		index, found := fields[name]
		if !found {
			return fmt.Errorf("%s: unknown field %q", path, name)
		}
		if err := decodeYAMLValue(input, output.Field(index), path+"."+name); err != nil {
			return err
		}
	}
	return nil
}

func decodeYAMLMap(mapping map[string]any, output reflect.Value, path string) error {
	if output.Type().Key().Kind() != reflect.String {
		return fmt.Errorf("%s map keys must be strings", path)
	}
	result := reflect.MakeMapWithSize(output.Type(), len(mapping)+output.Len())
	for _, existingKey := range output.MapKeys() {
		result.SetMapIndex(existingKey, output.MapIndex(existingKey))
	}
	for name, input := range mapping {
		key := reflect.ValueOf(name).Convert(output.Type().Key())
		value := reflect.New(output.Type().Elem()).Elem()
		if err := decodeYAMLValue(input, value, path+"."+name); err != nil {
			return err
		}
		result.SetMapIndex(key, value)
	}
	output.Set(result)
	return nil
}

func decodeYAMLScalar(input yamlScalar, output reflect.Value, path string) error {
	if output.CanAddr() {
		if unmarshaler, ok := output.Addr().Interface().(encoding.TextUnmarshaler); ok {
			if err := unmarshaler.UnmarshalText([]byte(input.value)); err != nil {
				return fmt.Errorf("%s at line %d: %w", path, input.line, err)
			}
			return nil
		}
	}
	var err error
	switch output.Kind() {
	case reflect.String:
		output.SetString(input.value)
	case reflect.Bool:
		var parsed bool
		parsed, err = strconv.ParseBool(strings.ToLower(input.value))
		if err == nil {
			output.SetBool(parsed)
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		var parsed int64
		parsed, err = strconv.ParseInt(strings.ReplaceAll(input.value, "_", ""), 10, output.Type().Bits())
		if err == nil {
			output.SetInt(parsed)
		}
	case reflect.Interface:
		output.Set(reflect.ValueOf(input.value))
	default:
		return fmt.Errorf("%s has unsupported scalar type %s", path, output.Type())
	}
	if err != nil {
		return fmt.Errorf("%s at line %d: invalid value %q: %w", path, input.line, input.value, err)
	}
	return nil
}

func yamlToPlain(input any) any {
	switch value := input.(type) {
	case yamlScalar:
		return value.value
	case map[string]any:
		result := make(map[string]any, len(value))
		for key, item := range value {
			result[key] = yamlToPlain(item)
		}
		return result
	case []any:
		result := make([]any, len(value))
		for index, item := range value {
			result[index] = yamlToPlain(item)
		}
		return result
	default:
		return value
	}
}
