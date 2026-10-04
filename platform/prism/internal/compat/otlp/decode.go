package otlp

import (
	"encoding/json"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/mem"
	"google.golang.org/protobuf/encoding/protowire"
)

const maxDecodeDepth = 64
const maxDecodeFields = 1_000_000

type schema uint8

const (
	metricsExport schema = iota
	logsExport
	tracesExport
	resourceMetrics
	scopeMetrics
	metric
	gauge
	sum
	histogram
	exponentialHistogram
	summary
	numberPoint
	histogramPoint
	exponentialPoint
	summaryPoint
	exemplar
	resourceLogs
	scopeLogs
	logRecord
	resourceSpans
	scopeSpans
	span
	spanEvent
	spanLink
	resource
	scope
	keyValue
	anyValue
	arrayValue
	keyValueList
	leaf
)

// Message fields from the pinned OTLP v1 schemas (pdata v1.23). Scalar strings,
// IDs and packed numeric arrays are not traversed as messages. Include deprecated
// scope field 1000 because the pinned decoder accepts it. Unknown fields are
// skipped exactly as protobuf requires. OTLP has no legacy protobuf groups.
var messageFields = map[schema]map[protowire.Number]schema{
	metricsExport: {1: resourceMetrics}, logsExport: {1: resourceLogs}, tracesExport: {1: resourceSpans},
	resourceMetrics: {1: resource, 2: scopeMetrics, 1000: scopeMetrics}, scopeMetrics: {1: scope, 2: metric},
	metric: {5: gauge, 7: sum, 9: histogram, 10: exponentialHistogram, 11: summary, 12: keyValue},
	gauge:  {1: numberPoint}, sum: {1: numberPoint}, histogram: {1: histogramPoint}, exponentialHistogram: {1: exponentialPoint}, summary: {1: summaryPoint},
	numberPoint: {7: keyValue, 5: exemplar}, histogramPoint: {9: keyValue, 8: exemplar}, exponentialPoint: {1: keyValue, 8: leaf, 9: leaf, 11: exemplar}, summaryPoint: {7: keyValue, 6: leaf}, exemplar: {7: keyValue},
	resourceLogs: {1: resource, 2: scopeLogs, 1000: scopeLogs}, scopeLogs: {1: scope, 2: logRecord}, logRecord: {5: anyValue, 6: keyValue},
	resourceSpans: {1: resource, 2: scopeSpans, 1000: scopeSpans}, scopeSpans: {1: scope, 2: span}, span: {9: keyValue, 11: spanEvent, 13: spanLink, 15: leaf}, spanEvent: {3: keyValue}, spanLink: {4: keyValue},
	resource: {1: keyValue}, scope: {3: keyValue}, keyValue: {2: anyValue}, anyValue: {5: arrayValue, 6: keyValueList}, arrayValue: {1: anyValue}, keyValueList: {1: keyValue},
}

func validateProto(payload []byte, kind schema) error {
	remaining := maxDecodeFields
	return validateMessage(payload, kind, 0, &remaining)
}
func validateMessage(payload []byte, kind schema, depth int, remaining *int) error {
	if depth > maxDecodeDepth {
		return failure(spi.ErrTooLarge)
	}
	for len(payload) > 0 {
		if *remaining <= 0 {
			return failure(spi.ErrTooLarge)
		}
		*remaining--
		number, wire, n := protowire.ConsumeTag(payload)
		if n < 0 || number <= 0 || wire == protowire.StartGroupType || wire == protowire.EndGroupType {
			return failure(spi.ErrBadRequest)
		}
		payload = payload[n:]
		child, known := messageFields[kind][number]
		if known {
			if wire != protowire.BytesType {
				return failure(spi.ErrBadRequest)
			}
			bytes, n := protowire.ConsumeBytes(payload)
			if n < 0 {
				return failure(spi.ErrBadRequest)
			}
			if err := validateMessage(bytes, child, depth+1, remaining); err != nil {
				return err
			}
			payload = payload[n:]
		} else {
			n := protowire.ConsumeFieldValue(number, wire, payload)
			if n < 0 {
				return failure(spi.ErrBadRequest)
			}
			payload = payload[n:]
		}
	}
	return nil
}

// This lexical pass never recursively decodes or allocates nested user values.
// json.Valid then checks grammar before pdata's recursive AnyValue decoder runs.
func validateJSON(payload []byte) error {
	depth := 0
	quoted := false
	escaped := false
	for _, c := range payload {
		if quoted {
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				quoted = false
			}
			continue
		}
		switch c {
		case '"':
			quoted = true
		case '{', '[':
			depth++
			if depth > maxDecodeDepth {
				return failure(spi.ErrTooLarge)
			}
		case '}', ']':
			depth--
		}
	}
	if !json.Valid(payload) {
		return failure(spi.ErrBadRequest)
	}
	return nil
}

// CodecV2 preserves grpc's default protobuf support but validates OTLP wire
// message nesting before pdata's generated recursive decoder is invoked.
type boundedCodec struct{ base encoding.CodecV2 }

func (c boundedCodec) Name() string { return "proto" }

type decodeTarget struct {
	kind   schema
	decode func([]byte) error
	err    error
}

func (c boundedCodec) Marshal(value any) (mem.BufferSlice, error) {
	if response, ok := value.(wireResponse); ok {
		bytes, err := response.MarshalProto()
		if err != nil {
			return nil, err
		}
		return mem.BufferSlice{mem.SliceBuffer(bytes)}, nil
	}
	return c.base.Marshal(value)
}
func (c boundedCodec) Unmarshal(data mem.BufferSlice, value any) error {
	target, ok := value.(*decodeTarget)
	if !ok {
		return failure(spi.ErrUnsupported)
	}
	payload := data.Materialize()
	target.err = validateProto(payload, target.kind)
	if target.err == nil && decodeProto(payload, target.decode) != nil {
		target.err = failure(spi.ErrBadRequest)
	}
	// Decode errors are retained for the method to classify and sanitize. Returning
	// nil allows grpc's InPayload event to report actual decompressed wire bytes.
	return nil
}

// pdata's generated gRPC adapter migrates deprecated scope field 1000. Public
// ExportRequest.UnmarshalProto does not. Reproduce that bounded wire migration
// for both transports, preferring modern scope fields when any are present.
// This runs only after validateProto and preserves the original byte accounting.
func migrateLegacyScopes(payload []byte) []byte {
	var output []byte
	offset := 0
	for offset < len(payload) {
		number, wire, n := protowire.ConsumeTag(payload[offset:])
		valueStart := offset + n
		size := protowire.ConsumeFieldValue(number, wire, payload[valueStart:])
		end := valueStart + size
		var changed []byte
		if number == 1 && wire == protowire.BytesType {
			resource, _ := protowire.ConsumeBytes(payload[valueStart:end])
			changed = migrateResourceScopes(resource)
		}
		if changed != nil {
			if output == nil {
				output = make([]byte, 0, len(payload))
				output = append(output, payload[:offset]...)
			}
			output = protowire.AppendTag(output, number, wire)
			output = protowire.AppendBytes(output, changed)
		} else if output != nil {
			output = append(output, payload[offset:end]...)
		}
		offset = end
	}
	if output == nil {
		return payload
	}
	return output
}
func migrateResourceScopes(payload []byte) []byte {
	modern, legacy := false, false
	for offset := 0; offset < len(payload); {
		number, wire, n := protowire.ConsumeTag(payload[offset:])
		modern = modern || number == 2
		legacy = legacy || number == 1000
		offset += n
		offset += protowire.ConsumeFieldValue(number, wire, payload[offset:])
	}
	if !legacy {
		return nil
	}
	output := make([]byte, 0, len(payload))
	for offset := 0; offset < len(payload); {
		number, wire, n := protowire.ConsumeTag(payload[offset:])
		valueStart := offset + n
		end := valueStart + protowire.ConsumeFieldValue(number, wire, payload[valueStart:])
		if number == 1000 {
			if !modern {
				output = protowire.AppendTag(output, 2, wire)
				output = append(output, payload[valueStart:end]...)
			}
		} else {
			output = append(output, payload[offset:end]...)
		}
		offset = end
	}
	// Non-nil empty output records a changed resource containing only ignored scopes.
	return output
}
func decodeProto(payload []byte, decode func([]byte) error) error {
	return decode(migrateLegacyScopes(payload))
}
