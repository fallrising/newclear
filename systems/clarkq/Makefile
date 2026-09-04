.PHONY: build test run clean docker docker-run fmt vet version release \
	demo demo-cluster stress stress-long stress-docker

BINARY ?= bin/clarkq
ADDR ?= :8080

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo 1.0.0)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w \
	-X github.com/fallrising/newclear/systems/clarkq/internal/version.Version=$(VERSION) \
	-X github.com/fallrising/newclear/systems/clarkq/internal/version.Commit=$(COMMIT) \
	-X github.com/fallrising/newclear/systems/clarkq/internal/version.Date=$(DATE)

build:
	go build -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/clarkq

test:
	go test ./...

vet:
	go vet ./...

fmt:
	go fmt ./...

run: build
	CLARKQ_ADDR=$(ADDR) ./$(BINARY)

version: build
	@./$(BINARY) 2>&1 | head -1 || true
	@curl -s http://127.0.0.1:9/ 2>/dev/null || true
	@echo "VERSION=$(VERSION) COMMIT=$(COMMIT) DATE=$(DATE)"

clean:
	rm -rf bin/

docker:
	docker build \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		--build-arg DATE=$(DATE) \
		-t clarkq:$(VERSION) -t clarkq:latest .

docker-run:
	docker run --rm -p 8080:8080 \
		-e CLARKQ_ADDR=:8080 \
		-e CLARKQ_API_KEY \
		-e CLARKQ_ENCRYPTION_MODE \
		-e CLARKQ_ENCRYPTION_QUEUES \
		-e CLARKQ_SNAPSHOT_PATH \
		-e CLARKQ_SNAPSHOT_INTERVAL \
		-e CLARKQ_CONFIG \
		clarkq:latest

# Smoke: unit tests + build release binary
release: test build
	@echo "built $(BINARY) version=$(VERSION) commit=$(COMMIT)"

# Capability demos (require Docker for demo/ and stress-docker)
demo:
	cd demo && ./run-demo.sh

demo-cluster: build
	cd demo/cluster && ./run-cluster-demo.sh

stress: build
	cd demo/cluster && ./run-stress.sh

# ~5 min linearizable+lease soak + partition + latency (Docker)
stress-long:
	cd demo/cluster && ./run-stress.sh --docker --long

stress-docker:
	cd demo/cluster && ./run-stress.sh --docker
