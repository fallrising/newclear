# AGENTS.md

## Scope

These instructions apply to the entire `ojbquay` repository.

## Product Baseline

- The accepted product baseline is `docs/product-spec.md`.
- Architectural decisions are recorded in `docs/adr/`.
- External contracts live under `proto/` and evolve additively.
- Java packages use `dev.ojbk.*` and Protobuf packages use `ojbk.v1` as the
  native API namespace for the `ojbquay` product.

## Engineering Rules

- Compile and run Java code on the Java 25 LTS baseline.
- Use Gradle Kotlin DSL and the checked-in Gradle wrapper.
- Keep data-plane modules free of Spring.
- Use immutable configuration snapshots and atomic replacement.
- Keep queues, caches, batches, retries, and executors bounded.
- Never log message payloads, credentials, or resource tokens.
- Use stable application error codes; do not expose broker exceptions.
- Treat PostgreSQL as metadata SSOT and Kafka as the v1 broker/config bus.

## Verification

- Follow Red-Green-Refactor for behavior changes.
- Prefer unit tests, then contract tests, then Testcontainers integration tests, then end-to-end tests.
- Run the narrowest relevant check while developing and `./gradlew build` before each milestone commit.
- A milestone commit must update its task evidence in `docs/execution-plan.md`.

## Git

- Use Conventional Commits.
- Commit and push only after the milestone acceptance gate passes.
- Do not mix work from different milestones in one commit.
