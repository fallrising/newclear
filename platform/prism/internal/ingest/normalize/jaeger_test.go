package normalize

import "testing"

func TestInferJaegerTagOrder(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		attribute string
		value     string
		wantType  string
		wantValue any
	}{
		{name: "bool", value: "true", wantType: "bool", wantValue: true},
		{name: "int before float", value: "1", wantType: "int64", wantValue: int64(1)},
		{name: "float", value: "1.20", wantType: "float64", wantValue: 1.2},
		{name: "string", value: "v1", wantType: "string", wantValue: "v1"},
		{name: "forced string", attribute: "version_str", value: "1.20", wantType: "string", wantValue: "1.20"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := InferJaegerTag(test.attribute, test.value)
			if got.Type != test.wantType || got.Value != test.wantValue {
				t.Fatalf("InferJaegerTag() = %#v, want %s/%#v", got, test.wantType, test.wantValue)
			}
		})
	}
}
