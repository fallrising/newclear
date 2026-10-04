package promapi

import (
	"bytes"
	"context"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/golang/snappy"
	"github.com/prometheus/prometheus/prompb"
	"google.golang.org/protobuf/encoding/protowire"
)

func field(number protowire.Number, wire protowire.Type, value []byte) []byte {
	payload := protowire.AppendTag(nil, number, wire)
	if wire == protowire.BytesType {
		return protowire.AppendBytes(payload, value)
	}
	return append(payload, value...)
}
func TestWriteProtoPreflight(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		payload []byte
		class   spi.ErrClass
	}{
		{"empty", nil, ""},
		{"unknown bytes opaque", field(99, protowire.BytesType, []byte{255, 255}), ""},
		{"unknown varint", field(99, protowire.VarintType, []byte{1}), ""},
		{"unknown fixed32", field(99, protowire.Fixed32Type, []byte{0, 0, 0, 0}), ""},
		{"unknown fixed64", field(99, protowire.Fixed64Type, make([]byte, 8)), ""},
		{"known wrong wire", field(1, protowire.VarintType, []byte{1}), spi.ErrBadRequest},
		{"zero field", []byte{0, 1}, spi.ErrBadRequest},
		{"invalid max field", field(protowire.MaxValidNumber+1, protowire.VarintType, []byte{1}), spi.ErrBadRequest},
		{"unknown group", field(99, protowire.StartGroupType, field(99, protowire.EndGroupType, nil)), spi.ErrBadRequest},
		{"known group", field(1, protowire.StartGroupType, nil), spi.ErrBadRequest},
		{"unmatched end", field(99, protowire.EndGroupType, nil), spi.ErrBadRequest},
		{"truncated bytes", []byte{10, 8, 1}, spi.ErrBadRequest},
		{"truncated varint", field(99, protowire.VarintType, []byte{128}), spi.ErrBadRequest},
		{"truncated fixed", field(99, protowire.Fixed64Type, []byte{1}), spi.ErrBadRequest},
		{"wrong label scalar", field(1, protowire.BytesType, field(1, protowire.BytesType, field(1, protowire.VarintType, []byte{1}))), spi.ErrBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			remaining := maxProtocolElements
			err := validateWriteMessage(context.Background(), tc.payload, writeRequest, &remaining)
			if tc.class == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || spi.Classify(err) != tc.class {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestWriteProtocolElementBoundaries(t *testing.T) {
	t.Parallel()
	// 100,000 unknown fields are accepted; the next field is refused before
	// generated unmarshal can retain or allocate the oversized structure.
	unknown := bytes.Repeat(field(99, protowire.VarintType, []byte{1}), maxProtocolElements)
	remaining := maxProtocolElements
	if err := validateWriteMessage(context.Background(), unknown, writeRequest, &remaining); err != nil || remaining != 0 {
		t.Fatalf("boundary: %v remaining=%d", err, remaining)
	}
	unknown = append(unknown, field(99, protowire.VarintType, []byte{1})...)
	_, _, err := decodeWrite(context.Background(), snappy.Encode(nil, unknown), 1<<20)
	if err == nil || spi.Classify(err) != spi.ErrTooLarge {
		t.Fatalf("unknown limit=%v", err)
	}
	for _, number := range []protowire.Number{9, 10, 12, 13} {
		t.Run(string(rune('a'+number)), func(t *testing.T) {
			t.Parallel()
			wire := protowire.VarintType
			value := []byte{1}
			if number == 10 || number == 13 {
				wire = protowire.Fixed64Type
				value = make([]byte, 8)
			}
			for _, packed := range []bool{false, true} {
				var histogram []byte
				if packed {
					histogram = field(number, protowire.BytesType, bytes.Repeat(value, maxProtocolElements))
				} else {
					histogram = bytes.Repeat(field(number, wire, value), maxProtocolElements)
				}
				payload := field(1, protowire.BytesType, field(4, protowire.BytesType, histogram))
				remaining := maxProtocolElements
				err := validateWriteMessage(context.Background(), payload, writeRequest, &remaining)
				if err == nil || spi.Classify(err) != spi.ErrTooLarge {
					t.Fatalf("number=%d packed=%v error=%v", number, packed, err)
				}
			}
		})
	}
}

func TestWriteNestedElementLimits(t *testing.T) {
	t.Parallel()
	for _, kind := range []writeSchema{writeRequest, timeSeries, label, sample, exemplar, histogram, bucketSpan, metadata} {
		t.Run(string(rune('a'+kind)), func(t *testing.T) {
			t.Parallel()
			// Duplicate singular/unknown fields consume capacity too, not just slices.
			payload := bytes.Repeat(field(99, protowire.VarintType, []byte{0}), 5)
			remaining := 4
			if err := validateWriteMessage(context.Background(), payload, kind, &remaining); err == nil || spi.Classify(err) != spi.ErrTooLarge {
				t.Fatalf("schema=%d error=%v", kind, err)
			}
		})
	}
	for _, number := range []protowire.Number{8, 11} {
		spans := bytes.Repeat(field(number, protowire.BytesType, nil), maxProtocolElements)
		remaining := maxProtocolElements - 1
		if err := validateWriteMessage(context.Background(), spans, histogram, &remaining); err == nil || spi.Classify(err) != spi.ErrTooLarge {
			t.Fatalf("spans error=%v", err)
		}
	}
}

func TestWritePackedValidationAndBudget(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		payload []byte
		wire    protowire.Type
		count   int
		class   spi.ErrClass
	}{
		{[]byte{1, 2, 3}, protowire.VarintType, 3, ""},
		{make([]byte, 16), protowire.Fixed64Type, 2, ""},
		{[]byte{128}, protowire.VarintType, 10, spi.ErrBadRequest},
		{make([]byte, 7), protowire.Fixed64Type, 10, spi.ErrBadRequest},
		{make([]byte, 16), protowire.Fixed64Type, 1, spi.ErrTooLarge},
	} {
		remaining := tc.count
		err := validatePacked(context.Background(), tc.payload, tc.wire, &remaining)
		if tc.class == "" {
			if err != nil || remaining != 0 {
				t.Fatalf("valid packed: %v %d", err, remaining)
			}
		} else if err == nil || spi.Classify(err) != tc.class {
			t.Fatalf("packed error=%v", err)
		}
	}
}
func TestWriteParserCancellation(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := decodeWrite(ctx, snappy.Encode(nil, nil), 100)
	if spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("decode cancellation=%v", err)
	}
	remaining := 100
	if err := validateWriteMessage(ctx, []byte{8, 1}, writeRequest, &remaining); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("scan cancellation=%v", err)
	}
	if err := validatePacked(ctx, []byte{1}, protowire.VarintType, &remaining); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("packed cancellation=%v", err)
	}
	if err := validateLabels(ctx, []prompb.Label{{Name: "x", Value: "y"}}, false); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("labels cancellation=%v", err)
	}
}
