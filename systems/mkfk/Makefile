GO ?= go
GOFMT ?= gofmt
GO_FILES := $(shell find . -name '*.go' -type f | sort)

.PHONY: fmt-check vet test test-race

fmt-check:
	@files="$$($(GOFMT) -l $(GO_FILES))"; test -z "$$files" || (echo "Go files need formatting:" >&2; echo "$$files" >&2; exit 1)

vet:
	$(GO) vet ./...

test:
	$(GO) test -count=1 ./...

test-race:
	$(GO) test -race -count=1 ./...
