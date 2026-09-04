---
task_id: P05-T02
node_id: P05
title: Add deployment contract tests and CI gate
status: done
owner: opencode
reviewer: codex
depends_on:
  - P05-T01 accepted
allowed_paths:
  - tests/ops/**
  - .github/workflows/deploy.yml
---

# P05-T02 — Tests and CI gate

## Objective

Create a hermetic shell contract test for the accepted production bundle and
run it in both existing workflow build paths.

## Required implementation

- Use real Compose for model resolution and a PATH-injected fake `docker` for
  deploy sequencing and failure injection.
- Cover every case enumerated in the P05 test plan.
- Create temporary files with `mktemp -d` and clean only that exact directory.
- Add one clearly named test step after checkout and before image build in both
  `validate` and `publish`.

## Constraints

- Preserve P04 event guards, permissions, tags, action pins, deploy gate,
  concurrency, SSH fingerprint, and exact remote command.
- Do not need network access beyond the workflow's later image build.
- Do not alter the accepted production bundle or edit SDD files.
- Do not commit or push.

## Handoff evidence

- List changed files.
- Report the test command and results.
- Report `actionlint`.
- Call out any P04 workflow behavior that changed.
