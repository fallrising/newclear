GO ?= go
export CGO_ENABLED=0
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    ?= $(shell date -u +%Y-%m-%d)
LDFLAGS = -s -w -X github.com/fallrising/fleet-catalog/internal/version.Version=$(VERSION) -X github.com/fallrising/fleet-catalog/internal/version.Commit=$(COMMIT) -X github.com/fallrising/fleet-catalog/internal/version.Date=$(DATE)

.PHONY: build test vet image-fleetd image-agent validate-schema

build:
	mkdir -p bin
	$(GO) build -trimpath -ldflags="$(LDFLAGS)" -o bin/fleetd ./cmd/fleetd
	$(GO) build -trimpath -ldflags="$(LDFLAGS)" -o bin/fleet-agent ./cmd/fleet-agent

test:
	$(GO) test ./...
	$(GO) -C examples/hello-healthz test ./...

vet:
	$(GO) vet ./...

image-fleetd:
	docker build -f Dockerfile.fleetd -t ghcr.io/fallrising/fleetd:dev .

image-agent:
	docker build -f Dockerfile.agent -t ghcr.io/fallrising/fleet-agent:dev .

validate-schema:
	$(GO) test ./internal/fleetfile ./internal/compose
