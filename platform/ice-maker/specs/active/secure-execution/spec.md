---
id: SDD-0002
title: Secure single-agent execution
status: approved
owner: fallrising
risk: high
data_class: internal
budget_usd: 4
allowed_paths:
  - "src/ice_maker/**"
  - "tests/**"
  - "runner/**"
  - "docs/runbooks/**"
  - "docs/verification/**"
  - ".github/workflows/agent.yml"
  - "orchestration/policies/protected-paths.json"
  - "README.md"
forbidden_paths:
  - ".git/**"
  - "docs/sdd/**"
---

# Secure single-agent execution

## Context

Phase 2 must turn the deterministic SDD control plane into a bounded execution
path without allowing an agent to expand permissions, write protected paths,
persist a failed workspace, leak secrets, or publish to `main`.

## Goals

- G-1: Validate one immutable task contract and run one command with hard limits.
- G-2: Isolate each job in a fresh worktree and deny network by default.
- G-3: Produce reviewable result and pull-request evidence only after gates pass.

## Non-goals

- Registering or claiming a real production self-hosted runner.
- Merge, deployment, direct `main` pushes, or production credential use.
- Multi-provider routing, retries, and independent review; those begin in Phase 3.

## User stories

- As an orchestrator, I can reject an unsafe contract before starting a process.
- As a reviewer, I can verify changed paths, commands, redacted logs, and status.
- As an operator, I can cleanly recover after a failed or timed-out job.

## Functional requirements

- FR-1: Parse and validate the unified task contract, immutable base SHA, spec hash, budgets, commands, provider/data policy, and execution identity.
- FR-2: Execute argv without a shell using bounded time, environment, process group, stdout/stderr, and deterministic redaction.
- FR-3: Create a fresh detached worktree per job and define a disposable, read-only-root, capability-dropped, resource-bounded, network-denied sandbox command.
- FR-4: Provide a doctor-checked Codex adapter that receives only approved task input and emits the governed result shape.
- FR-5: Reject changed paths outside the allowlist, all forbidden/protected paths, symlinks, `main` publication, failed commands, or missing evidence.
- FR-6: Build a branch/PR publication request without invoking merge or deploy, and retain evidence for the existing human-gated draft PR.

## Non-functional requirements

- Python 3.11 standard library only and offline deterministic tests.
- Fail closed on malformed input, timeout, truncation, unsupported isolation, cleanup failure, or ambiguous Git state.
- Never place credentials or raw secret values in argv, prompts, logs, artifacts, caches, exceptions, or result JSON.
- Every job is uniquely identified by task ID, base SHA, and spec SHA-256.

## Acceptance criteria

Scenario: Execute a bounded synthetic task
Given a valid internal task contract and a temporary Git repository
When the local executor runs a deterministic fixture command in a fresh worktree
Then the command evidence is redacted and bounded
And only allowlisted changed paths can pass the gate.

Scenario: Reject privilege expansion
Given a task that writes a forbidden path, symlink, host-root path, or `main`
When the post-execution and publication policies run
Then the task fails closed before a branch or PR mutation is requested.

Scenario: Clean up a failed job
Given a command times out or exits non-zero
When execution finishes
Then its process group and disposable worktree are cleaned
And the next job receives a fresh workspace.

## Failure modes

- Invalid contract or data/provider pair: reject before adapter invocation.
- Timeout/output overflow: terminate the process group, redact evidence, and fail.
- Gate or cleanup failure: do not construct publish authorization; retain an actionable local result.
- Missing real runner or scoped publisher credential: mark external evidence pending without weakening local controls.

## Open questions

- Production runner registration, rootless runtime, egress enforcement, and scoped GitHub App credentials remain external evidence gates owned by `fallrising`.
