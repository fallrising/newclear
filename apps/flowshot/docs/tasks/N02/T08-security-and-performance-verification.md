---
generated_at: 2026-10-23T04:18:40Z
document_type: task
node_id: N02
status: ready
derived_from:
  - ../../../SPEC.md
  - ../../nodes/N02-workspace-lazy-tree.md
  - ../../adr/ADR-003-workspace-boundaries.md
source_version: 1.0.2
source_sha256:
  SPEC.md: b569c2181559270221de3e81ce1d59fad136932299629f805fb10155938357b0
  N02: e1994e03209cb624d5430169d6866b63884712917f04841d8c1416a06b227f2e
  ADR-003: 5e929e434782cd8650641994555fc6eec5036530fac72ba4777308e447352f66
owner: codex
id: T08
title: security-and-performance-verification
expected_duration: 60m
allowed_paths:
  - crates/db/**
  - contracts/locks/N01.json
  - src-tauri/src/path_guard/**
  - src-tauri/src/workspace/**
  - src-tauri/src/commands/workspace*
  - src/features/workspace/**
  - src-tauri/tests/**
  - docs/tasks/N02/**
forbidden_paths:
  - SPEC.md
  - src/App.tsx
  - immutable v1 migration
---
# T08 — security-and-performance-verification

Deliver this named slice from the implementation/test plan, preserving all ADR-003 boundaries. Write its behavior RED first, retain the exact failing log, implement, then rerun its focused native/core/component target. Do not claim completion from contract generation alone. Dependencies follow T01→T02→T03→T04→T05→T06→T07→T08. Root owns final independent acceptance.

Partial-publication follow-up: reproduce a symlinked system temporary directory in Linux Docker, then canonicalize only the test fixture base to satisfy Guard’s existing canonical-root precondition. Keep production no-follow behavior and adversarial symlink assertions unchanged; retain the failing and passing same-command evidence.

Clean-CI evidence setup: retain the failing benchmark run with a configured but absent evidence directory, then create that directory before writing its JSON. Keep the timing oracle and source behavior unchanged; rerun the same case and native checks.

Remote Mac compile follow-up: Flowshot CI run39914744562 Apple Silicon job120285995009 rejects the test-only rustix mkfifoat call because rustix1.1.5 excludes Apple targets. Use the platform mkfifo utility to create the same real FIFO fixture on Unix; retain the unchanged UnsupportedMediaType assertion. Linux native tests and remote Mac CI must pass before merge.

Mac filesystem follow-up: job120288336536 rejects creating the invalid UTF-8 filename with EILSEQ before the security assertions run. Accept only the exact macOS/EILSEQ fixture-creation rejection as a distinct filesystem outcome, require zero nonexistent unsupported entries there, and still execute all symlink/ignored-document/asset bypass assertions. Linux must continue creating the invalid filename and requiring skip count1; all other setup errors must fail.
