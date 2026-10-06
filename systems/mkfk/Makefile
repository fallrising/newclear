GO ?= go
GOFMT ?= gofmt
GO_FILES := $(shell find . -name '*.go' -type f | sort)

.PHONY: fmt-check vet test test-race test-model test-integration

TEST_LOG_DIR ?= $(CURDIR)/.test-output

MODEL_PACKAGES := ./internal/raft ./internal/replication ./internal/group
MODEL_TESTS := TestM3DeterministicModel100Seeds1000Events TestM4RandomizedISRAndGateInvariants \
	TestM6GroupModel100Seeds300Events

INTEGRATION_PACKAGES := ./internal/storage ./internal/raft ./internal/replication ./cmd/mkfkctl ./pkg/client
INTEGRATION_TESTS := TestM1ST03DurableAfterSIGKILL TestM3ThreeProcessFailoverAndRestartDriver \
	TestM4RF1PersistentHWRecoveryAndCommittedFetch TestM5PR07CLIResumesDurablePendingBatchBeforeNewInput \
	TestM6CG05CG06RealWALRestartKeepsOffsetsAndFencesOldSessions TestM6CG04SDKStopsStaleGenerationAndNeverCommitsItsWork \
	TestM6SDKRetriesUnknownCommitWithTheSameRequest TestM6CG03SDKRejoinsAfterItsSessionExpired TestM6SDKDropsUnknownCommitFromAFencedGeneration \
	TestM6DemoRebalanceCrashAndCoordinatorRestart

fmt-check:
	@files="$$($(GOFMT) -l $(GO_FILES))"; test -z "$$files" || (echo "Go files need formatting:" >&2; echo "$$files" >&2; exit 1)

vet:
	$(GO) vet ./...

test:
	$(GO) test -count=1 ./...

test-race:
	$(GO) test -race -count=1 ./...

test-model:
	MKFK_TEST_LOG=$(TEST_LOG_DIR)/model.log GO=$(GO) ./scripts/run-named-tests.sh "$(MODEL_PACKAGES)" $(MODEL_TESTS)

test-integration:
	MKFK_TEST_LOG=$(TEST_LOG_DIR)/integration.log GO=$(GO) ./scripts/run-named-tests.sh "$(INTEGRATION_PACKAGES)" $(INTEGRATION_TESTS)
