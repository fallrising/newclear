# Repository team ledger

此檔保存主控計畫與接受決策；目前只有 dim-gate 試點。其他 program 使用獨立區塊，只有對應 program/variant 的主控可更新本區；worker 只能讀。

## Program: dim-gate / Variant: mainline

### Identity and authority

| 欄位 | 值 |
| --- | --- |
| project_id / variant_id | dim-gate / mainline |
| protocol_version / ledger_revision | 1 / 18 |
| target_repo / target_ref | fallrising/newclear / main |
| parent_variant / fork_commit | none / none |
| active_owner / run_id | Codex orchestrator / DG-M2-20260920-01 |
| active_work_branch | agent/dim-gate/mainline/m2-governance |
| source / last_reconciled_target | M1 source `50294b687d06f08e94290f6f327187e8f69248bc` / reconciled `a5982bf4547bba85429fec50494751562b5fe7c6`, 2026-09-20 |
| source kernel protocol | `664d176a07568fc17506185d3b99e7349897ce05` |
| spec revision | M2 integration contract revision 1; implementation checkpoint `a9e64276273fc3698105c2bf8b0b7bc833444057` |
| open implementation PRs at recovery | Draft PR #13 for M2; M0 PR #7 and M1 PR #11 are merged |

入口：[DEVELOPMENT_PROMPT](../platform/dim-gate/DEVELOPMENT_PROMPT.md)。規則：[DEVELOPMENT_PROTOCOL](../platform/dim-gate/docs/DEVELOPMENT_PROTOCOL.md)。產品：[SDD](../platform/dim-gate/SDD.md)。摘要：[STATUS](../platform/dim-gate/docs/STATUS.md)。

### Accepted baseline and recovery evidence

- [SDD PR #5](https://github.com/fallrising/newclear/pull/5) merged `746585718429615288c85bf0027ae4a31c13e36b`；[protocol PR #6](https://github.com/fallrising/newclear/pull/6) merged at source main. Both were documentation, not application acceptance.
- [Preflight](reports/dim-gate-m0-preflight.md) records complete mandatory/source-reference reading, exact blob SHAs, branches/worktrees/PR reconciliation and unavailable tools. No implementation task or active owner existed at recovery; the prior documentation checkout was preserved.
- This run selected the earliest unaccepted milestone M0. Only the orchestrator creates commits, pushes, PRs and acceptance decisions. No main writes, force push, merge, deployment, real infrastructure or global setting changes.

### Milestone ledger

| Milestone | Workflow state | Accepted implementation | Integration | Gate |
| --- | --- | --- | --- | --- |
| M0 | ACCEPTED | `695e962304276ab80885c985ce0f7287b15b4698` | MERGED — PR #7, merge `50294b687d06f08e94290f6f327187e8f69248bc` | AC-01–03; 82 tests, 7 E2E, independent review and remote CI passed |
| M1 | ACCEPTED | `784f771a040be72fedf2f1521912900990c09dbf` | MERGED — PR #11, merge `b8dae76034caf63bf7d0721cba99a58a0586ae85` | AC-04–08,20; 122 tests, 11 E2E, independent review, synthetic-merge and post-merge CI passed |
| M2 | RUNNING | none | DRAFT PR #13 | T-014 domain/API, T-015 RD/Ops UI and T-016 Admin UI checkpoints accepted; integrated review outstanding; AC-09–12,21–23 |
| M3 | NOT_STARTED | none | NOT_OPENED | M2; AC-13–16,24 |
| M4 | NOT_STARTED | none | NOT_OPENED | M3; AC-17–19,25 |
| M5 | NOT_STARTED | none | NOT_OPENED | M4; AC-26–30 and all regression |

Only [delivery validation](../platform/dim-gate/docs/sdd/07-delivery-validation.md) defines milestone gates. Accepted branch work and merged integration are separate events.

### Task allocation

| Task/revision | AC | Dependencies | Owner/actual route | Attempt/state | Branch | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [T-001](tasks/T-001.md) / 1 | 02/03 | contract rev1 | domain worker / collaboration | 1 / ACCEPTED | agent/dim-gate/mainline/t-001 | [report](reports/T-001.md); 45 focused tests; original wrapper failure resolved by lead/CI native integration gates |
| [T-002](tasks/T-002.md) / 2 | 01/02/03 | rev1, T-001 | transport worker / collaboration | 2 / ACCEPTED | agent/dim-gate/mainline/t-002 | [report](reports/T-002.md); 26 focused tests after precise replay correction |
| [T-003](tasks/T-003.md) / 1 | 01/02 | rev1, T-002 | UI worker / collaboration | 1 / ACCEPTED | agent/dim-gate/mainline/t-003 | [report](reports/T-003.md); 7 focused tests, contrast correction; browser gates owned by lead |
| [T-004](tasks/T-004.md) / 3 | 01/02/03 | fixed integration candidate | independent reviewer / collaboration | 3 / ACCEPTED | agent/dim-gate/mainline/t-004-review | [review](reports/T-004.md); all recorded findings independently closed |
| [T-005](tasks/T-005.md) / 3 | 01/02/03 | T-001–004 | orchestrator / local tools | 3 / ACCEPTED | agent/dim-gate/mainline/m0-foundation | [integration report](reports/T-005.md); native, browser and remote gates passed |
| [T-006](tasks/T-006.md) / 1 | M0 regression / M1 architecture | merged M0 | orchestrator / local tools | 1 / ACCEPTED | agent/dim-gate/mainline/m1-cmdb | [report](reports/T-006.md); behavior-preserving boundaries, 82 tests, 7 E2E |
| [T-007](tasks/T-007.md) / 1 | 04–08/20 domain | T-006 | collaboration worker + lead | 1 / ACCEPTED | agent/dim-gate/task/t007-shared | [report](reports/T-007.md); 60-CI shared domain, 96 tests |
| [T-008](tasks/T-008.md) / 1 | 06/08/20 | T-007 | collaboration worker + lead | 1 / ACCEPTED | agent/dim-gate/task/t008-rd | [report](reports/T-008.md); RD app/environment UI |
| [T-009](tasks/T-009.md) / 1 | 04/05/08 | T-007 | collaboration worker + lead | 1 / ACCEPTED | agent/dim-gate/task/t009-ops | [report](reports/T-009.md); Ops CMDB workflows |
| [T-010](tasks/T-010.md) / 1 | 07/08/20 | T-007 | collaboration worker + lead | 1 / ACCEPTED | agent/dim-gate/task/t010-topology | [report](reports/T-010.md); bounded topology/table |
| [T-011](tasks/T-011.md) / 1 | 04–08/20 integration | T-007–010 | orchestrator / local tools | 1 / SUPERSEDED CANDIDATE | agent/dim-gate/mainline/m1-cmdb | [report](reports/T-011.md); 120-test initial candidate rejected by T-012 attempt 1 |
| [T-012](tasks/T-012.md) / 2 | independent review | T-011 | independent collaboration reviewer | 2 / ACCEPTED | agent/dim-gate/task/t012-review-fix | [review](reports/T-012.md); attempt 1 BLOCKED, attempt 2 closed F-01/F-02 |
| [T-013](tasks/T-013.md) / 1 | final acceptance | T-012 | orchestrator / local tools | 1 / ACCEPTED | agent/dim-gate/mainline/m1-cmdb | [report](reports/T-013.md); PR #11 OPEN and Ready, not merged |
| [T-014](tasks/T-014.md) / 1 | 09–12/21–23 shared domain/API | merged M1 | orchestrator / local tools | 1 / ACCEPTED_CHECKPOINT | agent/dim-gate/mainline/m2-governance | [report](reports/T-014.md); `a9e6427`, 132 tests, 11 production E2E |
| [T-015](tasks/T-015.md) / 1 | 09–12 RD/Ops UI | T-014 | orchestrator / local tools | 1 / ACCEPTED_CHECKPOINT | agent/dim-gate/mainline/m2-governance | [report](reports/T-015.md); `3eaea29`, 135 tests, 14 production E2E |
| [T-016](tasks/T-016.md) / 1 | 21–23 Admin UI | T-015 | orchestrator / local tools | 1 / ACCEPTED_CHECKPOINT | agent/dim-gate/mainline/m2-governance | [report](reports/T-016.md); `f9f1472`, 136 tests, 17 production E2E |

Worker original reports remain immutable history; their PARTIAL statuses do not become acceptance automatically. Lead integrated their scoped files, central wire DTO/OpenAPI tooling and the UI contrast fix. Lead accepts the integrated results at the immutable correction after native checks and independent review; original worker limitations remain preserved.

### Routing and bounded loop

Actual lead and workers use the current built-in agent/collaboration tools. Exact model ID is not exposed and is not guessed. Claude, Codex CLI and other external model CLIs were unavailable; T-004 uses a separate fresh-context read-only agent. This is multi-agent execution, not a verified multi-model run. Private kernel skills were fully read as source, not installed and not copied into this public repo.

Maximum three dispatch/evaluate cycles, one same-approach rework. Cycle 1: three isolated bounded implementation workers and lead integration. One precise UI contrast correction was made after real axe evidence. Cycle 2 attempt 1 independently found F-01 relation-audit disclosure and F-02 seed compatibility; the lead made one bounded correction at `784f771`, and independent attempt 2 closed both. Reserved cycle 3 was not used; no further M1 dispatch remains. Workers cannot recurse, commit, push or self-accept.

### Decision history

| Decision | Context | Result |
| --- | --- | --- |
| DG-D001 | SDD exists and resumable entry requested | prompt/protocol/Git ledger; PLAN is authoritative and STATUS summarizes |
| DG-D002 | model availability changes | record actual role/tool/model exposure, never infer unavailable routes |
| DG-D003 | commit, acceptance and merge differ | evidence binds immutable code; remote integration separately reconciled |
| DG-D004 | pinned source is documentation only | start M0, keep M1–M5 unavailable; preserve existing checkout |
| DG-D005 | worker pnpm wrapper tries installation on shared node_modules symlink | focused direct binaries allowed; lead must run prescribed native scripts on a real installation |
| DG-D006 | Playwright CDN download failed; runtime lacked CJK fonts | local Chromium153 bundle and Noto CJK test font used without disabling web security; CI uses standard Playwright browser; results distinguish these environments |
| DG-D007 | Initial CI green but independent review found stale identity replay, sort drift and EOF whitespace | REWORK; initial evidence cannot accept correction |
| DG-D008 | Immutable correction a608a94; 82 tests, 7 E2E, independent closure, remote CI and updated-main reconciliation passed | ACCEPT M0 AC-01–03; PR remains unmerged; release owner |

### Resume block

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M0-20260920-01
terminal_state: DONE
active_owner: none
target_ref: main
last_reconciled_target: a330237860b3002d68fec3f853a6d1deb44a8e9a
continuation_ref: agent/dim-gate/mainline/m0-foundation
milestone: M0
task_id: T-005
implementation_commit: 695e962304276ab80885c985ce0f7287b15b4698
local_tested_commit: 26827e293c7bfc260ab790cc0696ebc7ce671e87
ci_tested_merge: a38b07292e60aa472bf664303a2fb3c45a1ba510
spec_revision: source-1117d29-plus-branch-ADR-012-014; CI rules reconciled at a330237
evidence_refs:
  - .team/reports/dim-gate-m0-preflight.md
  - .team/reports/T-004.md
  - .team/reports/T-005.md
  - .team/reports/dim-gate-commit-map.md
integration_state: OPEN
remote_durability: implementation verified on remote branch and PR 7; this metadata checkpoint is identified by its containing commit
blockers: []
next_action: review existing PR 7; do not auto-merge. Next development run must reconcile PR/main, preserve accepted M0, and select M1 AC-04–08,20.
```

### Remote and review checkpoint

[PR #7](https://github.com/fallrising/newclear/pull/7) is the sole implementation PR. [Correction CI](https://github.com/fallrising/newclear/actions/runs/35513835780) passed 82 tests and 7 E2E using standard Playwright Chromium. [Independent review](reports/T-004.md) closed the original findings. [Integration evidence](reports/T-005.md) records exact commits, main reconciliation and acceptance limits. Acceptance is not merge or deployment.

Local HTTPS credentials were absent; authorized GitHub Git Data API publication verified exact full trees. [Commit mapping](reports/dim-gate-commit-map.md) preserves recoverable equivalents. Refresh remote branch and PR before continuing; do not create a duplicate M0 task or PR. This final metadata-only checkpoint does not invalidate the accepted product evidence.

### Final checkpoint gate reopened

DG-D009: metadata CI run35513677939 failed dark-theme axe (6/7 E2E); button foreground/background color interpolation briefly falls below contrast limits. M0 acceptance is suspended pending the reserved third-cycle correction, fixed-commit browser revalidation, independent follow-up and new remote CI. Existing tests are unchanged; remove only the button color transition. Resume T-004/T-005, same PR7 draft. Prior accepted evidence remains historical, not a waiver of this failure.

DG-D010: reserved cycle3 closed F-03 by removing only the button color transition, without delays/exclusions or weakened axe checks. Independent attempt3 and CI35513835780 (82 tests,7 E2E) pass. ACCEPT M0 at695e962; no blockers; owner released. Earlier DG-D009 suspension is resolved. Final checkpoint remains metadata-only; PR7 is the sole unmerged delivery.

### M1 recovery and execution checkpoint

- Reconciled 2026-09-20 from clean `origin/main` `50294b687d06f08e94290f6f327187e8f69248bc`; PR #7 is MERGED, not OPEN. Its head `e057a12c54917f18c294cdc13423a2161e23fea2` passed final workflow run 35514160187. The scoped M0 tree is identical between head and merge commit.
- Source kernel `664d176a07568fc17506185d3b99e7349897ce05`; required source files were read, not installed or copied. Primary route is this Codex orchestrator plus bounded collaboration workers; exact inherited model ID is not exposed. External CLIs are recorded in the M1 preflight, but no unverified model is claimed.
- T-006 is ACCEPTED at `49e1b89754421cf0e2f76026416a1af184ceab94`: 82 tests, 7 production E2E and all native/architecture/actionlint gates passed. M1 integration contract revision 1 is fixed at `9ea032f66daabf68350482bfedac81f63e5221ec`.
- Planned bounded tasks: T-007 shared M1 schemas/seed/invariants; T-008 RD application slice; T-009 Ops CMDB slice; T-010 relations/topology slice; T-011 lead integration/search/scope/E2E; T-012 independent fixed-commit review; T-013 final evidence and acceptance. T-008–010 depend on T-006 and T-007. PLAN, route/API/demo composition and final Git integration remain lead-owned.

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M1-20260920-01
terminal_state: running
active_owner: Codex orchestrator
target_ref: main
source_main: 50294b687d06f08e94290f6f327187e8f69248bc
continuation_ref: agent/dim-gate/mainline/m1-cmdb
milestone: M1
task_id: T-008, T-009, T-010
implementation_commit: 888d81203d01aab8781c42ac47138e053bf2c487
spec_revision: M1-INTEGRATION-CONTRACT revision 1 at 9ea032f66daabf68350482bfedac81f63e5221ec
evidence_refs:
  - .team/reports/dim-gate-m1-preflight.md
  - .team/reports/T-006.md
  - .team/reports/T-007.md
integration_state: NOT_OPENED
remote_durability: local branch only until first accepted checkpoint is pushed
blockers: []
next_action: dispatch T-008 RD, T-009 Ops CMDB and T-010 topology in isolated worktrees from accepted T-007; then integrate centrally in T-011
```

DG-D011: ACCEPT T-006 architecture prerequisite at `49e1b89754421cf0e2f76026416a1af184ceab94`. Fresh evidence is 82/82 tests, 7/7 production E2E, frozen install, lint, typecheck, docs, unchanged 72-operation/165-schema OpenAPI, CI policy, feature-boundary check, demo build, actionlint 1.7.12 and diff check. M0 AC-01–03 remain valid on this tree. Freeze M1 integration contract revision 1 at `9ea032f66daabf68350482bfedac81f63e5221ec`; T-007 owns shared contracts/seed/domain, and T-008–T-010 remain blocked on its acceptance. M1 is RUNNING, not ACCEPTED; no M1 PR exists yet.

DG-D012: ACCEPT T-007 shared foundation at `888d81203d01aab8781c42ac47138e053bf2c487`. The orchestrator closed the worker's two expected central needs (M1 POST handler composition and generated OpenAPI) and the full fixed-commit result is 96/96 tests plus 7/7 M0 production E2E and every native/architecture/actionlint gate. Dispatch T-008 RD, T-009 Ops CMDB and T-010 topology from this accepted domain/API/seed base with disjoint file ownership. M1 remains RUNNING and PR #11 remains Draft.

### M1 integrated candidate checkpoint

DG-D013: ACCEPT T-008, T-009 and T-010 only as integrated slices at product/tested commit `9b656f276ef9f5dd3b18f8ca698bea6496751839`; accept T-011 as the review candidate. Evidence is 120/120 tests, 11/11 production E2E, frozen install, lint, typecheck, docs, 72-operation/166-schema contracts, CI/architecture checks, demo build, actionlint and diff check. AC-04–08 and AC-20 pass locally and all seven M0 browser regressions remain valid. M1 itself remains RUNNING: T-012 independent fixed-commit review and current remote synthetic-merge CI are still mandatory. PR #11 is DRAFT and unmerged.

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M1-20260920-01
terminal_state: running
active_owner: Codex orchestrator
target_ref: main
source_main: 50294b687d06f08e94290f6f327187e8f69248bc
last_reconciled_target: 50294b687d06f08e94290f6f327187e8f69248bc
continuation_ref: agent/dim-gate/mainline/m1-cmdb
milestone: M1
task_id: T-012
implementation_commit: 9b656f276ef9f5dd3b18f8ca698bea6496751839
local_tested_commit: 9b656f276ef9f5dd3b18f8ca698bea6496751839
ci_tested_merge: pending current remote CI
spec_revision: M1-INTEGRATION-CONTRACT revision 1 at 9ea032f66daabf68350482bfedac81f63e5221ec
evidence_refs:
  - .team/reports/dim-gate-m1-preflight.md
  - .team/reports/T-006.md
  - .team/reports/T-007.md
  - .team/reports/T-008.md
  - .team/reports/T-009.md
  - .team/reports/T-010.md
  - .team/reports/T-011.md
integration_state: DRAFT_PR_11
remote_durability: product commit awaiting push; prior architecture checkpoint is remote
blockers: []
next_action: commit evidence checkpoint, push over SSH, dispatch T-012 independent fixed-commit review, then reconcile current remote CI and decide T-013 acceptance without merging
```

### M1 final acceptance checkpoint

DG-D014: REJECT the original M1 product candidate `9b656f276ef9f5dd3b18f8ca698bea6496751839` as milestone acceptance evidence after independent T-012 attempt 1 reproduced F-01 deleted relation audit disclosure and F-02 silent M0 persisted-seed reuse. Existing green gates remain historical evidence but cannot waive adversarial failures.

DG-D015: ACCEPT correction and tested product commit `784f771a040be72fedf2f1521912900990c09dbf` for M1 AC-04–08 and AC-20. F-01 is closed by endpoint-preserving historical relation authorization; F-02 is closed by `dim-gate-m1-v1` compatibility with stable-key explicit recovery. Local evidence is 122/122 tests and 11/11 production E2E plus all prescribed gates. Independent T-012 attempt 2 has no blocking finding. GitHub Actions run 35526733678 passed synthetic merge `796960eae34bce6463e921c1b7527ba2da565ebb` whose parents are reconciled target main `a5982bf4547bba85429fec50494751562b5fe7c6` and product head `784f771...`. PR #11 is OPEN and Ready for Review, not merged. No deployment occurred.

DG-D016: PRESERVE M1 acceptance after a fresh production-like headless Chromium walkthrough at metadata head `364b3cc2acc29db90a9c211c1be305f4f6a24445`. Ten browser flows and 24 route/viewport/theme combinations passed, including real UI mutation, topology relation invalidation, AC-20 in-flight switching and historical relation audit, explicit persistence recovery, axe, focus, and overflow checks. All native gates repeated green: 122/122 unit and 11/11 production E2E. The detailed evidence is [the M1 browser walkthrough report](reports/dim-gate-m1-browser-walkthrough.md). This adds evidence only: accepted implementation remains `784f771`; PR #11 remains OPEN / READY / NOT MERGED; no deployment occurred. Current remote main is `c5b26b1ac4c42098f845d23439f4950e461ea1ff`, whose post-reconciliation changes do not touch `platform/dim-gate`.

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M1-20260920-01
terminal_state: DONE
active_owner: none
target_ref: main
source_main: 50294b687d06f08e94290f6f327187e8f69248bc
last_reconciled_target: a5982bf4547bba85429fec50494751562b5fe7c6
continuation_ref: agent/dim-gate/mainline/m1-cmdb
milestone: M1
task_id: T-013
implementation_commit: 784f771a040be72fedf2f1521912900990c09dbf
local_tested_commit: 784f771a040be72fedf2f1521912900990c09dbf
ci_tested_merge: 796960eae34bce6463e921c1b7527ba2da565ebb
ci_run: https://github.com/fallrising/newclear/actions/runs/35526733678
spec_revision: M1-INTEGRATION-CONTRACT revision 2 at 784f771a040be72fedf2f1521912900990c09dbf
evidence_refs:
  - .team/reports/dim-gate-m1-preflight.md
  - .team/reports/T-006.md
  - .team/reports/T-007.md
  - .team/reports/T-008.md
  - .team/reports/T-009.md
  - .team/reports/T-010.md
  - .team/reports/T-011.md
  - .team/reports/T-012-attempt-1.md
  - .team/reports/T-012-attempt-2.md
  - .team/reports/T-012.md
  - .team/reports/T-013.md
integration_state: OPEN_READY_PR_11_NOT_MERGED
remote_durability: accepted product and evidence are on the SSH remote branch; final metadata is identified by its containing commit
blockers: []
remaining_limits:
  - production JavaScript 413.17 kB gzip remains an M5 budget risk
  - reviewer-only targeted Ops browser checks are not repository-persisted
next_action: repository owner reviews PR #11 without automatic merge; before M2, reconcile current main/PR and preserve M1 evidence
```

### M2 recovery and execution checkpoint

DG-D017: Reconciled PR #11 as MERGED at `b8dae76034caf63bf7d0721cba99a58a0586ae85`; post-merge CI run 35531246949 passed. M1 acceptance remains bound to product commit `784f771a040be72fedf2f1521912900990c09dbf`. Start M2 from the merge commit in a new isolated branch; do not modify the accepted M1 worktree or historical worker outputs.

DG-D018: Select T-014 as the first bounded M2 slice and freeze M2 integration contract revision 1. The shared persisted domain/API is implemented before RD/Ops/Admin pages so all centers use the same request, capacity, job, policy and audit state.

DG-D019: ACCEPT T-014 only as the shared domain/API checkpoint at `a9e64276273fc3698105c2bf8b0b7bc833444057`. Local evidence is 132/132 tests, 11/11 production Chromium E2E and every prescribed native/docs/contracts/CI/architecture/actionlint gate. Draft PR #13 carries the SSH-pushed commit and remote run 35534450528 is in progress. M2 remains RUNNING: feature UI, fresh browser acceptance, independent review and successful current-head remote CI are not waived.

DG-D020: Remote run 35534559281 exposed a timing defect in the AC-20 E2E observer: Data search could legally render between observer installation and the later Playwright switch command, before scope transition began. The assertion was not weakened and product delay was not extended. Test-only commit `c35147cba7e6d52343456019e9975b78d9ef2fa3` activates leak recording from the real select change event and proves the old request was pending at that event. The focused race passed 5/5 locally, the full local suite passed 132/132 plus 11/11 E2E, and replacement remote run [35535062404](https://github.com/fallrising/newclear/actions/runs/35535062404) passed every gate. T-014 remains accepted at product commit `a9e6427`; M2 remains RUNNING and PR #13 remains Draft.

DG-D021: ACCEPT T-015 only as the RD/Ops self-service UI checkpoint at `3eaea290de563818af27b240bff73e02f47513d0`. Frozen install, 135/135 tests, all native gates, production build and 14/14 real Chromium journeys passed. AC-09 success and AC-12 failure/retry were operated entirely through visible product controls; capacity, jobs, environment and CI/placement remained API/domain-authoritative. Admin governance UI, independent review and final current-head CI are still required, so M2 remains RUNNING and PR #13 remains Draft.

DG-D022: GitHub Actions run [35548907839](https://github.com/fallrising/newclear/actions/runs/35548907839) passed every gate and 14/14 Chromium journeys on T-015 evidence head `26199b681e9c2fb3f08c78c621c7aa8833d77f43`. This remotely confirms the accepted T-015 slice but does not accept M2; Admin governance UI and independent integrated review remain outstanding.

DG-D023: ACCEPT T-016 only as the Admin governance UI checkpoint at `f9f14727c577b3baea8e0197dc9625bd19c8d76c`. Frozen install, 136/136 tests, all native gates, production build and 17/17 real Chromium journeys passed. AC-21–23 workflows were operated through visible controls at three viewports and both themes with zero axe serious/critical findings and no document overflow. A narrow transport fix preserves the initiating receipt of an already-committed policy mutation while all stale reads remain fail-closed. M2 remains RUNNING pending fixed-commit integrated walkthrough, independent review and current-head remote CI; PR #13 remains Draft.

DG-D024: GitHub Actions run [35550811097](https://github.com/fallrising/newclear/actions/runs/35550811097) passed every gate and 17/17 Chromium journeys on T-016 evidence head `934da677b2771c5a7b80737c32b47d6bc4fe47b3`, with browser artifacts preserved. This remotely confirms the T-016 checkpoint but does not accept M2 or make Draft PR #13 mergeable; integrated fixed-commit walkthrough and independent review remain outstanding.

DG-D025: REJECT integrated candidate `5dd74e8a3f94596be2a1c5abe7b08d1165a437d2` after the independent T-017 review found Admin job-log overreach, planned canonical-identity takeover, non-operable catalog spec governance and first-center-only multi-role navigation. Existing green CI remains historical evidence and cannot waive these findings.

DG-D026: LOCALLY ACCEPT final correction `513e6cc2f3ff9d1fc8228805c366ce4f9d732925` for M2 AC-09–12 and AC-21–23 pending exact-head remote CI. The initial corrections at `83a2e81` closed all four original findings; independent re-review then exposed and the final correction closed the failed-job/pre-retry identity window. Fresh local evidence is 138/138 tests, every native gate, 22/22 production Chromium journeys and a final independent verdict with no blocking/high/medium product finding. M2 remains RUNNING and PR #13 remains Draft until current-head remote CI passes.

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M2-20260920-01
terminal_state: running
active_owner: Codex orchestrator
target_ref: main
source_main: b8dae76034caf63bf7d0721cba99a58a0586ae85
last_reconciled_target: b8dae76034caf63bf7d0721cba99a58a0586ae85
continuation_ref: agent/dim-gate/mainline/m2-governance
milestone: M2
task_id: T-017 integrated M2 walkthrough, adversarial correction and final review
implementation_commit: 513e6cc2f3ff9d1fc8228805c366ce4f9d732925
local_tested_commit: 513e6cc2f3ff9d1fc8228805c366ce4f9d732925
ci_tested_merge: none
ci_run: https://github.com/fallrising/newclear/actions/runs/35550811097
spec_revision: M2-INTEGRATION-CONTRACT revision 1 at a9e64276273fc3698105c2bf8b0b7bc833444057
evidence_refs:
  - .team/reports/dim-gate-m2-preflight.md
  - .team/reports/T-014.md
  - .team/reports/T-015.md
  - .team/reports/T-016.md
  - .team/reports/T-017.md
integration_state: DRAFT_PR_13
remote_durability: T-016 is remote and green; T-017 product/evidence commits await SSH push and exact-head CI
blockers: []
next_action: commit and SSH-push T-017 evidence, wait for exact-head remote CI, then decide final M2 acceptance and PR #13 readiness
```
