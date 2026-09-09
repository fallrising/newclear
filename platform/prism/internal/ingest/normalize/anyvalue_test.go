package normalize

import (
	"math"
	"testing"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

func TestSerializeAnyValue(t *testing.T) {
	t.Parallel()

	bytesValue := pcommon.NewValueBytes()
	bytesValue.Bytes().FromRaw([]byte{0, 1, 2})
	arrayValue := pcommon.NewValueSlice()
	arrayValue.Slice().AppendEmpty().SetStr("x")
	arrayValue.Slice().AppendEmpty().SetInt(2)
	mapValue := pcommon.NewValueMap()
	mapValue.Map().PutStr("z", "last")
	mapValue.Map().PutBool("a", true)
	nanArray := pcommon.NewValueSlice()
	nanArray.Slice().AppendEmpty().SetDouble(math.NaN())

	tests := []struct {
		name  string
		value pcommon.Value
		want  string
	}{
		{name: "empty", value: pcommon.NewValueEmpty(), want: ""},
		{name: "string", value: pcommon.NewValueStr("text"), want: "text"},
		{name: "bool", value: pcommon.NewValueBool(true), want: "true"},
		{name: "int", value: pcommon.NewValueInt(-42), want: "-42"},
		{name: "double", value: pcommon.NewValueDouble(1.25), want: "1.25"},
		{name: "bytes", value: bytesValue, want: "AAEC"},
		{name: "array", value: arrayValue, want: `["x",2]`},
		{name: "map", value: mapValue, want: `{"a":true,"z":"last"}`},
		{name: "non finite JSON", value: nanArray, want: `["NaN"]`},
		{name: "invalid UTF-8", value: pcommon.NewValueStr("bad\xfftext"), want: "bad�text"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := SerializeAnyValue(test.value); got != test.want {
				t.Fatalf("SerializeAnyValue() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestFlattenAttributesDepthEscapingAndLimit(t *testing.T) {
	t.Parallel()

	attributes := pcommon.NewMap()
	attributes.PutStr("z", "last")
	attributes.PutStr("a", "first")
	level1 := attributes.PutEmptyMap("parent")
	level2 := level1.PutEmptyMap("child.with.dot")
	level3 := level2.PutEmptyMap("three")
	level4 := level3.PutEmptyMap("four")
	level5 := level4.PutEmptyMap("five")
	level5.PutStr("too.deep", "json-only")

	flattened, dropped := flattenAttributes(attributes, 100)
	if dropped != 0 {
		t.Fatalf("dropped = %d, want 0", dropped)
	}
	for _, key := range []string{
		"parent",
		`parent.child\.with\.dot`,
		`parent.child\.with\.dot.three`,
		`parent.child\.with\.dot.three.four`,
		`parent.child\.with\.dot.three.four.five`,
	} {
		if _, found := flattened[key]; !found {
			t.Errorf("missing flattened key %q in %#v", key, flattened)
		}
	}
	if _, found := flattened[`parent.child\.with\.dot.three.four.five.too\.deep`]; found {
		t.Fatal("depth-six key was flattened")
	}

	limited, dropped := capAttributes(flattened, 2)
	if dropped != len(flattened)-2 {
		t.Fatalf("dropped = %d, want %d", dropped, len(flattened)-2)
	}
	if limited["a"] != "first" {
		t.Fatalf("lexicographically first key not retained: %#v", limited)
	}
}
