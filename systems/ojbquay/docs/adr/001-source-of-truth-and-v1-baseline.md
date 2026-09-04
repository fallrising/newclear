# ADR-001: Source of Truth and v1 Baseline

- Status: Accepted; Java baseline superseded by ADR-002
- Date: 2026-07-29

## Context

The provided source set conflicts on four foundational choices:

| Concern | PRD v1 + normative SDD | Draft SSOT candidate |
|---|---|---|
| Broker | Kafka 4.2 only | RocketMQ first, Kafka later |
| Java | Java 24 on JDK 25 | Java 21 |
| Build | Gradle 9 Kotlin DSL | Maven modules |
| v1 scope | Push, delay, pull, web | Pull first; push and delay later |

The later file labels itself `Draft / SSOT Candidate`. The SDD labels its
constants, names, schema, and implementation order normative and names the v1
PRD as its upstream product source.

## Decision

The v1 PRD and normative SDD control conflicting implementation details.
`ojbquay` therefore uses Kafka 4.2, Java 24 on JDK 25, Gradle 9, and milestones
M0 through M6 from those documents.

Compatible requirements from the draft are adopted:

- explicit message and acknowledgement semantics;
- broker capability validation;
- transactional outbox;
- immutable versioned snapshots and Last Known Good;
- contiguous offset/ack-window rules where classic consumption is used;
- offset-reset hard gates;
- bounded resources and retry-storm limits;
- payload-safe telemetry;
- contract, integration, fault, and state-machine tests.

The repository and product name is `ojbquay`. Its native Java and Protobuf
namespaces are `dev.ojbk.*` and `ojbk.v1`.

ADR-002 replaces only the Java 24 language-level decision with one Java 25 LTS
compile/runtime baseline.

## Consequences

- RocketMQ adapters and legacy Thrift compatibility are later work, not v1.
- Kafka Share Groups must pass destructive validation before M5 is accepted.
- The control plane uses Spring Boot; data-plane services do not.
- Any change to this baseline requires a superseding ADR and product-spec
  update before code changes.
