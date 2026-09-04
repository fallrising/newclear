---
task_id: P06-T02
node_id: P06
title: Implement the read-only rollout preflight
status: done
owner: grok
reviewer: codex
depends_on:
  - P06-T01 accepted
allowed_paths:
  - ops/rollout-preflight.sh
---

# P06-T02 — Read-only rollout preflight

## Objective

Implement the minimum host-local preflight that makes the accepted P06-T01
contract green.

## Constraints

- Modify only `ops/rollout-preflight.sh`.
- Implement exactly P06-FR-01 through P06-FR-06.
- Use strict shell handling and quoted direct commands.
- Do not source environment files or print environment contents.
- Do not mutate Docker, invoke deployment, contact SSH/GitHub, or add
  dependencies.
- Do not edit tests, SDD, workflow, P05 files, or application source.
- Do not commit or push.

## Handoff

Report syntax and focused-test results, files changed, and any assumption.
Codex will review the complete diff for injection, secret handling, permission,
failure semantics, and command scope.
