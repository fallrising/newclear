# Agent Platform task board

## T-0380

Approved root ROUND2-SDD R2-AC-4/E; [bounded task](../../fe-review/tasks/round2/task.md). This is the FE review slice, not complete product/VM/provider acceptance.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| AFE2-1 | Isolated true API/fake-backend capture and approved presentation fixes (PR588 merged) | R2-AC-4/E | done | 2026-10-24T08:34:14Z | 2026-10-24T09:14:44Z | 2026-10-24T09:23:07Z |

## T-0087 — Issue #379 manual event retention

[Contract](../EVENT-RETENTION.md), [bounded task](../../tasks/379-event-retention/task.md).
Independent Phase A review accepted after replay/lock/bounds/schema corrections;
implementation follows this committed baseline. Whole AT13/M4 remains incomplete.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0087.1 | Bound approved retention and ownership | EVT-01 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |
| T-0087.2 | Preserve event identity and concurrency | EVT-02 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |
| T-0087.3 | Verify CLI/API/browser expired-history flow | EVT-03 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |
| T-0087.4 | Preserve schema and native backup compatibility | EVT-04 | done | 2026-10-25T06:42:53Z | 2026-10-25T09:59:13Z | 2026-10-25T10:00:38Z |

T0087 delivery: [PR633](https://github.com/fallrising/newclear/pull/633) merged
`ce81af8aef6e0faa4ef10d64d17b8d438c5d69a4` at2026-10-25T09:59:13Z;
head `fa3b1b68f8ba9a37380c04ede453b4590ccd8a39` passed all four required checks.
[Agent Platform CI40182333825](https://github.com/fallrising/newclear/actions/runs/40182333825)
passed45 base tests and700 control-plane tests; [contract CI40182333859](https://github.com/fallrising/newclear/actions/runs/40182333859) passed.
Merged component bytes match the reviewed candidate. This supersedes pre-merge CI-pending
statements in the local [delivery snapshot](../../tasks/379-event-retention/report.md);
original local failures remain historical, not erased or reattributed.
Only EVT01–04 are delivered. Audit retention, stale cleanup, integrated/live acceptance
and whole AT13/M4 remain open under#379; no usable tag, release or deployment.

## T-0089 — Issue #379 manual audit retention

[Contract](../AUDIT-RETENTION.md), [bounded task](../../tasks/379-audit-retention/task.md).
T090 independently accepted the policy/dependency/guard design before implementation.
Whole AT13/M4 remains incomplete.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0089.1 | Bound explicit90-day approvals | AUD-01 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |
| T-0089.2 | Guard atomic audit removal and replay | AUD-02 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |
| T-0089.3 | Preserve authoritative control state | AUD-03 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |
| T-0089.4 | Verify native backup and compatibility | AUD-04 | done | 2026-10-25T11:55:18Z | 2026-10-25T13:19:39Z | 2026-10-25T15:31:47Z |

T0089 delivery: [PR641](https://github.com/fallrising/newclear/pull/641) merged
`234daf32cad60af231abf35fb44cfdd75bbe2a6c` at2026-10-25T13:19:39Z;
head `9e052ff6935b7121c108be5e5c230f4fd14d6165` passed all four required checks.
[Agent Platform CI40196623154](https://github.com/fallrising/newclear/actions/runs/40196623154)
passed45 base tests and724 platform tests; [contract CI40196623122](https://github.com/fallrising/newclear/actions/runs/40196623122) passed.
Merged component bytes match the reviewed candidate. T090 independently accepted
AUD01–04 focused22/native3 and the additional pause fixture correction19 tests.
The initial hosted723 run had722pass/1pause-helper failure. A deterministic real
row-lock RED demonstrated that helper's immediate-claim assumption; bounded waiting
fixed the fixture without changing production or outcome assertions. The original
CI lock owner/interleaving remains unrecorded. Earlier focused21pass/1fail and
older event-regression failures remain preserved in the [dated report](../../tasks/379-audit-retention/report.md).
This delivery record supersedes that snapshot's pending-CI status. T0087 done rows
were also delivered by PR641; its standalone board candidate needs no duplicate PR.
Only the bounded audit/event slices are delivered. Stale runtime cleanup, integrated
fake/live acceptance and whole AT13/M4 remain open under#379; no usable tag, release or deployment.

## T-0092 — Issue #379 manual stale binding cleanup

Contract baseline `1b47738b` preceded actual RED. Independent T093 accepted local
STALE01–03 after the required HTTP overlap fixture; PR649 has normally merged.
See the [dated delivery snapshot](../../tasks/379-stale-cleanup/report.md).
SDD13.2, INV-12 and AT-13 preserve unknown resources and active recovery state.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0092.1 | Bound exact owned resource and explicit approval | STALE-01 | done | 2026-10-25T15:39:34Z | 2026-10-25T17:00:58Z | 2026-10-25T17:09:17Z |
| T-0092.2 | Fence one release attempt and preserve replay | STALE-02 | done | 2026-10-25T15:39:34Z | 2026-10-25T17:00:58Z | 2026-10-25T17:09:17Z |
| T-0092.3 | Reconcile capacity and preserve native backup | STALE-03 | done | 2026-10-25T15:39:34Z | 2026-10-25T17:00:58Z | 2026-10-25T17:09:17Z |

T0092 delivery: [PR649](https://github.com/fallrising/newclear/pull/649) normally merged
`ce5b5e6848884bf92ea0bca4c72f4acc877057f5` at 2026-10-25T17:00:58Z;
head `9635e645f1e7eebb7f8ae32d4078af33e1ac3585` passed all four required checks:
[Agent Platform CI40212776640](https://github.com/fallrising/newclear/actions/runs/40212776640)
check/control-plane/web and [contracts40212776776](https://github.com/fallrising/newclear/actions/runs/40212776776)
validate. Hosted 45 base and 755 platform tests passed. The entire merged component
matches the reviewed head. T093 independently accepted STALE01–03; local evidence
is 28 focused + 2 real HTTP overlap + 1 native pg_dump/restore + 12 related cases.
The HTTP upstream is synthetic; no live VM or sandboxd qualification is claimed.
Original expected RED, initial author lint failures, and earlier event/audit failures
remain preserved in the dated reports and raw evidence, not rewritten as first-green.

Cleanup covers one explicitly approved terminal owned binding, its original capability,
current lease/fence and at most one release request per attempt. Original uncertain
intent and permanent tombstone remain; existing recovery alone releases capacity after
independently confirming complete stop proof. No SQL migration or backup pin changed.
T0089 audit done rows were delivered with PR649; its preserved standalone candidate
needs no duplicate PR. This record supersedes stale pre-merge status in the dated snapshot.
Unknown host residue, complete same-version fake/live AT09/12/13, VM recovery,
actual deployment and whole M4 remain open under #379; no usable tag or release.

## T-0096 — Issue #379 fake cross-flow acceptance

Test-only integration from delivered PR649; no product defect established.
The [contract](../../tasks/379-fake-composite/task.md) preserves full M4/live scope.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0096.1 | Compose stale recovery and explicit fake HTTP export | COMP-01 | done | 2026-10-25T17:22:16Z | 2026-10-25T17:37:36Z | 2026-10-25T17:38:25Z |
| T-0096.2 | Preserve cross-flow authority through native restore | COMP-02 | done | 2026-10-25T17:22:16Z | 2026-10-25T17:37:36Z | 2026-10-25T17:38:25Z |

T0096 delivery: [PR653](https://github.com/fallrising/newclear/pull/653) normally merged
`ada118988b909c6aa826a76da8939e1ec7451432` at 2026-10-25T17:37:36Z;
head `fdbc3624260abb1004e98b20e2c2c2d08aeadf71` passed all four required checks:
[Agent Platform40216767283](https://github.com/fallrising/newclear/actions/runs/40216767283)
check/control-plane/web and [contracts40216767243](https://github.com/fallrising/newclear/actions/runs/40216767243)
validate. Hosted45 base/756 platform tests passed, including the new composition.
The entire merged component matches the reviewed candidate. T097 independently
accepted COMP01/02; T098-composite1 ran one new local scenario/2.234s with real
native dump/restore, and static177/43contracts/6indexes passed. Product code is unchanged.

The same DB joins terminal result/release fault, approved stale cleanup, independent
recovery, authenticated in-process API export, fake GitHub loopback HTTP reply loss
and GET-only reconciliation, then native restore. Restored completed intents stay
idle; durable rows, private journal/fences and external effect counts are preserved.
The original test-only unreachable SQL scheduling shortcut was rejected before runtime
and retained as review evidence. Prior failure history remains unchanged.
T0092 stale done rows were delivered by PR653; its standalone candidate needs no
separate PR. This supersedes pre-merge status in the dated delivery snapshot.
Full GC-operation composition/browser/fake E2E, live VM/sandboxd/provider,
unknown host residue/deployment and whole M4 remain open under #379.

## T-0100 — Issue #379 browser retention/export composition

Test-only BGC01/02 integration; [contract](../../tasks/379-browser-retention/task.md).

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0100.1 | Browser-approved export survives actual event/archive GC | BGC-01 | done | 2026-10-25T17:51:39Z | 2026-10-25T18:11:09Z | 2026-10-25T18:11:45Z |
| T-0100.2 | Stale browser archive controls refuse expired payload | BGC-02 | done | 2026-10-25T17:51:39Z | 2026-10-25T18:11:09Z | 2026-10-25T18:11:45Z |

T0100 delivery: [PR655](https://github.com/fallrising/newclear/pull/655) normally merged
`0b4e42d9cd27e4d4ede935f0a09c992c42fa58a7` at 2026-10-25T18:11:09Z; exact reviewed head
`499bc7b1a989b5e2abacffb2e991fd4365793689` passed all four required checks:
[Agent Platform40219513690](https://github.com/fallrising/newclear/actions/runs/40219513690)
check/control-plane/web and [contracts40219513705](https://github.com/fallrising/newclear/actions/runs/40219513705)
validate. Hosted45 base+756 platform passed; merged component equals reviewed head.
T101 independently accepted BGC01/02; one new local Chromium/SQL/API/GC/fakeHTTP
scenario passed9.8s, scopedTS/Prettier/Ruff178/43contracts/6indexes passed.
Initial9E501 lint and two45s browser body-collection timeouts remain preserved;
final test separates real browser410/UI/no-file from independent API410JSON, without
production edits, timeout increase or behavior assertion removal.

A fresh browser approval protects its historical archive through actual GC; event
prefix expires and UI reconnects; unreferenced B expires and stale controls refuse.
History is explicitly synthetic first INSERTs, GitHub upstream synthetic HTTP.
No observed31day lifecycle, fullfake/liveAT09/12/13, hostresidue cleanup, VMrecovery,
deployment or fullM4 acceptance. Issue379 staysOPEN; no release/tag.
T0096 COMPdone rows delivered with PR655; originala36 candidate preserved/no duplicatePR.
This record supersedes pre-merge wording in the dated local delivery snapshot.

## T-0104 — Issue #379 expired export availability

[Contract](../../tasks/379-expired-export/task.md); bounded workbench correction.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0104.1 | Reflect exact preview/approval archive expiry immediately | EUX-01 | done | 2026-10-25T18:19:18Z | 2026-10-25T18:37:47Z | 2026-10-25T18:38:12Z |
| T-0104.2 | Preserve auth/replay and verify real browser GC flow | EUX-02 | done | 2026-10-25T18:19:18Z | 2026-10-25T18:37:47Z | 2026-10-25T18:38:12Z |

T0104 delivery: [PR658](https://github.com/fallrising/newclear/pull/658) normally merged
`d81a7d91415d4e4733a58c61fa9b72f32412b1e0` at 2026-10-25T18:37:47Z; exact reviewed head
`7568503df96e5e6e565a7d695990d64f71957e11` passed all four required checks:
[Agent Platform40221618082](https://github.com/fallrising/newclear/actions/runs/40221618082)
check/control-plane/web and [contracts40221617968](https://github.com/fallrising/newclear/actions/runs/40221617968)
validate. Hosted45 base+756 platform and103 web tests passed; merged component equals reviewed head.
T105 independently accepted EUX01/02 after genuine rendered-App RED6fail/12pass.
Thirty distinct focused web cases passed (18new,7ExportPanel,5archive); type/format
and freshVitebuild passed, updated real Chromium/SQL/API/GC/fakeHTTP browser1/9.6s.
Original RED, test-type mistake and A/B fixture mistake remain preserved; corrections
were independently reviewed. Product change is limited to App and ExportPanel.

Exact preview/approval410 artifact_expired immediately retires affected controls,
retains result/diff/hash/size and refreshes source-run archives. Failed/stale refetch
cannot resurrect actions; no fabricated pruned_at. Late responses stay scoped;
auth/transient/lost-key/reconcile behavior remains correct. Backend unchanged.
Historical browser cohort and GitHub HTTP upstream are synthetic; no fullfake/live
AT09/12/13/VMrecovery/deployment/M4 acceptance. Issue379 staysOPEN; no release/tag.
T0100 BGCdone rows delivered with PR658; originalecd66b08 preserved/no duplicatePR.
This record supersedes pre-merge wording in the dated local delivery snapshot.

## T-0108 — download expiry availability

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0108.1 | Retain definitive download expiry across failed/stale metadata refresh | DUX-01 | done | 2026-10-26T07:03:53Z | 2026-10-26T07:23:34Z | 2026-10-26T07:23:52Z |
| T-0108.2 | Preserve error boundaries, source-run isolation and real download GC flow | DUX-02 | done | 2026-10-26T07:03:53Z | 2026-10-26T07:23:34Z | 2026-10-26T07:23:52Z |

T0108 delivery: [PR659](https://github.com/fallrising/newclear/pull/659) normally merged
`760fffab68d4da3cbb779fc5f5743f41ecab0585` at 2026-10-26T07:23:34Z; reviewed head `5b3e630dcb2e699866d11d0c51cb26d6e630c558`.
Four required checks passed: [Agent Platform40284753845](https://github.com/fallrising/newclear/actions/runs/40284753845)
check/control-plane/web and [contracts40284753927](https://github.com/fallrising/newclear/actions/runs/40284753927)
validate. Raw hosted45 base+756 platform and118 web tests passed; merged component equals reviewed head.
T109 independent review ACCEPT; root delivery gate passed43contracts/6indexes/source protection.
Actual rendered-App RED11fail/4pass retained; frozen tests then38focusedweb PASS,
strictTS/scopedformat, two test-helper Ruff/format, freshVitebuild and one browser3.5s PASS.

Download exact410 artifact_expired immediately retires affected controls while preserving
result/diff/hash/size through failed/stale metadata refresh. Other410/malformed/network
errors remain retryable;401 refreshes session; source-run identity and successful bytes/
fixedfilename/URLcleanup preserved. Only App product source changed; backend unchanged.
Browser uses synthetic historical firstINSERTs, exacttwo ownedarchiveGC with unchanged
authority/events and explicit metadata-network fault. Legacy trigger-disabling helper was
not executed. No fullfake/live/VMrecovery/deployment/M4 acceptance; issue379 staysOPEN.
T0104 EUXdone board delivered with659; original59a33fc8 preserved without duplicatePR.
This post-merge record supersedes pre-merge wording in the dated local snapshot.

## T-0112 — Worker result truth in browser

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- |
| T-0112.1 | Present actual failed and unverified Worker outcomes without false verification success | RTF-01 | in_progress | 2026-10-26T08:15:28Z | | 2026-10-26T08:31:12Z |
| T-0112.2 | Preserve interrupted/resultless archive-failure UI and held capacity | RTF-02 | in_progress | 2026-10-26T08:15:28Z | | 2026-10-26T08:31:12Z |

## T-0447 — Fanzloud M1 isolated executor dependency

[Contract](../EXTERNAL-WORKSPACE.md); parent T-0442.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0447.1 | Run-scoped external workspace API | EX-01 | done | 2026-10-31T18:37:19Z | 2026-10-31T19:40:53Z | 2026-10-31T19:40:53Z |
| T-0447.2 | Actual VM isolation and cleanup | EX-02 | done | 2026-10-31T18:37:19Z | 2026-10-31T19:40:53Z | 2026-10-31T19:40:53Z |
| T-0447.3 | Subscription CLI coding qualification | EX-03 | done | 2026-10-31T18:37:19Z | 2026-10-31T19:40:53Z | 2026-10-31T19:40:53Z |


## T-0442 — Fanzloud M2 bounded second subscription route

[Scope and acceptance](../../../fanzloud/docs/specs/SPEC-M2-two-vendors.md).
Existing T-0447 executor authority is reused; this does not open another AP milestone.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| M2-route | Exact Codex admission/driver, trusted tool boundary and native backup compatibility | M2-01/02 | in_progress | 2026-11-01T04:15Z | — | 2026-11-01T04:55Z |

Code review corrections and native backup31 tests passed; actual Codex Web execution
and concurrent workspace proof remain pending. Host ceiling remains one4CPU/4GiB VM.
