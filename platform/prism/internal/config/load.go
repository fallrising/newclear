package config

import (
	"context"
	"encoding"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"strconv"
	"strings"
)

const maxConfigBytes = 4 << 20

var errUnknownEnvironmentPath = errors.New("unknown configuration environment path")

// Load reads, overrides, and validates a configuration using the process environment.
func Load(path string) (*Config, error) {
	return LoadContext(context.Background(), path)
}

// LoadContext reads, applies process environment overrides, and validates a configuration.
func LoadContext(ctx context.Context, path string) (*Config, error) {
	return LoadWithEnvironment(ctx, path, os.Environ())
}

// LoadWithEnvironment reads, applies explicit environment overrides, and validates a configuration.
func LoadWithEnvironment(ctx context.Context, path string, environment []string) (*Config, error) {
	content, err := readBounded(ctx, path, maxConfigBytes)
	if err != nil {
		return nil, fmt.Errorf("read config %q: %w", path, err)
	}
	result := Default()
	if err := unmarshalYAMLStrict(content, &result); err != nil {
		return nil, fmt.Errorf("parse config %q: %w", path, err)
	}
	if err := applyEnvironment(&result, environment); err != nil {
		return nil, err
	}
	resolveRelativePaths(&result, path)
	if err := result.Validate(ctx); err != nil {
		return nil, fmt.Errorf("validate config %q: %w", path, err)
	}
	return &result, nil
}

func readBounded(ctx context.Context, path string, limit int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := os.Open(path) //nolint:gosec // Configuration and auxiliary paths are administrator-selected and reads are bounded.
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	content, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return content, nil
}

func applyEnvironment(result *Config, environment []string) error {
	for _, item := range environment {
		name, raw, found := strings.Cut(item, "=")
		if !found || !strings.HasPrefix(name, "PRISM_") {
			continue
		}
		path := strings.TrimPrefix(name, "PRISM_")
		if err := setEnvironmentValue(reflect.ValueOf(result).Elem(), path, raw); err != nil {
			return fmt.Errorf("environment variable %s: %w", name, err)
		}
	}
	return nil
}

func setEnvironmentValue(value reflect.Value, path, raw string) error {
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			value.Set(reflect.New(value.Type().Elem()))
		}
		return setEnvironmentValue(value.Elem(), path, raw)
	}
	if path == "" {
		return setScalar(value, raw)
	}

	switch value.Kind() {
	case reflect.Struct:
		field, remainder, found := findEnvironmentField(value, path)
		if !found {
			return fmt.Errorf("%w %q", errUnknownEnvironmentPath, path)
		}
		return setEnvironmentValue(field, remainder, raw)
	case reflect.Map:
		return setEnvironmentMapValue(value, path, raw)
	default:
		return fmt.Errorf("%w %q", errUnknownEnvironmentPath, path)
	}
}

func findEnvironmentField(value reflect.Value, path string) (reflect.Value, string, bool) {
	typeOfValue := value.Type()
	bestIndex, bestLength := -1, -1
	for i := range typeOfValue.NumField() {
		fieldType := typeOfValue.Field(i)
		if fieldType.PkgPath != "" {
			continue
		}
		tag := strings.Split(fieldType.Tag.Get("yaml"), ",")[0]
		if tag == "" || tag == "-" {
			continue
		}
		environmentName := strings.ToUpper(tag)
		if path == environmentName || strings.HasPrefix(path, environmentName+"_") {
			if len(environmentName) > bestLength {
				bestIndex, bestLength = i, len(environmentName)
			}
		}
	}
	if bestIndex < 0 {
		return reflect.Value{}, "", false
	}
	fieldType := typeOfValue.Field(bestIndex)
	environmentName := strings.ToUpper(strings.Split(fieldType.Tag.Get("yaml"), ",")[0])
	remainder := strings.TrimPrefix(path, environmentName)
	remainder = strings.TrimPrefix(remainder, "_")
	return value.Field(bestIndex), remainder, true
}

func setEnvironmentMapValue(value reflect.Value, path, raw string) error {
	if value.Type().Key().Kind() != reflect.String {
		return fmt.Errorf("map %s does not have string keys", value.Type())
	}
	if value.IsNil() {
		value.Set(reflect.MakeMap(value.Type()))
	}
	elementType := value.Type().Elem()
	if elementType.Kind() == reflect.String {
		value.SetMapIndex(reflect.ValueOf(strings.ToLower(path)).Convert(value.Type().Key()), reflect.ValueOf(raw).Convert(elementType))
		return nil
	}
	mapKey, remainder, found := strings.Cut(path, "_")
	if !found {
		return fmt.Errorf("%w %q", errUnknownEnvironmentPath, path)
	}
	key := reflect.ValueOf(strings.ToLower(mapKey)).Convert(value.Type().Key())
	element := reflect.New(elementType).Elem()
	if existing := value.MapIndex(key); existing.IsValid() {
		element.Set(existing)
	}
	if err := setEnvironmentValue(element, remainder, raw); err != nil {
		return err
	}
	value.SetMapIndex(key, element)
	return nil
}

func setScalar(value reflect.Value, raw string) error {
	if value.CanAddr() {
		if unmarshaler, ok := value.Addr().Interface().(encoding.TextUnmarshaler); ok {
			return unmarshaler.UnmarshalText([]byte(raw))
		}
	}
	switch value.Kind() {
	case reflect.String:
		value.SetString(raw)
	case reflect.Bool:
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return err
		}
		value.SetBool(parsed)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		parsed, err := strconv.ParseInt(raw, 10, value.Type().Bits())
		if err != nil {
			return err
		}
		value.SetInt(parsed)
	default:
		return fmt.Errorf("configuration type %s cannot be set from text", value.Type())
	}
	return nil
}
