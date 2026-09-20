# dim-gate M1 preflight

Observed 2026-09-20 before M1 product edits or worker dispatch.

- newclear source and target main: `50294b687d06f08e94290f6f327187e8f69248bc`.
- kernel collaboration source: `664d176a07568fc17506185d3b99e7349897ce05`.
- Repositories were accessed by SSH and cloned under `/home/ckc/test/codex`; both remotes remain SSH. The user explicitly replaced the unavailable `/workspace` location with the current workspace.
- The source checkout is clean. The isolated M1 worktree is `/home/ckc/test/codex/newclear-m1` on `agent/dim-gate/mainline/m1-cmdb`, based on `origin/main`.
- All user-required newclear and kernel files were read to EOF. Root/platform AGENTS and override files are absent; `platform/dim-gate/AGENTS.md` applies. PLAN-linked T-001–T-005 tasks, every attempt/canonical report, preflight and commit map were read.
- GitHub PR #7 is MERGED at the target main commit, despite the stale OPEN wording in PLAN/STATUS. Its final head CI run 35514160187 passed. Head and merge have no scoped difference for dim-gate, its ledger or workflow. There is no open PR and no existing M1 branch.
- M0 AC-01–03 remain the accepted historical baseline. T-006 touches architecture paths covered by M0, so the full M0 native/browser regression is mandatory. M1 schema/seed/domain/API/UI changes will require another complete integration run before acceptance.
- Runtime route: current Codex orchestrator and built-in collaboration agents; inherited model ID is not exposed. Codex CLI 0.155.1 and Claude Code 2.1.278 are authenticated, but no model invocation/model ID has yet been verified. OpenCode 1.17.18 exposes configured models. Grok CLI 1.0.34 is installed but authentication/model is unverified. Cursor, Antigravity and actionlint are unavailable at preflight.
- Workspace-local Node 24.18.0 and Corepack pnpm 11.18.0 were prepared; frozen install succeeded with 334 packages and no lockfile change.

Next action: finish and verify T-006, freeze the M1 integration contract, then dispatch bounded feature tasks with disjoint paths.
