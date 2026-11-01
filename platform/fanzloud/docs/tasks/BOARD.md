# Fanzloud task board

## T-0380 FE round2

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FE2-14 | T006R approved M1–M3 delivered ([R2 report](../../fe-review/tasks/round2/report.md); [ACCEPT-T006R](../acceptance/T006R.acceptance.md)); targets verified | R2-AC-14/E | done | 2026-10-24T12:23:53Z | 2026-10-29T16:42:19Z | 2026-10-29T16:42:19Z |

## T-0442 P0 browser-to-Cloud mainline

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T008-FAKE | Actual Chromium → production Rust → T007 fake executable → displayed diff; [PR807](https://github.com/fallrising/newclear/pull/807) / [evidence](../acceptance/T008.acceptance.md) | AC-01 | done | 2026-10-30T03:16:17Z | 2026-10-30T03:39:51Z | 2026-10-30T03:39:51Z |
| T008-LIVE | Private login ready; CLI catalog empty; live not run, Cloud retries paused by owner rebaseline | AC-04 | in_progress | 2026-10-30T03:16:17Z | | 2026-10-30T03:39:51Z |

## T-0442 主線重校（2026-10-31）

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| D0 | [SDD](../../SDD.md)／ADR-0008，Codex＋Claude Code 文件核對；owner 已於2026-10-31批准；PR849 merged | FN-01–07（規劃；全部 NOT_RUN） | done | 2026-10-31T12:26:30Z | 2026-10-31T17:52:46Z | 2026-10-31T17:52:46Z |

M1–M3 固定見 SDD；M1 qualification 已開始，不再擴張舊 Cloud 或原生 actor 子任務。D0 時間為文件記帳 checkpoint；實際審查耗時見 review receipt。

## T-0442 M1 qualification

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M1-Q | [有界 route qualification](../acceptance/M1-qualification.md)：Q1–Q3 completed through approved T-0447; actual Web task passed; PR885 merged; M2/M3 remain open | FN-01/03/06 prerequisites | done | 2026-10-31T17:55:49Z | 2026-10-31T19:40:53Z | 2026-10-31T19:40:53Z |

## T-0442 — M1 isolated Web after T-0447 EX02

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0442.M1 | Real Rust→AP→isolated subscription task→browser diff | M1-WEB01–06, EX03/FN-06 | done | 2026-10-31T19:06:00Z | 2026-10-31T19:40:53Z | 2026-10-31T19:40:53Z |

Single Ready Fanzloud production task; [contract](../specs/SPEC-M1-isolated-web.md).
No Cloud catalog investigation, UI redesign or new milestone.

## T-0442 M2 — second vendor and isolated tasks

| ID | 任務 | 對應AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M2-1 | Official Codex route qualification and same Web integration | FN-02 | in_progress | 2026-11-01T04:27:00Z | — | 2026-11-01T04:27:00Z |
| M2-2 | Concurrent workspace denial, cancellation independence and cleanup; resource approval pending | FN-03 | todo | — | — | 2026-11-01T04:27:00Z |
