# Agent-Agnostic Continuation State

Updated: 2026-09-24. This file records the verified working state and user instructions so any LLM coding agent can resume without this conversation. Check GitHub and the checkout again before acting; this snapshot can become stale.

## Checkout and PR

- Repository: `fallrising/newclear`; worktree: `/home/ckc/test/codex/newclear-agent-provider-mock-c2b2`.
- Branch: `agent/agent-platform/at-11-c2b2`; snapshot basis before the continuation update: `85d90010af4e5da1ca61b1a5fd759c9fb1ac0c7c`. The follow-up handoff commit `48af9eb` was pushed with `[skip ci]`; verify the actual branch tip with Git before resuming.
- Base last synchronized: `dba9ee94a49bcfe2efb298caa1d5324cfde03988`.
- Draft PR: [#82](https://github.com/fallrising/newclear/pull/82). It is not merged. The last workflow was cancelled; the current handoff-only commit skipped CI, so there are no checks reported for the current head. Do not treat the current PR head as fully green.
- All implementation changes are scoped to `platform/agent-platform`.

## Completed work

AT-11-C2b2 implements the fixed `openai-compatible-https-v1` transport, private file-backed credential and CA references, TLS verification, and profile-pinned verification contracts (`none`, `commands`, `fixture-m2`). Migration 012 allows the new model reference while preserving fixture profiles. No real provider was called and no host provider credential was read. Details and source hashes are in [M3-HTTPS-PROVIDER.md](M3-HTTPS-PROVIDER.md) and [evidence](evidence/m3-https-provider-2026-09-24.json).

The two new dependency-backed Python suites live in `tests_platform`, matching the CI job that installs the locked platform dependencies. The stale Web status assertion was corrected. Local `make platform-check` passed: 45 unit tests, 200 PostgreSQL/HTTP platform tests, and Ruff checks.

## CI status

- Full GitHub Actions run `36008490179` passed all three jobs (`check`, `web`, `control-plane`) on code commit `e099c6e1294a7010d461f5900c467b3bc6cb1110`. It included browser acceptance. Local `web-check` is unavailable because Node/npm is absent.
- A later docs-only push triggered run `36009297291`. At the user's direction, it was cancelled before browser acceptance. The `web` job passed; `check` and `control-plane` were cancelled, and the browser acceptance step was skipped. Follow-up handoff commit `48af9eb` used `[skip ci]`, so no newer workflow was started. Treat the earlier complete run as the last fully green CI result; do not describe the latest run as passed.
- The PR workflow runs browser acceptance on PR updates. Avoid pushing incremental commits to this open PR during development, because each push starts an E2E-bearing workflow. Keep intermediate work local or on a branch without an open PR, then batch the final push and the single final E2E run after development is complete.

## User instructions

- Run E2E tests only once, after overall development is complete. Do not run browser E2E, real-KVM acceptance, or other end-to-end acceptance cases during intermediate development. Ordinary unit and platform checks remain available when useful.
- Keep work agent-agnostic: use the repository handoff and evidence as the shared memory; do not rely on model-specific or conversation-only state.
- Do not use an existing host provider credential or call a paid/external provider without an explicit later opt-in and supplied interface.

## Blocking KVM recovery gate

The C2b2 `mock-https-complete` attempt did not pass. `sandboxd` lacked the required supplementary `kvm` group, `/dev/kvm` returned `EACCES`, and the attempt left one `allocate=started` journal intent without a saved handle, observation, or stop proof. The prior 197 stop proofs remain valid. The attempt's journal row and fence are preserved; post-attempt host VMs and connector claims were zero, but product `drained()` still rejects the unknown allocation.

The repository recovery contract keeps an allocation without handle/VMM ownership quarantined and requires administrator reconciliation. Connector inspect is read-only and returns `allocation_ownership_uncertain`; release requires saved VM observation. No supported same-journal reconciliation command/API for this row was found. Do not rerun KVM, edit/delete the row or fence, change the state directory, lower the generation, or use a direct driver until the user supplies or approves a formal, auditable same-journal recovery procedure. See [M3-RECOVERY.md](M3-RECOVERY.md).

## Resume sequence

1. Read this file, [HANDOFF.md](HANDOFF.md), [NEXT-PROMPT.md](NEXT-PROMPT.md), `SDD.md`, and the referenced provider, model, egress, isolation, and recovery docs.
2. Verify current main, PR #82, CI runs, branch head, and KVM/node state. Do not infer current status from this snapshot.
3. Get the user's formal recovery decision before touching the quarantined KVM journal or running any KVM case.
4. Continue development without E2E. Once the overall development is complete and the recovery gate is resolved, run the E2E acceptance once, collect evidence, then consider merge only if every required gate passes.
