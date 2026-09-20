---
id: SDD-0007
title: Operational hardening and evidence gates
status: approved
owner: fallrising
risk: high
data_class: internal
budget_usd: 4
allowed_paths:
  - "src/ice_maker/**"
  - "tests/**"
  - "ops/**"
  - "docs/runbooks/**"
  - "docs/verification/**"
forbidden_paths:
  - ".git/**"
  - "docs/sdd/**"
  - ".github/**"
  - "orchestration/policies/**"
---

# Operational hardening and evidence gates

## Context

Phase 7 must turn the earlier runner, routing, knowledge, and publication
controls into an operable local contract. No VPS, production credential,
collector, object store, or external attestor is available in this build, so
local drills must be useful while remaining structurally unable to claim
`PRODUCTION_READY`.

## Goals

- G-1: Validate deployable contracts for an ephemeral rootless runner,
  short-lived OIDC identity, and deny-by-default proxied egress.
- G-2: Produce bounded secret-safe metric snapshots and enforce task, retry,
  queue, and cost ceilings from tracked observability configuration.
- G-3: Exercise deterministic local restore, credential-rotation, runner-
  compromise, egress, and cost-ceiling drills with explicit evidence class.
- G-4: Report `DEVELOPMENT_COMPLETE` only after every local gate passes and
  reserve `PRODUCTION_READY` for separately attested external evidence.

## Non-goals

- Provisioning a runner/VPS, requesting credentials, contacting providers,
  changing protected workflows, deploying, merging, or publishing.
- Installing OpenTelemetry, Grafana, Temporal, Prefect, Vault, or a proxy.
- Treating local fixtures, configuration, or tabletop exercises as real
  infrastructure evidence.

## User stories

- As an operator, I can validate runner, identity, and egress configuration
  before a real host receives any credential.
- As a maintainer, I can detect cost, retry, queue, cleanup, and provenance
  threshold violations from a deterministic bounded snapshot.
- As an incident responder, I can rehearse restore, rotation, and runner
  compromise procedures locally without handling a secret.
- As a reviewer, I can distinguish development evidence from externally
  attested production evidence without relying on prose.

## Functional requirements

- FR-1: Strict tracked JSON contracts require one-job ephemeral execution,
  rootless/read-only/no-new-privilege isolation, short-lived OIDC with no static
  credential, and deny-by-default HTTPS egress through a named proxy boundary.
- FR-2: A deterministic metrics boundary accepts only the approved metric set,
  safe bounded labels, finite non-negative values, and configuration-bound
  thresholds; quota failures identify the metric without exposing raw data.
- FR-3: Local drills prove hash-exact restore with tamper rejection, metadata-
  only credential rotation, ordered compromised-runner replacement, denied
  unlisted egress, and fail-closed cost ceilings.
- FR-4: Immutable evidence binds control, commit, environment class, result,
  and artifact digest. Local evidence can satisfy development gates but can
  never satisfy an external production gate.
- FR-5: One end-to-end local journey validates tracked configuration, runs all
  drills, evaluates metrics, and returns `DEVELOPMENT_COMPLETE` with the exact
  external evidence still pending.

## Non-functional requirements

- Python 3.11 standard library only; no network, shell, credential value,
  timestamp generation, random output, or production side effect.
- Reject duplicate JSON keys, unknown fields, mutable/unbounded collections,
  non-finite numbers, control characters, secret-like labels, path traversal,
  symlinked state, evidence replay, missing steps, and digest drift.
- Configuration and local evidence are deterministic, reviewable, and safe to
  commit. Runtime drill output remains disposable.

## Acceptance criteria

Scenario: Complete the local hardening journey
Given tracked runner, identity, egress, metrics, and dashboard contracts
When all local drills and cost-ceiling checks run against synthetic state
Then every control yields digest-bound local evidence and readiness is exactly
`DEVELOPMENT_COMPLETE` with external infrastructure gates listed.

Scenario: Reject an unsafe hardening control
Given a persistent or privileged runner, static credential, overlong identity,
direct/unlisted egress, corrupt restore, unordered compromise response, or
over-budget metric snapshot
When the corresponding validator or drill runs
Then it fails closed without a credential value, network call, or partial
restored state.

Scenario: Prevent evidence overclaim
Given complete local simulated evidence or malformed external-looking evidence
When readiness is evaluated
Then it cannot produce `PRODUCTION_READY`; genuine external attestation remains
a separate human and infrastructure gate.

## Failure modes

- Unsafe configuration: reject before a drill begins.
- Backup corruption or destination collision: publish no restored state.
- Cost/retry/queue threshold breach: return a stable bounded violation set.
- Missing or replayed control evidence: keep readiness external-pending.

## Open questions

- Real runner platform, OIDC issuer/audience, proxy implementation, telemetry
  collector, backup target, and credential broker remain external decisions.
- Temporal/Prefect stays excluded unless measured Actions concurrency proves a
  need and a separately approved SDD covers the dependency.
