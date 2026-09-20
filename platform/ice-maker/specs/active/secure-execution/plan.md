# Secure single-agent execution implementation plan

## Scope and design

Implement the policy/execution primitives first, then bind them to a disposable
worktree and a single Codex adapter, and finally add an orchestrator/publisher
request boundary. External commands are argv arrays; shell strings are never
executed. The integration workflow remains human-triggered and least-privileged.

## Requirement-to-evidence mapping

| Requirement | Change | Verification | Rollback |
|---|---|---|---|
| FR-1, FR-2, FR-5 | contract, bounded process, redaction, path gate | executor unit/security tests | revert T-008 |
| FR-3, FR-4 | worktree, sandbox command, Codex adapter | temporary-Git and adapter contract tests | revert T-009 |
| FR-5, FR-6 | orchestration and publication request | end-to-end synthetic job and workflow policy tests | revert T-010 |

## Risks and dependencies

- Process cleanup races: launch a new session and kill its process group on timeout.
- Path glob ambiguity: normalize Git paths, reject links, and apply forbidden paths before allowlists.
- Secret leakage: redact before truncation and before serialization.
- Docker and self-hosted runner presence are not assumed; command construction is local evidence, while a real sandbox run stays externally pending.

## Migration and rollout

New modules and opt-in workflow only. No existing branch, runner, or credential is
modified. Rollback is deletion/revert of the Phase 2 checkpoint.

## Review gate

The orchestrator reviews every worker diff, reruns focused tests and `make check`,
confirms protected paths only strengthen controls, then records the real runner
and publisher credential as external pending.
