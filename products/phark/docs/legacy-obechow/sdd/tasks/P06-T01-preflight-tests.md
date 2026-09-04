---
task_id: P06-T01
node_id: P06
title: Add RED rollout-preflight contract tests
status: done
owner: grok
reviewer: codex
depends_on:
  - P06 specification baseline
allowed_paths:
  - tests/ops/rollout_preflight_test.sh
---

# P06-T01 — RED preflight contract tests

## Objective

Create the smallest hermetic shell test that fully encodes P06-BDD-01 through
P06-BDD-04 before production implementation exists.

## Required behavior

- Use fake Docker and DNS adapters plus isolated reviewed/installed artifacts.
- Assert exact command values and ordering for the success path.
- Cover the invalid-input and failure matrices in `P06-test-plan.md`.
- Prove malicious inputs do not create a marker file or invoke an adapter.
- Prove artifact drift stops before Docker/DNS/registry checks.
- Prove every injected prerequisite failure stops later commands and omits the
  success message.
- Allow-list the complete read-only command sequence.
- Clean only an exact `mktemp -d` directory.

## Constraints

- Modify only `tests/ops/rollout_preflight_test.sh`.
- Do not create `ops/rollout-preflight.sh`.
- Do not edit SDD, workflow, P05 files, or application source.
- Do not use real Docker, DNS, registry, SSH, GitHub, or VPS access.
- Do not commit or push.

## RED acceptance

- `bash -n tests/ops/rollout_preflight_test.sh` passes.
- Executing the test exits non-zero specifically because
  `ops/rollout-preflight.sh` is absent.
- The failure is not caused by test syntax, fixture setup, or missing local
  dependencies.

## Handoff

Report the changed file, assertion count or cases, syntax result, observed RED
failure, and any contract ambiguity. Codex will inspect the complete diff.
