package lokiapi

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// Close is observable but Read deliberately exits only after release, modeling
// a body cleanup callback that cannot reclaim the request's permit itself.
type heldBody struct {
	started, closed, release chan struct{}
	once                     sync.Once
	closeOnce                sync.Once
}

func (b *heldBody) Read(_ []byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	<-b.release
	return 0, io.EOF
}
func (b *heldBody) Close() error { b.closeOnce.Do(func() { close(b.closed) }); return nil }
func waitChannel(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}
}
func TestPushCancellationRetainsPermitAndStop(t *testing.T) {
	t.Parallel()
	r := receiver(t, success, options())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := request(nil).WithContext(ctx)
	body := &heldBody{started: make(chan struct{}), closed: make(chan struct{}), release: make(chan struct{})}
	req.Body = body
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { r.HTTPHandler().ServeHTTP(w, req); close(done) }()
	waitChannel(t, body.started)
	cancel()
	waitChannel(t, body.closed)
	refused := httptest.NewRecorder()
	next := request(nil)
	unread := new(countedBody)
	next.Body = unread
	r.HTTPHandler().ServeHTTP(refused, next)
	if refused.Code != 429 || unread.reads != 0 {
		t.Fatalf("permit released during canceled read: %d reads=%d", refused.Code, unread.reads)
	}
	r.Stop()
	stopped := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(stopped, request(nil))
	if stopped.Code != 503 {
		t.Fatalf("stopped=%d", stopped.Code)
	}
	close(body.release)
	waitChannel(t, done)
	if w.Code != 504 {
		t.Fatalf("cancellation=%d %s", w.Code, w.Body.String())
	}
	if len(r.gate) != 0 {
		t.Fatal("permit leaked")
	}
}
func TestPushStopPreservesAdmittedSubmission(t *testing.T) {
	t.Parallel()
	started, release := make(chan struct{}), make(chan struct{})
	r := receiver(t, func(_ context.Context, b []utm.LogRecord, _ int64) (ingest.Result, error) {
		close(started)
		<-release
		return ingest.Result{Accepted: len(b)}, nil
	}, options())
	w := httptest.NewRecorder()
	done := make(chan struct{})
	req := request(payload())
	go func() { r.HTTPHandler().ServeHTTP(w, req); close(done) }()
	waitChannel(t, started)
	w2 := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w2, request(nil))
	if w2.Code != 429 {
		t.Fatalf("gate=%d", w2.Code)
	}
	r.Stop()
	r.Stop()
	w3 := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w3, request(nil))
	if w3.Code != 503 {
		t.Fatalf("stop=%d", w3.Code)
	}
	close(release)
	waitChannel(t, done)
	if w.Code != 204 {
		t.Fatalf("admitted request=%d", w.Code)
	}
}
func TestPushCanceledRequestNoSubmission(t *testing.T) {
	t.Parallel()
	called := false
	r := receiver(t, func(context.Context, []utm.LogRecord, int64) (ingest.Result, error) {
		called = true
		return ingest.Result{}, nil
	}, options())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(w, request(nil).WithContext(ctx))
	if w.Code != 504 || called || len(r.gate) != 0 {
		t.Fatalf("status=%d called=%v", w.Code, called)
	}
}
func TestPushLogSamplingSanitized(t *testing.T) {
	t.Parallel()
	var logs bytes.Buffer
	o := options()
	o.Logger = slog.New(slog.NewTextHandler(&logs, nil))
	r := receiver(t, success, o)
	for range 30 {
		req := request(nil)
		req.Header.Set("Authorization", "Bearer sensitive-user-credential")
		w := httptest.NewRecorder()
		r.HTTPHandler().ServeHTTP(w, req)
	}
	if strings.Count(logs.String(), "\n") != 10 || strings.Contains(logs.String(), "sensitive-user") {
		t.Fatalf("sampled logs=%q", logs.String())
	}
	// The ring expires the oldest entry only; one new entry cannot reset a full
	// window and allow another burst of ten in the current rolling minute.
	r.logTimes[0] = time.Now().Add(-time.Minute - time.Second)
	r.log(context.Background(), "loki push bad_request", "bad_request")
	r.log(context.Background(), "loki push bad_request", "bad_request")
	if strings.Count(logs.String(), "\n") != 11 {
		t.Fatal("rolling sampler reset the whole window")
	}
}
func TestPushOptionsValidationAndFreeze(t *testing.T) {
	t.Parallel()
	for _, change := range []func(*PushOptions){func(o *PushOptions) { o.Tenant = "" }, func(o *PushOptions) { o.Tenant = " space" }, func(o *PushOptions) { o.APIKey = "short" }, func(o *PushOptions) { o.APIKey = "" }, func(o *PushOptions) { o.MaxRequestBytes = 0 }, func(o *PushOptions) { o.MaxRequestBytes = 1<<30 + 1 }} {
		o := options()
		change(&o)
		if _, err := NewPushReceiver(submitFunc(success), o); err == nil {
			t.Fatal("accepted invalid options")
		}
	}
	if _, err := NewPushReceiver(nil, options()); err == nil {
		t.Fatal("accepted missing submitter")
	}
	o := options()
	o.Normalize.Tenant = "untrusted"
	o.Normalize.LogLabelAllowlist = []string{"x"}
	r := receiver(t, success, o)
	o.Normalize.LogLabelAllowlist[0] = "changed"
	if r.normalize.Tenant != "trusted" || r.normalize.LogLabelAllowlist[0] != "x" {
		t.Fatal("options not frozen")
	}
}

// A repeated Close may return while the first Close is still working. The
// cancellation callback remains receiver-owned even after Read unblocks.
type slowCloseBody struct {
	*heldBody
	closing, finishClose chan struct{}
	closes               atomic.Int32
}

func (b *slowCloseBody) Close() error {
	if b.closes.Add(1) == 1 {
		close(b.closing)
		<-b.finishClose
	}
	return nil
}

type notifiedRecorder struct {
	*httptest.ResponseRecorder
	responded chan struct{}
}

func (w *notifiedRecorder) WriteHeader(code int) {
	w.ResponseRecorder.WriteHeader(code)
	close(w.responded)
}
func TestPushCancellationWaitsForBodyCleanup(t *testing.T) {
	t.Parallel()
	r := receiver(t, success, options())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	body := &slowCloseBody{heldBody: &heldBody{started: make(chan struct{}), release: make(chan struct{})}, closing: make(chan struct{}), finishClose: make(chan struct{})}
	req := request(nil).WithContext(ctx)
	req.Body = body
	w := &notifiedRecorder{ResponseRecorder: httptest.NewRecorder(), responded: make(chan struct{})}
	done := make(chan struct{})
	go func() { r.HTTPHandler().ServeHTTP(w, req); close(done) }()
	waitChannel(t, body.started)
	cancel()
	waitChannel(t, body.closing)
	close(body.release)
	waitChannel(t, w.responded)
	select {
	case <-done:
		t.Error("request released its permit while cancellation Close was running")
	case <-time.After(25 * time.Millisecond):
	}
	refused := httptest.NewRecorder()
	r.HTTPHandler().ServeHTTP(refused, request(nil))
	if refused.Code != 429 {
		t.Errorf("cleanup gate=%d", refused.Code)
	}
	close(body.finishClose)
	waitChannel(t, done)
	if w.Code != 504 || len(r.gate) != 0 {
		t.Fatalf("status=%d permits=%d", w.Code, len(r.gate))
	}
}
