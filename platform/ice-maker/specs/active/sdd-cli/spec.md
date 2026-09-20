---
id: SDD-0001
title: Deterministic SDD lifecycle CLI
status: approved
owner: fallrising
risk: medium
data_class: internal
budget_usd: 2
allowed_paths:
  - "src/ice_maker/**"
  - "tests/**"
  - "Makefile"
  - ".github/workflows/ci.yml"
  - "README.md"
forbidden_paths:
  - ".git/**"
  - "orchestration/policies/**"
---

# Deterministic SDD lifecycle CLI

## Context

Phase 1 needs a complete specification lifecycle that runs locally and in CI
without any model or third-party Python dependency.

## Goals

- G-1: Create, validate, and inspect repository SDDs through one deterministic CLI.
- G-2: Make an invalid active specification fail the repository CI-equivalent gate.

## Non-goals

- Executing agents, publishing pull requests, or installing dependencies.
- Parsing general YAML outside the constrained front matter used by the templates.

## User stories

- As an engineer, I can complete an SDD lifecycle without an AI provider.
- As a reviewer, I receive stable diagnostics for malformed or unsafe specifications.

## Functional requirements

- FR-1: `sdd init` creates idempotent repository-local configuration and required directories.
- FR-2: `sdd new` creates one four-file SDD from the governed templates without overwriting existing work.
- FR-3: `sdd validate` checks required files, front matter fields/types/enums, safe paths, task IDs, and verification structure.
- FR-4: `sdd status` reports deterministic lifecycle state in human-readable and JSON forms.
- FR-5: the repository gate validates every active SDD and returns non-zero for invalid schema/content.

## Non-functional requirements

- Python 3.11 standard library only; deterministic and offline.
- Reject absolute/traversal feature names and ambiguous or malformed front matter.
- Never overwrite an existing SDD and never access paths outside the selected root.

## Acceptance criteria

Scenario: Complete a lifecycle without AI
Given an empty temporary Git repository
When an operator runs `init`, `new`, `validate`, and `status`
Then the generated SDD is valid and status reports it deterministically.

Scenario: Reject malformed specification data
Given an active SDD with a missing required field or unsafe path
When validation or the repository gate runs
Then it exits non-zero with an actionable diagnostic and changes no file.

Scenario: Preserve existing work
Given an SDD directory already exists
When `sdd new` targets the same identifier
Then it fails without overwriting any existing file.

## Failure modes

- Malformed front matter or unsupported value: fail closed and name the file/field.
- Partial existing target: do not create or replace files; report the conflict.
- Missing repository templates: fail without creating an incomplete SDD.

## Open questions

- None. Owner: `fallrising`.
