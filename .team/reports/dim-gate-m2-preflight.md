# dim-gate M2 preflight

STATUS: PARTIAL

## Recovery facts

- Reconciled target: GitHub `main` and `origin/main` at merge commit `b8dae76034caf63bf7d0721cba99a58a0586ae85`.
- M1: AC-04–08 and AC-20 ACCEPTED; PR #11 MERGED; post-merge CI run 35531246949 passed.
- M2 branch/worktree: `agent/dim-gate/mainline/m2-governance` at `/home/ckc/test/codex/newclear-m2`, created from the fixed target commit.
- No open PR and no pre-existing M2 remote branch were present at recovery.
- Existing M1 source and worker worktrees were inspected and preserved. Historical worker worktrees contain their original uncommitted outputs and were not cleaned, reset or reused.
- Kernel remote main resolved to `52fea3a4fc732374c1fa81d15f9bb0486a279fe2`; required collaboration/UI contract paths have no diff from the previously read `664d176a07568fc17506185d3b99e7349897ce05`. The read-only kernel worktree remains at the earlier commit and was not checked out or modified.

## Runtime and baseline

- Runtime: workspace toolchain Node 24.18.0 and Corepack pnpm 11.18.0.
- `pnpm install --frozen-lockfile` — passed.
- Merged-base `pnpm test` — 122/122 passed.

## Selected work

M2 is the earliest unaccepted milestone. T-014 owns the shared domain/API contract; feature UI and final browser/review gates remain separate follow-up tasks. The implementation must preserve all M1 scope-isolation and persistence behavior.

## Current limitations

- M2 is RUNNING, not accepted or integrated.
- No M2 PR exists yet; durability is local until a tested checkpoint is committed and pushed.
- Production JavaScript remains approximately 413.17 kB gzip, a future M5 budget risk.
