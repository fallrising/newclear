# ADR-0001: Local-First Runtime Defaults

- Status: Accepted for Phase 0–1; reversible before production deployment
- Date: 2026-09-02
- Owner: repository owner (`fallrising`)
- Scope: development and locally testable phase gates

## Context

The approved full-build specification requires deterministic offline tests, while
the repository has no supplied production VPS or runner-registration evidence.
Phase 0–1 must therefore remain useful without external infrastructure.

## Decision

- Implement the control plane and CLI in Python 3.11, preferring the standard
  library and existing repository tools. Any production dependency requires a
  recorded necessity, license, and supply-chain review.
- Use a local process/container boundary and a fresh isolated worktree per job.
  Jobs are bounded by timeout, output, resource, retry, and cost limits; cleanup
  is explicit and failed jobs cannot reuse a prior workspace.
- Treat the local runner as a development substitute, not evidence of a
  registered self-hosted runner. Production requires a repo-scoped runner,
  disposable sandbox, protected-path enforcement, and a rebuild/compromise drill.
- Keep network access deny-by-default in runner jobs. Provider, package registry,
  and GitHub endpoints must be explicitly allowlisted when a local test needs
  them.

## Security and credential boundary

Runner jobs receive no production credentials. Provider credentials, when needed,
are injected only at the adapter boundary, never written to prompts, logs,
worktrees, or caches, and are short-lived where the eventual provider supports
that mechanism. A credential is never recovered from a log or cache on resume.

## External evidence gates

The following are `pending`, not passed: VPS OS and tenancy decision; runner
registration and isolation proof; rootless container/runtime configuration;
network egress enforcement; backup/restore and credential-rotation evidence; and
runner compromise/rebuild evidence. Missing evidence permits local development
only and prevents a `PRODUCTION_READY` claim.

## Consequences

Local implementation can proceed and be tested offline. Moving to production may
require an adapter/configuration change after the infrastructure gates are
supplied; that change must not weaken the isolation or credential controls above.
