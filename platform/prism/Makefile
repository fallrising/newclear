GO ?= go
PYTHON ?= python3
E2E_ARGS ?=
VERSION ?= dev
REVISION ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)

export GOFLAGS ?= -mod=readonly

.PHONY: build lint test deps-check conformance promql e2e ci

build:
	@mkdir -p bin
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags '-X main.version=$(VERSION) -X main.revision=$(REVISION)' -o bin/prismd ./cmd/prismd

lint:
	@test -z "$$(find . -type f -name '*.go' -not -path './vendor/*' -exec gofmt -l {} +)" || \
		(echo "Go files need formatting; run gofmt"; exit 1)
	$(GO) vet ./...

test:
	$(GO) test -race -count=1 ./...

deps-check:
	GO=$(GO) bash scripts/check-dependencies.sh
	GO=$(GO) bash scripts/test-dependency-guard.sh

conformance:
	$(GO) test -race -count=1 ./pkg/spi/conformance ./drivers/memory
	$(PYTHON) drivers/clickhouse/run-integration.py

promql:
	$(GO) test -race -count=1 ./test/promqltest
	$(PYTHON) drivers/clickhouse/run-integration.py

e2e:
ifeq ($(strip $(E2E_ARGS)),)
	@echo "Usage: make e2e E2E_ARGS='--docker-host unix:///path/to/docker.sock --image prism/prismd:<unique-local-tag> --no-build [--compose-binary /path/to/docker-compose]'" >&2
	@exit 2
else
	$(PYTHON) scripts/compose-e2e.py $(E2E_ARGS)
endif

ci: deps-check lint test conformance promql
