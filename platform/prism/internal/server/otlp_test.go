package server

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func TestDualListenerFailureClosesHTTPAndDrains(t *testing.T) {
	var lc net.ListenConfig
	occupied, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = occupied.Close() }()
	probe, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := probe.Addr().String()
	_ = probe.Close()
	var drained atomic.Bool
	server, err := New(Options{Address: address, GRPCAddress: occupied.Addr().String(), GRPCServer: grpc.NewServer(), ShutdownTimeout: time.Second, Drain: func(context.Context) error { drained.Store(true); return nil }})
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Run(context.Background()); err == nil {
		t.Fatal("occupied gRPC listener accepted")
	}
	if !drained.Load() {
		t.Fatal("startup failure did not close pipeline")
	}
	listener, err := lc.Listen(context.Background(), "tcp", address)
	if err != nil {
		t.Fatalf("HTTP bind leaked: %v", err)
	}
	_ = listener.Close()
}

func TestDualShutdownUsesOneDeadlineThenDrains(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	handler := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done(); close(stopped) })
	var lc net.ListenConfig
	listener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcListener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	var refused atomic.Bool
	drain := make(chan error, 1)
	server, err := New(Options{Address: listener.Addr().String(), GRPCAddress: grpcListener.Addr().String(), GRPCServer: grpc.NewServer(), Handler: handler, ShutdownTimeout: 30 * time.Millisecond, StopReceiving: func() { refused.Store(true) }, Drain: func(ctx context.Context) error {
		if !refused.Load() {
			drain <- errors.New("drained before receiver stop")
		} else {
			drain <- ctx.Err()
		}
		return ctx.Err()
	}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- server.ServeListeners(ctx, listener, grpcListener) }()
	waitForHealthy(t, "http://"+listener.Addr().String()+"/-/healthy")
	requestResult := make(chan error, 1)
	go requestExpectingClose("http://"+listener.Addr().String()+"/blocking", requestResult)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("handler not started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("shutdown error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown hung")
	}
	if err := <-drain; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("pipeline received renewed deadline: %v", err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("HTTP handler was not cancelled")
	}
	<-requestResult
}

func TestDualShutdownCancelsGRPCStreamWithoutClientDeadline(t *testing.T) {
	var lc net.ListenConfig
	listener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcListener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	grpcServer := grpc.NewServer()
	healthpb.RegisterHealthServer(grpcServer, health.NewServer())
	server, err := New(Options{Address: listener.Addr().String(), GRPCAddress: grpcListener.Addr().String(), GRPCServer: grpcServer, ShutdownTimeout: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- server.ServeListeners(ctx, listener, grpcListener) }()
	connection, err := grpc.NewClient(grpcListener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = connection.Close() }()
	stream, err := healthpb.NewHealthClient(connection).Watch(context.Background(), &healthpb.HealthCheckRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = stream.Recv(); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("no-deadline gRPC stream hung shutdown")
	}
	if _, err = stream.Recv(); err == nil {
		t.Fatal("stream survived forced stop")
	}
}

func TestDualShutdownInterruptsIncompleteHTTPBody(t *testing.T) {
	var lc net.ListenConfig
	listener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcListener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	started := make(chan struct{})
	bodyStopped := make(chan struct{})
	server, err := New(Options{Address: listener.Addr().String(), GRPCAddress: grpcListener.Addr().String(), GRPCServer: grpc.NewServer(), ShutdownTimeout: 20 * time.Millisecond, Handler: http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		_, _ = io.Copy(io.Discard, r.Body)
		close(bodyStopped)
	})})
	if err != nil {
		t.Fatal(err)
	}
	if server.httpServer.ReadTimeout <= 0 {
		t.Fatal("HTTP body has no finite read deadline")
	}
	connectionClosed := make(chan struct{})
	server.httpServer.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateClosed {
			close(connectionClosed)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- server.ServeListeners(ctx, listener, grpcListener) }()
	connection, err := (&net.Dialer{Timeout: time.Second}).DialContext(context.Background(), "tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		_ = connection.Close()
		select {
		case <-connectionClosed:
		case <-time.After(time.Second):
			t.Error("HTTP connection did not finish closing")
		}
	})
	_, err = io.WriteString(connection, "POST /v1/logs HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("body reader not started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("body reader hung shutdown")
	}
	select {
	case <-bodyStopped:
	case <-time.After(time.Second):
		t.Fatal("incomplete body read was not interrupted")
	}
}

func TestMissingGRPCListenerClosesOwnedHTTPAndDrains(t *testing.T) {
	var lc net.ListenConfig
	listener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	var drained bool
	server, err := New(Options{Address: address, GRPCAddress: "127.0.0.1:4317", GRPCServer: grpc.NewServer(), ShutdownTimeout: time.Second, Drain: func(context.Context) error { drained = true; return nil }})
	if err != nil {
		t.Fatal(err)
	}
	if err := server.ServeListeners(context.Background(), listener, nil); err == nil {
		t.Fatal("missing gRPC listener accepted")
	}
	if !drained {
		t.Fatal("pipeline not cleaned after missing listener")
	}
	rebound, err := lc.Listen(context.Background(), "tcp", address)
	if err != nil {
		t.Fatalf("owned listener not closed: %v", err)
	}
	_ = rebound.Close()
}

func TestUnexpectedHTTPServeErrorSurvivesDualShutdown(t *testing.T) {
	var lc net.ListenConfig
	listener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcListener, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	sentinel := errors.New("injected listener failure")
	var drained bool
	server, err := New(Options{Address: listener.Addr().String(), GRPCAddress: grpcListener.Addr().String(), GRPCServer: grpc.NewServer(), ShutdownTimeout: time.Second, Drain: func(context.Context) error { drained = true; return nil }})
	if err != nil {
		t.Fatal(err)
	}
	err = server.ServeListeners(context.Background(), failingListener{Listener: listener, err: sentinel}, grpcListener)
	if !errors.Is(err, sentinel) || spi.Classify(err) != spi.ErrUnavailable || !drained {
		t.Fatalf("unexpected serve failure lost: %v drained=%v", err, drained)
	}
}

type failingListener struct {
	net.Listener
	err error
}

func (l failingListener) Accept() (net.Conn, error) { return nil, l.err }
