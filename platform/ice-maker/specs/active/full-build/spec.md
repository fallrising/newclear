---
id: SDD-FULL-BUILD
title: Personal Engineering Knowledge Compiler full build
status: approved
owner: fallrising
risk: high
data_class: internal
budget_usd: 25
allowed_paths:
  - "**"
forbidden_paths:
  - ".git/**"
---

# Full Build Specification

## Context

The SDD pack defines a local-first, auditable engineering and knowledge pipeline
that must be implemented continuously through Phase 0–7 on one integration branch.

## Goals

- Deliver deterministic SDD, orchestration, knowledge, publication, and
  hardening capabilities with repository-native evidence.
- Preserve least privilege, provenance, synthetic-data honesty, and human gates.
- Keep every phase recoverable through a pushed checkpoint and one pull request.

## Non-goals

- Merge or direct push to `main`.
- Deployment or use of production credentials/sensitive corpora.
- Claiming real infrastructure drills passed from simulations.

## User stories

- As an engineer, I can create and validate an SDD without an AI provider.
- As an orchestrator, I can execute bounded adapters and reject unsafe output.
- As a knowledge curator, I can ingest synthetic PDFs with provenance, promote
  notes through review gates, and build reproducible publications.
- As an operator, I can inspect metrics, budgets, recovery controls, and the exact
  external evidence still required.

## Functional requirements

- FR-0: Encode decisions, schemas, data/provider rules, threat controls, and
  GitHub governance.
- FR-1: Provide `sdd init`, `new`, `validate`, and `status`.
- FR-2: Provide allowlisted, isolated, timeout-bounded, redacted single-agent
  execution and PR evidence.
- FR-3: Provide at least two doctor-verified adapter routes plus budgets,
  fallbacks, health/rate-limit handling, and independent review.
- FR-4: Ingest text and scanned synthetic PDFs through hash, dedupe, extraction,
  OCR, indexing, provenance, taxonomy, and privacy gates.
- FR-5: Retrieve and promote synthetic notes and report contradictions,
  duplicates, and orphans with human promotion gates.
- FR-6: Rebuild Markdown/HTML publications from manifests and record source SHA.
- FR-7: Provide hardening configuration, tests, runbooks, metrics, backup/restore,
  rotation, cost ceiling, and compromise exercises.

## Non-functional requirements

- Python 3.11 standard library first; deterministic, offline tests.
- Reject path traversal, symlink escape, secrets, invalid schemas, and unsafe
  provider/data combinations.
- Bound time, process output, retries, and cost. Make destructive or external side
  effects explicit and idempotent.
- Preserve immutable source hashes and page/chunk provenance.

## Acceptance criteria

Scenario: Complete each local phase
Given the immutable SDD pack and synthetic fixtures
When the repository-native full gate is run
Then every locally testable Phase 0–7 requirement passes
And external infrastructure evidence is labeled pending rather than passed.

Scenario: Prevent unauthorized integration
Given an agent or contributor attempts a direct main/protected-path bypass
When policy and GitHub gates evaluate the change
Then it is rejected and requires the designated human review.

Scenario: Rebuild publication
Given generated publication output is absent
When the publication manifest is built from a clean checkout
Then Markdown and HTML are reproduced with provenance and a source commit SHA.

## Failure modes

- Provider unavailable: follow the approved fallback only; otherwise fail closed.
- External infrastructure absent: complete independent local work and retain an
  explicit external evidence gate.
- Sensitive or rights-unclear input: stop before provider transmission.
- Gate or source-hash failure: do not checkpoint the phase.

## Open questions

- Production VPS, object store, runner registration, and credential mechanisms
  require human-supplied infrastructure and remain external evidence gates.
