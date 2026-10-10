package otlp

import (
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

func FuzzValidateProto(f *testing.F) {
	f.Add(uint8(0), []byte{})
	f.Add(uint8(1), []byte{0xff})
	f.Add(uint8(2), []byte{0x0a, 0x00})
	unknown := protowire.AppendTag(nil, 123, protowire.BytesType)
	unknown = protowire.AppendBytes(unknown, []byte{0x0a, 0x80})
	f.Add(uint8(0), unknown)
	nested := []byte{}
	for range 80 {
		nested = field(5, field(1, nested))
	}
	f.Add(uint8(1), field(1, field(2, field(2, field(5, nested)))))
	f.Fuzz(func(t *testing.T, selector uint8, payload []byte) {
		if len(payload) > 16384 {
			t.Skip()
		}
		kind := schema(selector % 3)
		if validateProto(payload, kind) != nil {
			return
		}
		signal := []string{"metrics", "logs", "traces"}[selector%3]
		_, target := newDecodeTarget(signal)
		_ = decodeProto(payload, target.decode)
	})
}
func field(number protowire.Number, body []byte) []byte {
	out := protowire.AppendTag(nil, number, protowire.BytesType)
	return protowire.AppendBytes(out, body)
}
func FuzzValidateJSON(f *testing.F) {
	for _, seed := range []string{`{}`, `{"resourceLogs":[]}`, `{"resourceMetrics":[{"scopeMetrics":[]}]}`, `{"resourceSpans":[]}`, `{"stringValue":"\\\"{["}`, `{"a":[[[[[[]]]]]]}`, `{`} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, payload string) {
		if len(payload) > 16384 {
			t.Skip()
		}
		_ = validateJSON([]byte(payload))
	})
}
