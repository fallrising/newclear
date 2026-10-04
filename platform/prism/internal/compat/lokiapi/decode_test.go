package lokiapi

import (
	"bytes"
	"context"
	"fmt"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func TestPushWholeRequestSchema(t *testing.T) {
	t.Parallel()
	cases := []string{
		`null`, `[]`, `{}`, `{"streams":null}`, `{"streams":{}}`, `{"streams":[],"extra":true}`, `{"Streams":[]}`, `{"streams":[],"streams":[]}`, `{"streams":[],"str\u0065ams":[]}`,
		`{"streams":[null]}`, `{"streams":[{}]}`, `{"streams":[{"stream":{},"values":null}]}`, `{"streams":[{"stream":null,"values":[]}]}`, `{"streams":[{"stream":{},"values":[],"extra":null}]}`,
		`{"streams":[{"stream":{"a":1},"values":[]}]}`, `{"streams":[{"stream":{"a":null},"values":[]}]}`, `{"streams":[{"stream":{"a":"1","a":"2"},"values":[]}]}`,
		`{"streams":[{"stream":{},"values":[null]}]}`, `{"streams":[{"stream":{},"values":[[]]}]}`, `{"streams":[{"stream":{},"values":[["1"]]}]}`, `{"streams":[{"stream":{},"values":[[1,"x"]]}]}`, `{"streams":[{"stream":{},"values":[[null,"x"]]}]}`, `{"streams":[{"stream":{},"values":[["1",null]]}]}`, `{"streams":[{"stream":{},"values":[["1",1]]}]}`,
		`{"streams":[{"stream":{},"values":[["1","x",null]]}]}`, `{"streams":[{"stream":{},"values":[["1","x",[]]]}]}`, `{"streams":[{"stream":{},"values":[["1","x",{"a":1}]]}]}`, `{"streams":[{"stream":{},"values":[["1","x",{"a":{}}]]}]}`, `{"streams":[{"stream":{},"values":[["1","x",{"a":[]}]]}]}`, `{"streams":[{"stream":{},"values":[["1","x",{"a":null}]]}]}`, `{"streams":[{"stream":{},"values":[["1","x",{"a":"1","a":"2"}]]}]}`, `{"streams":[{"stream":{},"values":[["1","x",{},"fourth"]]}]}`,
		`{"streams":[]} {"streams":[]}`, `{"streams":[],}`, `{"streams":[{"stream":{},"values":[["1","\ud800"]]}]}`,
	}
	cases = append(cases, string([]byte{'{', '"', 's', 't', 'r', 'e', 'a', 'm', 's', '"', ':', '[', ']', '}', 0xff}))
	for i, wire := range cases {
		t.Run(strconv.Itoa(i), func(t *testing.T) {
			called := false
			r := receiver(t, func(context.Context, []utm.LogRecord, int64) (ingest.Result, error) {
				called = true
				return ingest.Result{}, nil
			}, options())
			w := httptest.NewRecorder()
			r.HTTPHandler().ServeHTTP(w, request([]byte(wire)))
			if w.Code != 400 || called {
				t.Fatalf("status=%d called=%v wire=%s", w.Code, called, wire)
			}
		})
	}
	// A valid first stream must not be admitted when a later stream is malformed.
	wire := strings.TrimSpace(string(payload()))
	wire = wire[:len(wire)-3] + `,{"stream":{},"values":[[1,"bad"]]}]}`
	called := false
	r := receiver(t, func(context.Context, []utm.LogRecord, int64) (ingest.Result, error) {
		called = true
		return ingest.Result{}, nil
	}, options())
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request([]byte(wire)))
	if w.Code != 400 || called {
		t.Fatalf("late malformed stream=%d called=%v", w.Code, called)
	}
}
func TestPushTokenDepthAndElementBounds(t *testing.T) {
	t.Parallel()
	for _, depth := range []int{16, 17} {
		wire := []byte(strings.Repeat("[", depth) + strings.Repeat("]", depth))
		err := validateTokens(t.Context(), wire)
		if depth == 16 && err != nil {
			t.Fatal(err)
		}
		if depth == 17 && spi.Classify(err) != spi.ErrTooLarge {
			t.Fatalf("depth class=%v", err)
		}
	}
	for _, elements := range []int{maxProtocolElements, maxProtocolElements + 1} {
		wire := []byte("[" + strings.Repeat(`"x",`, elements-2) + `"x"]`)
		err := validateTokens(t.Context(), wire)
		if elements == maxProtocolElements && err != nil {
			t.Fatal(err)
		}
		if elements > maxProtocolElements && spi.Classify(err) != spi.ErrTooLarge {
			t.Fatalf("count class=%v", err)
		}
	}
	wire := []byte(`{"streams":[` + strings.Repeat(`{"stream":{},"values":[]},`, 20000) + `{"stream":{},"values":[]}]}`)
	r := receiver(t, success, options())
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(wire))
	if w.Code != 413 {
		t.Fatalf("empty containers evade count=%d", w.Code)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := decodePush(ctx, []byte(`{"streams":[]}`), false, 1024); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("cancel=%v", err)
	}
}
func TestPushGzipIntegrityAndSize(t *testing.T) {
	t.Parallel()
	plain := payload()
	valid := gzipPayload(t, plain)
	badCRC := bytes.Clone(valid)
	badCRC[len(badCRC)-8] ^= 1
	for _, wire := range [][]byte{[]byte("not gzip"), valid[:len(valid)-1], badCRC, append(bytes.Clone(valid), []byte("trailing invalid")...)} {
		r := receiver(t, success, options())
		req := request(wire)
		req.Header.Set("Content-Encoding", "gzip")
		w := httptest.NewRecorder()
		r.HTTPHandler().ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatalf("gzip corruption=%d", w.Code)
		}
	}
	for _, compressed := range []bool{false, true} {
		o := options()
		o.MaxRequestBytes = 512
		wire := []byte(`{"streams":[]}` + strings.Repeat(" ", 513))
		if compressed {
			wire = gzipPayload(t, wire)
		}
		r := receiver(t, success, o)
		req := request(wire)
		req.ContentLength = -1
		if compressed {
			req.Header.Set("Content-Encoding", "gzip")
		}
		w := httptest.NewRecorder()
		r.HTTPHandler().ServeHTTP(w, req)
		if w.Code != 413 {
			t.Fatalf("compressed=%v limit=%d", compressed, w.Code)
		}
	}
	o := options()
	o.MaxRequestBytes = 32
	r := receiver(t, success, o)
	req := request(gzipPayload(t, []byte(`{"streams":[]}`)))
	req.Header.Set("Content-Encoding", "gzip")
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, req)
	if w.Code != 413 {
		t.Fatalf("compressed bytes cap=%d", w.Code)
	}
	// Both exact-body-size boundaries and valid multi-member gzip preserve bytes.
	o = options()
	wire := []byte(`{"streams":[]}`)
	o.MaxRequestBytes = len(wire)
	r = receiver(t, success, o)
	w = httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(wire))
	if w.Code != 204 {
		t.Fatalf("exact bytes=%d", w.Code)
	}
	req = request(append(gzipPayload(t, wire[:5]), gzipPayload(t, wire[5:])...))
	req.Header.Set("Content-Encoding", "gzip")
	r = receiver(t, success, options())
	w = httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, req)
	if w.Code != 204 {
		t.Fatalf("gzip members=%d", w.Code)
	}
}
func TestPushPreflightExpansionAndMetadataCap(t *testing.T) {
	t.Parallel()
	var labels strings.Builder
	for i := range 128 {
		if i > 0 {
			labels.WriteByte(',')
		}
		fmt.Fprintf(&labels, `"attr_%d_uuid":"value"`, i)
	}
	entries := strings.TrimSuffix(strings.Repeat(`["1","x"],`, 1000), ",")
	workWire := []byte(`{"streams":[{"stream":{` + labels.String() + `},"values":[` + entries + `]}]}`)
	byteWire := []byte(`{"streams":[{"stream":{"request_id":"` + strings.Repeat("x", 1000) + `"},"values":[` + strings.TrimSuffix(strings.Repeat(`["1","x"],`, 10), ",") + `]}]}`)
	for _, wire := range [][]byte{workWire, byteWire} {
		called := false
		o := options()
		if bytes.Equal(wire, byteWire) {
			o.MaxRequestBytes = 4096
		}
		r := receiver(t, func(context.Context, []utm.LogRecord, int64) (ingest.Result, error) {
			called = true
			return ingest.Result{}, nil
		}, o)
		w := httptest.NewRecorder()
		r.HTTPHandler().ServeHTTP(w, request(wire))
		if w.Code != 413 || called {
			t.Fatalf("amplification=%d called=%v wirebytes=%d", w.Code, called, len(wire))
		}
	}
	var metadata strings.Builder
	for i := range 150 {
		if i > 0 {
			metadata.WriteByte(',')
		}
		fmt.Fprintf(&metadata, `"k%03d":"v"`, i)
	}
	wire := []byte(`{"streams":[{"values":[["1","x",{` + metadata.String() + `}]],"stream":{}}]}`)
	called := false
	r := receiver(t, func(ctx context.Context, records []utm.LogRecord, n int64) (ingest.Result, error) {
		called = true
		if len(records) != 1 || len(records[0].Attrs) != 128 {
			t.Fatalf("metadata cap=%v", records)
		}
		return success(ctx, records, n)
	}, options())
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(wire))
	if w.Code != 204 || !called {
		t.Fatalf("metadata=%d called=%v", w.Code, called)
	}
}

type cancelRead struct{ cancel context.CancelFunc }

func (r cancelRead) Read(p []byte) (int, error) { r.cancel(); return copy(p, `{"streams":[]}`), nil }
func TestPushBodyReadCancellationBetweenChunks(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	if _, err := readPushBody(ctx, cancelRead{cancel: cancel}, 1024); spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("body cancellation=%v", err)
	}
}
