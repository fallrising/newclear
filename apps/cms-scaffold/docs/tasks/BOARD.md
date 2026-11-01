# CMS technical tasks

## T-0380

Approved [R2task](../../fe-review/tasks/round2/task.md), fixed R2-AC-5/E.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CMS-FE2-1 | M1/M2 currentroute capture verification (PR589 merged) | R2-AC-5/E | done | 2026-10-24T09:00:28Z | 2026-10-24T09:36:50Z | 2026-10-24T09:38:37Z |

## T-0351 — oldest PR333/334 resume

Approved PP1b source: PR331 / docs/v2/waves/PP1b.md. PP1c stays DRAFT pending review/necessary owner decision.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CMS-R1 | 核對後續更新與現行工具／來源 | AC-04/05 | done | 2026-11-01T11:48:55Z | 2026-11-01T15:08:40Z | 2026-11-01T15:08:40Z |
| CMS-R2 | PP1b native與G07真實初始化／負例 | AC-04 / PP1-AC02/06 | done | 2026-11-01T11:48:55Z | 2026-11-01T15:08:40Z | 2026-11-01T15:08:40Z |
| CMS-R3 | 可信TLS帳號旅程與獨立review | AC-04 / PP1-FM05/06/15 | done | 2026-11-01T11:48:55Z | 2026-11-01T15:08:40Z | 2026-11-01T15:08:40Z |
| CMS-R4 | PP1b CI、正常合併與回讀 | AC-04 delivery | done | 2026-11-01T11:48:55Z | 2026-11-01T15:08:40Z | 2026-11-01T15:08:40Z |
| CMS-R5 | PP1c規格與D01–D03封板提案（等owner批准） | AC-05 design only | in_progress | 2026-11-01T11:48:55Z | — | 2026-11-01T16:03:09Z |
## 2026-11-01 PP1b delivery readback

[PR334](https://github.com/fallrising/newclear/pull/334) merged at2026-11-01T15:08:40Z, commit`2ba3e5629575bed043bb82a5a3e3967e5843895e`. Remote component bytes match reviewed head`a1d285a0237fbac765b4511742f209587b2c2eb5`; the two changed Java hashes equal the exact tested source hashes. [CMS CI](https://github.com/fallrising/newclear/actions/runs/41319005066) (Java/integration/web) and [Project success](https://github.com/fallrising/newclear/actions/runs/41319005360) passed on that head. Root normal merge/readback closes the pending delivery conditions in the [pre-merge runtime report](../../.team/resume-20261101/RUNTIME-REPORT.md) and [T113 review](../../.team/reports/T-113.md); those timestamped reports retain their historical failures and conditions.

PP1b local fresh-init/formal accounts/Q25 is now VERIFIED within its approved local scope:517unit,202PG,672workspace+117helper,93mock and trusted account journey pass. First concurrent integration201/202 publicp95134ms failure is preserved; isolated unchanged suite passes with publicp9552ms against100ms. TrueTTY,SQL rollback semantics,live guard negatives and sameAPI restart20tablehashes are recorded. This does not make overall SUCCESS AC-04/05, full BW6 or PP1 complete: hostrecover-success still needs PP1c matching verified DB+media rollback bundle; formalhost/offsite/upgrade/ops remain open. No usable tag or deployment.

CMS-R5/PR333 remains DRAFT pending owner approval of the concrete shared-v2/local-adapter proposal. D01 physical vectors, D02 full raw receipt, D03 one-use socket/fixture/authdelta are now defined in [the annex](../v2/contracts/PP1c-local-adapters.md);44 cards are split into9/12/9/14 subwaves. Five bounded tool probes and378 structural checks pass; final independent review/CI evidence is maintained in [the current evidence table](../../.team/pp1c-seal-20261101/EVIDENCE.md). No PP1c product/restore execution occurred. T-0351 remains in_progress; owner acceptance is separate. All four owned validation projects are stopped, their data/locks retained, and private evidence is preserved. No oldruntime/volume cleanup occurred.
