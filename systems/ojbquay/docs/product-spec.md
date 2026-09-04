# ojbquay Product Specification

## Context

Application teams benefit from a managed messaging platform instead of direct
broker access. `ojbquay` provides that experience on standard Kafka,
PostgreSQL, gRPC, and Protobuf infrastructure, avoiding broker forks,
ZooKeeper-coupled configuration, legacy RPC SDKs, and executable user
pipelines.

The source set contains two conflicting implementation designs. The v1 PRD and
its normative SDD define a Kafka-first implementation. A later document is
explicitly marked `Draft / SSOT Candidate` and proposes a RocketMQ-first
implementation. ADR-001 records why the v1 PRD/SDD controls implementation.

## Goal

Deliver a self-service enterprise messaging platform in which an application
can create a topic and subscription, send through a stable gRPC SDK, receive by
HTTP push or high-level pull, inspect failures and lag, and manage delay,
retry, DLQ, and offset workflows without direct broker administration.

## Non-goals

- End-to-end exactly-once semantics.
- A broker fork or a new broker implementation.
- Low-level manual-offset APIs for streaming frameworks.
- Arbitrary executable scripts in a core runtime.
- v1 Redis, HBase, or HDFS sinks.
- v1 cross-region replication or usage billing.

## Acceptance Criteria

- Given a valid owner, when they create a topic, group, and subscription, then
  PostgreSQL, Kafka, the versioned config bus, and audit log converge on the
  same desired state.
- Given a configured topic, when an authenticated SDK sends a valid message,
  then Kafka acknowledges it and the gateway returns its partition and offset.
- Given an unknown topic, bad token, oversized message, or exhausted quota,
  when a producer sends, then the gateway rejects it without broker I/O using a
  stable application code.
- Given a push subscription, when a message matches its tags and CEL filter,
  then the transformed body is delivered, transient failures follow the bounded
  retry policy, and exhausted messages enter DLQ.
- Given a pull subscription, when a client acks, nacks, or disconnects, then
  Kafka Share Group acknowledgement and delivery-count semantics remain visible
  without skipping messages.
- Given a delayed message, when its due time arrives, then it is emitted within
  the documented tolerance; cancellation and finite recurrence are atomic and
  auditable.
- Given an offset-reset request, when any runtime has not confirmed pause, then
  no broker offset changes.
- Given control-plane unavailability, when a data-plane runtime already has a
  valid snapshot, then it continues using Last Known Good configuration.
- Given the local Compose environment, when the golden-path E2E runs, then a
  user can complete topic creation through observed delivery without manual
  broker configuration.

## Constraints

- Java source is compiled and runs on the Java 25 LTS baseline.
- Kafka 4.2 is the only v1 broker and provides KRaft and Share Groups.
- PostgreSQL 17 is the metadata and scheduling store.
- Spring Boot is limited to the control plane.
- gRPC/Protobuf and REST `/api/v1` contracts evolve additively.
- Delivery is at-least-once; clients must be idempotent.
- All queues, inflight windows, batches, retries, and caches are bounded.
- Payloads and credentials are absent from default logs and traces.

## Assumptions and Unknowns

Verified:

- Kafka 4.2.0, Spring Boot 4.1.0, Gradle 9.6.1, and JDK 25 artifacts are
  published.
- Kafka 4.2 Share Groups acquire and explicitly acknowledge records against the
  selected Apache Kafka image when the Share coordinator internal topic is
  configured for the cluster replication size.
- The GitHub repository is private and owned by `fallrising`.

Open decisions that do not block M0:

- OIDC provider and secret manager selection.
- Whether offset reset requires two-person approval.
- Tenant-level gateway deduplication beyond Kafka producer idempotence.
- Production quotas and delay capacity values, which require load tests.
- Whether the sub-second retry path needs a different scheduler mechanism to
  meet the SDD's 150 ms `<20%` timeline target without weakening durable,
  no-early delivery or creating an unsafe broker poll rate.

## Design

The control plane is a modular Spring Boot application backed by PostgreSQL.
Resource changes, audit records, and transactional outbox rows are committed
together. A publisher emits monotonic entity revisions to the compacted
`__ojbk.config` topic.

Framework-free producer, consumer, and scheduler runtimes bootstrap that topic,
validate immutable snapshots, atomically replace active configuration, and keep
Last Known Good on failure. Kafka stores application, retry, DLQ, and delay
inbox topics. PostgreSQL workers use `FOR UPDATE SKIP LOCKED` for v1 delay
scheduling.

## Steps

Delivery follows M0 through M6 in `docs/execution-plan.md`. Each milestone is a
vertical slice with its own tests, documentation, acceptance evidence,
Conventional Commit, and push.

## Verification

- `./gradlew build`
- `docker compose -f deploy/compose/docker-compose.yml config --quiet`
- Milestone-specific Testcontainers and E2E commands recorded in
  `docs/execution-plan.md`
- Final `make e2e` once all deployable services exist
