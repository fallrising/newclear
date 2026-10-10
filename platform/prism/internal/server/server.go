// Package server owns Prism's HTTP server lifecycle and base routes.
package server

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
)

const (
	readHeaderTimeout = 5 * time.Second
	idleTimeout       = 2 * time.Minute
	readTimeout       = 30 * time.Second
)

// Options configures a Server.
type Options struct {
	Address         string
	GRPCAddress     string
	GRPCServer      *grpc.Server
	StopReceiving   func()
	Drain           func(context.Context) error
	Ready           func() error
	Stopping        func() error
	ShutdownTimeout time.Duration
	TLSCertFile     string
	TLSKeyFile      string
	Gatherer        prometheus.Gatherer
	Handler         http.Handler
	Logger          *slog.Logger
}

// Server serves Prism's base HTTP routes and owns graceful shutdown.
type Server struct {
	address         string
	shutdownTimeout time.Duration
	tlsCertFile     string
	tlsKeyFile      string
	httpServer      *http.Server
	grpcAddress     string
	grpcServer      *grpc.Server
	stopReceiving   func()
	drain           func(context.Context) error
	ready           *atomic.Bool
	onReady         func() error
	onStopping      func() error
}

// New constructs a server. It does not bind a listener or start goroutines.
func New(options Options) (*Server, error) {
	if options.Address == "" {
		return nil, fmt.Errorf("server address is required")
	}
	if options.ShutdownTimeout <= 0 {
		return nil, fmt.Errorf("server shutdown timeout must be positive")
	}
	if (options.TLSCertFile == "") != (options.TLSKeyFile == "") {
		return nil, fmt.Errorf("server TLS certificate and key must be configured together")
	}
	if (options.GRPCAddress == "") != (options.GRPCServer == nil) {
		return nil, fmt.Errorf("gRPC address and server must be configured together")
	}
	var tlsConfig *tls.Config
	if options.TLSCertFile != "" {
		certificate, err := tls.LoadX509KeyPair(options.TLSCertFile, options.TLSKeyFile)
		if err != nil {
			return nil, fmt.Errorf("load server TLS certificate: %w", err)
		}
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}}
	}
	if options.Gatherer == nil {
		options.Gatherer = prometheus.DefaultGatherer
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}

	ready := &atomic.Bool{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /-/healthy", healthy)
	mux.HandleFunc("/-/healthy", methodNotAllowed(http.MethodGet, http.MethodHead))
	mux.HandleFunc("GET /-/ready", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if !ready.Load() {
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = response.Write([]byte("not ready\n"))
			return
		}
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/-/ready", methodNotAllowed(http.MethodGet, http.MethodHead))
	mux.Handle("GET /metrics", promhttp.HandlerFor(options.Gatherer, promhttp.HandlerOpts{EnableOpenMetrics: true}))
	mux.HandleFunc("/metrics", methodNotAllowed(http.MethodGet, http.MethodHead))
	if options.Handler != nil {
		mux.Handle("/", options.Handler)
	}

	result := &Server{
		address:         options.Address,
		grpcAddress:     options.GRPCAddress,
		grpcServer:      options.GRPCServer,
		stopReceiving:   options.StopReceiving,
		drain:           options.Drain,
		onReady:         options.Ready,
		onStopping:      options.Stopping,
		ready:           ready,
		shutdownTimeout: options.ShutdownTimeout,
		tlsCertFile:     options.TLSCertFile,
		tlsKeyFile:      options.TLSKeyFile,
	}
	result.httpServer = &http.Server{
		Addr:              options.Address,
		Handler:           recoverPanics(options.Logger, mux),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		TLSConfig:         tlsConfig,
		IdleTimeout:       idleTimeout,
	}
	return result, nil
}

// Run acquires every configured listener before either transport serves.
func (s *Server) Run(ctx context.Context) error {
	var lc net.ListenConfig
	listener, err := lc.Listen(ctx, "tcp", s.address)
	if err != nil {
		return errors.Join(spi.Wrap(spi.ErrUnavailable, "", "server.listen.HTTP", err), s.drainAfterStartupFailure(ctx))
	}
	if s.grpcServer == nil {
		return s.Serve(ctx, listener)
	}
	grpcListener, err := lc.Listen(ctx, "tcp", s.grpcAddress)
	if err != nil {
		_ = listener.Close()
		return errors.Join(spi.Wrap(spi.ErrUnavailable, "", "server.listen.gRPC", err), s.drainAfterStartupFailure(ctx))
	}
	return s.ServeListeners(ctx, listener, grpcListener)
}

func (s *Server) drainAfterStartupFailure(ctx context.Context) error {
	if s.stopReceiving != nil {
		s.stopReceiving()
	}
	if s.grpcServer != nil {
		s.grpcServer.Stop()
	}
	shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.shutdownTimeout)
	defer cancel()
	if s.drain != nil {
		return s.drain(shutdown)
	}
	return nil
}

// Serve preserves the HTTP-only lifecycle for non-ingest roles.
func (s *Server) Serve(ctx context.Context, listener net.Listener) error {
	return s.ServeListeners(ctx, listener, nil)
}

// ServeListeners takes ownership of bound listeners. Receivers stop before the
// pipeline drains, all under one deadline independent of parent cancellation.
func (s *Server) ServeListeners(ctx context.Context, listener, grpcListener net.Listener) error {
	if listener == nil || (s.grpcServer != nil && grpcListener == nil) {
		if listener != nil {
			_ = listener.Close()
		}
		if grpcListener != nil {
			_ = grpcListener.Close()
		}
		return errors.Join(fmt.Errorf("configured server listeners are required"), s.drainAfterStartupFailure(ctx))
	}
	defer func() { _ = listener.Close() }()
	if grpcListener != nil {
		defer func() { _ = grpcListener.Close() }()
	}
	if err := ctx.Err(); err != nil {
		return errors.Join(err, s.drainAfterStartupFailure(ctx))
	}
	if s.onReady != nil {
		if err := s.onReady(); err != nil {
			return errors.Join(fmt.Errorf("notify ready: %w", err), s.drainAfterStartupFailure(ctx))
		}
	}
	s.ready.Store(true)
	requests, cancelRequests := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelRequests()
	s.httpServer.BaseContext = func(net.Listener) context.Context { return requests }
	count := 1
	if s.grpcServer != nil {
		count++
	}
	serveErrors := make(chan error, count)
	go s.serve(listener, serveErrors)
	if s.grpcServer != nil {
		go s.serveGRPC(grpcListener, serveErrors)
	}
	var serveErr error
	remaining := count
	select {
	case serveErr = <-serveErrors:
		remaining--
	case <-ctx.Done():
	}
	s.ready.Store(false)
	var notifyErr error
	if s.onStopping != nil {
		notifyErr = s.onStopping()
		if notifyErr != nil {
			notifyErr = fmt.Errorf("notify stopping: %w", notifyErr)
		}
	}
	if s.stopReceiving != nil {
		s.stopReceiving()
	}
	shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.shutdownTimeout)
	defer cancel()
	shutdownErr := s.shutdownReceivers(shutdown, cancelRequests)
	for range remaining {
		serveErr = errors.Join(serveErr, <-serveErrors)
	}
	var drainErr error
	if s.drain != nil {
		drainErr = s.drain(shutdown)
	}
	return errors.Join(serveErr, notifyErr, shutdownErr, drainErr)
}

func (s *Server) serveGRPC(listener net.Listener, result chan<- error) {
	err := s.grpcServer.Serve(listener)
	if errors.Is(err, grpc.ErrServerStopped) {
		err = nil
	}
	result <- spi.Wrap(spi.ErrUnavailable, "", "server.serve.gRPC", err)
}

func (s *Server) shutdownReceivers(ctx context.Context, cancelRequests context.CancelFunc) error {
	httpResult := make(chan error, 1)
	go s.shutdownHTTP(ctx, httpResult)
	grpcDone := make(chan struct{})
	if s.grpcServer != nil {
		go s.stopGRPC(grpcDone)
	} else {
		close(grpcDone)
	}
	// Both grace periods run concurrently under the same deadline. Stop waits
	// for gRPC handlers, and Close interrupts HTTP reads and request contexts.
	select {
	case <-grpcDone:
	case <-ctx.Done():
		if s.grpcServer != nil {
			s.grpcServer.Stop()
		}
		<-grpcDone
	}
	httpErr := <-httpResult
	if ctx.Err() != nil || httpErr != nil {
		cancelRequests()
		closeErr := s.httpServer.Close()
		return errors.Join(ctx.Err(), httpErr, closeErr)
	}
	return nil
}

func (s *Server) shutdownHTTP(ctx context.Context, result chan<- error) {
	result <- s.httpServer.Shutdown(ctx)
}
func (s *Server) stopGRPC(done chan<- struct{}) { defer close(done); s.grpcServer.GracefulStop() }

func (s *Server) serve(listener net.Listener, result chan<- error) {
	if s.tlsCertFile != "" {
		result <- normalizeServeError(s.httpServer.ServeTLS(listener, "", ""))
		return
	}
	result <- normalizeServeError(s.httpServer.Serve(listener))
}

func normalizeServeError(err error) error {
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return spi.Wrap(spi.ErrUnavailable, "", "server.serve.HTTP", err)
}

func healthy(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write([]byte("ok\n"))
}

func methodNotAllowed(methods ...string) http.HandlerFunc {
	return func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Allow", strings.Join(methods, ", "))
		http.Error(response, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
	}
}

func recoverPanics(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		defer recoverRequestPanic(request.Context(), logger, response, request.Method, request.URL.Path)
		next.ServeHTTP(response, request)
	})
}

func recoverRequestPanic(ctx context.Context, logger *slog.Logger, response http.ResponseWriter, method, path string) {
	if recovered := recover(); recovered != nil {
		logger.ErrorContext(
			ctx,
			"HTTP handler panic",
			"component", "server",
			"method", method,
			"path", path,
			"stack", string(debug.Stack()),
		)
		http.Error(response, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
	}
}
