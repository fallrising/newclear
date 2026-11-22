# Ice Maker technical tasks

## T-0383 — Grok review boundary

Requirement: [desk T-0383](https://github.com/fallrising/desk/tree/main/tasks/T-0383-grok-review-boundary). Scope: [SUCCESS](../../SUCCESS.md#t-0383-grok-review-boundary-documentation).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| GD-01 | Explain actual Grok flags and the external OS isolation gate | AC-04 documentation only | done | 2026-10-24T06:28:21Z | 2026-10-24T06:33:09Z | 2026-10-24T06:33:09Z |

Completing this documentation does not satisfy AC-04 live external acceptance.

Documentation delivered by [PR #582](https://github.com/fallrising/newclear/pull/582); AC-04 runtime acceptance remains pending.

## T-0380

Approved [task](../../fe-review/tasks/round2/task.md), R2-AC-6/E.

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| ICE-FE2-1 | M1–M4 syntheticfixture andinlineUI (PR590 merged) | R2-AC-6/E | done | 2026-10-24T09:17:52Z | 2026-10-24T09:49:41Z | 2026-10-24T09:51:27Z |

## P03 — Portfolio OCR comparison

Owner continuation 2026-11-22；[任務](P03.md)。僅文件對照，無 parser／服務遷移。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P03 | 比較既有OCR與HTTP服務，保存原證據／缺口 | P03-01–04 | done | 2026-11-22T13:04:51Z | 2026-11-22T13:14:16Z | 2026-11-22T13:14:58Z |

文件已由[PR #1060](https://github.com/fallrising/newclear/pull/1060)交付，merge `3fa11920ca2d1eb72504c078c1703436db1ea74e`；
候選 `a0142467b411c98b8fc5750fa30dc9478475a160` 的 [Ice Maker CI](https://github.com/fallrising/newclear/actions/runs/45026298573)／[contracts](https://github.com/fallrising/newclear/actions/runs/45026298585)、
[獨立審查](https://github.com/fallrising/newclear/pull/1060#issuecomment-7079659452)與遠端原元件逐byte回讀通過。
P03-01–04僅文件交付；原產品AC／external gates仍未完成，不代表owner整體portfolio驗收。
