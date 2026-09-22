# Repository team ledger

此檔保存主控計畫與接受決策；目前只有 dim-gate 試點。其他 program 使用獨立區塊，只有對應 program/variant 的主控可更新本區；worker 只能讀。

## Program: dim-gate / Variant: mainline

### Identity and authority

| 欄位 | 值 |
| --- | --- |
| project_id / variant_id | dim-gate / mainline |
| protocol_version / ledger_revision | 1 / 25 |
| target_repo / target_ref | fallrising/newclear / main |
| parent_variant / fork_commit | none / none |
| active_owner / run_id | Codex orchestrator — M4 final metadata-head CI closeout / DG-M4-20260922-01 |
| active_work_branch | agent/dim-gate/mainline/m4-observability |
| source / last_reconciled_target | M4 parent `7d20bbc48a25e82c82c048304da8b74a897ec14e` / SSH-fetched main `eb2023f81d02ad5e9a7419a0b8bf67751e135758`; no affected component/workflow/ledger delta, stacked parent retained |
| source kernel protocol | read pinned `237aa277b0d067f65c8f64f49c6854597f7f8b15`; newer remote HEAD observed, not adopted |
| spec revision | M4 integration contract revision1; final implementation/test candidate `93a4bbc8cafe03588ff8ef12014eeb2523a93de3` |
| open implementation PRs at recovery | Accepted M3 [PR #17](https://github.com/fallrising/newclear/pull/17) OPEN Ready; accepted M4 stacked [PR #20](https://github.com/fallrising/newclear/pull/20) OPEN, final metadata-head CI closeout pending; M0 #7/M1 #11/M2 #13 MERGED |

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
| M2 | ACCEPTED | `513e6cc2f3ff9d1fc8228805c366ce4f9d732925` | MERGED — PR #13, merge `29bed41788a33684f24d216f4fd4d5f3f998c672` | AC-09–12,21–23; independent review, 138 tests, 22 Chromium journeys and post-merge CI passed |
| M3 | ACCEPTED | `04d6646a2a325bb4efc18c44b463e0e6fd1747f3` | OPEN_PR_17_NOT_MERGED | AC-13–16,24; 170 tests, 40 Chromium journeys, independent closure and exact-head CI |
| M4 | ACCEPTED | `93a4bbc8cafe03588ff8ef12014eeb2523a93de3` | OPEN_PR_20_STACKED_NOT_MERGED | AC-17–19,25;207 tests,47 Chromium, independent closure and product-head CI passed |
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
| [T-017](tasks/T-017.md) | M2 integrated review | T-014–016 | independent review + lead | ACCEPTED | agent/dim-gate/mainline/m2-governance | [report](reports/T-017.md); M2 accepted and PR #13 merged |
| [T-018](tasks/T-018.md) / 1 | 13–16/24 domain and integration | merged M2 | orchestrator | 3 / ACCEPTED | agent/dim-gate/mainline/m3-delivery | [report](reports/T-018.md); final `04d6646`, 170 tests, 40 Chromium, review and CI passed |
| [T-019](tasks/T-019.md) / 1 | M3 UI/browser | T-018 contract | bounded isolated worker + lead | integrated / ACCEPTED | agent/dim-gate/task/t019-delivery-ui | [report](reports/T-019.md); original worker preserved, final integration verified at `04d6646` |
| [T-020](tasks/T-020.md) / 3 | independent M3 review | fixed candidate | independent read-only in-environment reviewer | 3 / ACCEPTED | detached 04d6646 | [report](reports/T-020.md); original and adversarial findings closed |

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

DG-D027: ACCEPT M2 AC-09–12 and AC-21–23 at product commit `513e6cc2f3ff9d1fc8228805c366ce4f9d732925`. GitHub Actions run [35590593367](https://github.com/fallrising/newclear/actions/runs/35590593367) passed every gate and 22/22 Chromium journeys on evidence head `3d61cb4e1d64efa348bfbc91f4bcfec435343176`, with browser artifacts preserved. The final independent review has no blocking/high/medium finding. PR #13 is OPEN, Ready for Review, CLEAN and unmerged at this checkpoint; merge remains a separate authorized action after final metadata-head CI.

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
ci_run: https://github.com/fallrising/newclear/actions/runs/35590593367
spec_revision: M2-INTEGRATION-CONTRACT revision 1 at a9e64276273fc3698105c2bf8b0b7bc833444057
evidence_refs:
  - .team/reports/dim-gate-m2-preflight.md
  - .team/reports/T-014.md
  - .team/reports/T-015.md
  - .team/reports/T-016.md
  - .team/reports/T-017.md
integration_state: OPEN_READY_PR_13_NOT_MERGED
remote_durability: T-017 product and evidence head are on the SSH remote branch; exact evidence-head CI 35590593367 passed
blockers: []
next_action: commit and SSH-push acceptance metadata, require final metadata-head CI, then perform the explicitly authorized PR #13 merge without deployment
```

### M3 recovery and execution checkpoint

DG-D028: Reconcile M2 as ACCEPTED and MERGED. PR #13 merged at `29bed41788a33684f24d216f4fd4d5f3f998c672`; metadata CI 35591097020, post-merge CI 35591531196 and mirror 35591531198 passed. Main advanced to `e760d8e988c0e2a837b226c600805a659a362c10` through unrelated agent-platform documentation PR #14. Source and M1/M2 worktrees remain unchanged; the new isolated M3 branch starts here.

DG-D029: User approved the first M3 vertical slice. Freeze [M3 integration contract revision 1](../platform/dim-gate/docs/M3-INTEGRATION-CONTRACT.md) and start [T-018](tasks/T-018.md), then bounded UI and independent review. No unresolved owner decision blocks this slice. Built-in Codex owns implementation and a separate read-only session owns review; exact runtime model IDs are not inferred. Kernel `237aa277b0d067f65c8f64f49c6854597f7f8b15` was read from an isolated SSH sparse checkout; the existing reference remains unchanged at `664d176`.

DG-D030: REWORK candidate `2abbec9` following independent T-020 attempt 1: clock receipt scope leak, impossible persisted scheduler steps, absent per-second playback and premature clock-completion feedback. Lead first reproduced both domain failures; correction `b58298e` passes 170 tests, lint, typecheck and architecture. Initial production M3 Chromium was 7/9, not acceptance. User requested saving progress/new conversation before corrected build/browser/independent re-review; preserve the checkpoint and release active ownership. No M3 PR/CI, merge or deployment is claimed.

The routing and resume sections above for M0–M2 are historical. Current M3 routing: bounded UI worker and fresh independent reviewer through existing collaboration. External Claude preflight succeeded but code transmission was denied; source review did not run there. One initial review completed; its bounded correction exists, and the single same-approach follow-up remains pending.

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M3-20260921-01
terminal_state: null
handoff_reason: user_requested_save_and_new_conversation
active_owner: none
target_ref: main
source_main: e760d8e988c0e2a837b226c600805a659a362c10
last_reconciled_target: aafd24d7e7110454847ef8856bc15cd76626c2c7
continuation_ref: agent/dim-gate/mainline/m3-delivery
milestone: M3
task_id: T-018 / T-019 / T-020
implementation_commit: b58298e9ddc2498830f1fd144277b1c6345359b1
local_tested_commit: b58298e9ddc2498830f1fd144277b1c6345359b1 — unit/lint/typecheck/architecture only
browser_tested_commit: 2abbec9ca4ca812b9be0278e6a5ca14c303c87b9 — 7 passed / 2 failed, not correction evidence
spec_revision: M3-INTEGRATION-CONTRACT revision 1
evidence_refs:
  - .team/reports/T-018.md
  - .team/reports/T-018-attempt-1.md
  - .team/reports/T-019.md
  - .team/reports/T-020.md
  - .team/reports/T-020-attempt-1.md
integration_state: NOT_OPENED
remote_durability: product and containing evidence checkpoint to be SSH-pushed before handoff; verify remote branch tip on resume
blockers: []
next_action: read T-018 checkpoint; add playback/scope browser coverage, rebuild current HEAD with CJK fonts, rerun affected and full gates, then fixed-commit independent follow-up and current-head PR CI
```

### M3 resumed verification run

DG-D031: Resume the user's explicit M3 handoff on 2026-09-21 at clean SSH-durable `24c55944f7f57010c7294df90c4feafb5976e75c`. Remote branch matches; no M3 PR or CI exists. Latest main `7bb80d00d03d93a2d392185adba65588c5fe2462` contains unrelated agent-platform changes and is integrated by a normal merge before validation. Source, accepted, worker and original fixed-review worktrees are preserved, including dirty historical workers. The prior owner explicitly released the variant.

Run DG-M3-20260921-02: lead owns playback/scope/focus Chromium regression and full native gates; a fresh in-environment read-only reviewer will inspect the resulting immutable commit as T-020 attempt 2. Exact inherited model slug is not exposed. No external Claude source transfer. Kernel contract stays pinned at `237aa277b0d067f65c8f64f49c6854597f7f8b15`, re-read locally; newer kernel instructions are not adopted. Three-cycle total budget and one same-approach follow-up remain in force. Required commands: frozen install, lint, typecheck, test, check:docs, check:contracts, check:ci, check:architecture, build --mode demo, test:e2e, actionlint, diff --check. No acceptance until independent review and current-head remote CI pass.

DG-D032: REWORK fixed candidate `f7905bbab0c3032b28387d4596795c3a64800c58` for an additional playback concurrency boundary found during independent T-020 attempt 2. Lead Chromium reproduction delayed delivery of real clock responses by 2500ms without changing response/domain content: pause immediately reopened manual stepping, producing two unsettled clock requests. The prior effect-local cancellation assumption is replaced by persistent in-flight ownership and pending UI state; pause stops scheduling but manual/resume wait for response plus refresh. Contract revision 2 makes this existing no-overlap requirement explicit. This is the third bounded cycle, with an adversarial in-flight regression and new immutable candidate required; do not repeat the earlier review unchanged or accept its green baseline tests.

Third-cycle refinement before final verdict: immutable intermediate `30b8d04a709c5b8f681654402284edbdfeeb9da8` closes same-view pause but independent inspection exposed the hook-remount lifetime boundary. Lead repeated the real-response-delay probe with detail→list→detail; maxPending remained 2. The design now uses the existing shared TanStack Query mutation cache rather than a hook-local ref, covering playback, delivery manual controls and Guide through response plus refresh; timer intent stays view-local. Original fixed review checkouts remain unchanged. Draft PR #17 exists for remote validation, not acceptance.

### M3 pre-acceptance resume block — DG-M3-20260921-02 (historical)

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M3-20260921-02
terminal_state: null
active_owner: Codex orchestrator
target_ref: main
source_main: e760d8e988c0e2a837b226c600805a659a362c10
last_reconciled_target: 7bb80d00d03d93a2d392185adba65588c5fe2462
continuation_ref: agent/dim-gate/mainline/m3-delivery
milestone: M3
task_id: T-018 / T-019 / T-020
implementation_commit: 04d6646a2a325bb4efc18c44b463e0e6fd1747f3
local_tested_commit: 04d6646a2a325bb4efc18c44b463e0e6fd1747f3 — full native gates pass; full Chromium running
spec_revision: M3-INTEGRATION-CONTRACT revision 2
evidence_refs:
  - .team/reports/T-018.md
  - .team/reports/T-018-attempt-2.md
  - .team/reports/T-019-attempt-1.md
  - .team/reports/T-020-attempt-2.md
integration_state: OPEN_DRAFT_PR_17
remote_durability: product candidate verified on SSH remote branch
blockers: []
next_action: await fixed-candidate Chromium, independent third-cycle closure and latest-head CI; then preserve acceptance evidence and wait metadata-head CI without merging
```

DG-D033: ACCEPT M3 AC-13–16 and AC-24. Evaluated implementation `04d6646a2a325bb4efc18c44b463e0e6fd1747f3`; report_ref `.team/reports/T-018-attempt-3.md`; review_ref `.team/reports/T-020-attempt-3.md`. Local 170 tests, all native gates, 40/40 production Chromium journeys and independent no-blocking/high/medium review pass. Exact product-head CI [35637762270](https://github.com/fallrising/newclear/actions/runs/35637762270) passed at synthetic merge `2320eeb2e7a012c9bcf012a591404cb223a5f261`, with browser artifact retained. Latest SSH main `7bb80d0` is integrated. Observation time: 2026-09-21 18:30 UTC. PR #17 is unmerged; evidence metadata and its final head CI remain the administrative closeout, reported on the PR without another self-referential commit. No merge/deployment authorization exists.

### Final M3 acceptance resume block

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M3-20260921-02
terminal_state: null
active_owner: Codex orchestrator — final metadata-head CI closeout
target_ref: main
source_main: e760d8e988c0e2a837b226c600805a659a362c10
last_reconciled_target: 7bb80d00d03d93a2d392185adba65588c5fe2462
continuation_ref: agent/dim-gate/mainline/m3-delivery
milestone: M3 ACCEPTED
task_id: T-018 / T-019 / T-020
implementation_commit: 04d6646a2a325bb4efc18c44b463e0e6fd1747f3
local_tested_commit: 04d6646a2a325bb4efc18c44b463e0e6fd1747f3
browser_tested_commit: 04d6646a2a325bb4efc18c44b463e0e6fd1747f3 — 40/40
ci_tested_merge: 2320eeb2e7a012c9bcf012a591404cb223a5f261
ci_run: https://github.com/fallrising/newclear/actions/runs/35637762270
spec_revision: M3-INTEGRATION-CONTRACT revision 2
evidence_refs:
  - .team/reports/T-018-attempt-3.md
  - .team/reports/T-019.md
  - .team/reports/T-020-attempt-3.md
integration_state: OPEN_PR_17_NOT_MERGED
remote_durability: product is SSH-durable; this evidence checkpoint will be SSH-pushed, with final head and CI recorded on PR 17
blockers: []
next_action: require current evidence-head CI before Ready/handoff; final PR metadata records DONE and released ownership after success, without an infinite self-reference commit; merge requires a separate user instruction
```

### M4 continuation — DG-M4-20260922-01

DG-D034: Reconciled accepted M3 parent PR17, OPEN Ready at7d20bbc, CI35639600714 success and prior owner release recorded on that PR. User authorized continued development and a handoff prompt if needed; no merge/deploy authorization. Start M4 from fixed M3 evidence commit in isolated newclear-m4, stacked branch agent/dim-gate/mainline/m4-observability. Parent PR17 stays unmodified. SSH remote main remains7bb80d0; unrelated agent-platform activity is preserved. Initial worktree HEAD/dirty manifest is /tmp/dim-gate-m4-evidence/initial-worktrees.json (local-only).

[Contract revision1](../platform/dim-gate/docs/M4-INTEGRATION-CONTRACT.md) freezes observation windows/schema, incident threshold/reopen/recovery, scope/read projections and UI exports. Three-cycle maximum and one same-approach rework. Lead owns shared contracts, router/Guide/shell, integration, validation, PLAN and Git. T-021 owns domain/seed/tests in isolated worker worktree; T-022 owns feature UI/client in a disjoint worker worktree; T-023 independent reviewer writes no implementation; T-024 owns delivery. Built-in agents inherit current runtime, exact model slug unavailable; no external Claude transfer and no verified multi-model claim. The unchanged fully read kernel237aa277 contract remains the source; no new kernel update adopted.

| Task | State | Scope | Evidence |
| --- | --- | --- | --- |
| [T-021](tasks/T-021.md) | ACCEPTED at93a4bbc | shared observation/incident domain | [canonical](reports/T-021.md); immutable worker attempt retained |
| [T-022](tasks/T-022.md) | ACCEPTED at93a4bbc | observation/incident/integration UI | [canonical](reports/T-022.md);12 worker tests plus integrated browser evidence |
| [T-023](tasks/T-023.md) | ACCEPTED at93a4bbc | independent read-only review | [final closure](reports/T-023-attempt-3.md) |
| [T-024](tasks/T-024.md) | ACCEPTED; final metadata CI closeout | integration/full gates/Chromium/CI | [canonical](reports/T-024.md);207 tests/47 E2E/current product-head CI |

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M4-20260922-01
terminal_state: null
active_owner: Codex orchestrator
milestone: M4 NOT_ACCEPTED
parent_pr: https://github.com/fallrising/newclear/pull/17
parent_commit: 7d20bbc48a25e82c82c048304da8b74a897ec14e
target_ref: agent/dim-gate/mainline/m3-delivery
continuation_ref: agent/dim-gate/mainline/m4-observability
worktree: /home/ckc/test/codex/newclear-m4
tasks: T-021 / T-022 / T-023 / T-024
spec_revision: M4-INTEGRATION-CONTRACT revision1
integration_state: NOT_OPENED
remote_durability: local contract checkpoint; SSH push required before handoff
next_action: complete domain/UI integration, production Chromium and independent fixed-candidate review; open stacked PR and require current-head CI; no merge/deployment
```

M4 integration checkpoint: frozen install, lint/typecheck, all 207 tests, docs/contracts/CI/architecture gates passed on the integrated local product diff. Full production Chromium and fixed-commit independent review remain pending. Native actionlint was initially invoked with an incorrect relative path; corrected root workflow invocation is required. No acceptance decision.

DG-D035: REWORK first M4 candidate298a563 after actual production Chromium4/7: three provider cases share a test-author Provider selector mismatch; preserved attempt1 artifacts. Independent T-023 static pass found no blocker/high/medium implementation issue. Lead also corrects screenshot-proven toolbar wrapping and extends Guide pending ownership through all projection refresh. Draft stacked PR20 is open; M4 remains NOT_ACCEPTED. This begins bounded validation cycle2; next fixed candidate requires full Chromium and review delta closure.

M4 cycle2 evidence refinement: c0ff3fc provider journeys reached third healthy sample then failed a premature test count during Guide startup; CI35701711435 reproduced a legacy reset test clicking during the correctly extended refresh guard. Preserve T-024-attempt-2; final test-only correction adds retrying Guide count and explicit pending-refresh assertions, without changing product behavior. Third bounded candidate now requires full native/Chromium and current-head CI plus reviewer closure.


DG-D036: ACCEPT M4 AC-17–19/25 at `93a4bbc8cafe03588ff8ef12014eeb2523a93de3`. Local pinned native gates207tests, fresh demo and47/47Chromium passed. Independent T-023 found no blocker/high/medium implementation issue and inspected raw evidence. Exact-head [CI35705801700](https://github.com/fallrising/newclear/actions/runs/35705801700), synthetic merge3a6670352f9e535dd95ff265f39f3b57d4177615, passed207tests/47Chromium and retains artifact10684483634. Report refs: T-024-attempt-3 and T-023-attempt-3. Third validation cycle preserves original failed attempts: test selector/startup synchronization, obsolete center-route assertion, precisely evidenced retired reads, then CI-exposed150mssearch timing. Final deterministic search test holds actual successful Data bytes across persona switching and proves no stale result. No production changes afterc0ff3fc.

M4 now implements RED/trace/log correlation, incident threshold/dedupe/reopen and Ops writes, three minute-spaced recovery samples after successful rollback, scoped integrations/notifications and coherent eight-step Guide. M5 remains NOT_STARTED. The final evidence-only checkpoint requires its own latest-head CI before Ready/owner release; record that closeout on PR20 without another self-referential commit. Accepted/source/worker/review worktrees remain preserved; no merge/deployment.

### Final M4 acceptance resume block

```yaml
project_id: dim-gate
variant_id: mainline
protocol_version: 1
run_id: DG-M4-20260922-01
terminal_state: null
active_owner: Codex orchestrator — final metadata-head CI closeout
milestone: M4 ACCEPTED
parent_pr: https://github.com/fallrising/newclear/pull/17
parent_commit: 7d20bbc48a25e82c82c048304da8b74a897ec14e
last_reconciled_main: eb2023f81d02ad5e9a7419a0b8bf67751e135758
target_ref: agent/dim-gate/mainline/m3-delivery
continuation_ref: agent/dim-gate/mainline/m4-observability
worktree: /home/ckc/test/codex/newclear-m4
task_id: T-021 / T-022 / T-023 / T-024
implementation_commit: 93a4bbc8cafe03588ff8ef12014eeb2523a93de3
local_tested_commit: 93a4bbc8cafe03588ff8ef12014eeb2523a93de3
browser_tested_commit: 93a4bbc8cafe03588ff8ef12014eeb2523a93de3 — 47/47
ci_tested_merge: 3a6670352f9e535dd95ff265f39f3b57d4177615
ci_run: https://github.com/fallrising/newclear/actions/runs/35705801700
spec_revision: M4-INTEGRATION-CONTRACT revision1
evidence_refs:
  - .team/reports/T-021.md
  - .team/reports/T-022.md
  - .team/reports/T-023-attempt-3.md
  - .team/reports/T-024-attempt-3.md
integration_state: OPEN_PR_20_STACKED_NOT_MERGED
remote_durability: product SSH-durable; containing evidence commit is pushed next, latest metadata head/CI and final owner release recorded on PR20
blockers: []
next_action: require latest metadata-head CI, then Ready/DONE/owner release on PR20; next development run follows docs/HANDOFF-M5.md after reconciliation, without auto-merge or deployment
```
