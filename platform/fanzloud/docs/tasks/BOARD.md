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
| M3-C | Immutable AP candidate inspection/download; [contract](../specs/SPEC-M3-fixed-candidate.md) | FN05 preparation, C01–05 | done | 2026-11-01T15:14:00Z | 2026-11-01T15:47:06Z | 2026-11-01T15:47:06Z |
| M3-R | Actual cross-vendor readonly review; source865ed05e passed, independent accepted; PR952 merged and remotely verified | FN05 | done | 2026-11-01T16:40:00Z | 2026-11-01T17:25:32.944657+00:00 | 2026-11-01T17:25:32.944657+00:00 |

M3-C independently ACCEPT_FIXED_CANDIDATE_C01_C05; [PR941](https://github.com/fallrising/newclear/pull/941)
merged2026-11-01T15:47:06Z as `c7dfdde57c017ea254eb9effa670e7788339bc4b`.
Finalhead d270cb96 Fanzloud CI41322589761 and contracts41322589743 passed;
remote Fanzloud/AP bytes read back equal. Actual source4fa2f781, Web33,
two real Chromium contexts downloaded the same verified1932-byte archive;
zero new task/coding/VM. [Acceptance](../acceptance/M3-fixed-candidate.md).
Historical candidate-only checkpoint: T-0449 then awaited approval; approved actual checkpoint below supersedes it. Services stopped; no resident URL.

## T-0449 approved readonly review dependency

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FN05-R | AP readonly admission/tools/result and same-Web explicit handoff | R01–05 / CU-M3-R01–04 | done | 2026-11-01T16:44:02Z | 2026-11-01T17:25:32.944657+00:00 | 2026-11-01T17:25:32.944657+00:00 |

PR952 merged as `a69ff34ec173ee36284aceebcb417e560438569c` after finalhead967727b2 passed AP41330719757/Fanz41330719768/contracts41330719829; remote Fanzloud/AP bytes read back equal. Bounded FN05-R done; completeM3/FN07 remains open.

## T-0442 M3 original-installation recovery

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M3-U | Saved reviewed gate source snapshot; 等owner重啟後重新核對操作前置 | FN04/FN07, U01–07 | in_progress | 2026-11-02T11:16:02Z | — | 2026-11-06T15:19:05Z |

Original SQLite now positively confirmed; U01–06 and automated U07 independently
accepted on86350871/PR983. Same-Web Claude→Codex first-roundaccept, exact restart
archives;2CLI/41.06s, zeroVM/claims/cgroups/reservations and services stopped.
Owner operation confirmation still pending, so M3-U/fullM3/FN07 stays in_progress.
[Actual evidence](../acceptance/M3-reconciliation.md); no window reset or oldM2 rerun.

PR983 merged2026-11-02T13:18:13Z as `d0dfb3622bd4cf59793b79448c7b4be55c3b3e7d`; finalheadfcf5c3fe Fanz41450718479/AP41450718688/contracts41450718458 allpassed, remote component bytes equal. M3-U stays in_progress for owner confirmation; bounded AP FN04-U dependency done.

2026-11-02 owner-preparation checkpoint: [steps and FN07 clause mapping](../acceptance/M3-owner-operation.md).
M3-U remains in_progress（等owner在場／窗口選擇與本人操作；不算無心跳卡住）。
Offline4confirmed/0unknown and226hashes verified. Zero services/CLI/VM starts;
proposed10min read-only access is partial human confirmation only; proposed15min
owner submit/review alternative still needs explicit authorization. No new milestone.

2026-11-02 owner現在可操作；M3-U續作10分鐘／零新CLI/VM只讀確認入口，私人有限gate先離線驗證與獨立審查；等私人連線／TLS就緒再開始，未開窗口、不改完整FN07條款。

## Portfolio entry comparison — owner direct request

[Issue #1047](https://github.com/fallrising/newclear/issues/1047), [task](FZ-ENTRY-MAP.task.md).
Documentation only; original product AC and M3-U status unchanged.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FZ-ENTRY-MAP | Six-journey Fanzloud/AP/Office capability and authority comparison | E01–E05 | done | 2026-11-16T17:09:10Z | 2026-11-16T17:19:02Z | 2026-11-16T17:19:55Z |

FZ-ENTRY-MAP delivery: [PR #1048](https://github.com/fallrising/newclear/pull/1048)
merged at `2026-11-16T17:19:02Z` as
`4d0c37593cf0c187331b7c21ddb65df8fdd84839`. Final reviewed head
`d1410c5396d1191f6042a69c032e5a7803281184` passed
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/43916601688) and
[Project success contracts](https://github.com/fallrising/newclear/actions/runs/43916601795).
All six changed files were read back from the merged SHA through GitHub and their
Git blob hashes matched the reviewed local files. Independent fresh-context review:
ACCEPT_DOCUMENT, no blockers; E01–E04 and local scoped contracts/links/whitespace
passed. This delivery record closes the E05 CI/merge/readback gates and supersedes
the pre-merge pending delivery/status snapshots in the task and acceptance files.
The required board-only closure PR preserves those snapshots rather than rewriting
review history. Only this document slice is done; original M3-U/FN07, Cloud AC04/full
AC05 and Office MVP/AC11 remain incomplete. No runtime, live window, new model call,
release, deployment, entry removal or authority migration occurred.

Next: use the comparison when choosing a named read-only navigation consumer; do
not treat the proposal as an implemented route or automatically start a new product
milestone. No owner operation is needed to close this documentation task.


## P01 — 既有入口對照補充（owner 直接指示）

[任務](P01.task.md)。沿用 PR1048 的既有文件，補原 AC／M4／精確對帳，不是原 M1–M3 新增產品前置。

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P01-01 | 既有六項入口補原 AC 索引與完整 M4 | P01-01 | done | 2026-11-16T17:11:25Z | 2026-11-16T17:30:33Z | 2026-11-16T17:31:14Z |
| P01-02 | 單一執行權威與 unknown／session／cancel 語義 | P01-02 | done | 2026-11-16T17:11:25Z | 2026-11-16T17:30:33Z | 2026-11-16T17:31:14Z |
| P01-03 | 原主線保留、文件驗證與正常交付 | P01-03 | done | 2026-11-16T17:11:25Z | 2026-11-16T17:30:33Z | 2026-11-16T17:31:14Z |

P01 結案：[PR1049](https://github.com/fallrising/newclear/pull/1049) 於
2026-11-16T17:30:33Z 正常合併為 `90f710cf8421490ab3bba6a323ea85dfe29eed7c`。
最終 head `413481b5b348f39a343f223249c0938cc0ca2dad` 的
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/43918579084) 與
[Project success contracts](https://github.com/fallrising/newclear/actions/runs/43918579104)
均 success。Fetch 後核對 merge 為遠端 main 祖先，整個 Fanzloud 元件與候選 diff 為零。
本地55 project contracts／9 llms、26固定來源、11新增相對連結、六檔範圍與
staged whitespace 通過；獨立初審／既有文件比較／補充覆核後接受。

沿用 PR1048 的唯一對照，只補26行原 AC 索引、完整 AP M4 與精確 unknown GET
對帳；重複 crosswalk 已撤回，PR1051 的原結案紀錄完整保留。
[任務](P01.task.md)與[驗收](../acceptance/P01.acceptance.md)中 pre-merge
交付待辦由本紀錄更新；原 FN07／M3-U、Cloud AC04、AP M4、Office MVP 不改狀態。
沒有新 runtime、provider、VM、release、deploy 或下一里程碑。

## T-1055 FZ-NAV-01

[Task T047](T047.task.md), [issue1055](https://github.com/fallrising/newclear/issues/1055).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| NAV-01 | Find original result instructions | N01 | done | 2026-11-22T11:50:22Z | 2026-11-22T12:06:36Z | 2026-11-22T12:08:29Z |
| NAV-02 | Private-safe read-only links | N02 | done | 2026-11-22T11:50:22Z | 2026-11-22T12:06:36Z | 2026-11-22T12:08:29Z |
| NAV-03 | Browser and existing regression checks | N03 | done | 2026-11-22T11:50:22Z | 2026-11-22T12:06:36Z | 2026-11-22T12:08:29Z |
| NAV-04 | Review and normal PR delivery | N04 | done | 2026-11-22T11:50:22Z | 2026-11-22T12:06:36Z | 2026-11-22T12:08:29Z |

FZ-NAV-01 source delivered: [PR1057](https://github.com/fallrising/newclear/pull/1057)
merged normally at 2026-11-22T12:06:36Z as
`5e5ed8aa05f3eea32c5aea2367776aa7e463744b`.
Final head `4da7fc459c3f43e2d2af772f913390aab1be5952` passed
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/45020372774)
and [Project success contracts](https://github.com/fallrising/newclear/actions/runs/45020372730).
Fanzloud steps include the 43 Web tests, offline parser tests, pinned Rust fmt/clippy,
workspace tests and application build. Independent fresh-context source review ACCEPT;
[acceptance and limitations](../acceptance/T047.acceptance.md) retain actual browser
receipt, source hashes, screenshots, commands and earlier harness/environment failures.

Remote readback in the target repository passed: fetch main, merge ancestry, and
`git diff --exit-code 4da7fc459c3f43e2d2af772f913390aab1be5952 origin/main -- platform/fanzloud`
returned zero at the merge above. An initial readback was accidentally invoked from the
outer workspace repository and rejected the unknown commit; it changed no working files.
The corrected target-repository check supplies the evidence, not that failed attempt.
Local checks passed: 55 project contracts / 9 llms, staged whitespace and aligned index,
15-file scope, 158 relative links, baseline target paths and all five receipt hashes.

This post-merge board-only record supersedes the task/README/SUCCESS/acceptance's
pre-merge CI/delivery-pending notes. N01–04 are delivered; the minimal optional navigation
opens only public instructions. Browser evidence uses synthetic session/503 responses and
intercepted document responses; no live Rust/AP/provider or owner acceptance is inferred.
FN07/full M3, Cloud AC04/P1 AC05, AP M4, Office MVP, mainline incomplete and usable_tag none
remain unchanged. No release, deployment, service window or next milestone is started.

Focused independent board-only review: ACCEPT; prior rows, exact merge metadata,
component source identity, scope and original gaps preserved. Reviewer reran indexes
and whitespace; final closeout PR CI/merge/readback remain delivery gates.

## FZ-OFFICE-NAV — owner private-navigation continuation

[Task/lead](FZ-OFFICE-NAV.task.md), [verified gap and proposal](../plans/office-private-navigation-gap.md),
[evidence](../acceptance/FZ-OFFICE-NAV.acceptance.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| FZ-OFFICE-NAV | Private Office result navigation; owner resumed source UI integration, see normative spec | N01–N05 bounded source feature | done | 2026-11-22T13:04:13Z | 2026-11-22T14:06:45Z | 2026-11-22T14:07:44Z |

PR1057/1058 already completed instruction navigation. This task does not repeat it
or mark direct private access passed. Office local snapshot/loopback console exist;
a usable private result-page locator and fresh-tab access contract are unverified.
Dependent implementation stops under the owner's explicit insufficient-contract
fallback. No deployment, credential change or Office T29 work is started. The
feature remains open after gap-report delivery; only resume from the linked task
when the concrete destination contract is available. Original rows/AC stay unchanged.

## T-1059 T048 diff download lifecycle

[Task T048](T048.task.md), [issue1059](https://github.com/fallrising/newclear/issues/1059).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| DIFF-01 | Auth and selection invalidation | D01 | done | 2026-11-22T13:03:55Z | 2026-11-22T13:18:43Z | 2026-11-22T13:20:22Z |
| DIFF-02 | Current bytes and stale errors | D02 | done | 2026-11-22T13:03:55Z | 2026-11-22T13:18:43Z | 2026-11-22T13:20:22Z |
| DIFF-03 | Regression and browser evidence | D03 | done | 2026-11-22T13:03:55Z | 2026-11-22T13:18:43Z | 2026-11-22T13:20:22Z |
| DIFF-04 | Review and normal delivery | D04 | done | 2026-11-22T13:03:55Z | 2026-11-22T13:18:43Z | 2026-11-22T13:20:22Z |

T048 delivered: [PR1062](https://github.com/fallrising/newclear/pull/1062) merged normally
at 2026-11-22T13:18:43Z as `327d26afe636b4294758df83c98176f7597a6d2c`.
Final head `e6e7c38c07373e6c8210ab21f1c455244c8a69be` passed
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/45026495375) and
[Project success contracts](https://github.com/fallrising/newclear/actions/runs/45026495343).
Native CI includes 49 Web tests, offline parser tests, Rust fmt/clippy/workspace tests
and application build. Fresh-context source and focused integration reviews ACCEPT;
[acceptance](../acceptance/T048.acceptance.md) preserves RED44/5 → GREEN49/0/0,
Chromium held-response/native-download receipts, source hashes and earlier failed attempts.

Remote readback passed in newclear: fetch main, merge ancestry and
`git diff --exit-code e6e7c38c07373e6c8210ab21f1c455244c8a69be origin/main -- platform/fanzloud`
returned zero at the merge above. Required local indexes (55 projects / 9 llms), staged
whitespace and alignment passed; 13-path scope, links and receipt hashes were verified.
Parallel PR1061 was integrated by normal merge: its entire BOARD and three Office docs
remain intact; its in_progress / N01–N05 NOT_RUN feature is not closed by T048.

This post-merge record supersedes T048's pre-merge CI/delivery-pending notes. D01–04
are delivered as a bounded original diff-handler correction. Browser sessions/results
are synthetic; no live Rust/AP/provider/owner operation is claimed. Original full FN07/M3,
Cloud AC04/P1 AC05, AP M4 and Office MVP remain incomplete, usable_tag none unchanged.
No release, deployment, service window or further product milestone is started.

Focused board-only review ACCEPT: prior rows preserved, exact merge ancestry/component
bytes checked, 55/9 indexes and staged whitespace/alignment passed. Final closure PR
CI/merge/readback remain the last delivery gates.

FZ-OFFICE-NAV continuation: owner explicitly resumed development after PR1061.
[Current contract](../specs/SPEC-FZ-OFFICE-NAV.md) adds no endpoint/service; the
prior gap-report record remains historical. Feature stays in_progress pending
independent review and delivery; actual browser/source checks passed locally. Office T29 and
T048 are separate; no provider run, deployment or original AC change.

## T-1065 T049 run observation ordering

[Task T049](T049.task.md), [issue1065](https://github.com/fallrising/newclear/issues/1065).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| OBS-01 | Current observation and login | O01 | done | 2026-11-22T13:45:15Z | 2026-11-22T13:57:35Z | 2026-11-22T13:59:43Z |
| OBS-02 | Stale errors, fallback and timers | O02 | done | 2026-11-22T13:45:15Z | 2026-11-22T13:57:35Z | 2026-11-22T13:59:43Z |
| OBS-03 | Regression and browser evidence | O03 | done | 2026-11-22T13:45:15Z | 2026-11-22T13:57:35Z | 2026-11-22T13:59:43Z |
| OBS-04 | Design review and delivery | O04 | done | 2026-11-22T13:45:15Z | 2026-11-22T13:57:35Z | 2026-11-22T13:59:43Z |

T049 delivered: [PR1068](https://github.com/fallrising/newclear/pull/1068) merged normally
at 2026-11-22T13:57:35Z as `1c0483e86a825d764aed6356312cee1ff26ac3a4`.
Final head `52707d5fe5b14f231c0ce900c947d591d7dfcf2d` passed
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/45029941570) and
[Project success contracts](https://github.com/fallrising/newclear/actions/runs/45029941484).
Hosted Fanzloud includes57 Web tests,offline parser,Rust fmt/clippy/workspace tests and
application build. Fresh-context implementation review ACCEPT; independent57/57 Web,
55project/9llms indexes,inspector syntax,whitespace/alignment and receipt hashes passed.
[Acceptance](../acceptance/T049.acceptance.md) retains corrected-fixture RED50/7 →
GREEN57/0/0,eight actual Chromium synthetic scenarios and synchronization history.

Remote readback passed in newclear: fetch main,merge ancestry and
`git diff --exit-code 52707d5fe5b14f231c0ce900c947d591d7dfcf2d origin/main -- platform/fanzloud`
returned zero at the merge above. Local scope/link/hash checks passed14allowed paths,
181relative Markdown links and five asset/inspector hashes. Intervening Office/cloud-lab
updates did not change Fanzloud; all parallel content and previous BOARD rows remain.

Optional Claude Code consultation was attempted once and remains **auth_failed**:
expired OAuth could not refresh; no design answer or model identity observed. It is not
counted as Claude approval. Required native source acceptance was separate and passed;
no authentication/settings change,retry or substituted provider call occurred.

This post-merge record supersedes T049's pre-merge CI/delivery-pending notes. Required
O01–04 are delivered; optional Claude confirmation remains unavailable. Shared API401,
other asynchronous page lifecycles and backend consistency remain outside this repair.
Synthetic sessions/results do not establish live Rust/AP/provider/owner acceptance.
Full FN07/M3,Cloud/P1,AP M4,Office MVP and Office-navigation gap remain as tracked in their
own contracts; usable_tag none unchanged. No deployment,service window or next milestone.

Focused board-only review ACCEPT: previous rows retained,merge ancestry/component bytes
verified,55/9indexes and whitespace/alignment passed. Optional Claude failure remains
explicit. Final closure PR CI/merge/readback are the last delivery gates.

## FZ-OFFICE-NAV delivery closeout

[PR #1071](https://github.com/fallrising/newclear/pull/1071) merged normally at
`2026-11-22T14:06:45Z`, merge SHA `4dce076bde64549190b87ac836573b2c24bfad3f`.
Candidate `770418428f15d2ae56159e22e6c93ef30e3fc90a`; all required CI passed:
[Fanzloud](https://github.com/fallrising/newclear/actions/runs/45030754158),
[Office](https://github.com/fallrising/newclear/actions/runs/45030754209),
[contracts](https://github.com/fallrising/newclear/actions/runs/45030754188).
Fetched remote main and verified that the merge SHA is its ancestor. All 26
changed files other than Fanzloud BOARD are byte-identical to the tested candidate;
Fanzloud BOARD additionally preserves
upstream T049/PR1070 closure. No conflict or protection bypass.

Lead evidence gate: **ACCEPTED for N01–N05 bounded source feature**. Local 224 Office
Python / 74 Office Node, integrated 65 Node (59 Fanzloud +6 Office navigation),
publication218, indexes55/9, staged whitespace and local links passed. Actual
Chromium153 with real Office HTTP/auth and synthetic records passed navigation,
source-only login, reload/refresh, invalid/offline/denied states, unchanged source
bytes/mtime, zero POST/spawn, hash/download/tamper and explicit return to full Office.
Fresh-context independent source review ACCEPT; focused integration review ACCEPT
independently reran65 tests, verified hashes and preserved T049 code/tests and T29
records. Detailed acceptance and browser receipt remain in the linked task.

This post-merge record supersedes pre-merge pending notes in SUCCESS/task/evidence;
only this bounded feature is closed. Existing Office must run on the browser's
machine with compatible source UI; user enters only its port in Fanzloud and uses
the original private launch URL in the Office tab. Results-only is a UI restriction,
not a new readonly credential. Existing grant source binding remains enforced;
installing changed source may invalidate unused older grants, with no auto renewal.
Live private installation/deployment, live Rust/AP authentication and owner FN07
operation were not verified. Original product AC/MVP/usable tags remain unchanged.
No paid product calls, migration, deployment, credential change or next milestone.
Optional Claude advice was not executed: automatic approval review rejected its
possible cost before launch; no output or success from Claude is claimed.

## M3-U offline continuation — 2026-11-22

Owner direct continuation; [scope and AC](../acceptance/M3-owner-operation.md#m3-u-離線重新核對--2026-11-22).
This is preparation within existing M3-U; the original owner-operation row remains open.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M3-PRE01 | Original saved installation and current prerequisites | PRE01 | done | 2026-11-22T15:44:51Z | 2026-11-22T15:54:06Z | 2026-11-22T15:55:01Z |
| M3-PRE02 | Source drift and concrete owner-operation recovery order | PRE02 | done | 2026-11-22T15:44:51Z | 2026-11-22T15:54:06Z | 2026-11-22T15:55:01Z |
| M3-PRE03 | Independent document review and normal delivery | PRE03 | done | 2026-11-22T15:44:51Z | 2026-11-22T15:54:06Z | 2026-11-22T15:55:01Z |

Offline document source review ACCEPT;55project/9llms indexes,156relative links, six template
hashes, scope/privacy/whitespace/alignment passed. Final CI/merge/readback pending; live
readiness remains not_ready and original M3-U/FN07 stays open. No services or credentials changed.

### M3-U offline preflight delivery

[PR1077](https://github.com/fallrising/newclear/pull/1077) merged normally at
2026-11-22T15:54:06Z as `6896929d93f2c053ede8d93a392a09fb621fe887`.
Final head `1579c88179bcdadedfb0e1f606f677a34eb164d7` passed both required workflows:
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/45040569303) and
[Project success contracts](https://github.com/fallrising/newclear/actions/runs/45040569301).
Hosted Fanzloud includes operator Web/parser, Rust fmt/lint/test/build and whitespace.
Required fresh-context document review ACCEPT;55project/9llms indexes,156relative
links,6public-template hashes, fixed-source diff/embedding and scope/privacy checks
passed. Private host/SQLite/Docker observations remain lead observations, not an
independent runtime review. [Acceptance](../acceptance/M3-owner-preflight-20261122.acceptance.md)
retains actual failures, current not_ready and all unverified boundaries.

Fetched remote main, verified merge ancestry, and compared the entire Fanzloud
component to the final source head: zero diff. This post-merge record supersedes
pre-merge CI/delivery-pending notes in the source documents. Only PRE01–03 offline
preparation is delivered; original M3-U/FN07/fullM3/mainline and usable_tag none remain
open. Historical DB-stopped/readiness statements do not describe today's installation.

Original container is absent in the inspected local default Docker context; original
volume identity remains unknown, data loss is not established. The maintenance dump
is only a verified-file recovery candidate. TLS expired; old binary excludes current
embedded UI fixes; full submit/review gate and owner connection readiness remain open.
Next dependency: locate original AP data and establish an evidence-backed recovery
plan before any restore/source replacement/TLS change/window. No original services,
product CLI, VM, credential changes, intent consumption or DB restore occurred.
The retained private audit/handoff is backed up separately; no private values published.

## M3-U original-data investigation — 2026-11-22

[Scope and AC](../acceptance/M3-owner-data-recovery.md); owner direct continuation.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M3-DATA01 | Locate saved original PostgreSQL candidates | DATA01 | done | 2026-11-22T16:05:21Z | 2026-11-22T16:26:27Z | 2026-11-22T16:27:18Z |
| M3-DATA02 | Bounded offline identity and recovery decision | DATA02 | done | 2026-11-22T16:05:21Z | 2026-11-22T16:26:27Z | 2026-11-22T16:27:18Z |
| M3-DATA03 | Review, CI and normal delivery | DATA03 | done | 2026-11-22T16:05:21Z | 2026-11-22T16:26:27Z | 2026-11-22T16:27:18Z |

Source/diagnostic review ACCEPT after correcting one tar-termination finding;17tests,
actual private snapshot verifier,55/9indexes,165links,hashes/privacy/whitespace pass.
Hosted CI/merge/readback pending; candidate_only/not_ready and original FN07 remain.

### M3-U data-candidate delivery

[PR1081](https://github.com/fallrising/newclear/pull/1081) merged normally at
2026-11-22T16:26:27Z as `73ea922efd70d6180d120e37f18286f4726ed0a6`.
Final head `49d0d09e15b64191a0bd903e4043f115ba4754a2` passed all three required workflows:
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/45043560116),
[Project success contracts](https://github.com/fallrising/newclear/actions/runs/45043560149),
and [Workflow static validation](https://github.com/fallrising/newclear/actions/runs/45043560124).
Hosted Fanzloud includes the17offline-verifier tests, existing Web/parser checks and
Rust fmt/lint/test/build. Fresh-context review initially requested one P1 correction;
full tar-trailer validation and3regression subcases fixed it, focused re-review ACCEPT.
Independent17tests, actual private archive verifier,55project/9llms indexes,165links,
source/test hashes, privacy/scope and whitespace/alignment passed. Failure history and
[acceptance limits](../acceptance/M3-owner-data-recovery.acceptance.md) remain visible.

Fetched remote main; merge ancestry and full Fanzloud plus workflow comparison with
the final source head returned zero diff. Parallel upstream changes were outside those
paths and preserved. This delivery record supersedes pre-merge pending notes; only
DATA01–03 close. Original M3-U/FN07/fullM3/mainline and usable_tag none stay unchanged.

The source inspection found112volumes/30PGdirectories/two major18candidates; one contains
both expected U07 run UUID texts. Two readonly captures of its private69,191,168-byte
snapshot match exactly, and the verifier returns candidate_only. This advances the
previous unknown-location checkpoint, but does not prove current committed rows or
complete result archives. No data-loss or logical-restore success is claimed. The private
snapshot/evidence is preserved under restrictive local backup permissions, never in Git.

All six diagnostic containers stopped normally and their exact owned containers/image
were removed; the112original volumes remain unchanged in inventory. No PostgreSQL/AP,
provider/VM startup, original writable mount, credential change or intent replay occurred.
Next: prepare and independently review bounded isolated-copy PostgreSQL18 logical
verification of task/run/command/archive lineage and cleanup before authorizing its run.
Runtime not_ready, current-source UI selection, full operation gate, TLS/trust and actual
owner FN07 remain open. Hosted CI validates this tool/branch, not a restored installation.

## M3-U isolated-copy validator — 2026-11-22

[Scope/design/AC](../specs/SPEC-M3-copy-validation.md); one Ready task, owner continuation.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M3-COPY01 | Safe private staging | COPY01 | done | 2026-11-22T16:56:56Z | 2026-11-22T17:20:54Z | 2026-11-22T17:22:57Z |
| M3-COPY02 | Bounded copy lifecycle | COPY02 | done | 2026-11-22T16:56:56Z | 2026-11-22T17:20:54Z | 2026-11-22T17:22:57Z |
| M3-COPY03 | Exact logical comparison | COPY03 | done | 2026-11-22T16:56:56Z | 2026-11-22T17:20:54Z | 2026-11-22T17:22:57Z |
| M3-COPY04 | Independent review and delivery | COPY04 | done | 2026-11-22T16:56:56Z | 2026-11-22T17:20:54Z | 2026-11-22T17:22:57Z |

Private-copy execution NOT_RUN; original FN07 remains open.

COPY01–03 source/synthetic acceptance complete; fresh-context review ACCEPT after one
P2 unknown-outcome persistence correction.29tests, real PostgreSQL18.6 synthetic
logical/readonly checks,120.48s autonomous deadline and cleanup pass;112original volume
names unchanged, zero owned containers remain. Source hashes and failure history are
in [acceptance](../acceptance/M3-copy-validation.acceptance.md). Required CI/merge/readback
pending; rows stay in_progress through source merge. Original private-copy NOT_RUN.

Final source precommit:55project/9llms indexes,177relative links, source hashes,
Ruff,29tests and staged/worktree whitespace/alignment pass. Sanitized historical
RED-log trailing whitespace was removed; original private failure output retained.

### M3-U isolated-copy tool delivery

[PR1090](https://github.com/fallrising/newclear/pull/1090) merged normally at
2026-11-22T17:20:54Z as `cb58117ce8c0edd603ad67ff23dfc6c622ded752`.
Reviewed head `1bd205814e5be02432383593eef46b22ad95a77d` passed both required workflows:
[Fanzloud CI](https://github.com/fallrising/newclear/actions/runs/45048659503) and
[Project success contracts](https://github.com/fallrising/newclear/actions/runs/45048659571).
Hosted Fanzloud includes29diagnostic tests, existing Web/parser tests and Rust
format/lint/test/build. Fresh-context review ACCEPT after correcting the P2 private
receipt-write failure that could hide an unknown cleanup state. Reviewer independently
ran29tests, the three-case CLI fault matrix and source-hash/whitespace checks, and
inspected the completed final-source synthetic smoke. Original finding and resolution
remain in the protected review packet; sanitized failures/receipts are in
[acceptance](../acceptance/M3-copy-validation.acceptance.md).

Real synthetic PostgreSQL18.6 passed all seven logical comparisons, read-only write
rejection, persisted outcome, strict launch inspection, autonomous120.48s/exit137 and
confirmed exact-container cleanup. Original112volume names unchanged; no original
volume was mounted and no owned containers remain. The fixed image is retained for
the proposed next diagnostic. Root's broad publication scan failed on unrelated
untracked worktrees/runtime files; the clean tracked-root export passed18studies/
712Markdown. Fanzloud55project/9llms indexes,177relative links, Ruff and staged alignment
passed. These scopes and failure history remain explicit.

Fetched remote main, confirmed source merge ancestry, and compared full Fanzloud,
unchanged AP and Fanzloud workflow bytes with the reviewed head: zero diff. Parallel
upstream changes were outside these paths and preserved. This delivery record
supersedes earlier hosted-CI/merge pending notes and closes COPY01–04 only.

Original private-copy execution remains NOT_RUN. The [concrete one-launch proposal](../specs/SPEC-M3-copy-validation.md#concrete-private-copy-execution-proposal-not-executed)
binds the original9b72f1…snapshot, four saved references, fixed image,120-second
runtime and isolated bounded copy. It awaits the separate execution authorization
required by the existing recovery proposal. No original service/credential/intent
change, worker/provider/VM, release or deployment occurred. Original M3-U/FN07/fullM3,
mainline incomplete and usable_tag none remain unchanged; logical data recovery and
current UI/TLS/owner-operation readiness are not claimed by tool delivery.
