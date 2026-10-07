GO ?= go
GOFMT ?= gofmt
GO_FILES := $(shell find . -name '*.go' -type f | sort)

.PHONY: fmt-check vet test test-race test-model test-model-extended test-integration test-chaos image demo demo-down bench

TEST_LOG_DIR ?= $(CURDIR)/.test-output

MODEL_PACKAGES := ./internal/raft ./internal/replication ./internal/group
MODEL_TESTS := TestM3DeterministicModel100Seeds1000Events TestM4RandomizedISRAndGateInvariants \
	TestM6GroupModel100Seeds300Events

INTEGRATION_PACKAGES := ./internal/storage ./internal/raft ./internal/replication ./cmd/mkfkctl ./pkg/client ./cmd/mkfk
INTEGRATION_TESTS := TestM1ST03DurableAfterSIGKILL TestM3ThreeProcessFailoverAndRestartDriver \
	TestM4RF1PersistentHWRecoveryAndCommittedFetch TestM5PR07CLIResumesDurablePendingBatchBeforeNewInput \
	TestM6CG05CG06RealWALRestartKeepsOffsetsAndFencesOldSessions TestM6CG04SDKStopsStaleGenerationAndNeverCommitsItsWork \
	TestM6SDKRetriesUnknownCommitWithTheSameRequest TestM6CG03SDKRejoinsAfterItsSessionExpired TestM6SDKDropsUnknownCommitFromAFencedGeneration \
	TestM6DemoRebalanceCrashAndCoordinatorRestart \
	TestM7OP02MisconfiguredOrDuplicateBrokersFailWithoutTouchingData TestM7OP06GracefulShutdownKeepsDataAndLeaksNoPayload \
	TestM7ThreeBrokerProcessesFailOverCatchUpAndKeepGroupOffsets \
	TestM7OP03FloodSlowClientsAndFetchStormStayBounded TestM7OP04LostProduceReplyIsRetriedWithTheSameIdentity \
	TestM7OP04StaleRoutesAreBoundedAndLeakNoGoroutines

# The chaos profile (OP-05) is `full` (28 seeded faults) unless CHAOS_PROFILE=short;
# CHAOS_SEED replays a schedule. The scrubbed run summary lands in chaos-report.json.
CHAOS_PROFILE ?= full
CHAOS_SEED ?=

# The Compose experiment (make demo) uses its own project, network, and named
# volumes; demo-down keeps the volumes unless DELETE_DATA=1.
DOCKER ?= docker
COMPOSE_PROJECT ?= mkfk-demo
IMAGE_CONTEXT := $(CURDIR)/.build/image

# make bench runs the 04-validation §5 matrix on local loopback brokers. For
# brokers on three hosts, add BENCH_ARGS="--ssh-hosts a,b,c --ssh-ips x,y,z".
BENCH_ARGS ?=

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

test-model-extended:
	MKFK_MODEL_SEEDS=1000 MKFK_MODEL_EVENTS=10000 MKFK_TEST_LOG=$(TEST_LOG_DIR)/model-extended.log GO="$(GO)" GOFLAGS="-timeout=120m" \
		./scripts/run-named-tests.sh "$(MODEL_PACKAGES)" $(MODEL_TESTS)

test-chaos:
	MKFK_CHAOS_PROFILE=$(CHAOS_PROFILE) MKFK_CHAOS_SEED=$(CHAOS_SEED) MKFK_CHAOS_REPORT=$(TEST_LOG_DIR)/chaos-report.json \
		MKFK_TEST_LOG=$(TEST_LOG_DIR)/chaos.log GO="$(GO)" GOFLAGS="-timeout=30m" \
		./scripts/run-named-tests.sh "./cmd/mkfk" TestM7ChaosOP05RotatingCrashesPartitionsAndPauses

image:
	rm -rf $(IMAGE_CONTEXT) && mkdir -p $(IMAGE_CONTEXT)/data
	CGO_ENABLED=0 GOOS=linux $(GO) build -trimpath -o $(IMAGE_CONTEXT)/mkfk ./cmd/mkfk
	cp configs/compose-cluster.json $(IMAGE_CONTEXT)/cluster.json
	$(DOCKER) build -q -t mkfk:local -f deploy/Dockerfile $(IMAGE_CONTEXT)

demo: image
	GO="$(GO)" DOCKER="$(DOCKER)" COMPOSE_PROJECT=$(COMPOSE_PROJECT) ./scripts/demo.sh

demo-down:
	$(DOCKER) compose -p $(COMPOSE_PROJECT) -f deploy/compose.yaml down $(if $(DELETE_DATA),--volumes,)

bench:
	mkdir -p .build && $(GO) build -trimpath -o .build/mkfk ./cmd/mkfk
	$(GO) run ./cmd/mkfkbench --mkfk .build/mkfk --out $(TEST_LOG_DIR)/bench \
		--commit "$$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" $(BENCH_ARGS)
