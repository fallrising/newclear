---
task_id: P06-T04
node_id: P06
title: Review, document, verify, and deliver P06
status: done
owner: codex
depends_on:
  - P06-T01 accepted
  - P06-T02 accepted
  - P06-T03 accepted
allowed_paths:
  - all P06 node allowed paths
---

# P06-T04 — Review and delivery

## Objective

Resolve every delegated finding, run the full local and online quality gate,
align operator documentation, and deliver P06 without claiming live rollout.

## Review focus

- Inputs cannot become commands, paths cannot escape quoting, and no secret is
  read or printed.
- Exact failure points prevent later host or registry access.
- Docker operations are read-only in production preflight.
- Rehearsal cleanup is uniquely scoped and persistence evidence is exact.
- Existing deployment, rollback, and default-disabled semantics are unchanged.

## Completion rule

P06 is done only after local evidence, pull-request validation, merge,
merged-main publication, and documentation are recorded. The live activation
gate remains a separate authorized operation with real online evidence.
