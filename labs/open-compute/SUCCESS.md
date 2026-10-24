---
project: labs/open-compute
purpose: 驗證固定 open-compute release 的有界持久狀態與人工操作生命週期
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# open-compute 成功契約

## 主線與範圍

固定上游v0.2.4，以原始release、非root Linux x64與合成Worker驗證M1–M7。
主線從Worker→D1→等待Workflow，延伸正常restart、完整Local冷還原、
資源／磁碟觀測、checkpoint SIGKILL、受控callback retry與retained人工trial。
各里程碑契約見 [SDD](docs/SDD.md) 與 [STATUS](docs/STATUS.md) 的M2–M7連結。
不保證任意Workers相容、host安裝、惡意程式隔離、HA、power loss、capacity或外部exactly-once。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 新建owned scope與等待Workflow，When 正常restart及完整備份後刪來源再還原，Then 原D1／R2／Workflow與nonce保持。 | historical | [M1報告](docs/evidence/2026-10-07-m1-ci.json)、[M2報告](docs/evidence/2026-10-08-m2-ci.json)。 |
| AC-02 | Given 固定idle/read workload與冷磁碟狀態，When 採樣程序及三次cold endpoint，Then 輸出有單位與coverage限制的觀測。 | historical | [M3](docs/evidence/2026-10-13-m3-ci.json)、[M4](docs/evidence/2026-10-13-m4-ci.json)；不推導容量。 |
| AC-03 | Given 公開checkpoint與受控callback失敗，When SIGKILL／retry，Then 原狀態可核對且效果計數符合限定oracle。 | historical | [M5](docs/evidence/2026-10-16-m5-ci.json)、[M6](docs/evidence/2026-10-17-m6-ci.json)；非斷電或外部副作用exactly-once。 |
| AC-04 | Given retained trial，When 三個foreground owner跨stop/start操作後顯式cold destroy，Then 保留狀態、單一D1效果及精確清理成立。 | historical | [M7報告](docs/evidence/2026-10-17-m7-ci.json)、[STATUS](docs/STATUS.md)：20回覆、3個daemon generation。 |
| AC-05 | Given 整合後主線版本，When M4 cold_after_writes關閉觀測，Then 所有owned generations退出且cold證據完整。 | failed | [STATUS M7後續驗證](docs/STATUS.md)：2026-10-17紀錄run39048597519遇parent-edge change，cold observation／cleanup被拒；根因未定。 |

## 現況與缺口

M1–M7確實有原始runtime的bounded CI結果，並非只有mock harness。
M7當輪276tests、五個CI jobs成功，仍不能掩蓋其後integrated-main的M4失敗。
退出碼0與無force不足以證明整棵程序樹已停止；既有拒絕guard保留。
因此主線目前incomplete，需先解釋／修復後續失敗並對目標版本補驗。
retained trial不是daemon服務；lease上限不是soak，Workflow仍有270秒同boot操作限制。
RSS可能重複共享頁、磁碟只計regular-file metadata，不提供完整容量或每row成本。

## 啟動與驗證

依 [quickstart](docs/quickstart.md) 與 [Makefile](Makefile) 使用 `make check`。
真runtime閘門為 `make integration`、`make integration-restore`、
`make integration-resources`、`make integration-storage`、`make integration-crash`、
`make integration-retry`、`make integration-trial`，各自遵循fresh非root runner條件。
M7只有精確manifest與clean receipt才可恢復原scope；一般M1–M6禁止採納既有scope。
2026-10-21 歷史 inventory 核對未下載release、建立帳號、啟動daemon或刪除任何runtime資料。

2026-10-21 歷史 inventory 只核對文件、程式入口與既有證據；未執行產品建置或外部整合。下方 Issue548 節另記錄本次 maintenance 的實際執行結果。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
先調查integrated-main M4 parent-edge failure，保留失敗artifact，再完成目標版本對應必要gate。
未來最多可標記M1–M7限定lab能力；不能擴為通用生產平台、長期可靠性或host部署資格。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。

## Issue548: bounded failure diagnostics (maintenance)

### M4 kernel closure continuation (contract baseline, T077)

This proposed implementation replaces M4's sampled descendant ownership with a
fresh same-PID exec runner, checked subreaper and single-use kernel-owned epochs.
It does not change generic Process/command, M1–M3/M5–M7, storage measurement,
upstream, workload or existing historical reports. Exact contract/schema/constants:
[SDD-M4 kernel closure amendment](docs/SDD-M4.md#m4-kernel-closure-amendment-t077).

AC-K1: every M4 subprocess, including source identity/version/setup, belongs to a
bounded main-thread registry; three cold boundaries require closed launches,
completed waits/drains, checked policy and actual ECHILD before snapshots.
AC-K2: immutable single-use receipts govern snapshot/epoch progression and fresh
final cleanup; authority/cancel/identity/policy/live-child uncertainty forbids
snapshot/removal. Ordinary workload/metadata failure never becomes success and
permits removal only after fresh verified closure and unchanged scope authority.
AC-K3: strict additive lifecycle evidence separates incomplete sampled liveness
from whole-tree kernel closure, preserves actual daemon identities/status and
rejects forged counts/types/private fields. AC-K4: causal/adversarial focused
tests, independent review, one full offline gate and one authorized original M4
qualification bind the resulting behavior to exact source/artifact evidence.

The committed baseline began with all AC-K checks not_run; root reviewed and
committed it before releasing implementation. The evidence below supersedes that
initial state. Historical AC-05 attribution and whole-mainline acceptance remain
separate from this bounded current-source qualification.

Phase B candidate evidence: root committed the contract baseline before release.
AC-K1–K3 have51 focused offline passes on Python3.11.17, including actual
three-generation kernel closure, unchanged generic refusal under the same causal
fixture, stable-child/transient-helper sampling, live orphan blocking and typed
authority failures. Production/test source digest:
`57be515883f0933712f89517a2ac7526d1b82eff79544c48d839e9603247a566`.
The earlier893611 source had331 root offline passes but was superseded after
review reproduced expired receipt/seal authorization. Two actual RED/GREEN cases
now verify immutable original deadlines; CLI output retains the original bounded
tail-ring semantics. Root reports332 full offline passes and T078 independent
ACCEPT on the corrected source. One original-artifact M4 qualification passed in61.007s: all five M4 and eight
functional checks, three closed epochs/snapshots and verified owned removal.
AC-K1–K4 local implementation/qualification checks are passed; hosted CI and normal
PR merge remain delivery gates. See [actual report](docs/evidence/2026-10-24-m4-kernel-closure.json),
[source binding](docs/evidence/2026-10-24-m4-kernel-closure-source.json) and
[implementation report](tasks/548-m4-kernel-closure/report.md). This does not
reconstruct the historical exact generation/edge or grant whole-mainline acceptance.

### Observation reason retention (2026-10-24 continuation)

Scope: preserve the fixed observation reason already recorded by Process when
later reads or shutdown rethrow its latched refusal. AC-D4 requires repeated
snapshot/identity/live/children reads and command cleanup to retain that reason
in strict diagnostic projection, without admitting a child or claiming clean
shutdown after an observation error. Plan: deterministic RED/GREEN coverage,
focused and full offline regression, independent review and exact-head CI.
AC-D4 local evidence:319 whole offline tests and25 independent focused tests pass;
independent real-process RED/GREEN proves reason retention while cleanup still
refuses success. Independent review accepts; exact-head CI/publication are separate.
Historical M4/AC-05 attribution remains unresolved; no new local real-runtime pass
is claimed by this maintenance correction.

This slice preserves existing M1–M7 behavior, report schemas, guards and exit codes.
AC-D1: independent version1 diagnostic artifacts contain only rebuilt typed enums,
source identity, bounded counts/exit status and separate original/cleanup/evidence
failure facts; hostile or unavailable evidence cannot leak raw output or claim pass.
AC-D2: CI always attempts fixed-file diagnostic publication, with30-day retention
and no raw log/state/backup uploads. AC-D3: current four reported runtime profiles
are attempted once each in fresh actual-passwd non-root network-disabled containers;
any repeated profile needs a diagnosed condition/test and max2 attempts.
Plan: strict projection/publication RED-GREEN, all existing276 offline tests,
container preflight and verified original artifact, four bounded profiles, independent
review/CI. Until actual results are recorded, original AC-05 remains failed and
mainline incomplete. No usable/release/deployment claim is added.

Maintenance evidence: AC-D1/D2 local implementation/static gates pass;290offline
checks pass. AC-D3 is partial: one real fresh-container run each restore/crash/storage
passed, retained-manual failed at first_owner (original bootstrap/child_missing,
then cleanup shutdown). No profile repeated. See [548 report](tasks/548-failure-diagnostics/report.md)
for exact source/evidence and ownership-proof follow-up. Historical M4 cause is not
resolved by one pass. Mainline/AC-05/tag status remain unchanged; parent CI/review
and publication still required.

## Issue548: lifecycle admission (T066, 2026-10-24)

The M7-only same-PID owner/private SupervisedCapture repair is implemented and has
offline evidence. Generic Process/Capture, M1–M6, upstream pin/workload, public
schemas and normal manual mode remain unchanged. Closed launches, checked
subreaper/SIGCHLD, quiesced waits/threads and actual ECHILD establish closure.
Opted init/serve leave clean=false; only the integration parent after validated
closure, actual exit0, complete expected output and locked identity/hash checks
may commit clean=true. Stop clients cannot commit a serving owner's state.

| Maintenance AC | Current evidence and limit |
| --- | --- |
| AC-L1 | T063 actual causal/double-fork probes and preserved generic refusal; exact earlier vanished role remains unknown. |
| AC-L2 | T067 independent ACCEPT; author318 and root318 offline tests pass on the same frozen source. |
| AC-L3 | One fresh original-runtime M7 trial passes all five acceptance checks in80.892s; exact publication/CI remains a separate gate. |

Final local gate:318tests/39.636s on verified official Python3.11.17, all30 frozen
source/workload/build hashes unchanged before/after, no unexpected descendants,
final ECHILD. The auditor collected one exact known M5 SIGKILL fixture orphan
after matching its actual verified PID/start receipt; M5 source/oracle is unchanged.
Frozen digest: `71a4040e996cc06f6c8b6390d95d7e437b488f98b54fa3436ba95ac8d8c07b55`.

The earlier317-test run failed one unchanged resource fixture. Baseline and
candidate timing pairs reproduced its truncated last50ms helper budget on system
Python and the CI SDK. The reviewed test-only correction retains four scheduled
samples with four full intervals and adds scheduled_slots==4; every production
deadline/interval and existing assertion remains. Original failures are retained.

See [current contract](docs/SDD.md), [status](docs/STATUS.md) and
[maintenance report](tasks/548-lifecycle-admission/report.md).
T063's production-unchanged checkpoint is historical and superseded by this
implementation; its two causal tests remain unchanged. The old real trial failure,
historical M4 attribution gap, AC-05 failed/mainline incomplete and usable_tag none
remain until separately supported. No actual runtime was run by T066.

Root T069 subsequently ran the separately released original-artifact trial:
actual UID1001/Linux x86_64/Python3.12.3,20 expected command results, three distinct
daemon generations, three nonforced SIGTERM/exit0 receipts, retained data and
explicit scope removal all pass. Source remained unchanged and the owned container
was absent afterward. See [actual report](docs/evidence/2026-10-24-m7-supervision.json)
and [source binding](docs/evidence/2026-10-24-m7-supervision-source.json).
The recorded harness commit is the working-tree base; the source hashes bind the
reviewed repair. This M7 pass does not resolve historical M4/AC-05 attribution.

T071 CI follow-up changes only two test fixtures: generated temporary scripts
load the trusted component path explicitly, and their test classes clear ambient
PYTHONPATH. The first hosted offline run failed7 assertions/14errors from missing
imports; those failures are retained. The corrected full318 tests pass in39.238s
with PYTHONPATH absent. Final test/source digest is
`aa7c3c86935ee78ce04ed1542aa68469760cc30a400a43f59733c3ba47944fe2`.
All actual-runtime production bytes remain identical to the80.892s trial; the
source-binding artifact records this test-only delta without rewriting that run.
