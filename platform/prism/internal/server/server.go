// Package server owns Prism's HTTP server lifecycle and base routes.
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const (
	readHeaderTimeout = 5 * time.Second
	idleTimeout       = 2 * time.Minute
)

// Options configures a Server.
type Options struct {
	Address         string
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
	if options.Gatherer == nil {
		options.Gatherer = prometheus.DefaultGatherer
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /-/healthy", healthy)
	mux.HandleFunc("/-/healthy", methodNotAllowed(http.MethodGet, http.MethodHead))
	mux.Handle("GET /metrics", promhttp.HandlerFor(options.Gatherer, promhttp.HandlerOpts{EnableOpenMetrics: true}))
	mux.HandleFunc("/metrics", methodNotAllowed(http.MethodGet, http.MethodHead))
	if options.Handler != nil {
		mux.Handle("/", options.Handler)
	}

	result := &Server{
		address:         options.Address,
		shutdownTimeout: options.ShutdownTimeout,
		tlsCertFile:     options.TLSCertFile,
		tlsKeyFile:      options.TLSKeyFile,
	}
	result.httpServer = &http.Server{
		Addr:              options.Address,
		Handler:           recoverPanics(options.Logger, mux),
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
	}
	return result, nil
}

// Run binds the configured address and serves until ctx is canceled or serving fails.
func (s *Server) Run(ctx context.Context) error {
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(ctx, "tcp", s.address)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", s.address, err)
	}
	return s.Serve(ctx, listener)
}

// Serve serves an already-bound listener until ctx is canceled or serving fails.
// The listener is always closed before Serve returns.
func (s *Server) Serve(ctx context.Context, listener net.Listener) error {
	if listener == nil {
		return fmt.Errorf("server listener is required")
	}
	requestContext, cancelRequests := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelRequests()
	s.httpServer.BaseContext = func(net.Listener) context.Context { return requestContext }
	serveErrors := make(chan error, 1)
	go s.serve(listener, serveErrors)

	select {
	case err := <-serveErrors:
		return normalizeServeError(err)
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.shutdownTimeout)
		shutdownErr := s.httpServer.Shutdown(shutdownContext)
		cancel()
		var closeErr error
		if shutdownErr != nil {
			cancelRequests()
			closeErr = s.httpServer.Close()
		}
		serveErr := <-serveErrors
		return errors.Join(shutdownErr, closeErr, normalizeServeError(serveErr))
	}
}

func (s *Server) serve(listener net.Listener, result chan<- error) {
	if s.tlsCertFile != "" {
		result <- s.httpServer.ServeTLS(listener, s.tlsCertFile, s.tlsKeyFile)
		return
	}
	result <- s.httpServer.Serve(listener)
}

func normalizeServeError(err error) error {
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
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
