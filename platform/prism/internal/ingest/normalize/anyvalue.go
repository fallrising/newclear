package normalize

import (
	"encoding/base64"
	"encoding/json"
	"maps"
	"math"
	"slices"
	"strconv"
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

const maxAttributeDepth = 5

// SerializeAnyValue converts an OpenTelemetry AnyValue to the canonical UTM
// string representation.
func SerializeAnyValue(value pcommon.Value) string {
	switch value.Type() {
	case pcommon.ValueTypeStr:
		return validUTF8(value.Str())
	case pcommon.ValueTypeBool:
		return strconv.FormatBool(value.Bool())
	case pcommon.ValueTypeInt:
		return strconv.FormatInt(value.Int(), 10)
	case pcommon.ValueTypeDouble:
		return strconv.FormatFloat(value.Double(), 'f', -1, 64)
	case pcommon.ValueTypeBytes:
		return base64.StdEncoding.EncodeToString(value.Bytes().AsRaw())
	case pcommon.ValueTypeSlice, pcommon.ValueTypeMap:
		encoded, err := json.Marshal(anyValueRaw(value))
		if err != nil {
			return ""
		}
		return string(encoded)
	default:
		return ""
	}
}

func validUTF8(value string) string {
	return strings.ToValidUTF8(value, "\uFFFD")
}

func anyValueRaw(value pcommon.Value) any {
	switch value.Type() {
	case pcommon.ValueTypeStr:
		return validUTF8(value.Str())
	case pcommon.ValueTypeBool:
		return value.Bool()
	case pcommon.ValueTypeInt:
		return value.Int()
	case pcommon.ValueTypeDouble:
		if math.IsNaN(value.Double()) || math.IsInf(value.Double(), 0) {
			return strconv.FormatFloat(value.Double(), 'g', -1, 64)
		}
		return value.Double()
	case pcommon.ValueTypeBytes:
		return base64.StdEncoding.EncodeToString(value.Bytes().AsRaw())
	case pcommon.ValueTypeSlice:
		values := value.Slice()
		result := make([]any, values.Len())
		for i := range values.Len() {
			result[i] = anyValueRaw(values.At(i))
		}
		return result
	case pcommon.ValueTypeMap:
		result := make(map[string]any, value.Map().Len())
		value.Map().Range(func(key string, child pcommon.Value) bool {
			result[validUTF8(key)] = anyValueRaw(child)
			return true
		})
		return result
	default:
		return nil
	}
}

func flattenAttributes(attributes pcommon.Map, maxAttrs int) (map[string]string, int) {
	flattened := make(map[string]string, attributes.Len())
	attributes.Range(func(key string, value pcommon.Value) bool {
		flattenValue(flattened, validUTF8(key), value, 1)
		return true
	})
	return capAttributes(flattened, maxAttrs)
}

func flattenValue(dst map[string]string, key string, value pcommon.Value, depth int) {
	dst[key] = SerializeAnyValue(value)
	if value.Type() != pcommon.ValueTypeMap || depth >= maxAttributeDepth {
		return
	}
	value.Map().Range(func(childKey string, child pcommon.Value) bool {
		flattenValue(dst, key+"."+escapeAttributeKey(childKey), child, depth+1)
		return true
	})
}

func escapeAttributeKey(key string) string {
	return strings.ReplaceAll(validUTF8(key), ".", `\.`)
}

func capAttributes(attributes map[string]string, maxAttrs int) (map[string]string, int) {
	if maxAttrs <= 0 || len(attributes) <= maxAttrs {
		return attributes, 0
	}

	keys := slices.Sorted(maps.Keys(attributes))
	kept := make(map[string]string, maxAttrs)
	for _, key := range keys[:maxAttrs] {
		kept[key] = attributes[key]
	}
	return kept, len(attributes) - maxAttrs
}

func capAttributesPreserving(attributes, protected map[string]string, maxAttrs int) (map[string]string, int) {
	combined := maps.Clone(attributes)
	if combined == nil {
		combined = make(map[string]string, len(protected))
	}
	maps.Copy(combined, protected)
	if maxAttrs <= 0 || len(combined) <= maxAttrs {
		return combined, 0
	}

	capacity := max(maxAttrs, len(protected))
	kept := maps.Clone(protected)
	for _, key := range slices.Sorted(maps.Keys(attributes)) {
		if len(kept) >= capacity {
			break
		}
		if _, protectedKey := protected[key]; !protectedKey {
			kept[key] = attributes[key]
		}
	}
	return kept, len(combined) - len(kept)
}
