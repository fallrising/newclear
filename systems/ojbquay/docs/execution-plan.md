# Execution Plan

## Rules

Each milestone produces one observable vertical result. Behavior work follows
Red-Green-Refactor. A milestone is committed and pushed only after its focused
checks, affected-module checks, documentation, and acceptance evidence pass.

## M0: Specification and Scaffold

- Status: Complete (2026-07-29)
- Output: accepted spec, ADR, Gradle modules, Protobuf contracts, CI, Kafka and
  PostgreSQL Compose services.
- Gate:
  - `./gradlew build`
  - `docker compose -f deploy/compose/docker-compose.yml config --quiet`
  - Kafka and PostgreSQL containers report healthy.
- Evidence:
  - Gradle 9.6.1/JDK 25 container ran `./gradlew build --no-daemon`:
    17 actionable tasks, contract descriptor test passed.
  - `docker compose -f deploy/compose/docker-compose.yml config --quiet`
    passed.
  - `docker compose ... up -d --wait kafka postgres` reported both services
    healthy.
  - Kafka CLI connected and listed topics successfully.
  - PostgreSQL returned `ojbquay|ojbquay` for database and current user.
  - Known warning: Protobuf 4.35.1 calls a terminally deprecated
    `sun.misc.Unsafe` method on JDK 25. It does not fail the build and will be
    tracked through dependency upgrades.

## M1: Shared Runtime and Control Plane

- Status: Complete (2026-07-29)
- Output: domain validation, config bus/store, Flyway schema, auth/RBAC,
  topic/group/subscription CRUD, audit, outbox, snapshots.
- Gate:
  - `./gradlew :modules:common:test :modules:console-api:test`
  - Testcontainers create-topic flow emits a config event and audit row.
- Evidence:
  - Red-Green coverage was recorded for config monotonicity and Last Known Good,
    CEL and transit validation, topic provisioning rollback, subscription
    validation, lifecycle versioning, owner isolation, auth, audit, snapshots,
    and OpenAPI generation.
  - `./gradlew :modules:common:test :modules:console-api:test --rerun-tasks
    --no-daemon` passed against Kafka 4.2.0 and PostgreSQL 17 Testcontainers.
  - The control-plane integration test created `orders` through REST, observed
    its PostgreSQL row and audit/outbox transaction, confirmed the Kafka topic,
    published the outbox row, and bootstrapped the same revision through
    `__ojbk.config` into `ConfigStore`.
  - `./gradlew build --rerun-tasks --no-daemon` passed all 23 actionable tasks
    and 27 tests on JDK 25.
  - Lifecycle deletion is reference-gated, soft-deleted in PostgreSQL for
    auditability, and emitted as a Kafka compaction tombstone; a runtime
    integration test proves the active snapshot removes the entity.
  - OpenAPI contains the topic and subscription lifecycle contracts.
  - Known warnings: Protobuf 4.35.1 uses a terminally deprecated
    `sun.misc.Unsafe` method on JDK 25; Mockito self-attachment and native-access
    notices are emitted by the test toolchain. No warning was hidden.

## M2: Producer Vertical Slice

- Status: Complete (2026-07-29)
- Output: Kafka producer adapter, gRPC gateway, quota/auth/size validation,
  metrics/tracing, Java producer SDK.
- Gate:
  - `./gradlew :modules:gateway-produce:test :sdk:java:test`
  - create topic → publish config → send → Kafka record E2E.
- Evidence:
  - Red-Green unit tests prove unknown/disabled topic, bad token, exhausted
    quota, oversized value, invalid partition, and broker failure codes; every
    local rejection asserts that no broker send starts.
  - In-process gRPC tests prove `x-ojbk-token` metadata precedence and ordered
    request/response behavior for bidi production.
  - Java SDK tests prove synchronous and asynchronous acknowledgement mapping,
    deadlines, metadata auth, and typed business failures.
  - Kafka 4.2 Testcontainers E2E publishes a topic revision, bootstraps
    `ConfigStore`, sends through Java SDK → Netty gRPC → gateway → idempotent
    Kafka producer, and observes matching key, value, tags, trace header,
    partition, and offset.
  - A packaged runtime bootstrapped the local Compose config topic, reported
    `UP` from `/readyz`, and exposed Prometheus counters from `/metrics`.
  - `./gradlew :modules:gateway-produce:test :sdk:java:test --rerun-tasks
    --no-daemon` passed 13 M2 tests.
  - `./gradlew build --rerun-tasks --no-daemon` passed 32 actionable tasks and
    all 40 repository tests on JDK 25.
  - The 50k messages/s NFR remains a release load-test gate; functional M2
    tests do not claim that capacity.

## M3: Delay

- Status: Complete (2026-07-29)
- Output: inbox ingestor, PostgreSQL dispatcher, direct threshold, cancel,
  finite recurrence, cleanup.
- Gate: delay accuracy, cancellation race, recurrence, and two-worker
  concurrency tests pass.
- Evidence:
  - Red-Green tests cover UUIDv7 ordering, versioned command validation,
    payload-safe decode failures, authenticated scheduling and cancellation,
    direct-threshold identity, and Java SDK mapping.
  - PostgreSQL 17 integration scenarios prove duplicate `ADD` idempotence,
    no-early and sub-second firing with 100 ms ticks, cancel-before-lock,
    cancel-after-lock for a recurring series, three occurrences, expiry,
    bounded cleanup, rollback on send failure, and two-worker
    `FOR UPDATE SKIP LOCKED` exclusion.
  - A forced database failure proves the Kafka ingestor rewinds its fetched
    positions before retry instead of allowing a later offset commit to skip
    the command.
  - Kafka 4.2/PostgreSQL 17 E2E schedules an exactly 4 MiB value through Java
    SDK → Netty gRPC → gateway → `__ojbk.delay.inbox`, retries ingestion,
    persists it, dispatches it to the requested partition, and observes the
    value, key, tags, trace context, and `x-ojbk-delay-id`.
  - The immediate producer E2E also stores an exactly 4 MiB value, proving
    transport and broker envelope limits preserve the public value limit.
  - `./gradlew :modules:common:test :modules:gateway-produce:test
    :modules:scheduler:test :sdk:java:test --rerun-tasks --no-daemon` passed;
    the final reports contain 49 focused tests with zero failures.
  - `./gradlew build --rerun-tasks --no-daemon` passed all 38 actionable tasks
    and 62 repository tests on JDK 25.
  - The packaged scheduler booted against the Compose Kafka/PostgreSQL
    services, joined all 12 inbox partitions, returned `UP` from `/readyz`,
    and exposed pending, ingest, fire-result, fire-lag, and worker-failure
    metrics.
  - Functional tests do not establish the 3,000 schedules/s or 50 million
    pending-row capacity targets. Protobuf 4.35.1 still emits its known JDK 25
    terminal `Unsafe` deprecation warning.

## M4: Push Consumer

- Status: Complete (functional, 2026-07-29); 150 ms timing NFR open
- Output: filter/transform pipeline, HTTP push, bounded backpressure, retry,
  DLQ/replay, ordered key lanes.
- Gate: filter/transform, retry timeline, DLQ, replay, and ordering E2E pass.
- Evidence:
  - Typed push policy validation bounds concurrency, TPS, URL/header safety,
    CEL/transit, order-key sources, retry arrays, and the trailing `-1`
    infinite-repeat convention.
  - Pipeline and HTTP tests prove shadow/tag/CEL filtering, transformed JSON,
    trace/source headers, HTTP 2xx handling, transport-only 200/400 ms fast
    retries, durable handoff before source acknowledgement, and release on
    handoff failure.
  - Kafka 4.2 Share Group integration proves explicit acknowledgement with
    `record_limit`, earliest group initialization, accepted-record
    non-reacquisition after worker restart, and the single-node Share
    coordinator broker settings required by local Compose.
  - Ordered Kafka integration proves same-key serialization and cross-stripe
    progress using bounded virtual-thread lanes. Finite retries run inline and
    exhaustion writes DLQ before the conservative batch-barrier commit.
  - Kafka 4.2/PostgreSQL 17/real HTTP E2E transforms the request body, preserves
    trace context, performs no-early `[150,300,600]` retries through the shared
    delay inbox/repository/dispatcher path within the scheduler's ±1 second
    contract, and writes the fourth business failure to DLQ with original
    identity.
  - Owner-authorized REST tests prove bounded DLQ browse, exact
    partition/offset single or batch replay, retry/DLQ header removal, source
    partition preservation, non-owner denial, and replay audit.
  - Configuration orchestration tests prove start, drain-before-replace,
    disable, mode change, and tombstone stop behavior; the runtime exposes
    worker, delivery, retry, DLQ, latency, and config-version metrics.
  - `./gradlew :modules:gateway-consume:test` passed all 25 consumer-gateway
    tests. `./gradlew :modules:console-api:test` passed all 16 control-plane
    tests, including the Kafka DLQ adapter and REST contract.
  - `./gradlew build --rerun-tasks --no-daemon` passed all 44 actionable tasks
    and 93 repository tests on JDK 25.
  - The packaged consumer runtime replayed the local Compose config topic,
    returned `UP` from `/readyz`, and exposed the expected Prometheus metric
    families on port 19202.
  - Functional tests do not establish the push throughput NFR. The SDD's
    `<20%` end-to-end target for the 150 ms retry conflicts with its 100 ms
    scheduler tick and ±1 second delay contract: observed first-retry intervals
    were roughly 206–253 ms, while 300/600 ms steady retries fit 20%. The
    durable/no-early behavior is complete; the 150 ms percentage remains a
    scheduler optimization follow-up.
  - Protobuf 4.35.1 continues to emit its known JDK 25 terminal `Unsafe`
    deprecation warning.

## M5: Pull Consumer and SDKs

- Status: Complete (2026-07-29)
- Output: Share Group pull, ack/nack/delivery count, bounded inflight buffers,
  Java and Go consumer SDKs.
- Gate: ack, nack redelivery, reconnect, delivery count, and restart-without-
  skip E2E pass.
- Evidence:
  - Typed pull policy validation bounds batch, concurrency, acknowledgement
    timeout, retry count, filters, tags, transit, and DLQ behavior. The
    consumer contract adds backward-compatible business-code fields to streamed
    deliveries and generated Java/Go contracts remain in sync.
  - Unit tests prove bounded in-flight memory, opaque single-use token routing,
    stale/duplicate token rejection, group isolation, metadata authentication,
    filtered-record acceptance, transformed values, and gRPC business-error
    envelopes.
  - Kafka 4.2 Share Group integration proves explicit `ACCEPT`, `RELEASE`
    redelivery with a new token and incremented delivery count, lease expiry,
    synchronous acknowledgement failure handling, and accepted-record
    non-reacquisition after worker restart.
  - PostgreSQL 17/Kafka control-plane integration proves pull creation
    configures the group lock, creates DLQ only when requested, creates no push
    retry topic, and rejects conflicting lock durations within one group.
  - Java and Go SDK tests prove TLS-by-default/plaintext opt-in, metadata auth,
    bounded batches, ACK/NACK batching, delivery-count propagation, typed
    business errors, and bounded transport reconnect backoff.
  - `./e2e/pull_share.sh` passed against the Compose Kafka 4.2 broker. Java
    production → Go consumption verified key/value/tags/headers, NACK
    redelivery count and token rotation, then ACK. Go production → Java
    consumption verified the same fields, disconnect/lease redelivery, token
    rotation, then ACK.
  - `go test ./...` and `go vet ./...` passed in `golang:1.25.1`.
  - `./gradlew :modules:common:test :modules:console-api:test
    :modules:gateway-consume:test :sdk:java:test --rerun-tasks --no-daemon`
    passed all 81 affected-module tests.
  - `./gradlew build --rerun-tasks --no-daemon` passed all 44 actionable tasks
    and 108 repository tests on JDK 25.
  - The installed consumer distribution replayed an empty local compacted
    config topic, returned `UP` from `/readyz`, exposed Prometheus metrics, and
    accepted a TCP connection on its configured pull gRPC port.
  - V1 acknowledgement routing requires gateway instance affinity and supports
    Share Groups only. Production rebalance/broker-failure chaos and throughput
    tests remain release-readiness work. Protobuf 4.35.1 continues to emit its
    known JDK 25 terminal `Unsafe` deprecation warning.

## M6: Console and Operations

- Status: Complete (2026-07-29)
- Output: React console, sampling/reset/delay/DLQ workflows, dashboards,
  alerts, production Compose and Kubernetes assets.
- Gate: web unit tests, Playwright golden path, full Compose E2E, and
  observability smoke tests pass.
- Evidence:
  - The React 19/TypeScript/Vite console provides session login, role-aware
    navigation, resource onboarding, side-effect-free subscription preview,
    Kafka topic sample/test-message, classic progress/reset, delay
    query/cancel, DLQ replay, cluster/user administration, audit, and a
    responsive operational dashboard.
  - `./gradlew :modules:console-api:test --no-daemon` passed all 28 tests
    against Kafka 4.2 and PostgreSQL 17 Testcontainers, including sampling,
    preview, delay cancellation, hard-gated offset reset, cluster health,
    administrative RBAC/audit, CSRF bootstrap, and OpenAPI coverage.
  - `pnpm test` passed 5 MSW/Vitest tests across 4 files; `pnpm build` passed
    strict TypeScript and the production Vite build.
  - Playwright Chromium passed the owner golden path through topic, group, and
    PUSH subscription creation with an observable active-resource result.
  - `make validate-deploy` passed Compose rendering, Prometheus configuration
    and all 5 alert rules, 3 Grafana dashboard JSON models, and the Kubernetes
    Kustomize render.
  - `make e2e` booted the isolated 11-service stack, verified health and
    session/CSRF login, provisioned a real topic/group/PUSH subscription,
    produced through gRPC, observed the Share Group HTTP delivery and
    `ojbk_push_total{code="success"}` metric, verified all Prometheus targets,
    and removed its volumes.
  - The Compose E2E exposed and corrected a stale observability label in both
    the success-rate alert and Grafana panel: the runtime's stable result code
    is `success`, not `OK`.
  - Known warnings: Vite recommends route-level splitting for the 2.4 MiB
    minified bundle, and Protobuf 4.35.1 emits its existing JDK 25 terminal
    `Unsafe` deprecation notice.

## Final Gate

- Status: Complete (2026-07-29)
- Output: CI-equivalent build, static/security/license checks, runbooks,
  compatibility review, release-readiness evidence.
- Evidence:
  - `./gradlew build --rerun-tasks --no-daemon` passed all 44 actionable tasks
    and 119 repository tests on JDK 25 after the final dependency updates.
  - `go test ./...` and `go vet ./...` passed with Go 1.25.1. The
    `./e2e/pull_share.sh` cross-language test then passed Java-to-Go and
    Go-to-Java production, NACK/lease redelivery, token rotation, and ACK.
  - `pnpm test` passed 5 tests across 4 files, `pnpm build` passed strict
    TypeScript and the production build, and Playwright Chromium passed the
    owner golden path.
  - `make validate-deploy` passed the Compose, Prometheus, five alert-rule,
    three Grafana-dashboard, and Kubernetes Kustomize validations.
  - `make e2e` passed against a fresh 11-service stack and verified gRPC
    production, Kafka Share Group HTTP push, console session/CSRF behavior,
    the success metric, and all Prometheus targets before removing the stack.
  - `pnpm audit --audit-level high` reported no known vulnerabilities. Trivy
    0.69.3 found no HIGH/CRITICAL vulnerabilities (fixed or unfixed) in the
    pnpm and Go dependency locks or any of the five runtime images, and its
    repository secret scan found no secrets.
  - The security gate upgraded React Router from 7.18.2 to 8.3.0, gRPC-Go from
    1.76.0 to 1.82.1, PostgreSQL JDBC from 42.7.11 to 42.7.12, and the web
    runtime's Alpine packages. Regression, interoperability, image, and live
    deployment gates were rerun after those upgrades.
  - `pnpm licenses list --json` reported only MIT-family, Apache-2.0, BSD,
    ISC, BlueOak-1.0.0, CC0-1.0, and MPL-2.0 package license categories.
  - The product contract, semantics guide, OpenAPI output, SDK examples,
    deployment guide, backup/recovery procedures, offset-reset guardrails,
    monitoring guidance, and upgrade/runbook material match the shipped
    behavior.
  - Known warnings and limits remain explicit: Protobuf emits its JDK 25
    terminal `Unsafe` deprecation notice; the web bundle is 2.4 MiB minified
    and is a route-splitting optimization candidate; Ant Design causes jsdom
    to log its unsupported pseudo-element `getComputedStyle` notice during an
    otherwise passing Vitest run, while the real Chromium golden path passes;
    production TLS/OIDC, secret distribution, capacity/load qualification,
    multi-node chaos, and restore drills are environment-specific deployment
    gates rather than claims made by this local release.

## Docker Functional Demo

- Status: Complete (2026-07-30)
- Goal: package the proven Compose golden path as a one-command, retained,
  inspectable demo for GitHub evaluators.
- Acceptance and verification:
  [docs/specs/docker-functional-demo.md](specs/docker-functional-demo.md).
- Evidence:
  - `python3 -m unittest deploy/compose/test_push_sink.py` first failed because
    `/last` returned 404, then passed after the bounded last-payload evidence
    endpoint was implemented.
  - `bash -n e2e/compose_full.sh demo/run.sh demo/down.sh` passed.
  - `make validate-deploy` passed the Compose, Prometheus, alert-rule, Grafana,
    and Kubernetes render checks.
  - `make demo` built and retained the dedicated 11-service
    `ojbquay-demo` project. It passed all seven public probes, session/CSRF
    login, resource provisioning, gRPC production with partition/offset,
    exact-payload HTTP PUSH, the consumer success metric, and five healthy
    Prometheus jobs.
  - Manual checks against the retained stack returned `UP` from the console,
    ready from Prometheus, a healthy Grafana database, one PUSH delivery, and
    the expected payload digest.
  - A containerized Chromium session authenticated against the real retained
    stack, reached the system overview, and found the generated topic.
  - `make demo-down` removed only the `ojbquay-demo` project and left zero
    project containers.
  - The sanitized environment, requirement matrix, results, and exclusions are
    recorded in
    [docs/test-reports/docker-functional-demo.md](test-reports/docker-functional-demo.md).

## OJBK Namespace Migration

- Status: Complete (2026-07-30)
- Goal: remove the legacy namespace from every current path and contract while
  preserving product behavior and keeping the repository private.
- Acceptance and verification:
  [docs/specs/ojbk-namespace-migration.md](specs/ojbk-namespace-migration.md).
- Evidence:
  - The namespace validator first failed with 1,166 content matches and 243
    path matches, then passed after all owned source, generated code, public
    contracts, runtime resources, tests, dashboards, alerts, and documentation
    were migrated.
  - `make generate-proto` regenerated the Go Protobuf and gRPC sources from
    `proto/ojbk/v1` with pinned compiler plugins.
  - The Dockerized Gradle build passed all Java modules and Testcontainers
    integration tests on JDK 25; `go test ./...`, `go vet ./...`, `pnpm test`,
    and `pnpm build` passed for both SDK and console boundaries.
  - `make validate-deploy` passed Compose, Prometheus, alert-rule, Grafana,
    Kubernetes, and namespace validation.
  - `./e2e/pull_share.sh` reported `GO_INTEROP_OK` and `INTEROP_OK` against the
    renamed gRPC package and authentication header.
  - `make e2e` passed a fresh 11-service Compose run, authenticated the console,
    provisioned resources, produced through gRPC, delivered the exact PUSH
    payload, and verified OJBK metrics plus five healthy Prometheus jobs.
  - The first retained `make demo` run exposed a one-shot Prometheus scrape
    race. A bounded health wait was added; a clean rerun passed and a real
    containerized Chromium session reported `LIVE_BROWSER_OK`.
  - The first private-PR CI run passed five jobs but exposed scheduling jitter
    in a real-Kafka sampling assertion: the production CEL filter correctly
    fails closed when its 10 ms evaluation budget is exceeded. The integration
    test now retries the read within a bounded 5-second window without changing
    the production limit; its focused Testcontainers test and the full Gradle
    build passed locally.
  - The follow-up private-PR run passed all six GitHub Actions jobs: Java build,
    Go SDK, Web, deployment models, Java/Go pull interoperability, and Compose
    E2E.
  - An exact pre-rewrite mirror and bundle were created after inventorying the
    two remote branches and confirming there were no tags. All 20 existing
    commits were rewritten, and the tested feature tree remained byte-for-byte
    identical at tree object `333243bfb0bca4c8dcd7c52a4024a27aff680b8c`.
  - The rewritten `main` and feature branch were atomically force-pushed with
    explicit leases. GitHub then regenerated the PR merge ref with the current
    base and head as parents; its commit messages, object paths, and reachable
    blobs passed the history scan.
  - Reopening the rewritten PR triggered GitHub Actions run `30523935473`.
    Java build, Go SDK, Web, deployment models, Java/Go pull interoperability,
    and Compose E2E all passed before PR #1 was merged as
    `4d860900462b353a441af4acf5c92c3023366c01`.
  - A fresh post-merge mirror including heads, tags, and pull-request refs
    passed `git fsck --full` and case-insensitive scans of ref names, commit
    messages, object paths, and all reachable blob contents.
  - Repository visibility remains private. Hosted-provider garbage collection
    of objects that are no longer reachable from any advertised ref is outside
    repository-owner control.

## Apache 2.0 Product License

- Status: Complete (2026-07-30)
- Goal: provide an explicit, standard grant for users to use, modify, and
  redistribute the independently implemented product.
- Acceptance and verification:
  [docs/specs/apache-2-license.md](specs/apache-2-license.md).
- Evidence:
  - The root `LICENSE` is byte-identical to the operating system's canonical
    Apache License 2.0 text.
  - The README identifies Apache-2.0 and links to the complete license.
  - Dependency and image license terms remain separate and unchanged.
  - Namespace validation and `git diff --check` passed.
  - Repository visibility remains private.

## Java 25 LTS Baseline

- Status: Complete (2026-07-30)
- Goal: replace the split Java 24/JDK 25 configuration with one supported Java
  25 LTS compile/runtime baseline and expose standard JVM tuning inputs.
- Acceptance and verification:
  [docs/specs/java-25-lts-baseline.md](specs/java-25-lts-baseline.md).
- Decision:
  [ADR-002](adr/002-java-25-lts-baseline.md).
- Evidence:
  - The initial configuration assertion failed because Gradle still set
    `options.release = 24`; after the change, the Java toolchain and release
    target both use 25.
  - Oracle identifies Java 25 as the current LTS, and Eclipse Temurin lists
    availability through at least September 2031. Java 24 is a superseded
    non-LTS release.
  - `make validate-deploy` passed Compose, Prometheus, five alert rules, three
    Grafana dashboards, and Kubernetes Kustomize rendering.
  - Structured Compose and rendered-Kubernetes checks proved all four Java
    services receive the configurable `JAVA_TOOL_OPTIONS` value.
  - A clean containerized `./gradlew clean build --no-daemon --no-parallel`
    passed all 51 executed tasks on JDK 25. The only Java warning was the
    already documented Protobuf terminal `Unsafe` deprecation.
  - `OJBQUAY_JAVA_TOOL_OPTIONS=-XX:+PrintCommandLineFlags make demo` rebuilt
    and retained the 11-service stack, then passed all readiness,
    authentication, provisioning, production, exact PUSH, metric, and
    Prometheus checks.
  - Direct inspection of console-api, both gateways, and scheduler reported
    Eclipse Adoptium Java `25.0.3`, the requested JVM flag, and Java class-file
    version 69.
  - The first two PR Java-build attempts exposed cold-runner scheduling jitter
    in the CEL unit test: a valid expression could correctly fail closed when
    its production 10 ms evaluation budget elapsed. The semantic assertion now
    retries within a bounded five-second test window, matching the existing
    real-Kafka test strategy without changing the production limit.
