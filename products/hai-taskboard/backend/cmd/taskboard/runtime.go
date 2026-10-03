package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

const (
	healthPayload = "{\"status\":\"ready\",\"commands\":\"ready\",\"persistence\":\"ready\",\"automatic_execution\":\"unavailable\",\"projections\":\"unavailable\"}"
	methodPayload = "{\"status\":\"method_not_allowed\"}"
)

type runningRuntime struct {
	server         *http.Server
	store          *sqlite.Store
	artifacts      *localArtifactStore
	listener       net.Listener
	serveResult    chan error
	shutdownResult chan error
	stopAfter      func() bool

	waitOnce sync.Once
	waitDone chan struct{}
	waitErr  error
}

func startRuntime(ctx context.Context, config runtimeConfig, supplied net.Listener) (*runningRuntime, error) {
	if ctx == nil {
		return nil, errors.New("runtime context is required")
	}
	if err := config.validate(); err != nil {
		return nil, err
	}
	if err := ensurePrivateDirectory(config.DataRoot); err != nil {
		return nil, err
	}
	stateRoot := filepath.Join(config.DataRoot, "state")
	artifactRoot := filepath.Join(config.DataRoot, "artifacts", "sha256")
	if err := ensurePrivateDirectory(stateRoot); err != nil {
		return nil, err
	}
	artifacts, err := newLocalArtifactStore(artifactRoot)
	if err != nil {
		return nil, err
	}
	closeArtifacts := true
	defer func() {
		if closeArtifacts {
			_ = artifacts.Close()
		}
	}()

	clock := systemClock{}
	databasePath := filepath.Join(stateRoot, "taskboard.sqlite")
	store, err := sqlite.OpenAtRootWithClock(ctx, config.DataRoot, databasePath, clock.Now)
	if err != nil {
		return nil, errors.New("open local persistence")
	}
	closeStore := true
	defer func() {
		if closeStore {
			_ = store.Close()
		}
	}()

	authority, err := newLocalSessionAuthority(config.SessionToken, config.SessionActor)
	config.SessionToken = ""
	if err != nil {
		return nil, err
	}
	executor, err := newLocalFakeAdapter()
	if err != nil {
		return nil, errors.New("construct local Fake adapter")
	}
	policyRevision := domain.HashString("local-policy-v1")
	recipeRevision := domain.HashString("local-recipe-v1")
	composed, err := Compose(Dependencies{
		Store:       store,
		Executor:    executor,
		Clock:       clock,
		IDs:         cryptoIDSource{},
		Artifacts:   artifacts,
		Projections: unavailableProjectionSource{},
		Authority:   authority,
		Application: service.Config{
			Operator:       config.SessionActor,
			IdempotencyTTL: 24 * time.Hour,
			Specification:  unavailableSpecification{},
			Completion: service.CompletionPolicy{
				RevisionDigest: policyRevision,
				RecipeDigest:   recipeRevision,
				Checks: map[domain.ACID]service.VerificationRule{
					"local": {VerifierClass: "local"},
				},
			},
		},
		HTTP: httpapi.Config{Origin: config.Origin},
	})
	if err != nil {
		return nil, errors.New("compose local runtime")
	}

	listener := supplied
	if listener == nil {
		listener, err = net.Listen("tcp", config.ListenAddress)
		if err != nil {
			return nil, errors.New("listen on local endpoint")
		}
	} else if !listenerMatches(listener, config.ListenAddress) {
		return nil, errors.New("supplied listener does not match runtime configuration")
	}
	closeListener := true
	defer func() {
		if closeListener {
			_ = listener.Close()
		}
	}()

	server := &http.Server{
		Handler:           runtimeHTTPHandler{api: composed.Handler},
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	runtime := &runningRuntime{
		server:         server,
		store:          store,
		artifacts:      artifacts,
		listener:       listener,
		serveResult:    make(chan error, 1),
		shutdownResult: make(chan error, 1),
		waitDone:       make(chan struct{}),
	}
	runtime.stopAfter = context.AfterFunc(ctx, func() {
		shutdownContext, cancel := context.WithTimeout(context.Background(), config.ShutdownWindow)
		defer cancel()
		shutdownErr := server.Shutdown(shutdownContext)
		if shutdownErr != nil {
			shutdownErr = errors.Join(shutdownErr, server.Close())
		}
		runtime.shutdownResult <- shutdownErr
	})
	go func() {
		serveErr := server.Serve(listener)
		if errors.Is(serveErr, http.ErrServerClosed) {
			serveErr = nil
		}
		runtime.serveResult <- serveErr
	}()

	closeStore = false
	closeArtifacts = false
	closeListener = false
	return runtime, nil
}

func listenerMatches(listener net.Listener, address string) bool {
	if listener == nil {
		return false
	}
	expectedIP, expectedPort, err := loopbackEndpoint(address)
	if err != nil {
		return false
	}
	actualHost, actualPort, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		return false
	}
	actualIP := net.ParseIP(actualHost)
	return actualIP != nil && actualIP.Equal(expectedIP) && actualPort == strconv.Itoa(int(expectedPort))
}

func (runtime *runningRuntime) Address() string {
	if runtime == nil || runtime.listener == nil {
		return ""
	}
	return runtime.listener.Addr().String()
}

func (runtime *runningRuntime) Wait(ctx context.Context) error {
	if runtime == nil || ctx == nil {
		return errors.New("runtime wait is invalid")
	}
	runtime.waitOnce.Do(func() {
		go func() {
			serveErr := <-runtime.serveResult
			var shutdownErr error
			if runtime.stopAfter != nil && !runtime.stopAfter() {
				shutdownErr = <-runtime.shutdownResult
			}
			runtime.waitErr = errors.Join(serveErr, shutdownErr, runtime.store.Close(), runtime.artifacts.Close())
			close(runtime.waitDone)
		}()
	})
	select {
	case <-ctx.Done():
		return context.Cause(ctx)
	case <-runtime.waitDone:
		return runtime.waitErr
	}
}

type runtimeHTTPHandler struct {
	api http.Handler
}

func (handler runtimeHTTPHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request != nil && request.URL != nil && request.URL.Path == "/healthz" {
		if request.Method != http.MethodGet || request.URL.RawPath != "" ||
			request.URL.EscapedPath() != "/healthz" || request.URL.RawQuery != "" {
			writeRuntimeJSON(response, http.StatusMethodNotAllowed, methodPayload)
			return
		}
		writeRuntimeJSON(response, http.StatusOK, healthPayload)
		return
	}
	handler.api.ServeHTTP(response, request)
}

func writeRuntimeJSON(response http.ResponseWriter, status int, payload string) {
	response.Header().Set("Content-Type", "application/json")
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.WriteHeader(status)
	_, _ = response.Write([]byte(payload))
}
