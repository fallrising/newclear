# ADR-0002: SQLite and Local Storage Defaults

- Status: Accepted for MVP; reversible through storage interfaces
- Date: 2026-09-02
- Owner: repository owner (`fallrising`)

## Context

The task ledger, usage records, and cache index need deterministic local behavior.
The architecture allows PostgreSQL and object storage later, but no production
storage has been supplied or verified.

## Decision

- Use SQLite in WAL mode for the local task ledger, usage data, and cache index.
- Keep persistence behind a small storage boundary so PostgreSQL can replace the
  ledger without changing task semantics. Task identity remains
  `task_id + input_commit + spec_hash`.
- Use a local filesystem/object-store fixture for development artifacts. Store
  immutable source hashes, classification, provenance, and references; do not
  treat generated publications as source of truth.
- Back up the local SQLite ledger/configuration on a bounded, documented schedule
  when operational code exists. Raw sensitive artifacts stay outside Git and are
  not copied into fixtures.

## External evidence gates

Production object storage provider, location/retention/versioning policy,
access-control configuration, encryption, backup/restore drill, and lifecycle
policy are `pending`. No external object-store configuration is represented as
available or passed. These gates block production data handling, not local
synthetic-fixture development.

## Consequences

The MVP has a low-dependency, offline-testable persistence path. Migration to
PostgreSQL or an S3-compatible store remains a deliberate operational change,
with schema, backup, restore, and access-control verification required first.
