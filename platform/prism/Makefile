GO ?= go

export GOFLAGS ?= -mod=readonly

.PHONY: lint test

lint:
	@test -z "$$(find . -type f -name '*.go' -not -path './vendor/*' -exec gofmt -l {} +)" || \
		(echo "Go files need formatting; run gofmt"; exit 1)
	$(GO) vet ./...

test:
	$(GO) test -race -count=1 ./...
