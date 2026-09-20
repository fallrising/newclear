---
id: SDD-0003
title: Multi-provider routing and independent review
status: approved
owner: fallrising
risk: high
data_class: internal
budget_usd: 6
allowed_paths:
  - "src/ice_maker/**"
  - "tests/**"
  - "config/**"
  - "docs/verification/**"
  - "docs/runbooks/**"
forbidden_paths:
  - ".git/**"
  - "docs/sdd/**"
  - ".github/**"
  - "orchestration/policies/**"
---

# Multi-provider routing and independent review

## Context

Phase 3 extends the governed Codex execution boundary with OpenCode execution
and Claude/Grok read-only review. Provider selection must remain data-class,
health, rate-limit, role, fallback, and task-budget aware without committing
model IDs or credentials.

## Goals

- G-1: Expose uniform doctor and invocation evidence for two builder adapters
  and an independent read-only reviewer route.
- G-2: Select only policy-equivalent configured aliases, fail closed by default,
  and track attempts, latency, and estimated cost against a task ceiling.
- G-3: Run the sequential builder, deterministic-gate, independent-review path
  without granting the reviewer write access.

## Non-goals

- Calling a paid provider, reading a provider credential, or committing a real
  model ID.
- Parallel implementation, agent debate, merge, deployment, or direct `main`
  mutation.
- Changing the Phase 0 provider/data matrix or protected GitHub policy.

## User stories

- As an orchestrator, I can route a task to a healthy allowed alias and explain
  whether an unavailable primary failed closed or used an explicit fallback.
- As a reviewer, I receive only the task, diff, and deterministic evidence and
  cannot edit the worktree.
- As an operator, I can inspect per-attempt provider usage and enforce a total
  cost ceiling.

## Functional requirements

- FR-1: Add OpenCode builder and Claude/Grok read-only reviewer adapters with
  bounded doctor, non-interactive argv, exact configured-model checks, safe
  inputs, and governed output evidence.
- FR-2: Keep role aliases in repository configuration while resolving actual
  model IDs only from injected runtime configuration.
- FR-3: Route by role, provider health, rate-limit state, data class, and budget;
  unknown or unsafe states fail closed.
- FR-4: Permit fallback only when explicitly configured to an equal-policy
  alias, bound attempts, and stop repeated failure signatures.
- FR-5: Record immutable provider, alias, attempt, latency, cost, and outcome
  entries and reject non-finite, negative, or over-budget usage.
- FR-6: Compose builder output, deterministic gate evidence, and a different-
  provider read-only review into one sequential result.

## Non-functional requirements

- Python 3.11 standard library only with deterministic offline tests.
- Never place model credentials, raw secrets, or real model IDs in repository
  configuration, prompts, logs, cached artifacts, or usage evidence.
- Bound every attempt by wall time, output size, attempt count, and task cost.
- Keep routing and pipeline state immutable after validation and make errors
  actionable without echoing unsafe input.

## Acceptance criteria

Scenario: Execute one synthetic fixture through two adapters
Given fake local Codex and OpenCode executables with no credentials or network
When the same governed fixture is invoked
Then both produce bounded result evidence through their exact non-interactive argv.

Scenario: Handle an unavailable model according to policy
Given an unhealthy or rate-limited primary alias
When no fallback is authorized the route fails closed
And when an equal-policy fallback is explicitly authorized it is selected and recorded.

Scenario: Require independent review
Given a successful builder result and deterministic gate
When the sequential pipeline reviews the diff
Then the reviewer provider differs from the builder provider
And the reviewer has no writable workspace or publication capability.

## Failure modes

- Missing CLI, auth, or configured model: unhealthy doctor result; do not invoke.
- Unsafe data/provider pair or exhausted budget: reject before adapter invocation.
- Rate limit or repeated failure signature: apply only an explicit bounded
  fallback; otherwise stop.
- Failed deterministic gate or rejected review: no publishable pipeline result.

## Open questions

- Real provider auth, subscription automation terms, rate-limit headers, and
  production model IDs remain external evidence owned by `fallrising`.
