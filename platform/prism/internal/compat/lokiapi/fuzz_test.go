package lokiapi

import "testing"

func FuzzDecodePush(f *testing.F) {
	f.Add([]byte(`{"streams":[]}`), false)
	f.Add(payload(), false)
	f.Add([]byte(`{"streams":[{"stream":{},"values":[["1","x",{"a":"b"}]]}]}`), false)
	f.Add([]byte{0x1f, 0x8b}, true)
	f.Fuzz(func(t *testing.T, input []byte, compressed bool) {
		if len(input) > 64<<10 {
			return
		}
		payload, err := decodePush(t.Context(), input, compressed, 64<<10)
		if err == nil {
			if len(payload) > 64<<10 {
				t.Fatal("decompressed bound violated")
			}
			if err := validateTokens(t.Context(), payload); err != nil {
				t.Fatal("invalid accepted tokens")
			}
			if err := validateShape(t.Context(), payload, 64<<10); err != nil {
				t.Fatal("invalid accepted schema")
			}
		}
	})
}
