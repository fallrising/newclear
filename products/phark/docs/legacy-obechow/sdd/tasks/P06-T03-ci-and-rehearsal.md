---
task_id: P06-T03
node_id: P06
title: Add the CI gate and isolated Docker rehearsal
status: done
owner: grok
reviewer: codex
depends_on:
  - P06-T02 accepted
allowed_paths:
  - tests/ops/rollout_rehearsal_test.sh
  - .github/workflows/deploy.yml
---

# P06-T03 — CI gate and Docker rehearsal

## Objective

Run the accepted preflight contract in both workflow build paths and add the
isolated real-Docker replacement rehearsal described by the P06 test plan.

## Constraints

- Preserve every P04/P05 event, permission, tag, deploy-gate, concurrency,
  action-pin, fingerprint, and exact-SHA behavior.
- Do not contact a VPS, public DNS, SSH, or GHCR from the rehearsal.
- Use a synthetic immutable local tag and `pull_policy: never`.
- Create and remove only uniquely named test resources.
- Do not edit production, SDD, application, or documentation files.
- Do not commit or push.

## Handoff

Report files changed, shell/workflow checks, local Docker results, cleanup
evidence, and any workflow behavior changed. Codex will repeat the rehearsal
and inspect all runtime values.
