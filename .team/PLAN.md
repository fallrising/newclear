# Repository team ledger

此檔保存主控計畫與接受決策；目前只有 dim-gate 試點。其他 program 使用獨立區塊，只有對應 program/variant 的主控可更新本區；worker 只能讀。

## Program: dim-gate / Variant: mainline

### Identity and authority

| 欄位 | 值 |
| --- | --- |
| project_id / variant_id | dim-gate / mainline |
| protocol_version / ledger_revision | 1 / 3 |
| target_repo / target_ref | fallrising/newclear / main |
| parent_variant / fork_commit | none / none |
| active_owner / run_id | Codex / DG-M0-20260920-01 |
| active_work_branch | agent/dim-gate/mainline/m0-foundation |
| source / last_reconciled_target | `1117d297aa3efef9472d847c9dfa5714eb6c4460`, 2026-09-20 |
| source kernel protocol | `7cddad13f965d579b218579609c7f64e1ecf35b2` |
| spec revision | source SDD blobs listed in preflight; this branch additionally records ADR-012–014 and M0 contract revision 2 |
| open implementation PRs at recovery | 0; remote state must be refreshed before continuation |

入口：[DEVELOPMENT_PROMPT](../platform/dim-gate/DEVELOPMENT_PROMPT.md)。規則：[DEVELOPMENT_PROTOCOL](../platform/dim-gate/docs/DEVELOPMENT_PROTOCOL.md)。產品：[SDD](../platform/dim-gate/SDD.md)。摘要：[STATUS](../platform/dim-gate/docs/STATUS.md)。

### Accepted baseline and recovery evidence

- [SDD PR #5](https://github.com/fallrising/newclear/pull/5) merged `746585718429615288c85bf0027ae4a31c13e36b`；[protocol PR #6](https://github.com/fallrising/newclear/pull/6) merged at source main. Both were documentation, not application acceptance.
- [Preflight](reports/dim-gate-m0-preflight.md) records complete mandatory/source-reference reading, exact blob SHAs, branches/worktrees/PR reconciliation and unavailable tools. No implementation task or active owner existed at recovery; the prior documentation checkout was preserved.
- This run selected the earliest unaccepted milestone M0. Only the orchestrator creates commits, pushes, PRs and acceptance decisions. No main writes, force push, merge, deployment, real infrastructure or global setting changes.

### Milestone ledger

| Milestone | Workflow state | Accepted implementation | Integration | Gate |
| --- | --- | --- | --- | --- |
| M0 | RUNNING | none; candidate awaiting fixed-commit gates/review | NOT_OPENED | AC-01–03; native checks, browser and independent review |
| M1 | NOT_STARTED | none | NOT_OPENED | M0; AC-04–08,20 |
| M2 | NOT_STARTED | none | NOT_OPENED | M1; AC-09–12,21–23 |
| M3 | NOT_STARTED | none | NOT_OPENED | M2; AC-13–16,24 |
| M4 | NOT_STARTED | none | NOT_OPENED | M3; AC-17–19,25 |
| M5 | NOT_STARTED | none | NOT_OPENED | M4; AC-26–30 and all regression |

Only [delivery validation](../platform/dim-gate/docs/sdd/07-delivery-validation.md) defines milestone gates. Accepted branch work and merged integration are separate events.

### Task allocation

| Task/revision | AC | Dependencies | Owner/actual route | Attempt/state | Branch | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [T-001](tasks/T-001.md) / 1 | 02/03 | contract rev1 | domain worker / collaboration | 1 / EVALUATING | agent/dim-gate/mainline/t-001 | [report](reports/T-001.md); 45 focused tests; wrapper failure requires native integration gate |
| [T-002](tasks/T-002.md) / 1 | 01/02/03 | rev1, T-001 | transport worker / collaboration | 1 / EVALUATING | agent/dim-gate/mainline/t-002 | [report](reports/T-002.md); 24 focused tests |
| [T-003](tasks/T-003.md) / 1 | 01/02 | rev1, T-002 | UI worker / collaboration | 1 / EVALUATING | agent/dim-gate/mainline/t-003 | [report](reports/T-003.md); 7 focused tests, contrast correction; browser gates owned by lead |
| [T-004](tasks/T-004.md) / 1 | 01/02/03 | fixed integration candidate | independent reviewer / collaboration | 1 / READY | agent/dim-gate/mainline/t-004-review | not dispatched before candidate commit |
| [T-005](tasks/T-005.md) / 1 | 01/02/03 | T-001–004 | orchestrator / local tools | 1 / RUNNING | agent/dim-gate/mainline/m0-foundation | fixed-commit report pending |

Worker original reports remain immutable history; their PARTIAL statuses do not become acceptance automatically. Lead integrated their scoped files, central wire DTO/OpenAPI tooling and the UI contrast fix. Canonical evaluation awaits native checks and review against a committed candidate.

### Routing and bounded loop

Actual lead and workers use the current built-in agent/collaboration tools. Exact model ID is not exposed and is not guessed. Claude, Codex CLI and other external model CLIs were unavailable; T-004 uses a separate fresh-context read-only agent. This is multi-agent execution, not a verified multi-model run. Private kernel skills were fully read as source, not installed and not copied into this public repo.

Maximum three dispatch/evaluate cycles, one same-approach rework. Cycle 1: three isolated bounded implementation workers and lead integration. One precise UI contrast correction was made after real axe evidence. Cycle 2: independent fixed-commit review and any bounded correction. Cycle 3 reserved only for a concrete remaining finding. Workers cannot recurse, commit, push or self-accept.

### Decision history

| Decision | Context | Result |
| --- | --- | --- |
| DG-D001 | SDD exists and resumable entry requested | prompt/protocol/Git ledger; PLAN is authoritative and STATUS summarizes |
| DG-D002 | model availability changes | record actual role/tool/model exposure, never infer unavailable routes |
| DG-D003 | commit, acceptance and merge differ | evidence binds immutable code; remote integration separately reconciled |
| DG-D004 | pinned source is documentation only | start M0, keep M1–M5 unavailable; preserve existing checkout |
| DG-D005 | worker pnpm wrapper tries installation on shared node_modules symlink | focused direct binaries allowed; lead must run prescribed native scripts on a real installation |
| DG-D006 | Playwright CDN download failed; runtime lacked CJK fonts | local Chromium153 bundle and Noto CJK test font used without disabling web security; CI uses standard Playwright browser; results distinguish these environments |

### Resume block

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M0-20260920-01
terminal_state: running
target_ref: main
continuation_ref: agent/dim-gate/mainline/m0-foundation
milestone: M0
task_id: T-005
implementation_commit: candidate-to-be-recorded-after-commit
spec_revision: source-1117d29-plus-branch-ADR-012-014
evidence_refs:
  - .team/reports/dim-gate-m0-preflight.md
  - .team/reports/T-001.md
  - .team/reports/T-002.md
  - .team/reports/T-003.md
integration_state: NOT_OPENED
remote_durability: LOCAL_ONLY
blockers: []
next_action: commit candidate; run clean native gates on that commit; dispatch T-004 once; preserve review and final acceptance before PR completion
```

Existing tasks/branch must be reused after reconciliation; this running checkpoint is not permission to start another competing orchestrator.
