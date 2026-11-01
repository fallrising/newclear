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
| M2-1 | Official Codex route qualification and same Web integration; PR895 merged | FN-02 | done | 2026-11-01T04:27:00Z | 2026-11-01T05:30:52Z | 2026-11-01T05:30:52Z |
| M2-2 | Concurrent workspace denial, cancellation independence and cleanup; PR906 merged | FN-03 | done | 2026-11-01T11:05:00Z | 2026-11-01T11:39:17Z | 2026-11-01T11:39:17Z |


M2 single-route checkpoint2026-11-01T05:10Z: actual Codex Web run142e9aee passed,
fixed-base diff/check/download and cleanup confirmed; see [acceptance](../acceptance/M2-two-vendors.md).
Concurrent FN03 remains pending explicit two-VM approval; no M3 work started.

M2-2 actual pair2026-11-01T11:21:42Z passed, original15min window retained; capacity1 restored.
Fresh independent ACCEPT_M2_LIVE and all three final-head workflows passed.
[PR906](https://github.com/fallrising/newclear/pull/906) merged2026-11-01T11:39:17Z
as `d55db6a9ad4606cd7df30b2bc9411b559d04f75a`; remote product bytes read back equal.
This supersedes the earlier pending-resource checkpoint. Services stopped; no standing URL.
M3/AC05 is not started; T-0442/T-0447 remain in_progress.

## T-0442 M3 — minimum durable intent and restart slice

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M3-D | Durable submit intent, unique AP run/result reference, restart readback and unknown zero-resend; [PR929](https://github.com/fallrising/newclear/pull/929) | AC05 minimum / FN04 slice, CU-M3-01–05 | done | 2026-11-01T14:25:00Z | 2026-11-01T15:06:57Z | 2026-11-01T15:06:57Z |

[Contract](../specs/SPEC-M3-durable-intents.md). Single Ready production task;
does not start FN05 review handoff/FN07 full journey or claim whole M3 complete.

M3-D independently ACCEPT_M3_MINIMUM: actual source2e08fabe, Rust339/Web26,
real Rust/AP restarts and held real202/SIGKILL unknown zero-resend. No new coding/VM.
[Acceptance](../acceptance/M3-durable-intents.md) retains original summary-export failure
and successful read-only reconciliation. PR929 finalhead a73a2c39 required Fanzloud
[CI41319261391](https://github.com/fallrising/newclear/actions/runs/41319261391) and
[contracts41319261482](https://github.com/fallrising/newclear/actions/runs/41319261482)
passed; merged `935ffbc1c717d61864cd32b60f2e2e5452d811b2` at2026-11-01T15:06:57Z.
Remote Fanzloud/AP bytes read back equal. Earlier pending-delivery snapshots are historical.
Only this minimum slice is done; full M3/FN04 events/FN05/FN07 remain open. Services stopped,
no resident URL; unknown intent retained for trusted manual investigation.

## T-0442 M3 fixed-candidate review

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M3-C | Immutable AP candidate inspection/download; [contract](../specs/SPEC-M3-fixed-candidate.md) | FN05 preparation, C01–05 | in_progress | 2026-11-01T15:14:00Z | | 2026-11-01T15:25:00Z |
| M3-R | Actual cross-vendor readonly review; waiting for bounded AP dependency approval under SDD§3 | FN05 | todo | | | 2026-11-01T15:25:00Z |
