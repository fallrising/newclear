package promapi

import (
	"context"
	"testing"

	"github.com/golang/snappy"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

func FuzzWriteParser(f *testing.F) {
	for _, seed := range [][]byte{nil, {10, 0}, {255}, {8, 1}, {10, 2, 10, 0}, {155, 6, 156, 6}} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, payload []byte) {
		if len(payload) > 1<<20 {
			t.Skip("fuzzer input exceeds finite receiver budget")
		}
		remaining := maxProtocolElements
		if err := validateWriteMessage(context.Background(), payload, writeRequest, &remaining); err == nil {
			_, _, _ = decodeWrite(context.Background(), snappy.Encode(nil, payload), 1<<20)
		}
	})
}
